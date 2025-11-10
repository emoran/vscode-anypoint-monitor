import * as vscode from 'vscode';
import { ApiHelper } from '../controllers/apiHelper';
import { HYBRID_SERVERS_ENDPOINT } from '../constants';

/**
 * Show detailed view of a Hybrid server with actions
 */
export async function showHybridServerDetails(
  context: vscode.ExtensionContext,
  serverData: any,
  environmentId: string
) {
  const panel = vscode.window.createWebviewPanel(
    'hybridServerDetails',
    `Server: ${serverData.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getServerDetailsHtml(serverData);

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      const { AccountService } = await import('../controllers/accountService.js');
      const accountService = new AccountService(context);
      const activeAccount = await accountService.getActiveAccount();

      if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found.');
        return;
      }

      const organizationID = activeAccount.organizationId;
      const apiHelper = new ApiHelper(context);

      switch (message.command) {
        case 'restartServer':
          const restartConfirm = await vscode.window.showWarningMessage(
            `Are you sure you want to restart server "${serverData.name}"?`,
            { modal: true },
            'Restart'
          );
          if (restartConfirm === 'Restart') {
            try {
              await apiHelper.post(
                `${HYBRID_SERVERS_ENDPOINT}/${serverData.id}/restart`,
                {},
                {
                  headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationID,
                  },
                }
              );
              vscode.window.showInformationMessage(`Restart command sent to server "${serverData.name}"`);

              // Refresh server data after action
              setTimeout(async () => {
                const updatedServer = await fetchServerDetails(context, serverData.id, environmentId);
                panel.webview.html = getServerDetailsHtml(updatedServer || serverData);
              }, 3000);
            } catch (error: any) {
              vscode.window.showErrorMessage(`Failed to restart server: ${error.message}`);
            }
          }
          break;

        case 'shutdownServer':
          const shutdownConfirm = await vscode.window.showWarningMessage(
            `Are you sure you want to shutdown server "${serverData.name}"?\n\n⚠️ Note: After shutdown, you cannot start the server from Runtime Manager. You'll need to manually restart the Mule runtime.`,
            { modal: true },
            'Shutdown'
          );
          if (shutdownConfirm === 'Shutdown') {
            try {
              await apiHelper.post(
                `${HYBRID_SERVERS_ENDPOINT}/${serverData.id}/shutdown`,
                {},
                {
                  headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationID,
                  },
                }
              );
              vscode.window.showWarningMessage(
                `Shutdown command sent to server "${serverData.name}". You'll need to manually restart the Mule runtime on the host system.`
              );

              // Refresh server data after action
              setTimeout(async () => {
                const updatedServer = await fetchServerDetails(context, serverData.id, environmentId);
                panel.webview.html = getServerDetailsHtml(updatedServer || serverData);
              }, 3000);
            } catch (error: any) {
              vscode.window.showErrorMessage(`Failed to shutdown server: ${error.message}`);
            }
          }
          break;

        case 'deleteServer':
          const deleteConfirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete server "${serverData.name}" from Runtime Manager?\n\n⚠️ This action cannot be undone.`,
            { modal: true },
            'Delete'
          );
          if (deleteConfirm === 'Delete') {
            try {
              await apiHelper.delete(`${HYBRID_SERVERS_ENDPOINT}/${serverData.id}`, {
                headers: {
                  'X-ANYPNT-ENV-ID': environmentId,
                  'X-ANYPNT-ORG-ID': organizationID,
                },
              });
              vscode.window.showInformationMessage(`Server "${serverData.name}" deleted from Runtime Manager`);
              panel.dispose();
            } catch (error: any) {
              vscode.window.showErrorMessage(`Failed to delete server: ${error.message}`);
            }
          }
          break;

        case 'refreshServer':
          try {
            const updatedServer = await fetchServerDetails(context, serverData.id, environmentId);
            if (updatedServer) {
              panel.webview.html = getServerDetailsHtml(updatedServer);
              vscode.window.showInformationMessage('Server information refreshed');
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to refresh server data: ${error.message}`);
          }
          break;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
  });
}

/**
 * Fetch updated server details
 */
async function fetchServerDetails(
  context: vscode.ExtensionContext,
  serverId: string,
  environmentId: string
): Promise<any | null> {
  try {
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();

    if (!activeAccount) {
      return null;
    }

    const apiHelper = new ApiHelper(context);
    const response = await apiHelper.get(`${HYBRID_SERVERS_ENDPOINT}/${serverId}`, {
      headers: {
        'X-ANYPNT-ENV-ID': environmentId,
        'X-ANYPNT-ORG-ID': activeAccount.organizationId,
      },
    });

    if (response.status === 200) {
      return response.data;
    }
  } catch (error) {
    console.error('Failed to fetch server details:', error);
  }
  return null;
}

/**
 * Generate HTML for server details view
 */
function getServerDetailsHtml(server: any): string {
  const statusColor = server.status === 'RUNNING' || server.status === 'CONNECTED' ? '#3fb950' : '#f85149';
  const statusText = server.status || 'UNKNOWN';

  // Calculate uptime if available
  let uptimeText = 'N/A';
  if (server.lastReportedTime) {
    const uptimeMs = Date.now() - new Date(server.lastReportedTime).getTime();
    const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    uptimeText = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
  }

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Server Details - ${server.name}</title>
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
            --warning: #d29922;
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            background-color: var(--background-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            padding: 24px;
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .header {
            background-color: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
          }

          .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
          }

          h1 {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 8px;
          }

          .server-type {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 16px;
          }

          .status-indicator {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 24px;
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
          }

          .status-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: ${statusColor};
            box-shadow: 0 0 12px ${statusColor};
          }

          .status-text {
            font-size: 18px;
            font-weight: 600;
            color: ${statusColor};
          }

          .actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }

          .button {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            color: var(--text-primary);
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .button:hover {
            background-color: var(--surface-secondary);
            border-color: var(--accent-blue);
            transform: translateY(-2px);
          }

          .button-danger {
            border-color: var(--error);
          }

          .button-danger:hover {
            background-color: var(--error);
            border-color: var(--error);
          }

          .button-warning {
            border-color: var(--warning);
          }

          .button-warning:hover {
            background-color: var(--warning);
            border-color: var(--warning);
          }

          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
          }

          .stat-card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
          }

          .stat-label {
            font-size: 12px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
          }

          .stat-value {
            font-size: 24px;
            font-weight: 600;
            color: var(--text-primary);
          }

          .card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
          }

          .card-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 16px;
          }

          .info-item {
            padding: 12px 0;
            border-bottom: 1px solid var(--border-muted);
          }

          .info-item:last-child {
            border-bottom: none;
          }

          .info-label {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 4px;
          }

          .info-value {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-primary);
          }

          .warning-banner {
            background-color: rgba(210, 153, 34, 0.1);
            border: 1px solid var(--warning);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
            display: flex;
            align-items: start;
            gap: 12px;
          }

          .warning-icon {
            font-size: 24px;
            color: var(--warning);
          }

          .warning-text {
            font-size: 14px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-top">
              <div>
                <h1>🖥️ ${server.name || 'Unknown Server'}</h1>
                <div class="server-type">${server.type || 'Mule Runtime Server'}</div>
              </div>
              <div class="status-indicator">
                <span class="status-dot"></span>
                <span class="status-text">${statusText}</span>
              </div>
            </div>

            <div class="actions">
              <button class="button" onclick="refreshServer()">
                🔄 Refresh
              </button>
              <button class="button button-warning" onclick="restartServer()">
                ⚡ Restart Server
              </button>
              <button class="button button-warning" onclick="shutdownServer()">
                🛑 Shutdown Server
              </button>
              <button class="button button-danger" onclick="deleteServer()">
                🗑️ Delete from Runtime Manager
              </button>
            </div>
          </div>

          <div class="warning-banner">
            <div class="warning-icon">⚠️</div>
            <div class="warning-text">
              <strong>Important:</strong> After shutting down a server, you cannot start it from Runtime Manager.
              You'll need to manually restart the Mule runtime on the host system where it's installed.
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Mule Version</div>
              <div class="stat-value">${server.muleVersion || 'N/A'}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Status</div>
              <div class="stat-value">${statusText}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Time Since Last Report</div>
              <div class="stat-value">${uptimeText}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Server Type</div>
              <div class="stat-value">${server.type || 'N/A'}</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">📊 Server Information</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Server ID</div>
                <div class="info-value">${server.id || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Server Name</div>
                <div class="info-value">${server.name || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Status</div>
                <div class="info-value">${statusText}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Mule Version</div>
                <div class="info-value">${server.muleVersion || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Agent Version</div>
                <div class="info-value">${server.agentVersion || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Last Reported Time</div>
                <div class="info-value">${server.lastReportedTime ? new Date(server.lastReportedTime).toLocaleString() : 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Operating System</div>
                <div class="info-value">${server.osInfo || server.osName || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">IP Address</div>
                <div class="info-value">${server.ipAddress || server.hostAddress || 'N/A'}</div>
              </div>
            </div>
          </div>

          ${server.clusterNodeId ? `
          <div class="card">
            <div class="card-title">🔗 Cluster Information</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Cluster Node ID</div>
                <div class="info-value">${server.clusterNodeId}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Cluster Name</div>
                <div class="info-value">${server.clusterName || 'N/A'}</div>
              </div>
            </div>
          </div>
          ` : ''}

          ${server.serverGroupId ? `
          <div class="card">
            <div class="card-title">👥 Server Group Information</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Server Group ID</div>
                <div class="info-value">${server.serverGroupId}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Server Group Name</div>
                <div class="info-value">${server.serverGroupName || 'N/A'}</div>
              </div>
            </div>
          </div>
          ` : ''}

          ${server.deployments && server.deployments.length > 0 ? `
          <div class="card">
            <div class="card-title">📦 Deployed Applications (${server.deployments.length})</div>
            <div class="info-grid">
              ${server.deployments.map((app: any) => `
                <div class="info-item">
                  <div class="info-label">${app.name || 'Unknown App'}</div>
                  <div class="info-value">${app.status || 'N/A'}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function refreshServer() {
            vscode.postMessage({ command: 'refreshServer' });
          }

          function restartServer() {
            vscode.postMessage({ command: 'restartServer' });
          }

          function shutdownServer() {
            vscode.postMessage({ command: 'shutdownServer' });
          }

          function deleteServer() {
            vscode.postMessage({ command: 'deleteServer' });
          }
        </script>
      </body>
    </html>
  `;
}
