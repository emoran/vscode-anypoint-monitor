import * as vscode from 'vscode';

/**
 * Creates a webview panel and displays a table of applications.
 * @param context The extension context (used to create WebviewPanel, etc.)
 * @param data The data returned by your API call (which may or may not be an array)
 */
export function showApplicationsWebview(context: vscode.ExtensionContext, data: any) {
  // 1. Ensure we have an array of applications
  const appsArray = Array.isArray(data) ? data : [];

  // 2. Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'Applications List',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // 3. Build the HTML with the application data
  panel.webview.html = getApplicationsHtml(appsArray);
}

/**
 * Generates HTML to display the applications in a simple table.
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
          background-color: #fff;
          color: #333;
          font-family: "Segoe UI", sans-serif;
        }
        h1 {
          margin: 0 0 24px 0;
          font-weight: 400;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 24px;
        }
        th, td {
          text-align: left;
          padding: 12px;
          vertical-align: middle;
        }
        th {
          font-weight: 600;
          background-color: #f9f9f9;
          border-bottom: 1px solid #e0e0e0;
        }
        tr:not(:first-child) {
          border-top: 1px solid #e0e0e0;
        }
        .subtle {
          color: #666;
          font-size: 0.9rem;
        }
        .status-started {
          color: green;
          font-weight: 500;
        }
        .status-unddeployed {
          color: red;
          font-weight: 500;
        }
      </style>
    </head>
    <body>
      <h1>Mule Applications</h1>
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Status</th>
            <th>Region</th>
            <th>Worker Type</th>
            <th>Last Update</th>
          </tr>
        </thead>
        <tbody>
          ${apps.map((app) => {
            const domain = app.domain ?? 'N/A';
            const status = app.status ?? 'N/A';
            const region = app.region ?? 'N/A';
            const workerType = app.workerType ?? 'N/A';
            const lastUpdate = app.lastUpdateTime 
              ? new Date(app.lastUpdateTime).toLocaleString() 
              : 'N/A';

            // Apply CSS class if you want color-coded statuses
            const statusClass = status === 'STARTED' 
              ? 'status-started' 
              : status === 'UNDEPLOYED' 
              ? 'status-unddeployed' 
              : '';

            return `
              <tr>
                <td>${domain}</td>
                <td class="${statusClass}">${status}</td>
                <td>${region}</td>
                <td>${workerType}</td>
                <td class="subtle">${lastUpdate}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </body>
  </html>
  `;
}