import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import {showApiManagerAPIDetail} from '../anypoint/apiMananagerAPIDetail'; // adjust path if needed
import { telemetryService } from '../services/telemetryService';

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
  telemetryService.trackPageView('apiManager');
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
            message.environmentId
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

  const { getBaseUrl } = await import('../constants.js');
  const baseUrl = await getBaseUrl(currentContext);
  const apiUrl = `${baseUrl}/apimanager/xapi/v1/organizations/${currentOrganizationId}/environments/${currentEnvironmentId}/apis?pinnedFirst=true&sort=name&ascending=false`;

  let apiData: any[] = [];
  try {
    const apiHelper = new ApiHelper(currentContext);
    const response = await apiHelper.get(apiUrl);
    apiData = response.data.instances || [];
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error fetching environment APIs: ${error.message}`);
    return;
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
      /* Code Time inspired theme */
      :root {
        --background-primary: #1e2328;
        --background-secondary: #161b22;
        --surface-primary: #21262d;
        --surface-secondary: #30363d;
        --text-primary: #f0f6fc;
        --text-secondary: #7d8590;
        --text-muted: #656d76;
        --accent-blue: #58a6ff;
        --accent-light: #79c0ff;
        --border-primary: #30363d;
        --border-muted: #21262d;
        --success: #3fb950;
        --warning: #d29922;
        --error: #f85149;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 0;
        background-color: var(--background-primary);
        color: var(--text-primary);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }

      /* Header Section */
      .header {
        background-color: var(--background-secondary);
        border-bottom: 1px solid var(--border-primary);
        padding: 24px 32px;
      }

      .header-content {
        max-width: 1200px;
        margin: 0 auto;
      }

      .header h1 {
        font-size: 28px;
        font-weight: 600;
        margin: 0 0 8px 0;
        color: var(--text-primary);
      }

      .header p {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      /* Main Content */
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 32px;
      }

      /* API Manager Card */
      .card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        padding: 24px;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }

      .card-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .button-group {
        display: flex;
        gap: 8px;
      }

      .button {
        background-color: var(--accent-blue);
        color: var(--text-primary);
        border: none;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .button:hover {
        background-color: var(--accent-light);
      }

      /* Table Styles */
      .table-wrapper {
        overflow-x: auto;
        border-radius: 8px;
        border: 1px solid var(--border-primary);
        margin-top: 16px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background-color: var(--surface-secondary);
      }

      th {
        background-color: var(--background-secondary);
        color: var(--text-primary);
        font-weight: 600;
        padding: 16px 12px;
        text-align: left;
        border-bottom: 1px solid var(--border-primary);
        font-size: 13px;
      }

      td {
        padding: 16px 12px;
        border-bottom: 1px solid var(--border-muted);
        color: var(--text-primary);
        font-size: 14px;
      }

      tr:last-child td {
        border-bottom: none;
      }

      tr:hover {
        background-color: var(--border-muted);
      }

      /* Status Indicators */
      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        text-transform: capitalize;
      }

      .status-indicator.active {
        background-color: rgba(63, 185, 80, 0.15);
        color: var(--success);
      }

      .status-indicator.unregistered,
      .status-indicator.inactive {
        background-color: rgba(248, 81, 73, 0.15);
        color: var(--error);
      }

      .status-indicator.unknown {
        background-color: rgba(125, 133, 144, 0.15);
        color: var(--text-secondary);
      }

      /* API Name Links */
      .api-name {
        color: var(--accent-blue);
        text-decoration: none;
        font-weight: 500;
      }

      .api-name:hover {
        text-decoration: underline;
        color: var(--accent-light);
      }

      /* DataTables Styling */
      .dataTables_wrapper {
        color: var(--text-primary);
      }

      .dataTables_length,
      .dataTables_filter,
      .dataTables_info,
      .dataTables_paginate {
        font-size: 14px;
        margin: 12px 0;
        color: var(--text-primary);
      }

      .dataTables_length select {
        background-color: var(--surface-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 14px;
      }

      .dataTables_filter input[type='search'] {
        background-color: var(--surface-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 14px;
      }

      .dataTables_filter input[type='search']:focus {
        outline: none;
        border-color: var(--accent-blue);
      }

      .dataTables_paginate .paginate_button {
        background-color: var(--surface-secondary) !important;
        color: var(--text-primary) !important;
        border: 1px solid var(--border-primary) !important;
        border-radius: 6px !important;
        padding: 8px 12px !important;
        margin: 0 2px !important;
      }

      .dataTables_paginate .paginate_button:hover {
        background-color: var(--accent-blue) !important;
        color: var(--text-primary) !important;
      }

      .dataTables_paginate .paginate_button.current {
        background-color: var(--accent-blue) !important;
        color: var(--text-primary) !important;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .container {
          padding: 16px;
        }
        
        .header {
          padding: 16px;
        }

        .card {
          padding: 16px;
        }

        .card-header {
          flex-direction: column;
          align-items: stretch;
          gap: 16px;
        }

        .button-group {
          justify-content: stretch;
        }

        .button {
          flex: 1;
        }
      }
    </style>
  </head>
  <body>
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <h1>API Manager - APIs</h1>
        <p>Manage and monitor your APIs across environments</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">APIs</h2>
          <div class="button-group">
            <button id="refreshAPIs" class="button">Refresh</button>
            <button id="downloadCSV" class="button">Download as CSV</button>
          </div>
        </div>
        <div class="table-wrapper">
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
  environmentId: string
) {
    showApiManagerAPIDetail(context, recordId, environmentId, organizationId);
}
