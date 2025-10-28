import * as vscode from 'vscode';
import { ApiHelper } from '../controllers/apiHelper.js';

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
  organizationId: string
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
    const apiHelper = new ApiHelper(context);
    const detailResp = await apiHelper.get(apiDetailUrl);
    apiDetail = detailResp.data;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch API detail: ${err.message}`);
    return;
  }

  // ---------------- Fetch Policies ----------------
  let policies: any[] = [];
  try {
    const apiHelper = new ApiHelper(context);
    const policiesResp = await apiHelper.get(policiesUrl);
    // The policies call returns an array
    policies = policiesResp.data || [];
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch Policies: ${err.message}`);
    return;
  }

  // ---------------- Fetch Contracts ----------------
  let contracts: any[] = [];
  try {
    const apiHelper = new ApiHelper(context);
    const contractsResp = await apiHelper.get(contractsUrl);
    contracts = contractsResp.data.contracts || [];
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch Contracts: ${err.message}`);
    return;
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

      /* Cards */
      .card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        margin-bottom: 24px;
        padding: 24px;
      }

      .card h2 {
        margin: 0 0 20px;
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
      }

      /* API Detail Grid */
      .triple-column {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }

      .info-item {
        background-color: var(--surface-secondary);
        padding: 16px;
        border-radius: 8px;
        border: 1px solid var(--border-muted);
        transition: all 0.2s;
      }

      .info-item:hover {
        border-color: var(--border-primary);
        transform: translateY(-1px);
      }

      .info-label {
        font-weight: 600;
        color: var(--accent-blue);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }

      .info-value {
        color: var(--text-primary);
        font-size: 14px;
        word-break: break-word;
      }

      /* Table Styling */
      .table-wrapper {
        overflow-x: auto;
        border-radius: 8px;
        border: 1px solid var(--border-primary);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background-color: var(--surface-secondary);
      }

      thead th {
        background-color: var(--background-secondary);
        color: var(--text-primary);
        font-weight: 600;
        padding: 16px 12px;
        text-align: left;
        border-bottom: 1px solid var(--border-primary);
        font-size: 13px;
      }

      td, th {
        padding: 16px 12px;
        border-bottom: 1px solid var(--border-muted);
        color: var(--text-primary);
        font-size: 14px;
      }

      tbody tr:hover {
        background-color: var(--border-muted);
      }

      tr:last-child td {
        border-bottom: none;
      }

      /* Expand/Collapse Controls */
      td.details-control {
        cursor: pointer;
        position: relative;
        padding-left: 32px;
      }

      td.details-control::before {
        content: '▶';
        color: var(--accent-blue);
        font-weight: 600;
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        transition: transform 0.2s;
      }

      tr.shown td.details-control::before {
        content: '▼';
        transform: translateY(-50%) rotate(0deg);
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

        .triple-column {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <h1>API Manager - API Detail</h1>
        <p>Detailed API information, policies, and contracts</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container">
      <!-- Main API Detail Card -->
      <div class="card">
        <h2>API Information</h2>
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
        <div class="table-wrapper">
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
      </div>

      <!-- Contracts Card -->
      <div class="card">
        <h2>Contracts</h2>
        <div class="table-wrapper">
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