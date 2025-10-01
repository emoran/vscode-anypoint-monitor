// cloudhub2Applications.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { showApplicationDetailsCH2Webview } from './/applicationDetailsCH2';
import { refreshAccessToken } from '../controllers/oauthService';

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

  const applicationsTableHtml = buildCloudHub2ApplicationsTable(applications);

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 2.0 Applications - ${environment || 'Unknown Environment'}</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap" />
        <style>
          :root {
            --background-color: #0D1117;
            --card-color: #161B22;
            --text-color: #C9D1D9;
            --accent-color: #58A6FF;
            --navbar-color: #141A22;
            --navbar-text-color: #F0F6FC;
            --button-hover-color: #3186D1;
            --table-hover-color: #21262D;
          }

          body {
            margin: 0;
            padding: 0;
            background-color: var(--background-color);
            color: var(--text-color);
            font-family: 'Fira Code', monospace, sans-serif;
            font-size: 12px;
          }

          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--navbar-color);
            padding: 0.5rem 1rem;
          }
          .navbar-left {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .navbar-left img {
            height: 28px;
            width: auto;
          }
          .navbar-left h1 {
            color: var(--navbar-text-color);
            font-size: 1rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 0.75rem;
          }
          .navbar-right a {
            color: var(--navbar-text-color);
            text-decoration: none;
            font-weight: 500;
            font-size: 0.75rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          .container {
            width: 90%;
            max-width: 1400px;
            margin: 0.5rem auto;
          }

          .card {
            background-color: var(--card-color);
            border: 1px solid #30363D;
            border-radius: 6px;
            padding: 0.5rem;
            margin-bottom: 1rem;
          }
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.5rem;
          }
          .card-header h2 {
            margin: 0;
            font-size: 0.9rem;
            color: var(--accent-color);
          }

          .button-group {
            display: flex;
            gap: 0.25rem;
          }
          .button {
            padding: 4px 8px;
            font-size: 0.75rem;
            color: #fff;
            background-color: var(--accent-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
          }
          .button:hover {
            background-color: var(--button-hover-color);
          }
          .button:disabled {
            background-color: #6c757d;
            cursor: not-allowed;
          }

          .table-container {
            width: 100%;
            overflow-x: auto;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            padding: 4px;
            border-bottom: 1px solid #30363D;
            text-align: left;
            vertical-align: top;
          }
          th {
            color: var(--accent-color);
            white-space: nowrap;
          }
          tr:hover {
            background-color: var(--table-hover-color);
          }
          .app-table {
            font-size: 0.75rem;
          }

          .app-name-link {
            color: var(--accent-color);
            text-decoration: none;
            cursor: pointer;
          }
          .app-name-link:hover {
            text-decoration: underline;
          }

          .environment-info {
            background-color: var(--card-color);
            border: 1px solid #30363D;
            border-radius: 4px;
            padding: 0.5rem;
            margin-bottom: 1rem;
            font-size: 0.8rem;
          }
        </style>
      </head>
      <body>
        <nav class="navbar">
          <div class="navbar-left">
            <img src="${logoSrc}" alt="Logo"/>
            <h1>Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <div class="container">
          ${environment ? `<div class="environment-info">Environment: <strong>${environment}</strong></div>` : ''}
          ${applicationsTableHtml}
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const applicationsRaw = ${JSON.stringify(applications)};
          const applicationsData = Array.isArray(applicationsRaw) ? applicationsRaw : [];
          const environmentName = '${environment || ''}';
          let filteredApplications = [...applicationsData];
          let currentPage = 1;
          let entriesPerPage = 10;

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
              const statusHtml = status === 'RUNNING' || status === 'STARTED' 
                ? \`<span style="color: #00ff00;">● \${status}</span>\`
                : ['STOPPED', 'UNDEPLOYED'].includes(status)
                ? \`<span style="color: #ff0000;">● \${status}</span>\`
                : status;

              const formatDateSafe = (dateStr) => {
                if (!dateStr) return '';
                try {
                  return new Date(dateStr).toISOString().split('T')[0];
                } catch {
                  return dateStr;
                }
              };

              return \`
                <tr data-app-index="\${actualIndex}">
                  <td>\${statusHtml}</td>
                  <td><a href="#" class="app-name-link" data-app-name="\${app.name || ''}" data-app-index="\${actualIndex}">\${app.name || 'Unknown'}</a></td>
                  <td>\${formatDateSafe(app.creationDate)}</td>
                  <td>\${app.currentRuntimeVersion || ''}</td>
                  <td>\${formatDateSafe(app.lastModifiedDate)}</td>
                  <td>\${app.lastSuccessfulRuntimeVersion || ''}</td>
                </tr>
              \`;
            }).filter(row => row !== '').join('');

            tbody.innerHTML = rowsHtml;

            // Update pagination info
            const totalPages = Math.ceil(filteredApplications.length / entriesPerPage);
            const showingStart = filteredApplications.length === 0 ? 0 : startIndex + 1;
            const showingEnd = Math.min(endIndex, filteredApplications.length);
            
            const infoElement = document.getElementById('ch2AppsInfo');
            const pageNumElement = document.getElementById('ch2AppsPageNum');
            const prevButton = document.getElementById('ch2AppsPrev');
            const nextButton = document.getElementById('ch2AppsNext');
            
            if (infoElement) {
              infoElement.textContent = \`Showing \${showingStart} to \${showingEnd} of \${filteredApplications.length} entries\`;
            }
            if (pageNumElement) {
              pageNumElement.textContent = currentPage.toString();
            }
            if (prevButton) {
              prevButton.disabled = currentPage <= 1;
            }
            if (nextButton) {
              nextButton.disabled = currentPage >= totalPages;
            }
          }

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
    let accessToken = await context.secrets.get('anypoint.accessToken');

    if (!accessToken) {
      throw new Error('No access token found. Please log in first.');
    }

    const executeRequest = async (token: string) => {
      console.log('Fetching CH2 deployments from:', url);
      return fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    };

    let response = await executeRequest(accessToken);

    if (response.status === 401) {
      console.warn('CH2 deployments request returned 401. Attempting to refresh access token.');
      const refreshed = await refreshAccessToken(context);
      if (!refreshed) {
        throw new Error('Failed to refresh access token while fetching deployments.');
      }

      accessToken = await context.secrets.get('anypoint.accessToken');
      if (!accessToken) {
        throw new Error('No access token available after refresh. Please log in again.');
      }

      response = await executeRequest(accessToken);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CloudHub 2.0 deployments API error:', response.status, errorText);
      throw new Error(`Failed to fetch deployments: ${response.status} ${response.statusText}`);
    }

    const deploymentsData = await response.json();
    console.log('CH2 deployments response structure:', Object.keys(deploymentsData));
    console.log('Full response data:', JSON.stringify(deploymentsData, null, 2));

    // FIXED: Handle different response structures including 'items'
    let deployments = [];
    if (Array.isArray(deploymentsData)) {
      deployments = deploymentsData;
      console.log('✅ Found deployments as direct array');
    } else if (deploymentsData.items && Array.isArray(deploymentsData.items)) {
      // ADDED: Handle 'items' property (most common for CloudHub 2.0)
      deployments = deploymentsData.items;
      console.log('✅ Found deployments in items property');
    } else if (deploymentsData.data && Array.isArray(deploymentsData.data)) {
      deployments = deploymentsData.data;
      console.log('✅ Found deployments in data property');
    } else if (deploymentsData.deployments && Array.isArray(deploymentsData.deployments)) {
      deployments = deploymentsData.deployments;
      console.log('✅ Found deployments in deployments property');
    } else {
      // Debug: Log the actual structure to understand what we're getting
      console.error('❌ Unknown response structure. Available properties:', Object.keys(deploymentsData));
      console.error('❌ Full response:', JSON.stringify(deploymentsData, null, 2));
      
      // Try to find any array property
      const arrayProps = Object.keys(deploymentsData).filter(key => 
        Array.isArray(deploymentsData[key])
      );
      
      if (arrayProps.length > 0) {
        console.log(`🔍 Found array properties: ${arrayProps.join(', ')}`);
        deployments = deploymentsData[arrayProps[0]];
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
