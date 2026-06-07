import * as vscode from 'vscode';
import { ApiHelper } from '../controllers/apiHelper.js';
import { telemetryService } from '../services/telemetryService';
import { wrapWebviewHtml, badge, escapeHtml } from '../webview/ui-kit';

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
  telemetryService.trackPageView('apiManagerDetail');
  const panel = vscode.window.createWebviewPanel(
    'apiManagerAPIDetail',
    'API Manager - API Detail',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Get region-specific base URL
  const { getBaseUrl } = await import('../constants.js');
  const baseUrl = await getBaseUrl(context);

  // Endpoints
  const apiDetailUrl = `${baseUrl}/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}?includeProxyConfiguration=true&includeTlsContexts=true`;
  const policiesUrl = `${baseUrl}/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}/policies?fullInfo=false`;
  const contractsUrl = `${baseUrl}/apimanager/xapi/v1/organizations/${organizationId}/environments/${environmentId}/apis/${recordId}/contracts?limit=10&offset=0&sort=name&ascending=true`;

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

function statusBadgeVariant(status: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  const s = String(status || '').toLowerCase();
  if (s.includes('active') || s.includes('published')) {
    return 'success';
  }
  if (s.includes('deprecated') || s.includes('retired')) {
    return 'warning';
  }
  if (s.includes('failed') || s.includes('error')) {
    return 'error';
  }
  if (s.includes('draft') || s.includes('pending')) {
    return 'info';
  }
  return 'default';
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

  const statusBadge =
    status !== 'N/A'
      ? badge(String(status), statusBadgeVariant(String(status)))
      : badge('N/A', 'default');

  const cloudHubBadge =
    isCloudHub === 'Yes' ? badge('Yes', 'success') : badge('No', 'default');

  const extraStyles = `
      .api-detail-page .am-card { margin-bottom: 24px; }
      .api-detail-page .am-card:hover { transform: none; }
      .api-detail-page .am-page-header p {
        color: var(--am-text-secondary);
        font-size: 14px;
        margin-top: 8px;
      }
      .triple-column {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }
      .info-item {
        background: var(--am-bg-secondary);
        padding: 16px;
        border-radius: var(--am-radius-md);
        border: 1px solid var(--am-border);
        transition: border-color 0.2s, transform 0.2s;
      }
      .info-item:hover {
        border-color: var(--am-info);
        transform: translateY(-1px);
      }
      .info-label {
        font-weight: 600;
        color: var(--am-info);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      .info-value {
        color: var(--am-text-primary);
        font-size: 14px;
        word-break: break-word;
      }
      td.details-control {
        cursor: pointer;
        position: relative;
        padding-left: 32px !important;
      }
      td.details-control::before {
        content: '▶';
        color: var(--am-info);
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
      .dataTables_wrapper { color: var(--am-text-primary); }
      .dataTables_length,
      .dataTables_filter,
      .dataTables_info,
      .dataTables_paginate {
        font-size: 13px;
        margin: 12px 0;
        color: var(--am-text-primary);
      }
      .dataTables_length select {
        background: var(--am-bg-input);
        color: var(--am-text-primary);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-sm);
        padding: 6px 8px;
        font-size: 13px;
      }
      .dataTables_filter input[type='search'] {
        background: var(--am-bg-input);
        color: var(--am-text-primary);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-sm);
        padding: 8px 12px;
        font-size: 13px;
      }
      .dataTables_filter input[type='search']:focus {
        outline: none;
        border-color: var(--am-info);
      }
      .dataTables_paginate .paginate_button {
        background: var(--am-bg-surface) !important;
        color: var(--am-text-primary) !important;
        border: 1px solid var(--am-border) !important;
        border-radius: var(--am-radius-sm) !important;
        padding: 8px 12px !important;
        margin: 0 2px !important;
      }
      .dataTables_paginate .paginate_button:hover {
        background: var(--am-bg-surface-hover) !important;
        color: var(--am-text-primary) !important;
        border-color: var(--am-info) !important;
      }
      .dataTables_paginate .paginate_button.current {
        background: color-mix(in srgb, var(--am-info) 25%, var(--am-bg-surface)) !important;
        color: var(--am-text-primary) !important;
        border-color: var(--am-info) !important;
      }
      .am-child-detail-table {
        color: var(--am-text-primary);
        width: 90%;
        margin: 0.5rem auto;
        border-collapse: collapse;
      }
      .am-child-detail-table th {
        width: 30%;
        text-align: left;
        color: var(--am-info);
        padding: 8px;
        border-bottom: 1px solid var(--am-border);
      }
      .am-child-detail-table td {
        padding: 8px;
        border-bottom: 1px solid var(--am-border);
      }
      .am-child-detail-table pre {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        white-space: pre-wrap;
        margin: 0;
      }
      @media (max-width: 768px) {
        .triple-column { grid-template-columns: 1fr; }
      }
  `;

  const body = `
    <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css" />
    <div class="am-container api-detail-page">
      <header class="am-page-header">
        <div>
          <h1>API Manager - API Detail</h1>
          <p>Detailed API information, policies, and contracts</p>
        </div>
      </header>

      <section class="am-card">
        <div class="am-card-title">API Information</div>
        <div class="triple-column">
          <div class="info-item">
            <div class="info-label">ID</div>
            <div class="info-value">${escapeHtml(String(id))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Group ID</div>
            <div class="info-value">${escapeHtml(String(groupId))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Asset ID</div>
            <div class="info-value">${escapeHtml(String(assetId))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Asset Version</div>
            <div class="info-value">${escapeHtml(String(assetVersion))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Product Version</div>
            <div class="info-value">${escapeHtml(String(productVersion))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Technology</div>
            <div class="info-value">${escapeHtml(String(technology))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Stage</div>
            <div class="info-value">${escapeHtml(String(stage))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Status</div>
            <div class="info-value">${statusBadge}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Tags</div>
            <div class="info-value">${escapeHtml(String(tags))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Active</div>
            <div class="info-value">${escapeHtml(String(lastActive))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Created Date</div>
            <div class="info-value">${escapeHtml(String(createdDate))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Updated Date</div>
            <div class="info-value">${escapeHtml(String(updatedDate))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Auto-discovery</div>
            <div class="info-value">${escapeHtml(String(autodiscoName))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Endpoint URI</div>
            <div class="info-value">${escapeHtml(String(endpointUri))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Deployment Type</div>
            <div class="info-value">${escapeHtml(String(deploymentType))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">API Gateway Version</div>
            <div class="info-value">${escapeHtml(String(apiGatewayVersion))}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Is CloudHub</div>
            <div class="info-value">${cloudHubBadge}</div>
          </div>
        </div>
      </section>

      <section class="am-card">
        <div class="am-card-title">Policies</div>
        <div class="am-table-container">
          <table id="policiesTable" class="display am-table">
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
      </section>

      <section class="am-card">
        <div class="am-card-title">Contracts</div>
        <div class="am-table-container">
          <table id="contractsTable" class="display am-table">
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
      </section>
    </div>

    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
  `;

  const scripts = `
    const policiesData = ${JSON.stringify(policies)};
    const contractsData = ${JSON.stringify(contracts)};

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

      return \`<table class="am-child-detail-table">
        <tr><th>Created</th><td>\${created}</td></tr>
        <tr><th>Updated</th><td>\${updated}</td></tr>
        <tr><th>Configuration Data</th><td><pre>\${config}</pre></td></tr>
        <tr><th>Implementation Asset</th><td><pre>\${implAsset}</pre></td></tr>
      </table>\`;
    }

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

      return \`<table class="am-child-detail-table">
        <tr><th>Master Org ID</th><td>\${masterOrgId}</td></tr>
        <tr><th>Organization ID</th><td>\${orgId}</td></tr>
        <tr><th>Rejected Date</th><td>\${rejectedDate}</td></tr>
        <tr><th>Revoked Date</th><td>\${revokedDate}</td></tr>
        <tr><th>Application ID</th><td>\${appId}</td></tr>
        <tr><th>App Created</th><td>\${appCreated}</td></tr>
        <tr><th>Core Services ID</th><td>\${appCoreServicesId}</td></tr>
      </table>\`;
    }

    document.addEventListener('DOMContentLoaded', function() {
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
  `;

  return wrapWebviewHtml({
    title: 'API Manager - Detail',
    body,
    scripts,
    extraStyles,
  });
}
