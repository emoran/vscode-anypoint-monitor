import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a detailed table of applications
 * with a single CSV download option, matching the style from your screenshot.
 *
 * @param context The extension context (used to create WebviewPanel, etc.)
 * @param data The data returned by your API call (JSON array of application records).
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

  // Build the HTML with the application data
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri);

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'downloadAllCsv') {
      const csvContent = generateAllApplicationsCsv(appsArray);

      // Prompt the user for a save location
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Applications as CSV',
      });

      if (uri) {
        // Save the file to the chosen location
        fs.writeFileSync(uri.fsPath, csvContent, 'utf-8');
        vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
      }
    }
  });
}

function getApplicationsHtml(apps: any[],  webview: vscode.Webview,
  extensionUri: vscode.Uri): string {
      // Construct the webview-safe URI for logo
      const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
      const logoSrc = webview.asWebviewUri(logoPath);

      const ldsPath = vscode.Uri.joinPath(extensionUri,'salesforce-lightning-design-system.min.css');
      const ldsSrc = webview.asWebviewUri(ldsPath);

      const dataTableJs = "https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js";
      const jqueryJs = "https://code.jquery.com/jquery-3.6.0.min.js";
      const dataTableCss = "https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css";
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub Applications</title>
        <link rel="stylesheet" href="${dataTableCss}" />
        <link rel="stylesheet" href="${ldsSrc}" />
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            color: #212529;
            background-color: #ffffff;
          }

          /* Top Navbar */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1e1a41; /* Dark purple/blue */
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

          /* Hero / Gradient Section */
          .hero {
            position: relative;
            background: linear-gradient(90deg, #262158 0%, #463f96 50%, #5d54b5 100%);
            color: #ffffff;
            padding: 2rem 1rem;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .hero-text {
            max-width: 60%;
          }
          .hero-text h2 {
            font-size: 2rem;
            margin-bottom: 0.5rem;
          }
          .hero-text p {
            margin-bottom: 0;
            font-size: 1rem;
            line-height: 1.4;
          }

          /* Main Container */
          .container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 1rem;
            background-color: #ffffff;
          }

          /* Page Title (above the table) */
          .title-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 1rem 0;
          }
          .title-bar h3 {
            font-size: 1.25rem;
            margin: 0;
          }

          .button {
            padding: 10px 16px;
            font-size: 14px;
            color: #ffffff;
            background-color: #5b44c0;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
          }
          .button:hover {
            background-color: #49359a;
          }

          /* Table styling */
          .app-table {
            width: 100%;
            border-collapse: collapse;
            background-color: #fff;
            box-shadow: 0 0 5px rgba(0,0,0,0.15);
          }
          .app-table th,
          .app-table td {
            padding: 12px;
            border-bottom: 1px solid #e2e2e2;
            text-align: left;
          }
          .app-table th {
            background-color: #f4f4f4;
            font-weight: 600;
          }
          .app-table tr:hover {
            background-color: #f9f9f9;
          }
          .link {
            color: #007bff;
            text-decoration: none;
          }
          .link:hover {
            text-decoration: underline;
          }

          /* Ensure the table fits perfectly inside the card */
          .slds-card__body {
            overflow-x: auto; /* Allow horizontal scrolling if content overflows */
          }

          .slds-table {
            width: 100%; /* Force the table to stay within the card */
            table-layout: auto; /* Allow columns to resize dynamically */
          }
        </style>
      </head>
      <body>
        <!-- Top Navbar -->
        <nav class="navbar">
          <div class="navbar-left">
            <!-- If you have a logo, place it here -->
            <img src="${logoSrc}" />
            <h1>Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About the Extension</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <!-- Main Content Container -->
        <div class="container">

          <article class="slds-card">
            <div class="slds-card__header slds-grid">
              <header class="slds-media slds-media_center slds-has-flexi-truncate">
                <div class="slds-media__figure">
                  <span class="slds-icon_container slds-icon-standard-account" title="account">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24px" height="24px">
                      <rect width="100%" height="100%" fill="transparent" />
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
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
                  <button id="downloadAllCsv" class="slds-button slds-button_neutral">Download as CSV</button>
                </div>
              </header>
            </div>
            <div class="slds-card__body slds-card__body_inner">
              <!-- Table -->
              <div class="slds-scrollable slds-m-around_medium">
              <table id="appTable" class="slds-table slds-table_cell-buffer slds-table_striped slds-max-medium-table_stacked-horizontal">
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
                            <td>${app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : 'N/A'}</td>
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