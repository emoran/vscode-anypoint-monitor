import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a table of applications.
 * @param context The extension context (used to create WebviewPanel, etc.)
 * @param data The data returned by your API call (response JSON).
 */
export function showApplicationsWebview(context: vscode.ExtensionContext, data: any) {
  // 1. Extract items from the data
  const appsArray = Array.isArray(data.items) ? data.items : [];

  // 2. Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'CloudHub 2.0 Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // 3. Build the HTML with the application data
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri);

  // 4. Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'downloadCsv') {
      // Generate the CSV content
      const csvData = generateCsvContent(appsArray);

      // Prompt the user for a save location
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Applications as CSV',
      });

      if (uri) {
        // Save the file to the chosen location
        fs.writeFileSync(uri.fsPath, csvData, 'utf-8');
        vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
      }
    }
  });
}

/**
 * Generates HTML to display the applications in a styled table 
 * and provide a CSV download button matching the screenshot style.
 */
function getApplicationsHtml(apps: any[], webview: vscode.Webview,
  extensionUri: vscode.Uri): string {

      // Construct the webview-safe URI for logo
      const logoPath = vscode.Uri.joinPath(extensionUri, 'src', 'resources', 'logo.png');
      const logoSrc = webview.asWebviewUri(logoPath);
  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>CloudHub 2.0 Applications</title>
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
      </style>
    </head>
    <body>
      <!-- Navbar -->
      <nav class="navbar">
        <div class="navbar-left">
          <!-- Replace the src with your actual logo path or use webview.asWebviewUri -->
          <img src="${logoSrc}" alt="Extension Logo" />
          <h1 class="extension-name">Anypoint Monitor Extension</h1>
        </div>
        <div class="navbar-right">
          <a href="#">About the Extension</a>
          <a href="#">Buy Me a Coffee</a>
        </div>
      </nav>

      <!-- Hero Section -->
      <section class="hero">
        <div class="hero-text">
          <h2>CloudHub Applications</h2>
          <p>Below is a list of your Mule applications deployed to CloudHub.</p>
        </div>
      </section>

      <!-- Main content container -->
      <div class="container">
        <div class="title-bar">
          <h3>Mule Applications</h3>
          <button id="downloadCsv" class="button">Download as CSV</button>
        </div>

        <!-- Table -->
        <table class="app-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Full Domain</th>
              <th>Status</th>
              <th>Workers</th>
              <th>Worker Type</th>
              <th>Region</th>
              <th>Last Update</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            ${apps
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
                    <td>
                      <a href="${app.href ?? '#'}" target="_blank" class="link">
                        Open Application
                      </a>
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // CSV download handler
        document.getElementById('downloadCsv').addEventListener('click', () => {
          vscode.postMessage({ command: 'downloadCsv' });
        });
      </script>
    </body>
  </html>
  `;
}

/**
 * Generates the CSV content from the application data.
 */
function generateCsvContent(apps: any[]): string {
  // Example columns; adapt as needed
  const headers = ['Domain', 'Full Domain', 'Status', 'Workers', 'Worker Type', 'Region', 'Last Update'];
  const rows = apps.map((app) => [
    app.domain ?? '',
    app.fullDomain ?? '',
    app.status ?? '',
    app.workers ?? '',
    app.workerType ?? '',
    app.region ?? '',
    app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : '',
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}