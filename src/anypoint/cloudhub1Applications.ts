import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a detailed table of applications with a single CSV download option.
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
  panel.webview.html = getApplicationsHtml(appsArray);

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

function getApplicationsHtml(apps: any[]): string {
    return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            margin: 0;
            padding: 16px;
            background-color: #ffffff;
            font-family: Arial, sans-serif;
            color: #212529;
          }
          h1 {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 16px;
          }
          .container {
            max-width: 1000px;
            margin: 0 auto;
          }
          .button-container {
            margin-bottom: 16px;
            text-align: left;
          }
          .button {
            padding: 10px 16px;
            font-size: 14px;
            color: #ffffff;
            background-color: #007bff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
          }
          .button:hover {
            background-color: #0056b3;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
            border: 1px solid #dee2e6;
          }
          th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid #dee2e6;
          }
          th {
            background-color: #f8f9fa;
            font-weight: bold;
          }
          tr:hover {
            background-color: #f1f1f1;
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
        <div class="container">
          <h1>Mule Applications</h1>
          <div class="button-container">
            <button id="downloadAllCsv" class="button">Download as CSV</button>
          </div>
          <table>
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
                  <td>${app.lastUpdateTime ? new Date(app.lastUpdateTime).toLocaleString() : 'N/A'}</td>
                  <td><a href="${app.href ?? '#'}" target="_blank" class="link">Open Application</a></td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
  
          // CSV download handler
          document.getElementById('downloadAllCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadAllCsv' });
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