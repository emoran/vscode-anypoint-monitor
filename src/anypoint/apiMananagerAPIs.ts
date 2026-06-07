import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import {showApiManagerAPIDetail} from '../anypoint/apiMananagerAPIDetail'; // adjust path if needed
import { telemetryService } from '../services/telemetryService';
import {
  wrapWebviewHtml,
  badge,
  summaryCard,
  button,
} from '../webview/ui-kit';

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
  if (!currentPanel || !currentContext) {
    return;
  }

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
    currentEnvironmentId,
    currentOrganizationId
  );
}

/** Row payload for client-side table (search, sort, pagination). */
interface ApiTableRowPayload {
  id: string;
  organizationId: string;
  environmentId: string;
  name: string;
  version: string;
  stage: string;
  tech: string;
  status: string;
  autodisco: string;
  created: string;
  updated: string;
  statusHtml: string;
}

/**
 * Generate the HTML for the API Manager table.
 * Includes a Refresh button that triggers a message to the extension.
 */
function getAPIManagerHtml(
  apis: any[],
  environmentId: string,
  organizationId: string
): string {
  function renderStatus(status: string): string {
    switch (status) {
      case 'active':
        return badge('active', 'success');
      case 'unregistered':
        return badge('unregistered', 'error');
      case 'inactive':
        return badge('inactive', 'error');
      default:
        return badge(status || 'unknown', 'default');
    }
  }

  const rowPayloads: ApiTableRowPayload[] = apis.map((api) => {
    const name = api.asset?.exchangeAssetName || '';
    const createdDate = api.audit?.created?.date
      ? new Date(api.audit.created.date).toLocaleString()
      : '';
    const updatedDate = api.audit?.updated?.date
      ? new Date(api.audit.updated.date).toLocaleString()
      : '';
    return {
      id: api.id,
      organizationId,
      environmentId,
      name,
      version: api.assetVersion || '',
      stage: api.stage || '',
      tech: api.technology || '',
      status: api.status || '',
      autodisco: api.autodiscoveryInstanceName || '',
      created: createdDate,
      updated: updatedDate,
      statusHtml: renderStatus(api.status || ''),
    };
  });

  const activeCount = apis.filter((a) => (a.status || '') === 'active').length;

  const pageSizeOptions = [10, 25, 50, 100];
  const pageSizeOptionsHtml = pageSizeOptions
    .map((n) => `<option value="${n}">${n}</option>`)
    .join('');

  const body = `
<div class="am-container">
  <div class="am-page-header">
    <div>
      <h1>API Manager - APIs</h1>
      <p class="am-api-subtitle">Manage and monitor your APIs across environments</p>
    </div>
  </div>
  <div class="am-summary-cards">
    ${summaryCard({ icon: '📡', value: apis.length, label: 'Total APIs' })}
    ${summaryCard({
      icon: '✓',
      value: activeCount,
      label: 'Active',
      variant: 'healthy',
      animationDelay: '0.05s',
    })}
  </div>
  <div class="am-card am-api-list-card">
    <div class="am-api-card-toolbar">
      <h2 class="am-card-title am-api-card-title-reset">APIs</h2>
      <div class="am-api-toolbar-actions">
        ${button('Refresh', { variant: 'primary', id: 'refreshAPIs' })}
        ${button('Download as CSV', { variant: 'secondary', id: 'downloadCSV' })}
      </div>
    </div>
    <div class="am-filters am-api-table-controls">
      <label class="am-api-entries-label">Show <select id="pageSizeSelect" class="am-select">${pageSizeOptionsHtml}</select> entries</label>
      <div class="am-api-search-wrap">
        <span class="am-api-search-label">Search:</span>
        <input type="search" id="searchInput" class="am-input am-api-search" placeholder="Filter APIs…" />
      </div>
    </div>
    <div class="am-table-container am-api-table-outer">
      <table id="apiTable" class="am-table">
        <thead>
          <tr>
            <th class="am-sortable" data-sort-key="name" data-sort-type="string">Name <span class="am-sort-icon" data-sort-indicator="name"></span></th>
            <th class="am-sortable" data-sort-key="version" data-sort-type="string">Version <span class="am-sort-icon" data-sort-indicator="version"></span></th>
            <th class="am-sortable" data-sort-key="stage" data-sort-type="string">Stage <span class="am-sort-icon" data-sort-indicator="stage"></span></th>
            <th class="am-sortable" data-sort-key="tech" data-sort-type="string">Technology <span class="am-sort-icon" data-sort-indicator="tech"></span></th>
            <th class="am-sortable" data-sort-key="status" data-sort-type="string">Status <span class="am-sort-icon" data-sort-indicator="status"></span></th>
            <th class="am-sortable" data-sort-key="autodisco" data-sort-type="string">Autodiscovery <span class="am-sort-icon" data-sort-indicator="autodisco"></span></th>
            <th class="am-sortable" data-sort-key="created" data-sort-type="string">Created <span class="am-sort-icon" data-sort-indicator="created"></span></th>
            <th class="am-sortable" data-sort-key="updated" data-sort-type="string">Updated <span class="am-sort-icon" data-sort-indicator="updated"></span></th>
          </tr>
        </thead>
        <tbody id="apiTableBody"></tbody>
      </table>
    </div>
    <div class="am-api-table-footer">
      <span id="tableInfo" class="am-api-table-info"></span>
      <div class="am-api-pagination" id="paginationControls"></div>
    </div>
  </div>
</div>
`;

  const extraStyles = `
    .am-api-subtitle {
      color: var(--am-text-secondary);
      font-size: 14px;
      margin-top: 6px;
      font-weight: 400;
    }
    .am-api-list-card { margin-top: 8px; }
    .am-api-card-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .am-api-card-title-reset { margin-bottom: 0; }
    .am-api-toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .am-api-table-controls { margin-bottom: 12px; align-items: center; }
    .am-api-search-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .am-api-search-label { font-size: 13px; color: var(--am-text-muted); white-space: nowrap; }
    .am-api-search { min-width: 180px; max-width: 360px; flex: 1; }
    .am-api-table-outer { overflow-x: auto; }
    .am-api-table-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 13px;
      color: var(--am-text-muted);
    }
    .am-api-pagination { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .am-api-page-jump { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .am-api-page-jump input {
      width: 52px;
      padding: 4px 8px;
      background: var(--am-bg-input);
      border: 1px solid var(--am-border-input);
      border-radius: var(--am-radius-sm);
      color: var(--am-text-primary);
      font-size: 13px;
    }
  `;

  const rowsJson = JSON.stringify(rowPayloads);
  const apisExportJson = JSON.stringify(apis);

  const scripts = `
    const vscode = acquireVsCodeApi();
    const ROWS = ${rowsJson};
    const APIS_EXPORT = ${apisExportJson};

    function esc(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    function escAttr(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    let filtered = ROWS.slice();
    let currentPage = 1;
    let pageSize = 10;
    let sortKey = 'name';
    let sortAsc = false;

    function compareRows(a, b, key) {
      const av = a[key] != null ? String(a[key]) : '';
      const bv = b[key] != null ? String(b[key]) : '';
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
    }

    function applySort() {
      const mult = sortAsc ? 1 : -1;
      filtered.sort((a, b) => mult * compareRows(a, b, sortKey));
    }

    function updateSortIndicators() {
      document.querySelectorAll('[data-sort-indicator]').forEach((el) => {
        const k = el.getAttribute('data-sort-indicator');
        el.textContent = k === sortKey ? (sortAsc ? '▲' : '▼') : '';
      });
    }

    function renderTable() {
      const tbody = document.getElementById('apiTableBody');
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      const start = total === 0 ? 0 : (currentPage - 1) * pageSize;
      const pageRows = filtered.slice(start, start + pageSize);

      tbody.innerHTML = pageRows.map((r) => \`
        <tr class="am-row">
          <td><a href="#" class="api-name" data-id="\${escAttr(r.id)}" data-org="\${escAttr(r.organizationId)}" data-env="\${escAttr(r.environmentId)}">\${esc(r.name)}</a></td>
          <td>\${esc(r.version)}</td>
          <td>\${esc(r.stage)}</td>
          <td>\${esc(r.tech)}</td>
          <td>\${r.statusHtml}</td>
          <td>\${esc(r.autodisco)}</td>
          <td>\${esc(r.created)}</td>
          <td>\${esc(r.updated)}</td>
        </tr>
      \`).join('');

      document.querySelectorAll('.api-name').forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const target = event.currentTarget;
          vscode.postMessage({
            command: 'openApiDetails',
            recordId: target.getAttribute('data-id'),
            organizationId: target.getAttribute('data-org'),
            environmentId: target.getAttribute('data-env')
          });
        });
      });

      const startIdx = total === 0 ? 0 : start + 1;
      const endIdx = Math.min(start + pageSize, total);
      document.getElementById('tableInfo').textContent = total
        ? 'Showing ' + startIdx + ' to ' + endIdx + ' of ' + total + ' entries'
        : 'Showing 0 to 0 of 0 entries';

      const pag = document.getElementById('paginationControls');
      const prevDisabled = currentPage <= 1 ? ' disabled' : '';
      const nextDisabled = currentPage >= totalPages ? ' disabled' : '';
      pag.innerHTML =
        '<button type="button" class="am-btn am-btn-ghost am-api-page-first"' + prevDisabled + '>First</button>' +
        '<button type="button" class="am-btn am-btn-ghost am-api-page-prev"' + prevDisabled + '>Previous</button>' +
        '<span class="am-api-page-jump">Page <input type="number" min="1" max="' + totalPages + '" value="' + currentPage + '" id="pageJumpInput" /> of ' + totalPages + '</span>' +
        '<button type="button" class="am-btn am-btn-ghost am-api-page-next"' + nextDisabled + '>Next</button>' +
        '<button type="button" class="am-btn am-btn-ghost am-api-page-last"' + nextDisabled + '>Last</button>';

      const bindNav = (sel, fn) => {
        const btn = pag.querySelector(sel);
        if (btn && !btn.disabled) btn.addEventListener('click', fn);
      };
      bindNav('.am-api-page-first', () => { currentPage = 1; renderTable(); });
      bindNav('.am-api-page-prev', () => { currentPage--; renderTable(); });
      bindNav('.am-api-page-next', () => { currentPage++; renderTable(); });
      bindNav('.am-api-page-last', () => { currentPage = totalPages; renderTable(); });

      const jump = document.getElementById('pageJumpInput');
      if (jump) {
        jump.addEventListener('change', () => {
          let p = parseInt(jump.value, 10);
          if (isNaN(p) || p < 1) p = 1;
          if (p > totalPages) p = totalPages;
          currentPage = p;
          renderTable();
        });
      }

      updateSortIndicators();
    }

    function runFilter() {
      const q = document.getElementById('searchInput').value.trim().toLowerCase();
      if (!q) {
        filtered = ROWS.slice();
      } else {
        filtered = ROWS.filter((r) => {
          return [r.name, r.version, r.stage, r.tech, r.status, r.autodisco, r.created, r.updated].some((f) =>
            String(f || '').toLowerCase().includes(q)
          );
        });
      }
      applySort();
      currentPage = 1;
      renderTable();
    }

    document.getElementById('downloadCSV').addEventListener('click', () => {
      vscode.postMessage({ command: 'downloadCSV', data: APIS_EXPORT });
    });

    document.getElementById('refreshAPIs').addEventListener('click', () => {
      vscode.postMessage({ command: 'refreshAPIs' });
    });

    document.getElementById('pageSizeSelect').value = String(pageSize);
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value, 10) || 10;
      currentPage = 1;
      renderTable();
    });

    document.getElementById('searchInput').addEventListener('input', runFilter);

    document.querySelectorAll('#apiTable thead .am-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort-key');
        if (!key) return;
        if (sortKey === key) {
          sortAsc = !sortAsc;
        } else {
          sortKey = key;
          sortAsc = true;
        }
        applySort();
        currentPage = 1;
        renderTable();
      });
    });

    applySort();
    renderTable();
  `;

  return wrapWebviewHtml({
    title: 'API Manager - APIs',
    body,
    scripts,
    extraStyles,
  });
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
