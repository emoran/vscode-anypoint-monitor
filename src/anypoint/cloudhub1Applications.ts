import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import { AccountService } from '../controllers/accountService.js';
import { BASE_URL, getBaseUrl } from '../constants';
import { getGitHubStarBannerHtml, getGitHubStarBannerStyles, getGitHubStarBannerScript } from '../utils/starPrompt.js';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    escapeHtml as uiEscapeHtml,
    stripScriptTags
} from '../webview/ui-kit';

/**
 * Creates a webview panel and displays a detailed table of applications
 * with a single CSV download option. This version has a dark theme
 * and a more “techy” vibe, plus styling for the DataTables length menu.
 */
export async function showApplicationsWebview1(
  context: vscode.ExtensionContext,
  data: any[],
  environmentId?: string,
  environmentName?: string
) {
  telemetryService.trackPageView('cloudhub1Applications');
  // Ensure the data is an array
  let appsArray = Array.isArray(data) ? data : [];

  // Get business group info
  const accountService = new AccountService(context);
  const businessGroup = await accountService.getActiveAccountBusinessGroup();

  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'CloudHub Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Build the HTML
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri, environmentName, businessGroup);

  // Listen for messages (for CSV download)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'openApplicationDetails') {
      console.log('🚀 Opening Application Command Center for CH1 app...');
      console.log('📱 App data:', JSON.stringify(message.appData, null, 2));

      // Import and call the Application Command Center with preselected data
      const { showApplicationCommandCenter } = await import('./applicationCommandCenter.js');
      await showApplicationCommandCenter(
        context,
        environmentId,
        environmentName,
        message.appName,
        message.appData
      );

      console.log('✅ Application Command Center opened');
    } else if (message.command === 'downloadAllCsv') {
      const csvContent = generateAllApplicationsCsv(appsArray);

      // Prompt for save location
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Applications as CSV',
      });

      if (uri) {
        try {
          await fs.promises.writeFile(uri.fsPath, csvContent, 'utf-8');
          vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to save CSV file: ${error.message}`);
        }
      }
    } else if (message.command === 'ch1BulkAction') {
      try {
        await handleCh1BulkAction(context, environmentId, message.action, message.domains);
      } catch (error: any) {
        console.error('Bulk action failed:', error);
        vscode.window.showErrorMessage(`Failed to ${message.action || 'update'} applications: ${error.message}`);
      }
    } else if (message.command === 'refreshApplications') {
      try {
        vscode.window.showInformationMessage('Refreshing CloudHub 1.0 applications...');
        const refreshed = await fetchCloudHub1Applications(context, environmentId);
        appsArray = Array.isArray(refreshed) ? refreshed : [];
        panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri, environmentName);
        vscode.window.showInformationMessage(`Refreshed ${appsArray.length} CloudHub 1.0 application(s).`);
      } catch (error: any) {
        console.error('Failed to refresh CloudHub 1.0 apps:', error);
        vscode.window.showErrorMessage(`Failed to refresh applications: ${error.message}`);
      }
    } else if (message.command === 'openGitHubRepo') {
      try {
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
      } catch (error: any) {
        console.error('Failed to open GitHub URL:', error);
        vscode.window.showErrorMessage(`Failed to open GitHub: ${error.message}`);
      }
    }
  });
}

function getApplicationsHtml(
  apps: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  environmentName?: string,
  businessGroup?: { id: string, name: string }
): string {
  const totalApps = apps.length;
  const runningApps = apps.filter(app => app.status === 'STARTED' || app.status === 'RUNNING').length;
  const stoppedApps = apps.filter(app => app.status === 'STOPPED' || app.status === 'UNDEPLOYED').length;
  const totalWorkers = apps.reduce((sum, app) => sum + (app.workers || 0), 0);

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>CloudHub 1.0 Applications</h1>
          <div class="am-page-header-meta">
            ${environmentName ? badge(uiEscapeHtml(environmentName), 'info', true) : ''}
            ${businessGroup ? badge(uiEscapeHtml(businessGroup.name), 'default', true) : ''}
          </div>
        </div>
        <div class="am-page-header-right" style="display:flex;gap:8px">
          ${button('Refresh', { variant: 'secondary', id: 'refreshApps' })}
          ${button('Download CSV', { variant: 'primary', id: 'downloadAllCsv' })}
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '📦', value: totalApps, label: 'Total Applications', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '✅', value: runningApps, label: 'Running', variant: 'healthy', animationDelay: '0.15s' })}
        ${summaryCard({ icon: '🔴', value: stoppedApps, label: 'Stopped', variant: 'critical', animationDelay: '0.2s' })}
        ${summaryCard({ icon: '⚙️', value: totalWorkers, label: 'Total Workers', animationDelay: '0.25s' })}
      </div>

      <div class="ch1-controls">
        <div class="ch1-table-controls">
          <div class="ch1-entries-control">
            <label>Show</label>
            <select id="entriesPerPage">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <label>entries</label>
          </div>
          <div class="ch1-search-control">
            <input type="text" id="searchInput" class="ch1-search-input" placeholder="Search applications...">
          </div>
        </div>

        <div class="ch1-action-bar">
          <div class="ch1-selection-info" id="selectionSummary">No applications selected</div>
          <div style="display:flex;gap:8px">
            ${button('Start Selected', { variant: 'primary', id: 'btnStartSelected', disabled: true })}
            ${button('Restart Selected', { variant: 'primary', id: 'btnRestartSelected', disabled: true })}
            ${button('Stop Selected', { variant: 'danger', id: 'btnStopSelected', disabled: true })}
          </div>
        </div>
      </div>

      <div class="am-table-container">
        <table class="am-table" id="appTable">
          <thead>
            <tr>
              <th style="width:40px;text-align:center"><input type="checkbox" id="selectAll"></th>
              <th>Domain</th>
              <th>Full Domain</th>
              <th>Status</th>
              <th>Workers</th>
              <th>Worker Type</th>
              <th>Region</th>
              <th>Last Update</th>
            </tr>
          </thead>
          <tbody id="appTableBody"></tbody>
        </table>
      </div>

      <div class="ch1-pagination">
        <div id="paginationInfo">Showing 0 to 0 of 0 entries</div>
        <div style="display:flex;gap:8px">
          ${button('Previous', { variant: 'secondary', id: 'prevBtn' })}
          ${button('Next', { variant: 'secondary', id: 'nextBtn' })}
        </div>
      </div>
    </div>

    ${getGitHubStarBannerHtml()}`;

  const scripts = `
    ${stripScriptTags(getGitHubStarBannerScript())}
    const vscode = acquireVsCodeApi();
    const appsData = ${JSON.stringify(apps)};
    const environmentName = ${JSON.stringify(environmentName || 'Unknown')};
    let filteredData = [...appsData];
    let currentPage = 1;
    let entriesPerPage = 10;
    const selectedDomains = new Set();

    function getDomain(app) {
      return app?.domain || app?.fullDomain || '';
    }

    function updateSelectionSummary() {
      const summaryEl = document.getElementById('selectionSummary');
      const count = selectedDomains.size;
      if (summaryEl) {
        summaryEl.textContent = count === 0 ? 'No applications selected' : \`\${count} application(s) selected\`;
      }
      const hasSelection = count > 0;
      ['btnRestartSelected','btnStopSelected','btnStartSelected'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !hasSelection;
      });
    }

    function getPaginationBounds() {
      const startIndex = (currentPage - 1) * entriesPerPage;
      return { startIndex, endIndex: startIndex + entriesPerPage };
    }

    function getPageData() {
      const { startIndex, endIndex } = getPaginationBounds();
      return filteredData.slice(startIndex, endIndex);
    }

    function syncSelectAllCheckbox() {
      const selectAllEl = document.getElementById('selectAll');
      if (!selectAllEl) return;
      const pageData = getPageData();
      if (pageData.length === 0) {
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
        return;
      }
      const pageDomains = pageData.map(getDomain).filter(Boolean);
      const allSelected = pageDomains.length > 0 && pageDomains.every(d => selectedDomains.has(d));
      const someSelected = pageDomains.some(d => selectedDomains.has(d));
      selectAllEl.checked = allSelected;
      selectAllEl.indeterminate = !allSelected && someSelected;
    }

    function sendBulkAction(action) {
      if (!selectedDomains.size) { alert('Select at least one application first.'); return; }
      vscode.postMessage({ command: 'ch1BulkAction', action, domains: Array.from(selectedDomains) });
    }

    function renderStatus(status) {
      const variant =
        (status === 'STARTED' || status === 'RUNNING') ? 'success' :
        (status === 'STOPPED' || status === 'UNDEPLOYED') ? 'error' : 'default';
      return '<span class="am-badge am-badge--' + variant + ' am-badge--dot">' + (status || 'Unknown') + '</span>';
    }

    function renderTable() {
      const { startIndex, endIndex } = getPaginationBounds();
      const pageData = filteredData.slice(startIndex, endIndex);
      const tbody = document.getElementById('appTableBody');
      tbody.innerHTML = pageData.map((app, index) => {
        const actualIndex = startIndex + index;
        const domain = getDomain(app);
        const isSelected = domain && selectedDomains.has(domain);
        return \`<tr>
          <td style="width:40px;text-align:center">
            <input type="checkbox" class="row-select" data-app-index="\${actualIndex}" \${domain ? '' : 'disabled'} \${isSelected ? 'checked' : ''}>
          </td>
          <td><a href="#" class="app-name-link" data-app-name="\${app.domain || ''}" data-app-index="\${actualIndex}">\${app.domain || 'N/A'}</a></td>
          <td>\${app.fullDomain || 'N/A'}</td>
          <td>\${renderStatus(app.status)}</td>
          <td>\${app.workers || 'N/A'}</td>
          <td>\${app.workerType || 'N/A'}</td>
          <td>\${app.region || 'N/A'}</td>
          <td>\${app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : 'N/A'}</td>
        </tr>\`;
      }).join('');
      updatePagination();
      updateSelectionSummary();
      syncSelectAllCheckbox();
    }

    function updatePagination() {
      const totalItems = filteredData.length;
      const totalPages = Math.ceil(totalItems / entriesPerPage);
      const si = (currentPage - 1) * entriesPerPage + 1;
      const ei = Math.min(currentPage * entriesPerPage, totalItems);
      document.getElementById('paginationInfo').textContent =
        totalItems === 0 ? 'Showing 0 to 0 of 0 entries' : \`Showing \${si} to \${ei} of \${totalItems} entries\`;
      document.getElementById('prevBtn').disabled = currentPage <= 1;
      document.getElementById('nextBtn').disabled = currentPage >= totalPages;
    }

    function applyFilter() {
      const searchTerm = document.getElementById('searchInput').value.toLowerCase();
      filteredData = appsData.filter(app =>
        Object.values(app).some(v => v && v.toString().toLowerCase().includes(searchTerm))
      );
      currentPage = 1;
      renderTable();
    }

    document.getElementById('searchInput').addEventListener('input', applyFilter);
    document.getElementById('entriesPerPage').addEventListener('change', (e) => {
      entriesPerPage = parseInt(e.target.value);
      currentPage = 1;
      renderTable();
    });
    document.getElementById('refreshApps').addEventListener('click', () => {
      vscode.postMessage({ command: 'refreshApplications' });
    });
    document.getElementById('btnRestartSelected').addEventListener('click', () => sendBulkAction('restart'));
    document.getElementById('btnStartSelected').addEventListener('click', () => sendBulkAction('start'));
    document.getElementById('btnStopSelected').addEventListener('click', () => sendBulkAction('stop'));

    document.addEventListener('change', (e) => {
      const target = e.target;
      if (target?.id === 'selectAll') {
        const pageData = getPageData();
        pageData.forEach(app => {
          const domain = getDomain(app);
          if (domain) { target.checked ? selectedDomains.add(domain) : selectedDomains.delete(domain); }
        });
        renderTable();
      }
      if (target?.classList?.contains('row-select')) {
        const app = filteredData[Number(target.dataset.appIndex)];
        const domain = getDomain(app);
        if (domain) { target.checked ? selectedDomains.add(domain) : selectedDomains.delete(domain); }
        updateSelectionSummary();
        syncSelectAllCheckbox();
      }
    });

    document.getElementById('prevBtn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); } });
    document.getElementById('nextBtn').addEventListener('click', () => {
      if (currentPage < Math.ceil(filteredData.length / entriesPerPage)) { currentPage++; renderTable(); }
    });
    document.getElementById('downloadAllCsv').addEventListener('click', () => {
      vscode.postMessage({ command: 'downloadAllCsv' });
    });

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('app-name-link')) {
        e.preventDefault();
        const appIndex = parseInt(e.target.dataset.appIndex);
        if (appIndex >= 0 && appIndex < filteredData.length) {
          vscode.postMessage({
            command: 'openApplicationDetails',
            appName: e.target.dataset.appName,
            appData: filteredData[appIndex],
            environment: environmentName
          });
        }
      }
    });

    renderTable();
  `;

  return wrapWebviewHtml({
    title: 'CloudHub 1.0 Applications',
    body,
    scripts,
    extraStyles: `
      ${getGitHubStarBannerStyles()}
      .ch1-controls { margin-bottom: 16px; }
      .ch1-table-controls {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 12px; flex-wrap: wrap; gap: 12px;
      }
      .ch1-entries-control {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: var(--am-text-muted);
      }
      .ch1-entries-control select {
        background: var(--am-bg-secondary); color: var(--am-text-primary);
        border: 1px solid var(--am-border); border-radius: var(--am-radius-sm);
        padding: 4px 8px; font-size: 13px;
      }
      .ch1-search-input {
        background: var(--am-bg-secondary); color: var(--am-text-primary);
        border: 1px solid var(--am-border); border-radius: var(--am-radius-sm);
        padding: 6px 12px; font-size: 13px; width: 250px;
      }
      .ch1-search-input:focus { outline: none; border-color: var(--am-accent); }
      .ch1-action-bar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
      }
      .ch1-selection-info { color: var(--am-text-muted); font-size: 13px; }
      .ch1-pagination {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 12px; font-size: 13px; color: var(--am-text-muted);
      }
      .app-name-link {
        color: var(--am-accent); text-decoration: none; cursor: pointer;
        font-weight: 500; transition: color 0.2s;
      }
      .app-name-link:hover { text-decoration: underline; }
      input[type="checkbox"] { width: 16px; height: 16px; }
    `
  });
}

async function handleCh1BulkAction(
  context: vscode.ExtensionContext,
  environmentId: string | undefined,
  action: string,
  domains: string[]
): Promise<void> {
  if (!environmentId) {
    throw new Error('No environment selected for CloudHub 1.0.');
  }

  if (!domains || domains.length === 0) {
    vscode.window.showWarningMessage('Select at least one application to continue.');
    return;
  }

  const normalizedAction = (action || '').toLowerCase();
  if (!['restart', 'stop', 'start'].includes(normalizedAction)) {
    throw new Error(`Unsupported action ${action}`);
  }

  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }

  const apiHelper = new ApiHelper(context);
  const organizationID = activeAccount.organizationId;
  const statusValue = normalizedAction === 'restart' ? 'restart' : normalizedAction === 'start' ? 'start' : 'STOPPED';

  // Get region-specific base URL
  const baseUrl = await getBaseUrl(context);

  for (const domain of domains) {
    let response;
    if (statusValue === 'restart') {
      response = await apiHelper.post(
        `${baseUrl}/cloudhub/api/applications/${domain}/status`,
        { status: 'restart' },
        {
          headers: {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationID,
          },
        }
      );
    } else {
      response = await apiHelper.post(
        `${baseUrl}/cloudhub/api/applications/${domain}/status`,
        { status: statusValue },
        {
          headers: {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationID,
          },
        }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API responded with ${response.status} for ${domain}`);
    }
  }

  const label =
    statusValue === 'restart' ? 'Restart' :
    statusValue === 'start' ? 'Start' : 'Stop';

  vscode.window.showInformationMessage(
    `${label} requested for ${domains.length} CloudHub 1.0 application(s).`
  );
}

async function fetchCloudHub1Applications(context: vscode.ExtensionContext, environmentId?: string): Promise<any[]> {
  if (!environmentId) {
    throw new Error('No environment selected for CloudHub 1.0.');
  }

  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }

  const apiHelper = new ApiHelper(context);
  const organizationID = activeAccount.organizationId;

  // Get region-specific base URL
  const baseUrl = await getBaseUrl(context);

  const response = await apiHelper.get(`${baseUrl}/cloudhub/api/applications`, {
    headers: {
      'X-ANYPNT-ENV-ID': environmentId,
      'X-ANYPNT-ORG-ID': organizationID,
    },
  });

  if (response.status !== 200) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return response.data;
}

/**
 * Generates a CSV file for all applications, excluding the Properties attribute.
 */
function generateAllApplicationsCsv(apps: any[]): string {
  const headers = [
    'ID',
    'Domain',
    'Full Domain',
    'Status',
    'Workers',
    'Worker Type',
    'Last Update',
    'Mule Version',
    'Region',
  ];
  const rows = apps.map((app) => [
    app.id ?? '',
    app.domain ?? '',
    app.fullDomain ?? '',
    app.status ?? '',
    app.workers ?? '',
    app.workerType ?? '',
    app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : '',
    app.muleVersion ?? '',
    app.region ?? '',
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}
