import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import { AccountService } from '../controllers/accountService.js';
import { HYBRID_APPLICATIONS_ENDPOINT } from '../constants';

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
        appsArray = Array.isArray(refreshed) ? refreshed : refreshed?.data || [];
        panel.webview.html = getHybridApplicationsHtml(appsArray, panel.webview, context.extensionUri, environmentName);
        vscode.window.showInformationMessage(`Refreshed ${appsArray.length} Hybrid application(s).`);
      } catch (error: any) {
        console.error('Failed to refresh Hybrid apps:', error);
        vscode.window.showErrorMessage(`Failed to refresh applications: ${error.message}`);
      }
    }
  });
}

function getHybridApplicationsHtml(
  apps: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  environmentName?: string
): string {
  // Calculate statistics
  const totalApps = apps.length;
  const runningApps = apps.filter(app =>
    app.status === 'STARTED' || app.status === 'RUNNING' || app.lastReportedStatus === 'RUNNING'
  ).length;
  const stoppedApps = apps.filter(app =>
    app.status === 'STOPPED' || app.status === 'UNDEPLOYED' || app.lastReportedStatus === 'STOPPED'
  ).length;

  // Count deployment targets
  const servers = new Set(apps.map(app => app.target?.targetId || app.targetId).filter(Boolean));
  const totalTargets = servers.size;

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Hybrid Applications</title>
        <style>
          /* Code Time inspired theme */
          :root {
            --background-primary: #1e2328;
            --background-secondary: #161b22;
            --surface-primary: #21262d;
            --surface-secondary: #30363d;
            --surface-accent: #0d1117;
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
            --hybrid-purple: #8b5cf6;
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

          .header-subtitle {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .header p {
            font-size: 16px;
            color: var(--text-secondary);
            margin: 0;
          }

          .hybrid-badge {
            background-color: rgba(139, 92, 246, 0.15);
            color: var(--hybrid-purple);
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
          }

          /* Main Content */
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 32px;
          }

          /* Statistics Grid */
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 32px;
          }

          .stat-card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            transition: all 0.2s;
          }

          .stat-card:hover {
            border-color: var(--border-muted);
            transform: translateY(-1px);
          }

          .stat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
          }

          .stat-title {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
            margin: 0;
          }

          .stat-value {
            font-size: 32px;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 8px 0;
            line-height: 1.2;
          }

          .stat-subtitle {
            font-size: 13px;
            color: var(--text-muted);
            margin: 0;
          }

          /* Applications Table Card */
          .applications-card {
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

          .button-ghost {
            background-color: transparent;
            border: 1px solid var(--border-primary);
          }

          .button-danger {
            background-color: var(--error);
            color: var(--text-primary);
          }

          .button-danger:hover {
            background-color: #ff6b6b;
          }

          .button-group {
            display: flex;
            gap: 8px;
          }

          /* Table Controls */
          .table-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 16px;
          }

          .entries-control {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: var(--text-secondary);
          }

          .entries-control select {
            background-color: var(--surface-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 6px 8px;
            font-size: 14px;
          }

          .search-control {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .search-input {
            background-color: var(--surface-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 14px;
            width: 250px;
          }

          .search-input:focus {
            outline: none;
            border-color: var(--accent-blue);
          }

          /* Table Styles */
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

          .checkbox-cell {
            width: 40px;
            text-align: center;
          }

          input[type="checkbox"] {
            width: 16px;
            height: 16px;
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

          /* Status Badges */
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
          }

          .status-running {
            background-color: rgba(63, 185, 80, 0.15);
            color: var(--success);
          }

          .status-stopped {
            background-color: rgba(248, 81, 73, 0.15);
            color: var(--error);
          }

          .status-default {
            background-color: rgba(125, 133, 144, 0.15);
            color: var(--text-secondary);
          }

          .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: currentColor;
          }

          /* Pagination */
          .pagination {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 16px;
            font-size: 14px;
            color: var(--text-secondary);
          }

          .pagination-controls {
            display: flex;
            gap: 8px;
          }

          .pagination-btn {
            background-color: var(--surface-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .pagination-btn:hover:not(:disabled) {
            background-color: var(--accent-blue);
          }

          .pagination-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          /* Clickable app name links */
          .app-name-link {
            color: var(--accent-blue);
            text-decoration: none;
            cursor: pointer;
            font-weight: 500;
            transition: color 0.2s ease;
          }

          .app-name-link:hover {
            color: var(--accent-light);
            text-decoration: underline;
          }

          /* Responsive Design */
          @media (max-width: 768px) {
            .container {
              padding: 16px;
            }

            .header {
              padding: 16px;
            }

            .stats-grid {
              grid-template-columns: 1fr;
            }

            .table-controls {
              flex-direction: column;
              align-items: stretch;
            }

            .search-input {
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header -->
        <div class="header">
          <div class="header-content">
            <h1>Hybrid Applications</h1>
            <div class="header-subtitle">
              <p>On-premises Mule Runtime deployments</p>
              <span class="hybrid-badge">HYBRID</span>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="container">
          <!-- Statistics Grid -->
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-header">
                <h3 class="stat-title">Total Applications</h3>
              </div>
              <div class="stat-value">${totalApps}</div>
              <p class="stat-subtitle">Deployed applications</p>
            </div>

            <div class="stat-card">
              <div class="stat-header">
                <h3 class="stat-title">Running Applications</h3>
              </div>
              <div class="stat-value">${runningApps}</div>
              <p class="stat-subtitle">Currently active</p>
            </div>

            <div class="stat-card">
              <div class="stat-header">
                <h3 class="stat-title">Stopped Applications</h3>
              </div>
              <div class="stat-value">${stoppedApps}</div>
              <p class="stat-subtitle">Currently inactive</p>
            </div>

            <div class="stat-card">
              <div class="stat-header">
                <h3 class="stat-title">Deployment Targets</h3>
              </div>
              <div class="stat-value">${totalTargets}</div>
              <p class="stat-subtitle">Servers/Clusters</p>
            </div>
          </div>

          <!-- Applications Table -->
          <div class="applications-card">
            <div class="card-header">
              <h2 class="card-title">Applications</h2>
              <div class="button-group">
                <button id="refreshApps" class="button button-ghost">Refresh</button>
                <button id="downloadAllCsv" class="button">Download as CSV</button>
              </div>
            </div>

            <div class="table-controls">
              <div class="entries-control">
                <label>Show</label>
                <select id="entriesPerPage">
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <label>entries</label>
              </div>
              <div class="search-control">
                <label>Search:</label>
                <input type="text" id="searchInput" class="search-input" placeholder="Search applications...">
              </div>
            </div>

            <div class="table-controls" style="justify-content: space-between; align-items: center;">
              <div id="selectionSummary" style="color: var(--text-secondary); font-size: 13px;">No applications selected</div>
              <div class="button-group">
                <button id="btnStartSelected" class="button" disabled>Start Selected</button>
                <button id="btnStopSelected" class="button button-danger" disabled>Stop Selected</button>
              </div>
            </div>

            <div class="table-wrapper">
              <table id="appTable">
                <thead>
                  <tr>
                    <th class="checkbox-cell"><input type="checkbox" id="selectAll"></th>
                    <th>Application Name</th>
                    <th>Status</th>
                    <th>Target Type</th>
                    <th>Target Name</th>
                    <th>Runtime Version</th>
                    <th>Last Update</th>
                  </tr>
                </thead>
                <tbody id="appTableBody">
                  <!-- Table content will be populated by JavaScript -->
                </tbody>
              </table>
            </div>

            <div class="pagination">
              <div id="paginationInfo">Showing 0 to 0 of 0 entries</div>
              <div class="pagination-controls">
                <button id="prevBtn" class="pagination-btn">Previous</button>
                <button id="nextBtn" class="pagination-btn">Next</button>
              </div>
            </div>
          </div>
        </div>

        <script>
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

          // Render status badge
          function renderStatus(status) {
            const normalizedStatus = status?.toUpperCase() || 'UNKNOWN';
            const statusClass =
              (normalizedStatus === 'STARTED' || normalizedStatus === 'RUNNING') ? 'status-running' :
              (normalizedStatus === 'STOPPED' || normalizedStatus === 'UNDEPLOYED') ? 'status-stopped' :
              'status-default';

            return \`<span class="status-badge \${statusClass}">
              <span class="status-dot"></span>
              \${normalizedStatus}
            </span>\`;
          }

          // Render table
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
              <tr>
                <td class="checkbox-cell">
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

          // Update pagination
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

          // Apply search filter
          function applyFilter() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            filteredData = appsData.filter(app =>
              JSON.stringify(app).toLowerCase().includes(searchTerm)
            );
            currentPage = 1;
            renderTable();
          }

          // Event listeners
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

          // Handle app name clicks to open Command Center
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

          // Initial render
          renderTable();
        </script>
      </body>
    </html>
  `;
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
