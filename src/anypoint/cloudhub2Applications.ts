// cloudhub2Applications.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { showApplicationDetailsCH2Webview } from './/applicationDetailsCH2';
import { refreshAccessToken } from '../controllers/oauthService';
import { ApiHelper } from '../controllers/apiHelper.js';

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

  panel.webview.html = getCloudHub2ApplicationsHtml(applications, panel.webview, context.extensionUri, environment);

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
        
        // Get the stored environment info
        const storedEnvInfo = await context.secrets.get('anypoint.selectedEnvironment');
        let environmentInfo = { id: '', name: environment };
        
        console.log('🔍 Stored environment info raw:', storedEnvInfo);
        
        if (storedEnvInfo) {
          try {
            environmentInfo = JSON.parse(storedEnvInfo);
            console.log('✅ Successfully parsed environment info:', environmentInfo);
          } catch (error) {
            console.error('❌ Failed to parse stored environment info:', error);
          }
        } else {
          console.warn('⚠️ No stored environment info found, using fallback');
        }
        
        console.log('🎯 Final environment ID to use:', environmentInfo.id);
        console.log('📱 About to call showApplicationDetailsCH2Webview...');
        
        // Import the function if not already imported
        // const { showApplicationDetailsCH2Webview } = await import('.//applicationDetailsCH2');
        
        // Open the new ApplicationDetailsCH2 webview with environment info
        await showApplicationDetailsCH2Webview(
          context, 
          message.appName, 
          message.appData, 
          environmentInfo.id
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
          
          // Get the stored environment info for refresh
          const storedEnvInfo = await context.secrets.get('anypoint.selectedEnvironment');
          if (!storedEnvInfo) {
            vscode.window.showErrorMessage('Environment info not found. Please run the command again.');
            return;
          }
          
          const envInfo = JSON.parse(storedEnvInfo);
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
  environment?: string
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
        </style>
      </head>
      <body>
        <!-- Header -->
        <div class="header">
          <div class="header-content">
            <h1>CloudHub 2.0 Applications</h1>
            <p>Next-generation application monitoring and management</p>
            ${environment ? `<div class="environment-badge">Environment: ${environment}</div>` : ''}
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

            <div class="table-wrapper">
              <table id="appTable">
                <thead>
                  <tr>
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

          // Render table
          function renderTable() {
            const startIndex = (currentPage - 1) * entriesPerPage;
            const endIndex = startIndex + entriesPerPage;
            const pageApplications = filteredApplications.slice(startIndex, endIndex);
            
            const tbody = document.getElementById('ch2AppsTbody');
            if (!tbody) return;

            const rowsHtml = pageApplications.map((app, pageIndex) => {
              if (!app || typeof app !== 'object') return '';
              
              const actualIndex = applicationsData.indexOf(app);
              const status = (app.application && app.application.status) || app.status || '';

              return \`
                <tr data-app-index="\${actualIndex}">
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
 * Get organization and environment info from stored secrets
 */
export async function getStoredOrgAndEnvInfo(context: vscode.ExtensionContext): Promise<{orgId: string, envId: string, environments: any[]}> {
  const storedUserInfo = await context.secrets.get('anypoint.userInfo');
  const storedEnvironments = await context.secrets.get('anypoint.environments');

  if (!storedUserInfo || !storedEnvironments) {
    throw new Error('User info or environment info not found. Please log in first.');
  }

  const userInfo = JSON.parse(storedUserInfo);
  const parsedEnvironments = JSON.parse(storedEnvironments); // { data: [...], total: N }

  return {
    orgId: userInfo.organization.id,
    envId: parsedEnvironments.data[0]?.id || '', // Use first environment or let user select
    environments: parsedEnvironments.data
  };
}

/**
 * Step 1: Get all deployments for the environment - FIXED to handle 'items' property
 */
export async function getCH2Deployments(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string
): Promise<any[]> {
  try {
    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`;
    const apiHelper = new ApiHelper(context);

    console.log('Fetching CH2 deployments from:', url);
    const response = await apiHelper.get(url);

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
