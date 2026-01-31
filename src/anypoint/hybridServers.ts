import * as vscode from 'vscode';
import * as fs from 'fs';
import { telemetryService } from '../services/telemetryService';

/**
 * Creates a webview panel and displays Hybrid servers (Mule Runtimes)
 */
export function showHybridServersWebview(
  context: vscode.ExtensionContext,
  data: any,
  environmentId?: string
) {
  telemetryService.trackPageView('hybridServers');
  const serversArray = Array.isArray(data) ? data : data.data || [];

  const panel = vscode.window.createWebviewPanel(
    'hybridServersView',
    'Hybrid Servers',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getHybridServersHtml(serversArray);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'openServerDetails') {
      console.log('🖥️ Opening server details for:', message.serverName);

      // Import and call the server details view
      const { showHybridServerDetails } = await import('./hybridServerDetails.js');
      await showHybridServerDetails(context, message.serverData, environmentId);

      console.log('✅ Server details opened');
    } else if (message.command === 'downloadAllCsv') {
      const csvContent = generateServersCsv(serversArray);
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Hybrid Servers as CSV',
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

function getHybridServersHtml(servers: any[]): string {
  const totalServers = servers.length;
  const runningServers = servers.filter(s => s.status === 'RUNNING' || s.status === 'CONNECTED').length;
  const disconnectedServers = servers.filter(s => s.status === 'DISCONNECTED' || s.status === 'FAILED').length;

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Hybrid Servers</title>
        <style>
          :root {
            --background-primary: #1e2328;
            --background-secondary: #161b22;
            --surface-primary: #21262d;
            --surface-secondary: #30363d;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --text-muted: #656d76;
            --accent-blue: #58a6ff;
            --accent-light: #79c0ff;
            --border-primary: #30363d;
            --border-muted: #21262d;
            --success: #3fb950;
            --error: #f85149;
            --hybrid-purple: #8b5cf6;
          }

          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 0;
            background-color: var(--background-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
          }

          .header {
            background-color: var(--background-secondary);
            border-bottom: 1px solid var(--border-primary);
            padding: 24px 32px;
          }
          .header h1 {
            font-size: 28px;
            font-weight: 600;
            margin: 0 0 8px 0;
          }
          .header p {
            font-size: 16px;
            color: var(--text-secondary);
            margin: 0;
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 32px;
          }

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
          }
          .stat-value {
            font-size: 32px;
            font-weight: 600;
            color: var(--text-primary);
            margin: 8px 0;
          }
          .stat-subtitle {
            font-size: 13px;
            color: var(--text-muted);
          }

          .card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
          }

          .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }

          .button {
            background-color: var(--accent-blue);
            color: var(--text-primary);
            border: none;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 14px;
            cursor: pointer;
          }
          .button:hover {
            background-color: var(--accent-light);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--surface-secondary);
            border-radius: 8px;
            overflow: hidden;
          }
          th {
            background-color: var(--background-secondary);
            color: var(--text-primary);
            font-weight: 600;
            padding: 16px 12px;
            text-align: left;
            border-bottom: 1px solid var(--border-primary);
          }
          td {
            padding: 16px 12px;
            border-bottom: 1px solid var(--border-muted);
            color: var(--text-primary);
          }
          tr:hover {
            background-color: var(--border-muted);
          }

          .server-name-link {
            color: var(--accent-blue);
            text-decoration: none;
            cursor: pointer;
            font-weight: 500;
            transition: color 0.2s ease;
          }

          .server-name-link:hover {
            color: var(--accent-light);
            text-decoration: underline;
          }

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
          .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: currentColor;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Hybrid Servers</h1>
          <p>Mule Runtime instances registered in Runtime Manager</p>
        </div>

        <div class="container">
          <div class="stats-grid">
            <div class="stat-card">
              <h3 style="font-size: 14px; color: var(--text-secondary); margin: 0;">Total Servers</h3>
              <div class="stat-value">${totalServers}</div>
              <p class="stat-subtitle">Registered runtimes</p>
            </div>
            <div class="stat-card">
              <h3 style="font-size: 14px; color: var(--text-secondary); margin: 0;">Running Servers</h3>
              <div class="stat-value">${runningServers}</div>
              <p class="stat-subtitle">Currently active</p>
            </div>
            <div class="stat-card">
              <h3 style="font-size: 14px; color: var(--text-secondary); margin: 0;">Disconnected Servers</h3>
              <div class="stat-value">${disconnectedServers}</div>
              <p class="stat-subtitle">Offline or failed</p>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h2 style="font-size: 18px; margin: 0;">Servers</h2>
              <button id="downloadAllCsv" class="button">Download as CSV</button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Mule Version</th>
                  <th>Last Reported</th>
                </tr>
              </thead>
              <tbody>
                ${servers.map((s, index) => `
                  <tr style="cursor: pointer;" onclick="openServerDetails(${index})">
                    <td><a href="#" class="server-name-link" onclick="event.preventDefault(); openServerDetails(${index});">${s.name || 'N/A'}</a></td>
                    <td><span class="status-badge ${s.status === 'RUNNING' || s.status === 'CONNECTED' ? 'status-running' : 'status-stopped'}">
                      <span class="status-dot"></span>
                      ${s.status || 'UNKNOWN'}
                    </span></td>
                    <td>${s.type || 'N/A'}</td>
                    <td>${s.muleVersion || 'N/A'}</td>
                    <td>${s.lastReportedTime ? new Date(s.lastReportedTime).toLocaleString() : 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const serversData = ${JSON.stringify(servers)};

          document.getElementById('downloadAllCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadAllCsv' });
          });

          function openServerDetails(index) {
            const serverData = serversData[index];
            console.log('Opening server details for:', serverData.name);
            vscode.postMessage({
              command: 'openServerDetails',
              serverName: serverData.name,
              serverData: serverData
            });
          }
        </script>
      </body>
    </html>
  `;
}

function generateServersCsv(servers: any[]): string {
  const headers = ['Server Name', 'Status', 'Type', 'Mule Version', 'Last Reported'];
  const rows = servers.map(s => [
    s.name || '',
    s.status || '',
    s.type || '',
    s.muleVersion || '',
    s.lastReportedTime || '',
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}
