import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a detailed table of applications
 * with a single CSV download option, with container at ~80% width
 * and a smaller table font.
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
        fs.writeFileSync(uri.fsPath, csvContent, 'utf-8');
        vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
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
  const ldsPath = vscode.Uri.joinPath(extensionUri, 'salesforce-lightning-design-system.min.css');
  const ldsSrc = webview.asWebviewUri(ldsPath);

  const dataTableJs = 'https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js';
  const jqueryJs = 'https://code.jquery.com/jquery-3.6.0.min.js';
  const dataTableCss = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';

  const googleFontLink = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap';

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub Applications</title>
        <!-- DataTables + Lightning Design System + Google Font -->
        <link rel="stylesheet" href="${dataTableCss}" />
        <link rel="stylesheet" href="${ldsSrc}" />
        <link rel="stylesheet" href="${googleFontLink}" />
        <style>
          /* Use a modern font (Inter in this example) */
          body {
            margin: 0;
            padding: 0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont,
              "Segoe UI", Roboto, Helvetica, Arial, sans-serif,
              "Apple Color Emoji", "Segoe UI Emoji";
            color: #212529;
            background-color: #ffffff;
          }

          /* Top Navbar */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1f2b3c;
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
            color: #ffffff;
            font-size: 1.25rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 1.5rem;
          }
          .navbar-right a {
            color: #ffffff;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* Main Container: ~80% of viewport width, centered */
          .container {
            width: 80%;
            margin: 1rem auto; /* 1rem top/bottom margin */
            background-color: #ffffff;
          }

          /* Card styling */
          .slds-card {
            border: 1px solid #e4e4e4;
            border-radius: 6px;
            padding: 1rem;
            background-color: #ffffff;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
          }
          .slds-card__header {
            margin-bottom: 1rem;
          }
          .slds-icon_container {
            background-color: #52667a;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
          }
          .slds-icon_container svg {
            fill: #fff;
          }

          /* Button smaller */
          .button {
            padding: 6px 12px;
            font-size: 0.85rem;
            color: #ffffff;
            background-color: #52667a;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            font-weight: 600;
          }
          .button:hover {
            background-color: #435362;
          }

          /* DataTable custom styling */
          #appTable_wrapper .dataTables_length,
          #appTable_wrapper .dataTables_filter,
          #appTable_wrapper .dataTables_info,
          #appTable_wrapper .dataTables_paginate {
            margin: 0.5rem 0;
            font-size: 0.8rem;
          }

          /* Make the table font smaller & narrower columns */
          table.dataTable thead th,
          table.dataTable tbody td {
            font-size: 0.8rem; /* Make table text smaller */
            white-space: nowrap; /* Keep cells from wrapping (narrow columns) */
          }
          table.dataTable tbody td {
            padding: 0.5rem 0.5rem;
          }

          /* Subtle row striping, highlight on hover */
          table.dataTable tbody tr:nth-child(even) {
            background-color: #fafbfc;
          }
          table.dataTable tbody tr:hover {
            background-color: #f1f3f5;
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

        <!-- Main Content (80% width container) -->
        <div class="container">
          <article class="slds-card">
            <div class="slds-card__header slds-grid">
              <header class="slds-media slds-media_center slds-has-flexi-truncate">
                <div class="slds-media__figure">
                  <span class="slds-icon_container slds-icon-standard-account" title="account">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24px" height="24px">
                      <rect width="100%" height="100%" fill="transparent" />
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 
                          10-4.48 10-10S17.52 2 12 2zm0 18
                          c-4.41 0-8-3.59-8-8s3.59-8
                          8-8 8 3.59 8 8-3.59 8-8
                          8z"/>
                      <path d="M11 14h2v2h-2zm0-8h2v6h-2z"/>
                    </svg>
                    <span class="slds-assistive-text">account</span>
                  </span>
                </div>
                <div class="slds-media__body">
                  <h2 class="slds-card__header-title">
                    <a href="javascript:void(0);" class="slds-card__header-link slds-truncate" title="Accounts">
                      <span>CloudHub 1.0</span>
                    </a>
                  </h2>
                </div>
                <div class="slds-no-flex">
                  <button id="downloadAllCsv" class="button">Download as CSV</button>
                </div>
              </header>
            </div>
            <div class="slds-card__body slds-card__body_inner">
              <!-- Table -->
              <div class="slds-scrollable slds-m-around_medium">
                <table
                  id="appTable"
                  class="slds-table slds-table_cell-buffer slds-table_striped
                         slds-max-medium-table_stacked-horizontal display"
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
          </article>
        </div>

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