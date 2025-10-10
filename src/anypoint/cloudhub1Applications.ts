import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a detailed table of applications
 * with a single CSV download option. This version has a dark theme
 * and a more “techy” vibe, plus styling for the DataTables length menu.
 */
export function showApplicationsWebview1(context: vscode.ExtensionContext, data: any[]) {
  // Ensure the data is an array
  const appsArray = Array.isArray(data) ? data : [];

  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'CloudHub Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Build the HTML
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri);

  // Listen for messages (for CSV download)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'downloadAllCsv') {
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
    }
  });
}

function getApplicationsHtml(
  apps: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // URIs for resources
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Calculate statistics
  const totalApps = apps.length;
  const runningApps = apps.filter(app => app.status === 'STARTED' || app.status === 'RUNNING').length;
  const stoppedApps = apps.filter(app => app.status === 'STOPPED' || app.status === 'UNDEPLOYED').length;
  const totalWorkers = apps.reduce((sum, app) => sum + (app.workers || 0), 0);

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 1.0 Applications</title>
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
            <h1>CloudHub 1.0 Applications</h1>
            <p>Application monitoring and management</p>
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
                <h3 class="stat-title">Total Workers</h3>
              </div>
              <div class="stat-value">${totalWorkers}</div>
              <p class="stat-subtitle">Allocated workers</p>
            </div>
          </div>

          <!-- Applications Table -->
          <div class="applications-card">
            <div class="card-header">
              <h2 class="card-title">Applications</h2>
              <button id="downloadAllCsv" class="button">Download as CSV</button>
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

            <div class="table-wrapper">
              <table id="appTable">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Full Domain</th>
                    <th>Status</th>
                    <th>Workers</th>
                    <th>Worker Type</th>
                    <th>Region</th>
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
          let filteredData = [...appsData];
          let currentPage = 1;
          let entriesPerPage = 10;

          // Render status badge
          function renderStatus(status) {
            const statusClass = 
              (status === 'STARTED' || status === 'RUNNING') ? 'status-running' :
              (status === 'STOPPED' || status === 'UNDEPLOYED') ? 'status-stopped' :
              'status-default';
            
            return \`<span class="status-badge \${statusClass}">
              <span class="status-dot"></span>
              \${status || 'Unknown'}
            </span>\`;
          }

          // Render table
          function renderTable() {
            const startIndex = (currentPage - 1) * entriesPerPage;
            const endIndex = startIndex + entriesPerPage;
            const pageData = filteredData.slice(startIndex, endIndex);

            const tbody = document.getElementById('appTableBody');
            tbody.innerHTML = pageData.map(app => \`
              <tr>
                <td>\${app.domain || 'N/A'}</td>
                <td>\${app.fullDomain || 'N/A'}</td>
                <td>\${renderStatus(app.status)}</td>
                <td>\${app.workers || 'N/A'}</td>
                <td>\${app.workerType || 'N/A'}</td>
                <td>\${app.region || 'N/A'}</td>
                <td>\${app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : 'N/A'}</td>
              </tr>
            \`).join('');

            updatePagination();
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
              Object.values(app).some(value => 
                value && value.toString().toLowerCase().includes(searchTerm)
              )
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

          // Initial render
          renderTable();
        </script>
      </body>
    </html>
  `;
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