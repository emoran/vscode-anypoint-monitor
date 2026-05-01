import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import { AccountService } from '../controllers/accountService.js';
import { HYBRID_APPLICATIONS_ENDPOINT } from '../constants';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    emptyState,
    escapeHtml as uiEscapeHtml
} from '../webview/ui-kit';

/**
 * Creates a webview panel and displays Hybrid applications
 * deployed to on-premises Mule Runtimes
 */
export function showHybridApplicationsWebview(
  context: vscode.ExtensionContext,
  data: any,
  environmentId?: string,
  environmentName?: string
) {
  telemetryService.trackPageView('hybridApplications');
  // Ensure the data is an array
  let appsArray = Array.isArray(data) ? data : data.data || [];

  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'hybridApplicationsView',
    'Hybrid Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Build the HTML
  panel.webview.html = getHybridApplicationsHtml(appsArray, panel.webview, context.extensionUri, environmentName);

  // Listen for messages (for CSV download and Command Center)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'openApplicationDetails') {
      console.log('🚀 Opening Application Command Center for Hybrid app...');
      console.log('📱 App data:', JSON.stringify(message.appData, null, 2));

      // Mark this as a Hybrid application in the data
      const appName = message.appData.name || message.appData.artifact?.name || message.appName;
      const appId = message.appData.id || appName;
      const targetId = message.appData.target?.id || message.appData.targetId;

      const hybridAppData = {
        ...message.appData,
        deploymentType: 'HYBRID',
        cloudhubVersion: 'HYBRID',
        domain: appName, // Add domain field for consistency with CloudHub
        name: appName,
        id: appId
      };

      console.log('Hybrid App Data prepared:', {
        appName,
        appId,
        targetId,
        cloudhubVersion: 'HYBRID'
      });

      // Import and call the Application Command Center with preselected data
      const { showApplicationCommandCenter } = await import('./applicationCommandCenter.js');
      await showApplicationCommandCenter(
        context,
        environmentId,
        environmentName,
        appName,
        hybridAppData
      );

      console.log('✅ Application Command Center opened for Hybrid app');
    } else if (message.command === 'downloadAllCsv') {
      const csvContent = generateAllApplicationsCsv(appsArray);

      // Prompt for save location
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Hybrid Applications as CSV',
      });

      if (uri) {
        try {
          await fs.promises.writeFile(uri.fsPath, csvContent, 'utf-8');
          vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to save CSV file: ${error.message}`);
        }
      }
    } else if (message.command === 'hybridBulkAction') {
      try {
        await handleHybridBulkAction(context, environmentId, message.action, message.appIds);
      } catch (error: any) {
        console.error('Hybrid bulk action failed:', error);
        vscode.window.showErrorMessage(`Failed to ${message.action || 'update'} applications: ${error.message}`);
      }
    } else if (message.command === 'refreshApplications') {
      try {
        vscode.window.showInformationMessage('Refreshing Hybrid applications...');
        const refreshed = await fetchHybridApplications(context, environmentId);
        const refreshedList = Array.isArray(refreshed) ? refreshed : (refreshed as any)?.data;
        appsArray = Array.isArray(refreshedList) ? refreshedList : [];
        panel.webview.html = getHybridApplicationsHtml(appsArray, panel.webview, context.extensionUri, environmentName);
        vscode.window.showInformationMessage(`Refreshed ${appsArray.length} Hybrid application(s).`);
      } catch (error: any) {
        console.error('Failed to refresh Hybrid apps:', error);
        vscode.window.showErrorMessage(`Failed to refresh applications: ${error.message}`);
      }
    }
  });
}

function hybridApplicationsExtraStyles(): string {
    return `
    .hybrid-page-desc { font-size: 13px; color: var(--am-text-secondary); }
    .hybrid-apps-panel { margin-bottom: 24px; }
    .hybrid-apps-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .hybrid-apps-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--am-text-primary);
      margin: 0;
    }
    .hybrid-button-group { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .hybrid-table-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .hybrid-entries-control {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--am-text-secondary);
    }
    .hybrid-search-control {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--am-text-secondary);
      font-size: 13px;
    }
    .hybrid-bulk-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .hybrid-selection-summary {
      color: var(--am-text-muted);
      font-size: 13px;
    }
    .hybrid-table-scroll.am-table-container { overflow-x: auto; }
    .hybrid-checkbox-cell {
      width: 40px;
      text-align: center;
    }
    .hybrid-pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
      font-size: 13px;
      color: var(--am-text-secondary);
    }
    .hybrid-pagination-controls { display: flex; gap: 8px; flex-wrap: wrap; }
    .app-name-link { font-weight: 500; cursor: pointer; }
    #selectAll,
    .row-select {
      width: 16px;
      height: 16px;
    }
    .hybrid-initial-empty { margin-bottom: 20px; }
    .hybrid-initial-empty .am-empty-state { padding: 24px 16px; }
    @media (max-width: 768px) {
      .hybrid-table-controls { flex-direction: column; align-items: stretch; }
      .hybrid-search-control .am-input { width: 100%; }
    }
  `;
}

function getHybridApplicationsHtml(
  apps: any[],
  _webview: vscode.Webview,
  _extensionUri: vscode.Uri,
  environmentName?: string
): string {
  const totalApps = apps.length;
  const runningApps = apps.filter(app =>
    app.status === 'STARTED' || app.status === 'RUNNING' || app.lastReportedStatus === 'RUNNING'
  ).length;
  const stoppedApps = apps.filter(app =>
    app.status === 'STOPPED' || app.status === 'UNDEPLOYED' || app.lastReportedStatus === 'STOPPED'
  ).length;

  const servers = new Set(apps.map(app => app.target?.targetId || app.targetId).filter(Boolean));
  const totalTargets = servers.size;

  const initialEmpty =
    apps.length === 0
      ? `<div class="hybrid-initial-empty">${emptyState({
            icon: '🖥️',
            title: 'No hybrid applications',
            description:
                'No applications were returned for this environment. Deploy to on-premises runtimes or refresh after connecting.'
        })}</div>`
      : '';

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>${uiEscapeHtml('Hybrid Applications')}</h1>
          <div class="am-page-header-meta">
            <span class="hybrid-page-desc">${uiEscapeHtml('On-premises Mule Runtime deployments')}</span>
            ${badge('HYBRID', 'info', true)}
          </div>
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({
            icon: '📦',
            value: totalApps,
            label: 'Total Applications',
            breakdown: 'Deployed applications',
            animationDelay: '0.05s'
        })}
        ${summaryCard({
            icon: '▶',
            value: runningApps,
            label: 'Running Applications',
            breakdown: 'Currently active',
            variant: 'healthy',
            animationDelay: '0.1s'
        })}
        ${summaryCard({
            icon: '■',
            value: stoppedApps,
            label: 'Stopped Applications',
            breakdown: 'Currently inactive',
            variant: 'critical',
            animationDelay: '0.15s'
        })}
        ${summaryCard({
            icon: '🎯',
            value: totalTargets,
            label: 'Deployment Targets',
            breakdown: 'Servers/Clusters',
            animationDelay: '0.2s'
        })}
      </div>

      <div class="am-card hybrid-apps-panel">
        ${initialEmpty}
        <div class="hybrid-apps-panel-header">
          <h2 class="hybrid-apps-title">${uiEscapeHtml('Applications')}</h2>
          <div class="hybrid-button-group">
            ${button('Refresh', { variant: 'ghost', id: 'refreshApps' })}
            ${button('Download as CSV', { variant: 'primary', id: 'downloadAllCsv' })}
          </div>
        </div>

        <div class="hybrid-table-controls">
          <div class="hybrid-entries-control">
            <label for="entriesPerPage">Show</label>
            <select id="entriesPerPage" class="am-select" aria-label="Entries per page">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <span>entries</span>
          </div>
          <div class="hybrid-search-control">
            <label for="searchInput">Search</label>
            <input type="text" id="searchInput" class="am-input" placeholder="Search applications..." />
          </div>
        </div>

        <div class="hybrid-bulk-row">
          <div id="selectionSummary" class="hybrid-selection-summary">No applications selected</div>
          <div class="hybrid-button-group">
            ${button('Start Selected', { variant: 'primary', id: 'btnStartSelected', disabled: true })}
            ${button('Stop Selected', { variant: 'danger', id: 'btnStopSelected', disabled: true })}
          </div>
        </div>

        <div class="am-table-container hybrid-table-scroll">
          <table id="appTable" class="am-table">
            <thead>
              <tr>
                <th class="hybrid-checkbox-cell"><input type="checkbox" id="selectAll" /></th>
                <th>Application Name</th>
                <th>Status</th>
                <th>Target Type</th>
                <th>Target Name</th>
                <th>Runtime Version</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody id="appTableBody"></tbody>
          </table>
        </div>

        <div class="hybrid-pagination">
          <div id="paginationInfo">Showing 0 to 0 of 0 entries</div>
          <div class="hybrid-pagination-controls">
            <button type="button" id="prevBtn" class="am-btn am-btn-secondary">Previous</button>
            <button type="button" id="nextBtn" class="am-btn am-btn-secondary">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const scripts = `
          const vscode = acquireVsCodeApi();
          const appsData = ${JSON.stringify(apps)};
          const environmentName = ${JSON.stringify(environmentName || 'Unknown')};
          let filteredData = [...appsData];
          let currentPage = 1;
          let entriesPerPage = 10;
          const selectedAppIds = new Set();

          function getAppId(app) {
            return app?.id || app?.deploymentId || app?.artifactId || app?.name || app?.artifact?.name || '';
          }

          function updateSelectionSummary() {
            const summaryEl = document.getElementById('selectionSummary');
            const count = selectedAppIds.size;
            if (summaryEl) {
              summaryEl.textContent = count === 0 ? 'No applications selected' : \`\${count} application(s) selected\`;
            }

            const startBtn = document.getElementById('btnStartSelected');
            const stopBtn = document.getElementById('btnStopSelected');
            const hasSelection = count > 0;
            if (startBtn) startBtn.disabled = !hasSelection;
            if (stopBtn) stopBtn.disabled = !hasSelection;
          }

          function getPaginationBounds() {
            const startIndex = (currentPage - 1) * entriesPerPage;
            return { startIndex, endIndex: startIndex + entriesPerPage };
          }

          function getPageData() {
            const { startIndex, endIndex } = getPaginationBounds();
            return filteredData.slice(startIndex, endIndex);
          }

          function syncSelectAll() {
            const selectAllEl = document.getElementById('selectAll');
            if (!selectAllEl) return;

            const pageData = getPageData();
            if (pageData.length === 0) {
              selectAllEl.checked = false;
              selectAllEl.indeterminate = false;
              return;
            }

            const pageIds = pageData.map(getAppId).filter(Boolean);
            const allSelected = pageIds.length > 0 && pageIds.every(id => selectedAppIds.has(id));
            const someSelected = pageIds.some(id => selectedAppIds.has(id));
            selectAllEl.checked = allSelected;
            selectAllEl.indeterminate = !allSelected && someSelected;
          }

          function sendBulkAction(action) {
            if (!selectedAppIds.size) {
              alert('Select at least one application first.');
              return;
            }
            vscode.postMessage({
              command: 'hybridBulkAction',
              action,
              appIds: Array.from(selectedAppIds)
            });
          }

          function renderStatus(status) {
            const normalizedStatus = status?.toUpperCase() || 'UNKNOWN';
            let extraClass = '';
            if (normalizedStatus === 'STARTED' || normalizedStatus === 'RUNNING') {
              extraClass = ' am-badge-success';
            } else if (normalizedStatus === 'STOPPED' || normalizedStatus === 'UNDEPLOYED') {
              extraClass = ' am-badge-error';
            }
            return \`<span class="am-badge\${extraClass}">\${normalizedStatus}</span>\`;
          }

          function renderTable() {
            const { startIndex, endIndex } = getPaginationBounds();
            const pageData = filteredData.slice(startIndex, endIndex);

            const tbody = document.getElementById('appTableBody');
            tbody.innerHTML = pageData.map((app, index) => {
              const targetType = app.target?.type || app.targetType || 'N/A';
              const targetName = app.target?.name || app.targetName || 'N/A';
              const runtimeVersion = app.muleVersion?.version || app.muleVersion || app.runtimeVersion || 'N/A';
              const lastUpdate = app.lastModifiedDate || app.lastUpdateTime || app.lastReportedTime || 'N/A';
              const appId = getAppId(app);
              const isSelected = appId && selectedAppIds.has(appId);

              return \`
              <tr class="am-row">
                <td class="hybrid-checkbox-cell">
                  <input type="checkbox" class="row-select" data-app-index="\${startIndex + index}" data-app-id="\${appId || ''}" \${appId ? '' : 'disabled'} \${isSelected ? 'checked' : ''}>
                </td>
                <td><a href="#" class="app-name-link" data-app-name="\${app.name || app.artifact?.name || ''}" data-app-index="\${startIndex + index}">\${app.name || app.artifact?.name || 'N/A'}</a></td>
                <td>\${renderStatus(app.status || app.lastReportedStatus)}</td>
                <td>\${targetType}</td>
                <td>\${targetName}</td>
                <td>\${runtimeVersion}</td>
                <td>\${lastUpdate !== 'N/A' ? new Date(lastUpdate).toLocaleString() : 'N/A'}</td>
              </tr>
            \`;
            }).join('');

            updatePagination();
            updateSelectionSummary();
            syncSelectAll();
          }

          function updatePagination() {
            const totalItems = filteredData.length;
            const totalPages = Math.ceil(totalItems / entriesPerPage);
            const startIndex = (currentPage - 1) * entriesPerPage + 1;
            const endIndex = Math.min(currentPage * entriesPerPage, totalItems);

            document.getElementById('paginationInfo').textContent =
              totalItems === 0 ? 'Showing 0 to 0 of 0 entries' :
              \`Showing \${startIndex} to \${endIndex} of \${totalItems} entries\`;

            document.getElementById('prevBtn').disabled = currentPage <= 1;
            document.getElementById('nextBtn').disabled = currentPage >= totalPages;
          }

          function applyFilter() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            filteredData = appsData.filter(app =>
              JSON.stringify(app).toLowerCase().includes(searchTerm)
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

          document.getElementById('btnStartSelected').addEventListener('click', () => {
            sendBulkAction('start');
          });

          document.getElementById('btnStopSelected').addEventListener('click', () => {
            sendBulkAction('stop');
          });

          document.addEventListener('change', (e) => {
            const target = e.target;

            if (target?.id === 'selectAll') {
              const pageData = getPageData();
              if (target.checked) {
                pageData.forEach(app => {
                  const id = getAppId(app);
                  if (id) selectedAppIds.add(id);
                });
              } else {
                pageData.forEach(app => {
                  const id = getAppId(app);
                  if (id) selectedAppIds.delete(id);
                });
              }
              renderTable();
            }

            if (target?.classList?.contains('row-select')) {
              const appIndex = Number(target.dataset.appIndex);
              const app = filteredData[appIndex];
              const id = getAppId(app);
              if (id) {
                if (target.checked) {
                  selectedAppIds.add(id);
                } else {
                  selectedAppIds.delete(id);
                }
              }
              updateSelectionSummary();
              syncSelectAll();
            }
          });

          document.getElementById('prevBtn').addEventListener('click', () => {
            if (currentPage > 1) {
              currentPage--;
              renderTable();
            }
          });

          document.getElementById('nextBtn').addEventListener('click', () => {
            const totalPages = Math.ceil(filteredData.length / entriesPerPage);
            if (currentPage < totalPages) {
              currentPage++;
              renderTable();
            }
          });

          document.getElementById('downloadAllCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadAllCsv' });
          });

          document.addEventListener('click', (e) => {
            if (e.target.classList.contains('app-name-link')) {
              e.preventDefault();
              const appName = e.target.dataset.appName;
              const appIndex = parseInt(e.target.dataset.appIndex);
              if (appIndex >= 0 && appIndex < filteredData.length) {
                const appData = filteredData[appIndex];
                console.log('Opening Command Center for Hybrid app:', appName, 'in environment:', environmentName);
                vscode.postMessage({
                  command: 'openApplicationDetails',
                  appName: appName,
                  appData: appData,
                  environment: environmentName
                });
              }
            }
          });

          renderTable();
  `;

  return wrapWebviewHtml({
    title: 'Hybrid Applications',
    body,
    scripts,
    extraStyles: hybridApplicationsExtraStyles()
  });
}

/**
 * Generates a CSV file for all Hybrid applications
 */
function generateAllApplicationsCsv(apps: any[]): string {
  const headers = [
    'Application Name',
    'Status',
    'Target Type',
    'Target Name',
    'Runtime Version',
    'Last Update',
  ];
  const rows = apps.map((app) => [
    app.name || app.artifact?.name || '',
    app.status || app.lastReportedStatus || '',
    app.target?.type || app.targetType || '',
    app.target?.name || app.targetName || '',
    app.muleVersion?.version || app.muleVersion || app.runtimeVersion || '',
    app.lastModifiedDate || app.lastUpdateTime || app.lastReportedTime || '',
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

async function handleHybridBulkAction(
  context: vscode.ExtensionContext,
  environmentId: string | undefined,
  action: string,
  appIds: string[]
): Promise<void> {
  if (!environmentId) {
    throw new Error('No environment selected for Hybrid applications.');
  }

  if (!appIds || appIds.length === 0) {
    vscode.window.showWarningMessage('Select at least one application to continue.');
    return;
  }

  const normalizedAction = (action || '').toLowerCase();
  if (!['start', 'stop'].includes(normalizedAction)) {
    throw new Error(`Unsupported action ${action}`);
  }

  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }

  const apiHelper = new ApiHelper(context);
  const organizationID = activeAccount.organizationId;
  const desiredStatus = normalizedAction === 'start' ? 'STARTED' : 'STOPPED';

  for (const appId of appIds) {
    const response = await apiHelper.patch(
      `${HYBRID_APPLICATIONS_ENDPOINT}/${appId}`,
      { id: appId, desiredStatus },
      {
        headers: {
          'X-ANYPNT-ENV-ID': environmentId,
          'X-ANYPNT-ORG-ID': organizationID,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API responded with ${response.status} for ${appId}`);
    }
  }

  vscode.window.showInformationMessage(
    `${desiredStatus === 'STARTED' ? 'Start' : 'Stop'} requested for ${appIds.length} Hybrid application(s).`
  );
}

async function fetchHybridApplications(
  context: vscode.ExtensionContext,
  environmentId?: string
): Promise<any[]> {
  if (!environmentId) {
    throw new Error('No environment selected for Hybrid applications.');
  }

  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }

  const apiHelper = new ApiHelper(context);
  const organizationID = activeAccount.organizationId;
  const response = await apiHelper.get(HYBRID_APPLICATIONS_ENDPOINT, {
    headers: {
      'X-ANYPNT-ENV-ID': environmentId,
      'X-ANYPNT-ORG-ID': organizationID,
    },
  });

  if (response.status !== 200) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return response.data?.data || [];
}
