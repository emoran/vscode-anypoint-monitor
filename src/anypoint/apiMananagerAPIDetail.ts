import * as vscode from 'vscode';
import axios from 'axios';
import { refreshAccessToken } from './DeveloperInfo'; // Adjust the path if needed

/**
 * Displays a WebView with:
 * - Main API detail in a 3-column layout
 * - Policies card (DataTable) with row expand for nested data
 * - Contracts card (DataTable) with row expand for nested data
 */
export async function showApiManagerAPIDetail(
  context: vscode.ExtensionContext,
  recordId: string,
  environmentId: string,
  organizationId: string,
  accessToken: string
) {
  const panel = vscode.window.createWebviewPanel(
    'apiManagerAPIDetail',
    'API Manager - API Detail',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Endpoints
  const apiDetailUrl = `https://anypoint.mulesoft.com/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}?includeProxyConfiguration=true&includeTlsContexts=true`;
  const policiesUrl = `https://anypoint.mulesoft.com/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}/policies?fullInfo=false`;
  const contractsUrl = `https://anypoint.mulesoft.com/apimanager/xapi/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}/contracts?limit=10&offset=0&sort=name&ascending=true`;

  // ---------------- Fetch API detail ----------------
  let apiDetail: any;
  try {
    const detailResp = await axios.get(apiDetailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    apiDetail = detailResp.data;
  } catch (err: any) {
    if (err.response?.status === 401) {
     
      const refreshed = await refreshAccessToken(context);
      if (!refreshed) {
        vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
        return;
      }
      // Retrieve new token
      accessToken = (await context.secrets.get('anypoint.accessToken')) || '';
      if (!accessToken) {
        
        return;
      }
      // Retry once
      try {
        const retryResp = await axios.get(apiDetailUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        apiDetail = retryResp.data;
      } catch (retryErr: any) {
        vscode.window.showErrorMessage(`Retry fetch of API detail failed: ${retryErr.message}`);
        return;
      }
    } else {
      vscode.window.showErrorMessage(`Failed to fetch API detail: ${err.message}`);
      return;
    }
  }

  // ---------------- Fetch Policies ----------------
  let policies: any[] = [];
  try {
    const policiesResp = await axios.get(policiesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // The policies call returns an array
    policies = policiesResp.data || [];
  } catch (err: any) {
    if (err.response?.status === 401) {
     
      const refreshed = await refreshAccessToken(context);
      if (!refreshed) {
       
        return;
      }
      accessToken = (await context.secrets.get('anypoint.accessToken')) || '';
      if (!accessToken) {
        vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
        return;
      }
      // Retry once
      try {
        const retryPoliciesResp = await axios.get(policiesUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        policies = retryPoliciesResp.data || [];
      } catch (retryErr: any) {
        vscode.window.showErrorMessage(`Retry fetch of Policies failed: ${retryErr.message}`);
        return;
      }
    } else {
      vscode.window.showErrorMessage(`Failed to fetch Policies: ${err.message}`);
      return;
    }
  }

  // ---------------- Fetch Contracts ----------------
  let contracts: any[] = [];
  try {
    const contractsResp = await axios.get(contractsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    contracts = contractsResp.data.contracts || [];
  } catch (err: any) {
    if (err.response?.status === 401) {
      vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
      const refreshed = await refreshAccessToken(context);
      if (!refreshed) {
        vscode.window.showErrorMessage('Unable to refresh token for Contracts. Please log in again.');
        return;
      }
      accessToken = (await context.secrets.get('anypoint.accessToken')) || '';
      if (!accessToken) {
        vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
        return;
      }
      // Retry once
      try {
        const retryContractsResp = await axios.get(contractsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        contracts = retryContractsResp.data.contracts || [];
      } catch (retryErr: any) {
        vscode.window.showErrorMessage(`Retry fetch of Contracts failed: ${retryErr.message}`);
        return;
      }
    } else {
      vscode.window.showErrorMessage(`Failed to fetch Contracts: ${err.message}`);
      return;
    }
  }

  // Render final HTML
  panel.webview.html = getApiDetailHtml(apiDetail, policies, contracts);
}

/**
 * Build the entire HTML, including:
 * - 3-column layout for API detail
 * - Policies card (DataTable)
 * - Contracts card (DataTable)
 */
function getApiDetailHtml(apiDetail: any, policies: any[], contracts: any[]): string {
  const createdDate = apiDetail?.audit?.created?.date
    ? new Date(apiDetail.audit.created.date).toLocaleString()
    : 'N/A';
  const updatedDate = apiDetail?.audit?.updated?.date
    ? new Date(apiDetail.audit.updated.date).toLocaleString()
    : 'N/A';
  const id = apiDetail?.id ?? 'N/A';
  const groupId = apiDetail?.groupId ?? 'N/A';
  const assetId = apiDetail?.assetId ?? 'N/A';
  const assetVersion = apiDetail?.assetVersion ?? 'N/A';
  const productVersion = apiDetail?.productVersion ?? 'N/A';
  const tags = apiDetail?.tags?.length ? apiDetail.tags.join(', ') : 'None';
  const status = apiDetail?.status ?? 'N/A';
  const technology = apiDetail?.technology ?? 'N/A';
  const stage = apiDetail?.stage ?? 'N/A';
  const autodiscoName = apiDetail?.autodiscoveryInstanceName ?? 'N/A';
  const lastActive = apiDetail?.lastActiveDate
    ? new Date(apiDetail.lastActiveDate).toLocaleString()
    : 'N/A';
  const endpointUri = apiDetail?.endpoint?.uri ?? 'N/A';
  const apiGatewayVersion = apiDetail?.endpoint?.apiGatewayVersion ?? 'N/A';
  const isCloudHub = apiDetail?.endpoint?.isCloudHub ? 'Yes' : 'No';
  const deploymentType = apiDetail?.endpoint?.deploymentType ?? 'N/A';

  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>API Manager - Detail</title>
    <!-- Google Font + DataTables CSS -->
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap" />
    <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css" />
    <style>
      :root {
        --bg-color: #0D1117;
        --card-color: #161B22;
        --text-color: #C9D1D9;
        --accent-color: #58A6FF;
        --table-border: #30363D;
        --hover-bg: #21262D;
      }
      body {
        margin: 0;
        padding: 0;
        background-color: var(--bg-color);
        font-family: 'Fira Code', monospace, sans-serif;
        color: var(--text-color);
        font-size: 14px;
      }
      /* Navbar */
      .navbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: #141A22;
        padding: 0.75rem 1rem;
      }
      .navbar-left {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .navbar-left h1 {
        margin: 0;
        font-size: 1.25rem;
        color: #F0F6FC;
      }
      .navbar-right a {
        color: #F0F6FC;
        margin-left: 1.5rem;
        text-decoration: none;
      }
      .navbar-right a:hover {
        text-decoration: underline;
      }

      .container {
        width: 90%;
        max-width: 1200px;
        margin: 1rem auto;
      }
      .card {
        background-color: var(--card-color);
        border: 1px solid var(--table-border);
        border-radius: 6px;
        margin-bottom: 1rem;
        padding: 1rem;
      }
      .card h2 {
        margin: 0 0 1rem;
        font-size: 1.1rem;
        color: var(--accent-color);
      }
      /* 3-column layout for main API info */
      .triple-column {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
      }
      .info-item {
        background-color: #0D1117;
        padding: 0.5rem;
        border-radius: 4px;
      }
      .info-label {
        font-weight: 600;
        color: var(--accent-color);
      }
      .info-value {
        display: block;
        margin-top: 4px;
      }
      .info-item:hover {
        background-color: var(--hover-bg);
      }

      /* Table styling + expand/collapse icons */
      table {
        width: 100%;
        border-collapse: collapse;
      }
      thead th {
        background-color: #21262D;
        color: var(--accent-color);
      }
      td, th {
        border-bottom: 1px solid var(--table-border);
        padding: 0.5rem;
      }
      tbody tr:hover {
        background-color: var(--hover-bg);
      }
        /* By default, show a right arrow (▶) in accent color */
      td.details-control::before {
        content: '▶';
        color: var(--accent-color);
        font-weight: 600;
        margin-right: 5px;
      }
      /* When row is shown, show a down arrow (▼) */
      tr.shown td.details-control::before {
        content: '▼';
        color: var(--accent-color);
      }
      td.details-control {
        cursor: pointer;
        background: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAhElEQVR42mNkIBIwEqmO4n98wrBmxoAmAtEfQAHkA0RZEUhCwmnaAnIMkCMMcZRYLEFkBdo2BfgNk5uBvExFAzvCZhZBWdw4QOq+YQwfBiGnMzEYSCTJ0ARTDGaBWAmy6FIcCGF60v0gY2Rt2T8CyeACkAm+EHCIJQb65kZ7raIrkm0BJwAhGZzg86dIMm4jEAAAUQzMZtmyWRgAAAABJRU5ErkJggg==') no-repeat center center;
        background-size: 16px 16px;
      }
      tr.shown td.details-control {
        background: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAgElEQVR42mNkIBIwEqmO4kMnRhj+MeR8ESKMIZKcFZDRTHAGkZBh/AJ8AZiRoTybQDUPxBphqKCDcQTw1BvTCuUI3KsSyAe/JnAY7AFZAbA8VC+83gXxhRqtul48ANopMFIXCtc9dRQPMgEhN2A5UHcdGeAfM++5j/haWNRQ5AqKQBu7A9dqFAWSIAAAAASUVORK5CYII=') no-repeat center center;
        background-size: 16px 16px;
      }

      /* White background for 'Show entries' dropdown */
      .dataTables_length select {
        background-color: #ffffff !important;
        color: #000000 !important;
        border: 1px solid var(--table-border);
        border-radius: 4px;
        padding: 2px 4px;
        outline: none;
      }
      .dataTables_filter input[type='search'] {
        background-color: #121212;
        color: var(--text-color);
        border: 1px solid var(--table-border);
        border-radius: 4px;
        padding: 2px 8px;
        outline: none;
      }
    </style>
  </head>
  <body>
    <nav class="navbar">
      <div class="navbar-left">
        <h1>Anypoint Monitor Extension</h1>
      </div>
      <div class="navbar-right">
        <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor" target="_blank">About</a>
        <a href="https://www.buymeacoffee.com/yucelmoran" target="_blank">Buy Me a Coffee</a>
      </div>
    </nav>

    <div class="container">
      <!-- Main API Detail Card -->
      <div class="card">
        <h2>API Detail</h2>
        <div class="triple-column">
          <div class="info-item">
            <div class="info-label">ID</div>
            <div class="info-value">${id}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Group ID</div>
            <div class="info-value">${groupId}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Asset ID</div>
            <div class="info-value">${assetId}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Asset Version</div>
            <div class="info-value">${assetVersion}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Product Version</div>
            <div class="info-value">${productVersion}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Technology</div>
            <div class="info-value">${technology}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Stage</div>
            <div class="info-value">${stage}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Status</div>
            <div class="info-value">${status}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Tags</div>
            <div class="info-value">${tags}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Active</div>
            <div class="info-value">${lastActive}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Created Date</div>
            <div class="info-value">${createdDate}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Updated Date</div>
            <div class="info-value">${updatedDate}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Auto-discovery</div>
            <div class="info-value">${autodiscoName}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Endpoint URI</div>
            <div class="info-value">${endpointUri}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Deployment Type</div>
            <div class="info-value">${deploymentType}</div>
          </div>
          <div class="info-item">
            <div class="info-label">API Gateway Version</div>
            <div class="info-value">${apiGatewayVersion}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Is CloudHub</div>
            <div class="info-value">${isCloudHub}</div>
          </div>
        </div>
      </div>

      <!-- Policies Card -->
      <div class="card">
        <h2>Policies</h2>
        <table id="policiesTable" class="display">
          <thead>
            <tr>
              <th></th>
              <th>ID</th>
              <th>Asset ID</th>
              <th>Type</th>
              <th>Order</th>
              <th>Disabled</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <!-- Contracts Card -->
      <div class="card">
        <h2>Contracts</h2>
        <table id="contractsTable" class="display">
          <thead>
            <tr>
              <th></th>
              <th>ID</th>
              <th>Status</th>
              <th>Approved Date</th>
              <th>Application Name</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- jQuery + DataTables JS -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
    <script>
      const policiesData = ${JSON.stringify(policies)};
      const contractsData = ${JSON.stringify(contracts)};

      // Expand row for Policies
      function formatPolicyRow(policy) {
        const created = policy.audit?.created?.date
          ? new Date(policy.audit.created.date).toLocaleString()
          : 'N/A';
        const updated = policy.audit?.updated?.date
          ? new Date(policy.audit.updated.date).toLocaleString()
          : 'N/A';

        const config = policy.configurationData
          ? JSON.stringify(policy.configurationData, null, 2)
          : 'N/A';

        const implAsset = policy.implementationAsset
          ? JSON.stringify(policy.implementationAsset, null, 2)
          : 'N/A';

        return \`
          <table style=\"color: var(--text-color); width: 90%; margin: 0.5rem auto; border-collapse: collapse;\">
            <tr><th style=\"width: 30%; text-align: left; color: var(--accent-color);\">Created</th><td>\${created}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Updated</th><td>\${updated}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Configuration Data</th><td><pre>\${config}</pre></td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Implementation Asset</th><td><pre>\${implAsset}</pre></td></tr>
          </table>
        \`;
      }

      // Expand row for Contracts
      function formatContractRow(contract) {
        const masterOrgId = contract.masterOrganizationId || 'N/A';
        const orgId = contract.organizationId || 'N/A';
        const rejectedDate = contract.rejectedDate
          ? new Date(contract.rejectedDate).toLocaleString()
          : 'N/A';
        const revokedDate = contract.revokedDate
          ? new Date(contract.revokedDate).toLocaleString()
          : 'N/A';
        const appId = contract.application?.id || 'N/A';
        const appCreated = contract.application?.audit?.created?.date
          ? new Date(contract.application.audit.created.date).toLocaleString()
          : 'N/A';
        const appCoreServicesId = contract.application?.coreServicesId || 'N/A';

        return \`
          <table style=\"color: var(--text-color); width: 90%; margin: 0.5rem auto; border-collapse: collapse;\">
            <tr><th style=\"width: 30%; text-align: left; color: var(--accent-color);\">Master Org ID</th><td>\${masterOrgId}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Organization ID</th><td>\${orgId}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Rejected Date</th><td>\${rejectedDate}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Revoked Date</th><td>\${revokedDate}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Application ID</th><td>\${appId}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">App Created</th><td>\${appCreated}</td></tr>
            <tr><th style=\"color: var(--accent-color); text-align: left;\">Core Services ID</th><td>\${appCoreServicesId}</td></tr>
          </table>
        \`;
      }

      document.addEventListener('DOMContentLoaded', function() {
        // ---------------- POLICIES TABLE ----------------
        const polTable = $('#policiesTable').DataTable({
          data: policiesData,
          columns: [
            {
              className: 'details-control',
              orderable: false,
              data: null,
              defaultContent: ''
            },
            { data: 'id' },
            { data: 'assetId' },
            { data: 'type' },
            { data: 'order' },
            {
              data: 'disabled',
              render: function(val) {
                return val ? 'true' : 'false';
              }
            }
          ],
          pageLength: 5,
          lengthMenu: [[5, 10, 25, 50], [5, 10, 25, 50]],
          language: {
            lengthMenu: 'Show _MENU_ entries',
            search: 'Search:',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            infoEmpty: 'Showing 0 to 0 of 0 entries',
            zeroRecords: 'No policies found',
            paginate: {
              first: 'First',
              last: 'Last',
              next: 'Next',
              previous: 'Previous'
            }
          }
        });
        // Expand/collapse for Policies
        $('#policiesTable tbody').on('click', 'td.details-control', function () {
          const tr = $(this).closest('tr');
          const row = polTable.row(tr);
          if (row.child.isShown()) {
            row.child.hide();
            tr.removeClass('shown');
          } else {
            row.child(formatPolicyRow(row.data())).show();
            tr.addClass('shown');
          }
        });

        // ---------------- CONTRACTS TABLE ----------------
        const cTable = $('#contractsTable').DataTable({
          data: contractsData,
          columns: [
            {
              className: 'details-control',
              orderable: false,
              data: null,
              defaultContent: ''
            },
            { data: 'id' },
            { data: 'status' },
            {
              data: 'approvedDate',
              render: function(val) {
                return val ? new Date(val).toLocaleString() : 'N/A';
              }
            },
            {
              data: 'application.name',
              render: function(val) {
                return val || 'N/A';
              }
            }
          ],
          pageLength: 5,
          lengthMenu: [[5, 10, 25, 50], [5, 10, 25, 50]],
          language: {
            lengthMenu: 'Show _MENU_ entries',
            search: 'Search:',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            infoEmpty: 'Showing 0 to 0 of 0 entries',
            zeroRecords: 'No contracts found',
            paginate: {
              first: 'First',
              last: 'Last',
              next: 'Next',
              previous: 'Previous'
            }
          }
        });
        // Expand/collapse for Contracts
        $('#contractsTable tbody').on('click', 'td.details-control', function () {
          const tr = $(this).closest('tr');
          const row = cTable.row(tr);
          if (row.child.isShown()) {
            row.child.hide();
            tr.removeClass('shown');
          } else {
            row.child(formatContractRow(row.data())).show();
            tr.addClass('shown');
          }
        });
      });
    </script>
  </body>
</html>
  `;
}