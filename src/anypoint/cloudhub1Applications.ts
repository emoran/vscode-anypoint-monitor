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

  // DataTables + jQuery
  const dataTableJs = 'https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js';
  const jqueryJs = 'https://code.jquery.com/jquery-3.6.0.min.js';
  const dataTableCss = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';

  // Google Fonts (Fira Code for a tech vibe)
  const googleFontLink = 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap';

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub Applications</title>
        <!-- DataTables + Google Font -->
        <link rel="stylesheet" href="${dataTableCss}" />
        <link rel="stylesheet" href="${googleFontLink}" />
        <style>
          /* Dark Theme + Tech Vibe */
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
            font-size: 14px;
          }

          /* Navbar */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--navbar-color);
            padding: 0.75rem 1rem;
          }
          .navbar-left {
            display: flex;
            align-items: center;
            gap: 1rem;
          }
          .navbar-left img {
            height: 32px;
            width: auto;
          }
          .navbar-left h1 {
            color: var(--navbar-text-color);
            font-size: 1.25rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 1.5rem;
          }
          .navbar-right a {
            color: var(--navbar-text-color);
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* Main Container */
          .container {
            width: 90%;
            max-width: 1200px;
            margin: 1rem auto;
          }

          /* Card */
          .card {
            background-color: var(--card-color);
            border: 1px solid #30363D;
            border-radius: 6px;
            padding: 1rem;
          }
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
          }
          .card-header h2 {
            margin: 0;
            font-size: 1.25rem;
            color: var(--accent-color);
          }

          /* Button */
          .button {
            padding: 6px 12px;
            font-size: 0.85rem;
            color: #ffffff;
            background-color: var(--accent-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
          }
          .button:hover {
            background-color: var(--button-hover-color);
          }

          /* DataTable Overwrites */
          #appTable_wrapper .dataTables_length,
          #appTable_wrapper .dataTables_filter,
          #appTable_wrapper .dataTables_info,
          #appTable_wrapper .dataTables_paginate {
            margin: 0.5rem 0;
            font-size: 0.85rem;
            color: var(--text-color);
          }

          /* Style the "Show X entries" label and dropdown */
          #appTable_length label {
            color: var(--text-color);
            font-weight: normal;
          }
          #appTable_length select {
            background-color: #121212;
            color: var(--text-color);
            border: 1px solid #30363D;
            border-radius: 4px;
            padding: 2px 8px;
            outline: none;
          }

          #appTable_wrapper input[type="search"] {
            background-color: #121212;
            color: var(--text-color);
            border: 1px solid #30363D;
          }
          #appTable thead {
            background-color: #21262D;
          }
          #appTable thead th {
            color: var(--accent-color);
            border-bottom: 1px solid #30363D;
          }
          #appTable tbody tr {
            background-color: var(--card-color);
            border-bottom: 1px solid #30363D;
          }
          #appTable tbody tr:hover {
            background-color: var(--table-hover-color);
          }
          #appTable tbody td {
            color: var(--text-color);
            white-space: nowrap;
          }
          .dataTables_paginate .paginate_button {
            color: var(--accent-color) !important;
          }
          .dataTables_paginate .paginate_button.current {
            background: var(--accent-color) !important;
            color: #fff !important;
          }
        </style>
      </head>
      <body>
        <!-- Top Navbar -->
        <nav class="navbar">
          <div class="navbar-left">
            <img src="${logoSrc}" />
            <h1>Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About the Extension</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <!-- Main Content -->
        <div class="container">
          <div class="card">
            <div class="card-header">
              <h2>CloudHub 1.0</h2>
              <button id="downloadAllCsv" class="button">Download as CSV</button>
            </div>
            <div style="overflow-x:auto;">
              <table
                id="appTable"
                class="display"
                style="width: 100%;"
              >
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
                <tbody>
                  ${
                    apps
                      .map(
                        (app) => `
                          <tr>
                            <td>${app.domain ?? 'N/A'}</td>
                            <td>${app.fullDomain ?? 'N/A'}</td>
                            <td>${app.status ?? 'N/A'}</td>
                            <td>${app.workers ?? 'N/A'}</td>
                            <td>${app.workerType ?? 'N/A'}</td>
                            <td>${app.region ?? 'N/A'}</td>
                            <td>${
                              app.lastUpdateTime
                                ? new Date(app.lastUpdateTime).toLocaleString()
                                : 'N/A'
                            }</td>
                          </tr>
                        `
                      )
                      .join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Scripts -->
        <script src="${jqueryJs}"></script>
        <script src="${dataTableJs}"></script>
        <script>
          const vscode = acquireVsCodeApi();

          // CSV download handler
          document.getElementById('downloadAllCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadAllCsv' });
          });

          // Initialize DataTables
          $(document).ready(function () {
            $('#appTable').DataTable({
              pageLength: 10,
              responsive: true,
              autoWidth: false,
              language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries"
              }
            });
          });
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