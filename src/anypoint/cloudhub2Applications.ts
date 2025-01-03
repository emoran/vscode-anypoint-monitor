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
  panel.webview.html = getApplicationsHtml(appsArray);

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
 * Generates HTML to display the applications in a simple table and provide a CSV download button.
 */
function getApplicationsHtml(apps: any[]): string {
  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <style>
        body {
          margin: 0;
          padding: 24px;
          background-color: #f8f9fa;
          font-family: Arial, sans-serif;
          color: #212529;
        }
        h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 24px;
        }
        .button-container {
          margin-bottom: 16px;
          text-align: left;
        }
        .button {
          padding: 10px 16px;
          font-size: 14px;
          color: #fff;
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
          background-color: #fff;
          border: 1px solid #dee2e6;
          margin-top: 16px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        th, td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #dee2e6;
        }
        th {
          background-color: #f1f3f5;
          font-weight: bold;
        }
        td {
          vertical-align: middle;
        }
        tr:hover {
          background-color: #f8f9fa;
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
      <h1>Mule Applications</h1>
      <div class="button-container">
        <button id="downloadCsv" class="button">Download as CSV</button>
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
  const headers = ['ID', 'Name', 'Status', 'RuntimeVersion', 'LastModified', 'Target'];
  const rows = apps.map((app) => [
    app.id ?? '',
    app.name ?? '',
    app.application?.status ?? '',
    app.currentRuntimeVersion ?? '',
    app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : '',
    app.target?.targetId ?? '',
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}