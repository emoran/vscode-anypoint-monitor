import * as vscode from 'vscode';
import * as fs from 'fs';
import axios from 'axios';
import { refreshAccessToken } from './DeveloperInfo'; // adjust path if needed
import {showApiManagerAPIDetail} from '../anypoint/apiMananagerAPIDetail'; // adjust path if needed

// Keep references so we can update the same panel
let currentPanel: vscode.WebviewPanel | undefined;
let currentContext: vscode.ExtensionContext | undefined;
let currentEnvironmentId: string;
let currentOrganizationId: string;

export async function showAPIManagerWebview(
  context: vscode.ExtensionContext,
  environmentId: string,
  organizationId: string
) {
  currentPanel = vscode.window.createWebviewPanel(
    'apiManagerAPIs',
    'API Manager - APIs',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  currentContext = context;
  currentEnvironmentId = environmentId;
  currentOrganizationId = organizationId;

  // Initial load
  await loadAPIsAndRender();

  // Listen for messages (CSV download, open details, refresh, etc.)
  currentPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case 'downloadCSV':
        {
          const csvContent = generateAPIsCsv(message.data);
          const uri = await vscode.window.showSaveDialog({
            filters: { 'CSV Files': ['csv'] },
            saveLabel: 'Save APIs as CSV',
          });
          if (uri) {
            fs.writeFileSync(uri.fsPath, csvContent, 'utf-8');
            vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
          }
        }
        break;

      case 'openApiDetails':
        {
          // Implement a new webview that displays details for this record
          showApiDetailsWebview(
            context,
            message.recordId,
            message.organizationId,
            message.environmentId,
            'accessToken' // or re-fetch from secrets if you prefer
          );
        }
        break;

      case 'refreshAPIs':
        {
          // User clicked Refresh button
          await loadAPIsAndRender();
        }
        break;

      default:
        break;
    }
  });
}

/**
 * Fetches data from the API with refresh logic, updates the existing webview’s HTML.
 */
async function loadAPIsAndRender() {
  if (!currentPanel || !currentContext) return;

  let accessToken = await currentContext.secrets.get('anypoint.accessToken');
  const apiUrl = `https://anypoint.mulesoft.com/apimanager/xapi/v1/organizations/${currentOrganizationId}/environments/${currentEnvironmentId}/apis?pinnedFirst=true&sort=name&ascending=false`;

  let apiData: any[] = [];
  try {
    const response = await axios.get(apiUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    apiData = response.data.instances || [];
  } catch (error: any) {
    // Handle 401 token refresh
    if (error.response?.status === 401) {
      vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
      const didRefresh = await refreshAccessToken(currentContext);
      if (!didRefresh) {
        vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
        return;
      }

      // Retrieve the new token from secrets
      accessToken = await currentContext.secrets.get('anypoint.accessToken');
      if (!accessToken) {
        vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
        return;
      }

      // Retry once
      try {
        const retryResp = await axios.get(apiUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (retryResp.status !== 200) {
          throw new Error(`APIs request failed (retry) with status ${retryResp.status}`);
        }
        apiData = retryResp.data.instances || [];
      } catch (retryErr: any) {
        vscode.window.showErrorMessage(`Retry after refresh failed: ${retryErr.message}`);
        return;
      }
    } else {
      vscode.window.showErrorMessage(`Error fetching environment APIs: ${error.message}`);
      return;
    }
  }

  // Update the existing panel's HTML with new data
  currentPanel.webview.html = getAPIManagerHtml(
    apiData,
    currentPanel.webview,
    currentContext.extensionUri,
    currentEnvironmentId,
    currentOrganizationId
  );
}

/**
 * Generate the HTML for the API Manager table.
 * Includes a Refresh button that triggers a message to the extension.
 */
function getAPIManagerHtml(
  apis: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  environmentId: string,
  organizationId: string
): string {
  const jqueryJs = 'https://code.jquery.com/jquery-3.6.0.min.js';
  const dataTableJs = 'https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js';
  const dataTableCss = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';
  const googleFontLink = 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap';

  function renderStatus(status: string): string {
    switch (status) {
      case 'active':
        return `<span class="status-indicator active">active</span>`;
      case 'unregistered':
        return `<span class="status-indicator unregistered">unregistered</span>`;
      case 'inactive':
        return `<span class="status-indicator inactive">inactive</span>`;
      default:
        return `<span class="status-indicator unknown">${status}</span>`;
    }
  }

  const rowsHtml = apis
    .map((api) => {
      const name = api.asset?.exchangeAssetName || '';
      const version = api.assetVersion || '';
      const stage = api.stage || '';
      const tech = api.technology || '';
      const status = renderStatus(api.status || '');
      const autodisco = api.autodiscoveryInstanceName || '';

      const createdDate = api.audit?.created?.date
        ? new Date(api.audit.created.date).toLocaleString()
        : '';
      const updatedDate = api.audit?.updated?.date
        ? new Date(api.audit.updated.date).toLocaleString()
        : '';

      return `
        <tr>
          <td>
            <a href="#" class="api-name"
               data-id="${api.id}"
               data-org="${organizationId}"
               data-env="${environmentId}">
              ${name}
            </a>
          </td>
          <td>${version}</td>
          <td>${stage}</td>
          <td>${tech}</td>
          <td>${status}</td>
          <td>${autodisco}</td>
          <td>${createdDate}</td>
          <td>${updatedDate}</td>
        </tr>
      `;
    })
    .join('');

  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>API Manager - APIs</title>
    <link rel="stylesheet" href="${dataTableCss}" />
    <link rel="stylesheet" href="${googleFontLink}" />
    <style>
      :root {
        --bg-color: #0D1117;
        --card-color: #161B22;
        --text-color: #C9D1D9;
        --accent-color: #58A6FF;
        --table-head-bg: #21262D;
        --table-border-color: #30363D;
        --hover-color: #21262D;
      }

      body {
        background-color: var(--bg-color);
        color: var(--text-color);
        font-family: 'Fira Code', monospace;
        margin: 0;
        padding: 0;
      }

      .container {
        width: 90%;
        max-width: 1200px;
        margin: 1rem auto;
      }

      .card {
        background: var(--card-color);
        padding: 1rem;
        border-radius: 6px;
      }

      h2 {
        margin: 0 0 1rem 0;
        font-size: 1.2rem;
        color: var(--accent-color);
      }

      .button {
        background: var(--accent-color);
        color: #fff;
        padding: 8px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
      }
      .button:hover {
        background: #3186D1;
      }

      .button-group {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        background: var(--table-head-bg);
        color: var(--accent-color);
        border-bottom: 1px solid var(--table-border-color);
      }
      td {
        border-bottom: 1px solid var(--table-border-color);
      }
      tr:hover {
        background: var(--hover-color);
      }

      .status-indicator {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.85rem;
        font-weight: 600;
        text-transform: capitalize;
      }
      .status-indicator.active {
        background-color: #3fb950; /* green */
        color: #fff;
      }
      .status-indicator.unregistered,
      .status-indicator.inactive {
        background-color: #f85149; /* red */
        color: #fff;
      }
      .status-indicator.unknown {
        background-color: #808080;
        color: #fff;
      }

      .dataTables_length,
      .dataTables_filter,
      .dataTables_info,
      .dataTables_paginate {
        font-size: 0.9rem;
        margin: 0.5rem 0;
      }
      .dataTables_length select {
        background-color: #121212;
        color: var(--text-color);
        border: 1px solid var(--table-border-color);
        border-radius: 4px;
        padding: 2px 8px;
        outline: none;
      }
      .dataTables_filter input[type='search'] {
        background-color: #121212;
        color: var(--text-color);
        border: 1px solid var(--table-border-color);
        border-radius: 4px;
        padding: 2px 8px;
        outline: none;
      }

      .api-name {
        color: var(--accent-color);
        text-decoration: none;
      }
      .api-name:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h2>API Manager - APIs</h2>
        <div class="button-group">
          <button id="downloadCSV" class="button">Download as CSV</button>
          <button id="refreshAPIs" class="button">Refresh</button>
        </div>
        <table id="apiTable" class="display">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Stage</th>
              <th>Technology</th>
              <th>Status</th>
              <th>Autodiscovery</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
    <script src="${jqueryJs}"></script>
    <script src="${dataTableJs}"></script>
    <script>
      const vscode = acquireVsCodeApi();

      // CSV download
      document.getElementById('downloadCSV').addEventListener('click', () => {
        vscode.postMessage({
          command: 'downloadCSV',
          data: ${JSON.stringify(apis)},
        });
      });

      // Refresh button
      document.getElementById('refreshAPIs').addEventListener('click', () => {
        vscode.postMessage({
          command: 'refreshAPIs'
        });
      });

      $(document).ready(function () {
        $('#apiTable').DataTable({
          pageLength: 10,
          lengthMenu: [[10, 25, 50, 100], [10, 25, 50, 100]],
          language: {
            lengthMenu: 'Show _MENU_ entries',
            search: 'Search:',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            infoEmpty: 'Showing 0 to 0 of 0 entries',
            zeroRecords: 'No matching entries found',
            paginate: {
              first: 'First',
              last: 'Last',
              next: 'Next',
              previous: 'Previous'
            }
          }
        });

        // Handle clicks on the Name column to open a new webview
        document.querySelectorAll('.api-name').forEach(link => {
          link.addEventListener('click', (event) => {
            event.preventDefault();
            const target = event.target;
            const recordId = target.getAttribute('data-id');
            const orgId = target.getAttribute('data-org');
            const envId = target.getAttribute('data-env');

            vscode.postMessage({
              command: 'openApiDetails',
              recordId: recordId,
              organizationId: orgId,
              environmentId: envId
            });
          });
        });
      });
    </script>
  </body>
</html>
`;
}

/** CSV generator */
function generateAPIsCsv(apis: any[]): string {
  const headers = [
    'Name',
    'Version',
    'Stage',
    'Technology',
    'Status',
    'Autodiscovery'
  ];
  const rows = apis.map((api) => [
    api.asset?.exchangeAssetName ?? '',
    api.assetVersion ?? '',
    api.stage ?? '',
    api.technology ?? '',
    api.status ?? '',
    api.autodiscoveryInstanceName ?? ''
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function showApiDetailsWebview(
  context: vscode.ExtensionContext,
  recordId: string,
  organizationId: string,
  environmentId: string,
  accessToken: string
) {
    
    showApiManagerAPIDetail(context, recordId, environmentId, organizationId, accessToken);


}