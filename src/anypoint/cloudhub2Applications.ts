// cloudhub2Applications.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import { BASE_URL, getBaseUrl } from '../constants';
import { getGitHubStarBannerHtml, getGitHubStarBannerStyles, getGitHubStarBannerScript } from '../utils/starPrompt.js';

// ==================== MAIN ENTRY POINTS ====================

// Updated functions in cloudhub2Applications.ts

/**
 * Show the CloudHub 2.0 applications list webview
 */
export async function showApplicationsWebview(
  context: vscode.ExtensionContext,
  applicationsData: any,
  environment: string
) {
  // Get business group info
  const { AccountService } = await import('../controllers/accountService.js');
  const accountService = new AccountService(context);
  const businessGroup = await accountService.getActiveAccountBusinessGroup();
  // Debug: Log the received data structure
  console.log('CloudHub 2.0 Applications Data Structure:', JSON.stringify(applicationsData, null, 2));
  
  // Handle different data structures
  let applications: any[] = [];
  
  if (Array.isArray(applicationsData)) {
    applications = applicationsData;
  } else if (applicationsData && typeof applicationsData === 'object') {
    // Check if it's wrapped in a property like { data: [...] } or { applications: [...] }
    applications = applicationsData.data || applicationsData.applications || applicationsData.items || [];
    
    // If still not an array, check for other common API response structures
    if (!Array.isArray(applications)) {
      // Check for nested structures like { response: { data: [...] } }
      applications = applicationsData.response?.data || 
                    applicationsData.response?.applications ||
                    applicationsData.result?.data ||
                    applicationsData.result?.applications ||
                    [];
    }
  }
  
  // Ensure we have an array
  if (!Array.isArray(applications)) {
    applications = [];
    console.warn('Applications data is not in expected format. Received:', typeof applicationsData, applicationsData);
    vscode.window.showWarningMessage(`Applications data format unexpected. Check console for details.`);
  }

  console.log(`Processed ${applications.length} applications for display`);

  const panel = vscode.window.createWebviewPanel(
    'cloudHub2Applications',
    'CloudHub 2.0 Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.onDidDispose(() => {
    // Panel disposed - cleanup if needed
  });

  panel.webview.html = getCloudHub2ApplicationsHtml(applications, panel.webview, context.extensionUri, environment, businessGroup);

panel.webview.onDidReceiveMessage(async (message) => {
  try {
    console.log('=== WEBVIEW MESSAGE RECEIVED ===');
    console.log('Command:', message.command);
    console.log('Message data:', JSON.stringify(message, null, 2));
    
    switch (message.command) {
      case 'openApplicationDetails':
        console.log('🚀 Processing openApplicationDetails command...');
        console.log('App name to open:', message.appName);
        console.log('App data:', JSON.stringify(message.appData, null, 2));
        
        // Get the environment info using multi-account system
        const { AccountService } = await import('../controllers/accountService.js');
        const accountService = new AccountService(context);
        const activeAccount = await accountService.getActiveAccount();
        
        let environmentInfo = { id: '', name: environment };
        
        if (activeAccount) {
          const environmentsData = await accountService.getAccountData(activeAccount.id, 'environments');
          if (environmentsData) {
            try {
              const parsedEnvironments = JSON.parse(environmentsData);
              if (parsedEnvironments.data && parsedEnvironments.data.length > 0) {
                environmentInfo = { 
                  id: parsedEnvironments.data[0].id, 
                  name: parsedEnvironments.data[0].name || environment 
                };
                console.log('✅ Retrieved environment info from multi-account system:', environmentInfo);
              }
            } catch (error) {
              console.error('❌ Failed to parse environments data:', error);
            }
          }
        }
        
        console.log('🎯 Final environment ID to use:', environmentInfo.id);
        console.log('📱 About to call showApplicationCommandCenter...');
        console.log('📱 App data:', JSON.stringify(message.appData, null, 2));

        // Import and call the Application Command Center with preselected data
        const { showApplicationCommandCenter } = await import('./applicationCommandCenter.js');

        // Open the Application Command Center with preselected environment and app
        await showApplicationCommandCenter(
          context,
          environmentInfo.id,
          environmentInfo.name,
          message.appName,
          message.appData
        );
        
        console.log('✅ Application details webview call completed');
        break;

      case 'downloadCH2Csv':
        console.log('📥 Processing downloadCH2Csv command...');
        const csvData = generateCH2ApplicationsCsv(applications);
        if (!csvData) {
          vscode.window.showInformationMessage('No application data to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'CSV Files': ['csv'] },
          saveLabel: 'Save as CSV',
          defaultUri: vscode.Uri.file(`cloudhub2-applications-${new Date().toISOString().split('T')[0]}.csv`)
        });
        if (uri) {
          try {
            await fs.promises.writeFile(uri.fsPath, csvData, 'utf-8');
            vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save CSV file: ${error.message}`);
          }
        }
        break;

      case 'refreshApplications':
        console.log('🔄 Processing refreshApplications command...');
        try {
          vscode.window.showInformationMessage('Refreshing CloudHub 2.0 applications...');
          
          // Get the environment info using multi-account system for refresh
          const { AccountService } = await import('../controllers/accountService.js');
          const accountService = new AccountService(context);
          const activeAccount = await accountService.getActiveAccount();
          
          if (!activeAccount) {
            vscode.window.showErrorMessage('No active account found. Please log in first.');
            return;
          }

          const environmentsData = await accountService.getAccountData(activeAccount.id, 'environments');
          if (!environmentsData) {
            vscode.window.showErrorMessage('Environment info not found. Please login first.');
            return;
          }
          
          const parsedEnvironments = JSON.parse(environmentsData);
          const envInfo = { 
            id: parsedEnvironments.data[0]?.id || '', 
            name: parsedEnvironments.data[0]?.name || environment 
          };
          const storedSelected = await context.secrets.get('anypoint.selectedEnvironment');
          if (storedSelected) {
            try {
              const parsed = JSON.parse(storedSelected);
              envInfo.id = parsed.id || envInfo.id;
              envInfo.name = parsed.name || envInfo.name;
            } catch {
              // ignore parse errors and use defaults
            }
          }
          console.log('🔄 Refreshing with environment:', envInfo);
          
          const refreshedApps = await getCH2Applications(context);
          
          // Update the webview with new data
          panel.webview.html = getCloudHub2ApplicationsHtml(refreshedApps, panel.webview, context.extensionUri, envInfo.name);
          vscode.window.showInformationMessage(`Refreshed ${refreshedApps.length} applications`);
        } catch (error: any) {
          console.error('❌ Refresh failed:', error);
          vscode.window.showErrorMessage(`Failed to refresh applications: ${error.message}`);
        }
        break;

      case 'ch2BulkAction':
        console.log('🚦 Processing CloudHub 2.0 bulk action...');
        try {
          await handleCh2BulkAction(context, message.action, message.domains, message.deployments);
        } catch (error: any) {
          console.error('❌ Bulk action failed:', error);
          vscode.window.showErrorMessage(`Failed to ${message.action?.toLowerCase?.() || 'update'} applications: ${error.message}`);
        }
        break;

      case 'openGitHubRepo':
        try {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        } catch (error: any) {
          console.error('Failed to open GitHub URL:', error);
          vscode.window.showErrorMessage(`Failed to open GitHub: ${error.message}`);
        }
        break;

      default:
        console.log('❓ Unknown command:', message.command);
    }
  } catch (error: any) {
    console.error('💥 Error in message handler:', error);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
});
}

/**
 * Updated HTML generation function to include environment info
 */
function getCloudHub2ApplicationsHtml(
  applications: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  environment?: string,
  businessGroup?: { id: string, name: string }
): string {
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Calculate statistics
  const totalApps = applications.length;
  const runningApps = applications.filter(app => (app.application?.status || app.status) === 'RUNNING' || (app.application?.status || app.status) === 'STARTED').length;
  const stoppedApps = applications.filter(app => ['STOPPED', 'UNDEPLOYED', 'FAILED'].includes(app.application?.status || app.status)).length;
  const totalVCores = applications.reduce((sum, app) => sum + (app.target?.resources?.cpu?.reserved || 0), 0);

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 2.0 Applications - ${environment || 'Unknown Environment'}</title>
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

          /* Environment Info */
          .environment-badge {
            display: inline-flex;
            align-items: center;
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            padding: 8px 12px;
            margin-top: 12px;
            color: var(--accent-blue);
            font-weight: 500;
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
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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

          .button:disabled {
            background-color: var(--text-muted);
            cursor: not-allowed;
          }

          .button-danger {
            background-color: var(--error);
            color: var(--text-primary);
          }

          .button-danger:hover {
            background-color: #ff6b6b;
          }

          .button-ghost {
            background-color: transparent;
            border: 1px solid var(--border-primary);
          }

          .action-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            gap: 12px;
            flex-wrap: wrap;
          }

          .selection-info {
            color: var(--text-secondary);
            font-size: 13px;
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

          /* App Name Links */
          .app-name-link {
            color: var(--accent-blue);
            text-decoration: none;
            cursor: pointer;
            font-weight: 500;
          }

          .app-name-link:hover {
            text-decoration: underline;
            color: var(--accent-light);
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

          /* GitHub Star Banner Styles */
          ${getGitHubStarBannerStyles()}
        </style>
      </head>
      <body>
        <!-- Header -->
        <div class="header">
          <div class="header-content">
            <h1>CloudHub 2.0 Applications</h1>
            <p>Next-generation application monitoring and management</p>
            <div style="display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap;">
              ${environment ? `<div class="environment-badge">🌍 Environment: ${environment}</div>` : ''}
              ${businessGroup ? `<div class="environment-badge" style="background: var(--surface-secondary); border-color: var(--accent-blue);">🏢 Business Group: ${businessGroup.name}</div>` : ''}
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
              <p class="stat-subtitle">All applications</p>
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
                <h3 class="stat-title">Total vCores</h3>
              </div>
              <div class="stat-value">${totalVCores}</div>
              <p class="stat-subtitle">Allocated vCores</p>
            </div>
          </div>

          <!-- Applications Table -->
          <div class="applications-card">
            <div class="card-header">
              <h2 class="card-title">Applications</h2>
              <div class="button-group">
                <button id="btnRefreshApps" class="button">Refresh</button>
                <button id="btnDownloadCH2Csv" class="button">Download as CSV</button>
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
                <input type="text" id="appSearch" class="search-input" placeholder="Search applications...">
              </div>
            </div>

            <div class="action-bar">
              <div class="selection-info" id="selectionSummary">No applications selected</div>
              <div class="button-group">
                <button id="btnRestartSelected" class="button button-ghost" disabled>Start Selected</button>
                <button id="btnStopSelected" class="button button-danger" disabled>Stop Selected</button>
              </div>
            </div>

            <div class="table-wrapper">
              <table id="appTable">
                <thead>
                  <tr>
                    <th class="checkbox-cell"><input type="checkbox" id="ch2SelectAll"></th>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Creation Date</th>
                    <th>Current Runtime Version</th>
                    <th>Last Modified Date</th>
                    <th>Last Successful Runtime Version</th>
                  </tr>
                </thead>
                <tbody id="ch2AppsTbody">
                  <!-- Table content will be populated by JavaScript -->
                </tbody>
              </table>
            </div>

            <div class="pagination">
              <div id="ch2AppsInfo">Showing 0 to 0 of 0 entries</div>
              <div class="pagination-controls">
                <button id="ch2AppsPrev" class="pagination-btn">Previous</button>
                <button id="ch2AppsNext" class="pagination-btn">Next</button>
              </div>
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const applicationsRaw = ${JSON.stringify(applications)};
          const applicationsData = Array.isArray(applicationsRaw) ? applicationsRaw : [];
          const environmentName = '${environment || ''}';
          let filteredApplications = [...applicationsData];
          let currentPage = 1;
          let entriesPerPage = 10;
          const selectedApps = new Map();

          function getDomain(app) {
            if (!app || typeof app !== 'object') {
              return '';
            }
            return app.application?.domain || app.domain || app.name || '';
          }

          function getDeploymentId(app) {
            return app?.deploymentId || app?.id || app?.application?.id || '';
          }

          // Render status badge
          function renderStatus(status) {
            const statusClass = 
              (status === 'RUNNING' || status === 'STARTED') ? 'status-running' :
              ['STOPPED', 'UNDEPLOYED', 'FAILED'].includes(status) ? 'status-stopped' :
              'status-default';
            
            return \`<span class="status-badge \${statusClass}">
              <span class="status-dot"></span>
              \${status || 'Unknown'}
            </span>\`;
          }

          // Format date safely
          function formatDateSafe(dateStr) {
            if (!dateStr) return 'N/A';
            try {
              return new Date(dateStr).toLocaleDateString();
            } catch {
              return dateStr;
            }
          }

          function updateSelectionSummary() {
            const summaryEl = document.getElementById('selectionSummary');
            const selectedCount = selectedApps.size;
            if (summaryEl) {
              summaryEl.textContent = selectedCount === 0
                ? 'No applications selected'
                : \`\${selectedCount} application(s) selected\`;
            }

            const restartBtn = document.getElementById('btnRestartSelected');
            const stopBtn = document.getElementById('btnStopSelected');
            const hasSelection = selectedCount > 0;
            if (restartBtn) restartBtn.disabled = !hasSelection;
            if (stopBtn) stopBtn.disabled = !hasSelection;
          }

          function getPaginationBounds() {
            const startIndex = (currentPage - 1) * entriesPerPage;
            return { startIndex, endIndex: startIndex + entriesPerPage };
          }

          function getPageApplications() {
            const { startIndex, endIndex } = getPaginationBounds();
            return filteredApplications.slice(startIndex, endIndex);
          }

          function syncSelectAllCheckbox() {
            const selectAllEl = document.getElementById('ch2SelectAll');
            if (!selectAllEl) {
              return;
            }

            const pageApps = getPageApplications();
            if (pageApps.length === 0) {
              selectAllEl.checked = false;
              selectAllEl.indeterminate = false;
              return;
            }

            const pageDomains = pageApps.map(getDomain).filter(Boolean);
            const allSelected = pageDomains.length > 0 && pageDomains.every(domain => selectedApps.has(domain));
            const someSelected = pageDomains.some(domain => selectedApps.has(domain));
            selectAllEl.checked = allSelected;
            selectAllEl.indeterminate = !allSelected && someSelected;
          }

          function sendBulkAction(action) {
            if (!selectedApps.size) {
              alert('Select at least one application first.');
              return;
            }

            const deployments = Array.from(selectedApps.values())
              .map(item => item.deploymentId)
              .filter(Boolean);

            if (!deployments.length) {
              alert('Could not resolve deployment IDs for the selected applications.');
              return;
            }

            vscode.postMessage({
              command: 'ch2BulkAction',
              action,
              domains: Array.from(selectedApps.keys()),
              deployments
            });
          }

          // Render table
          function renderTable() {
            const { startIndex, endIndex } = getPaginationBounds();
            const pageApplications = filteredApplications.slice(startIndex, endIndex);
            
            const tbody = document.getElementById('ch2AppsTbody');
            if (!tbody) return;

            const rowsHtml = pageApplications.map((app, pageIndex) => {
              if (!app || typeof app !== 'object') return '';
              
              const actualIndex = applicationsData.indexOf(app);
              const status = (app.application && app.application.status) || app.status || '';
              const domain = getDomain(app);
              const deploymentId = getDeploymentId(app);
              const isSelected = domain && selectedApps.has(domain);

              return \`
                <tr data-app-index="\${actualIndex}">
                  <td class="checkbox-cell">
                    <input type="checkbox" class="row-select" data-app-index="\${actualIndex}" data-deployment-id="\${deploymentId || ''}" data-domain="\${domain || ''}" \${domain ? '' : 'disabled'} \${isSelected ? 'checked' : ''}>
                  </td>
                  <td>\${renderStatus(status)}</td>
                  <td><a href="#" class="app-name-link" data-app-name="\${app.name || ''}" data-app-index="\${actualIndex}">\${app.name || 'Unknown'}</a></td>
                  <td>\${formatDateSafe(app.creationDate)}</td>
                  <td>\${app.currentRuntimeVersion || 'N/A'}</td>
                  <td>\${formatDateSafe(app.lastModifiedDate)}</td>
                  <td>\${app.lastSuccessfulRuntimeVersion || 'N/A'}</td>
                </tr>
              \`;
            }).filter(row => row !== '').join('');

            tbody.innerHTML = rowsHtml;
            updatePagination();
            updateSelectionSummary();
            syncSelectAllCheckbox();
          }

          // Update pagination
          function updatePagination() {
            const totalItems = filteredApplications.length;
            const totalPages = Math.ceil(totalItems / entriesPerPage);
            const startIndex = (currentPage - 1) * entriesPerPage + 1;
            const endIndex = Math.min(currentPage * entriesPerPage, totalItems);

            document.getElementById('ch2AppsInfo').textContent = 
              totalItems === 0 ? 'Showing 0 to 0 of 0 entries' :
              \`Showing \${startIndex} to \${endIndex} of \${totalItems} entries\`;

            document.getElementById('ch2AppsPrev').disabled = currentPage <= 1;
            document.getElementById('ch2AppsNext').disabled = currentPage >= totalPages;
          }

          // Handle app name clicks
          document.addEventListener('click', (e) => {
            if (e.target.classList.contains('app-name-link')) {
              e.preventDefault();
              const appName = e.target.dataset.appName;
              const appIndex = parseInt(e.target.dataset.appIndex);
              if (appIndex >= 0 && appIndex < applicationsData.length) {
                const appData = applicationsData[appIndex];
                console.log('Sending app data with environment:', environmentName);
                vscode.postMessage({
                  command: 'openApplicationDetails',
                  appName: appName,
                  appData: appData,
                  environment: environmentName
                });
              }
            }
          });

          // Download CSV button
          document.getElementById('btnDownloadCH2Csv')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadCH2Csv' });
          });

          // Refresh button
          document.getElementById('btnRefreshApps')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'refreshApplications' });
          });

          document.getElementById('btnRestartSelected')?.addEventListener('click', () => {
            sendBulkAction('START');
          });

          document.getElementById('btnStopSelected')?.addEventListener('click', () => {
            sendBulkAction('STOP');
          });

          document.addEventListener('change', (e) => {
            const target = e.target;

            if (target?.id === 'ch2SelectAll') {
              const pageApps = getPageApplications();
              if (target.checked) {
                pageApps.forEach(app => {
                  const domain = getDomain(app);
                  const deploymentId = getDeploymentId(app);
                  if (domain) {
                    selectedApps.set(domain, { domain, deploymentId });
                  }
                });
              } else {
                pageApps.forEach(app => {
                  const domain = getDomain(app);
                  if (domain) {
                    selectedApps.delete(domain);
                  }
                });
              }
              renderTable();
            }

            if (target?.classList?.contains('row-select')) {
              const appIndex = Number(target.dataset.appIndex);
              const app = applicationsData[appIndex];
              const domain = getDomain(app);
              const deploymentId = getDeploymentId(app);
              if (domain) {
                if (target.checked) {
                  selectedApps.set(domain, { domain, deploymentId });
                } else {
                  selectedApps.delete(domain);
                }
              }
              updateSelectionSummary();
              syncSelectAllCheckbox();
            }
          });

          // Search functionality
          const searchInput = document.getElementById('appSearch');
          searchInput?.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filteredApplications = applicationsData.filter(app => {
              if (!app || typeof app !== 'object') return false;
              return Object.values(app).some(value => {
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(searchTerm);
              });
            });
            currentPage = 1;
            renderTable();
          });

          // Entries per page
          const entriesSelect = document.getElementById('entriesPerPage');
          entriesSelect?.addEventListener('change', (e) => {
            entriesPerPage = parseInt(e.target.value);
            currentPage = 1;
            renderTable();
          });

          // Pagination
          document.getElementById('ch2AppsPrev')?.addEventListener('click', () => {
            if (currentPage > 1) {
              currentPage--;
              renderTable();
            }
          });

          document.getElementById('ch2AppsNext')?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredApplications.length / entriesPerPage);
            if (currentPage < totalPages) {
              currentPage++;
              renderTable();
            }
          });

          // Initial render
          renderTable();
        </script>

        <!-- GitHub Star Banner -->
        ${getGitHubStarBannerHtml()}
        ${getGitHubStarBannerScript()}
      </body>
    </html>
  `;
}

/**
 * Get CloudHub 2.0 applications/deployments list using stored credentials
 */
export async function getCH2Applications(context: vscode.ExtensionContext): Promise<any[]> {
  try {
    const { orgId, envId } = await getStoredOrgAndEnvInfo(context);
    const deployments = await getCH2Deployments(context, orgId, envId);
    
    // Transform deployments to match expected application structure
    return deployments.map(deployment => ({
      ...deployment,
      // Ensure consistent naming
      name: deployment.name || deployment.applicationName || deployment.application?.name || 'Unknown',
      // Add deployment-specific data
      deploymentId: deployment.id,
      isCloudHub2: true
    }));

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 applications:', error);
    vscode.window.showErrorMessage(`Failed to fetch applications: ${error.message}`);
    return [];
  }
}

async function handleCh2BulkAction(
  context: vscode.ExtensionContext,
  action: string,
  domains: string[],
  deployments?: string[]
): Promise<void> {
  if (!domains || domains.length === 0) {
    vscode.window.showWarningMessage('Select at least one application to continue.');
    return;
  }

  const normalizedAction = (action || '').toUpperCase();
  if (!['START', 'STOP'].includes(normalizedAction)) {
    throw new Error(`Unsupported action ${action}`);
  }

  const storedEnv = await context.secrets.get('anypoint.selectedEnvironment');
  const { orgId, envId: defaultEnvId } = await getStoredOrgAndEnvInfo(context);
  let envId = defaultEnvId;

  if (storedEnv) {
    try {
      const parsed = JSON.parse(storedEnv);
      envId = parsed.id || defaultEnvId;
    } catch {
      // Keep default env id on parse error
    }
  }

  if (!envId) {
    throw new Error('No environment selected for CloudHub 2.0.');
  }

  const apiHelper = new ApiHelper(context);
  const desiredState = normalizedAction === 'START' ? 'STARTED' : 'STOPPED';

  // Get region-specific base URL
  const baseUrl = await getBaseUrl(context);

  // Get region to determine which API to use
  const { AccountService } = await import('../controllers/accountService.js');
  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  const regionId = activeAccount?.region || 'us';

  const deploymentIds = (deployments || []).filter(id => !!id);
  if (!deploymentIds.length) {
    throw new Error('No deployment IDs found for the selected applications.');
  }

  for (const deploymentId of deploymentIds) {
    // US region uses ADAM API, EU/GOV may use different endpoint
    // Note: Bulk actions may need different handling per region
    let url: string;
    if (regionId === 'us') {
      url = `${baseUrl}/amc/adam/api/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
    } else {
      // For EU/GOV, use ARM API pattern (may need adjustment based on actual API)
      url = `${baseUrl}/amc/adam/api/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
      console.log(`CloudHub 2.0 Bulk Action: Using ADAM API for ${regionId.toUpperCase()} region (may need adjustment)`);
    }

    const response = await apiHelper.patch(
      url,
      { application: { desiredState } }
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API responded with status ${response.status} for deployment ${deploymentId}`);
    }
  }

  vscode.window.showInformationMessage(
    `${desiredState === 'STARTED' ? 'Start' : 'Stop'} requested for ${domains.length} CloudHub 2.0 application(s).`
  );
}

/**
 * Debug function to help identify data structure issues
 */
export function debugApplicationsData(data: any): void {
  console.log('=== CloudHub 2.0 Applications Data Debug ===');
  console.log('Type:', typeof data);
  console.log('Is Array:', Array.isArray(data));
  console.log('Data:', JSON.stringify(data, null, 2));
  
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    console.log('Object keys:', Object.keys(data));
    
    // Check common nested structures
    const possibleArrays = ['data', 'applications', 'items', 'response', 'result'];
    possibleArrays.forEach(key => {
      if (data[key]) {
        console.log(`Found ${key}:`, Array.isArray(data[key]) ? `Array with ${data[key].length} items` : typeof data[key]);
      }
    });
  }
  
  console.log('=== End Debug ===');
}

// ==================== CLOUDHUB 2.0 API FUNCTIONS ====================

/**
 * Get organization and environment info using multi-account system
 */
export async function getStoredOrgAndEnvInfo(context: vscode.ExtensionContext): Promise<{orgId: string, envId: string, environments: any[]}> {
  // Use multi-account system
  const { AccountService } = await import('../controllers/accountService.js');
  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }

  // Get environments for the active account
  const environmentsData = await accountService.getAccountData(activeAccount.id, 'environments');
  if (!environmentsData) {
    throw new Error('Environment info not found. Please login first.');
  }

  const parsedEnvironments = JSON.parse(environmentsData); // { data: [...], total: N }
  let envId = parsedEnvironments.data[0]?.id || '';

  // Prefer previously selected environment if available
  const storedSelected = await context.secrets.get('anypoint.selectedEnvironment');
  if (storedSelected) {
    try {
      const parsed = JSON.parse(storedSelected);
      envId = parsed.id || envId;
    } catch {
      // ignore parse failure
    }
  }

  return {
    orgId: activeAccount.organizationId,
    envId, // Use selected or first environment
    environments: parsedEnvironments.data
  };
}

/**
 * Step 1: Get all deployments for the environment - FIXED to handle 'items' property and region-specific APIs
 */
export async function getCH2Deployments(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string
): Promise<any[]> {
  try {
    const { getBaseUrl } = await import('../constants.js');
    const { AccountService } = await import('../controllers/accountService.js');
    const baseUrl = await getBaseUrl(context);
    const apiHelper = new ApiHelper(context);

    // Get region to determine which API to use
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    const regionId = activeAccount?.region || 'us';

    // US region uses Application Manager API (original working endpoint)
    // EU/GOV use ARM API (unified endpoint)
    let url: string;
    let requestConfig: any = {};

    if (regionId === 'us') {
      url = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`;
      console.log(`CloudHub 2.0 Deployments: Using Application Manager API for US region`);
    } else {
      url = `${baseUrl}/armui/api/v2/applications`;
      console.log(`CloudHub 2.0 Deployments: Using ARM API for ${regionId.toUpperCase()} region`);

      // ARM API requires org and env as headers instead of URL path
      requestConfig.headers = {
        'X-Anypnt-Org-Id': orgId,
        'X-Anypnt-Env-Id': envId
      };
      console.log(`CloudHub 2.0 Deployments: Adding ARM API headers - Org: ${orgId}, Env: ${envId}`);
    }

    console.log('Fetching CH2 deployments from:', url);
    const response = await apiHelper.get(url, requestConfig);

    if (response.status !== 200) {
      console.error('CloudHub 2.0 deployments API error:', response.status, response.data);
      throw new Error(`Failed to fetch deployments: ${response.status} ${response.statusText}`);
    }

    const deploymentsData = response.data;
    console.log('CH2 deployments response structure:', Object.keys(deploymentsData));
    console.log('Full response data:', JSON.stringify(deploymentsData, null, 2));

    // FIXED: Handle different response structures including 'items'
    let deployments = [];
    if (Array.isArray(deploymentsData)) {
      deployments = deploymentsData;
      console.log('✅ Found deployments as direct array');
    } else if ((deploymentsData as any).items && Array.isArray((deploymentsData as any).items)) {
      // ADDED: Handle 'items' property (most common for CloudHub 2.0)
      deployments = (deploymentsData as any).items;
      console.log('✅ Found deployments in items property');
    } else if ((deploymentsData as any).data && Array.isArray((deploymentsData as any).data)) {
      deployments = (deploymentsData as any).data;
      console.log('✅ Found deployments in data property');
    } else if ((deploymentsData as any).deployments && Array.isArray((deploymentsData as any).deployments)) {
      deployments = (deploymentsData as any).deployments;
      console.log('✅ Found deployments in deployments property');
    } else {
      // Debug: Log the actual structure to understand what we're getting
      console.error('❌ Unknown response structure. Available properties:', Object.keys(deploymentsData as any));
      console.error('❌ Full response:', JSON.stringify(deploymentsData, null, 2));

      // Try to find any array property
      const arrayProps = Object.keys(deploymentsData as any).filter(key =>
        Array.isArray((deploymentsData as any)[key])
      );

      if (arrayProps.length > 0) {
        console.log(`🔍 Found array properties: ${arrayProps.join(', ')}`);
        deployments = (deploymentsData as any)[arrayProps[0]];
        console.log(`⚠️ Using first array property '${arrayProps[0]}' with ${deployments.length} items`);
      }
    }

    // For EU/GOV ARM API: Filter for CloudHub 2.0 apps only
    if (regionId !== 'us') {
      const ch2Apps = deployments.filter((app: any) =>
        app.target?.type === 'MC' &&
        app.target?.subtype === 'shared-space'
      );
      console.log(`Filtered ${ch2Apps.length} CloudHub 2.0 apps from ${deployments.length} total deployments`);

      // Transform ARM API format to match Application Manager API format
      deployments = ch2Apps.map((app: any) => ({
        id: app.id,
        deploymentId: app.id,
        name: app.artifact?.name || 'Unknown',
        domain: app.artifact?.name || 'Unknown',
        creationDate: app.artifact?.createTime ? new Date(app.artifact.createTime).toISOString() : undefined,
        lastModifiedDate: app.artifact?.lastUpdateTime ? new Date(app.artifact.lastUpdateTime).toISOString() : undefined,
        currentRuntimeVersion: app.muleVersion?.version || 'N/A',
        lastSuccessfulRuntimeVersion: app.muleVersion?.version || 'N/A',
        muleVersion: app.muleVersion?.version || 'N/A',  // Command Center checks for this first
        region: app.target?.name || app.target?.provider || 'Unknown',  // Region info from target
        application: {
          status: app.application?.status || app.lastReportedStatus || 'UNKNOWN',
          domain: app.artifact?.name || 'Unknown'
        },
        target: app.target,
        // Keep original data for reference
        _originalArmData: app
      }));
      console.log(`Transformed ${deployments.length} apps from ARM API format to Application Manager format`);
    }

    console.log(`Retrieved ${deployments.length} deployments`);

    // Debug: Log the first deployment to see its structure
    if (deployments.length > 0) {
      console.log('📋 First deployment structure:', Object.keys(deployments[0]));
      console.log('📋 First deployment sample:', JSON.stringify(deployments[0], null, 2));
    }

    return deployments;

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 deployments:', error);
    throw error;
  }
}

// ==================== HELPER FUNCTIONS ====================

function getNestedValue(obj: any, path: string): any {
  try {
    if (!obj || typeof obj !== 'object') return '';
    return path.split('.').reduce((current, key) => current?.[key], obj) || '';
  } catch (error) {
    console.warn(`Error getting nested value for path ${path}:`, error);
    return '';
  }
}

function renderStatusCell(status: string): string {
  if (status === 'RUNNING' || status === 'STARTED') {
    return `<span style="color: #00ff00;">● ${status}</span>`;
  }
  if (['STOPPED', 'UNDEPLOYED'].includes(status)) {
    return `<span style="color: #ff0000;">● ${status}</span>`;
  }
  return status || '';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

// ==================== UI BUILDING FUNCTIONS ====================

/**
 * Build the CloudHub 2.0 applications table with reordered columns and clickable names
 */
function buildCloudHub2ApplicationsTable(applications: any[]): string {
  // Ensure applications is an array
  if (!Array.isArray(applications)) {
    console.warn('buildCloudHub2ApplicationsTable received non-array:', applications);
    applications = [];
  }

  if (applications.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h2>CloudHub 2.0 Applications</h2>
          <div class="button-group">
            <button id="btnRefreshApps" class="button">Refresh</button>
            <button id="btnDownloadCH2Csv" class="button">Download as CSV</button>
          </div>
        </div>
        <p>No applications available.</p>
      </div>
    `;
  }

  // Define column order - name is now second
  const columns = [
    { key: 'application.status', label: 'Status' },
    { key: 'name', label: 'Name' }, // Moved to second position
    { key: 'creationDate', label: 'Creation Date' },
    { key: 'currentRuntimeVersion', label: 'Current Runtime Version' },
    { key: 'lastModifiedDate', label: 'Last Modified Date' },
    { key: 'lastSuccessfulRuntimeVersion', label: 'Last Successful Runtime Version' },
  ];

  const rowsHtml = applications
    .map((app, index) => {
      const cells = columns.map((col) => {
        const val = getNestedValue(app, col.key);
        
        // Special handling for the name column - make it clickable
        if (col.key === 'name') {
          return `<td><a href="#" class="app-name-link" data-app-name="${val}" data-app-index="${index}">${val}</a></td>`;
        }
        
        // Special handling for status
        if (col.key === 'application.status') {
          return `<td>${renderStatusCell(val)}</td>`;
        }
        
        // Special handling for dates
        if (col.key.includes('Date')) {
          return `<td>${formatDate(val)}</td>`;
        }
        
        return `<td>${val || ''}</td>`;
      });

      return `<tr data-app-index="${index}">${cells.join('')}</tr>`;
    })
    .join('');

  return `
    <div class="card">
      <div class="card-header">
        <h2>CloudHub 2.0 Applications</h2>
        <div class="button-group">
          <button id="btnRefreshApps" class="button">Refresh</button>
          <button id="btnDownloadCH2Csv" class="button">Download as CSV</button>
        </div>
      </div>
      <div style="margin-bottom: 0.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <label>Show 
          <select id="entriesPerPage" style="padding: 2px; background-color: var(--card-color); color: var(--text-color); border: 1px solid #30363D;">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select> entries
        </label>
        <label>Search: 
          <input id="appSearch" type="text" placeholder="Search applications..." 
                 style="padding: 4px; width: 200px; background-color: var(--card-color); color: var(--text-color); border: 1px solid #30363D;" />
        </label>
      </div>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              ${columns.map(c => `<th>${c.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="ch2AppsTbody">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="margin-top: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
        <span id="ch2AppsInfo">Showing 1 to ${Math.min(applications.length, 10)} of ${applications.length} entries</span>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button id="ch2AppsPrev" class="button">Previous</button>
          <span id="ch2AppsPageNum" style="padding: 4px 8px;">1</span>
          <button id="ch2AppsNext" class="button">Next</button>
        </div>
      </div>
    </div>
  `;
}

// ==================== DATA GENERATION FUNCTIONS ====================

function generateCH2ApplicationsCsv(applications: any[]): string {
  // Ensure applications is an array
  if (!Array.isArray(applications) || applications.length === 0) {
    console.warn('generateCH2ApplicationsCsv received invalid data:', applications);
    return '';
  }
  
  const headers = ['Status', 'Name', 'Creation Date', 'Current Runtime Version', 'Last Modified Date', 'Last Successful Runtime Version'];
  const rows = applications.map(app => [
    getNestedValue(app, 'application.status') || '',
    app.name || '',
    formatDate(app.creationDate) || '',
    app.currentRuntimeVersion || '',
    formatDate(app.lastModifiedDate) || '',
    app.lastSuccessfulRuntimeVersion || ''
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  return csvContent;
}
