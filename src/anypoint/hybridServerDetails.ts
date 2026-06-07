import * as vscode from 'vscode';
import { ApiHelper } from '../controllers/apiHelper';
import { HYBRID_SERVERS_ENDPOINT } from '../constants';
import { wrapWebviewHtml, badge, summaryCard, button, escapeHtml } from '../webview/ui-kit';

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

function infoRow(label: string, value: string | number | boolean | null | undefined): string {
    const display =
        value === null || value === undefined || value === ''
            ? 'N/A'
            : String(value);
    return `
              <div class="hybrid-info-item">
                <div class="hybrid-info-label">${escapeHtml(label)}</div>
                <div class="hybrid-info-value">${escapeHtml(display)}</div>
              </div>`;
}

/**
 * Generate HTML for server details view
 */
function getServerDetailsHtml(server: any): string {
    const statusText = server.status || 'UNKNOWN';
    const statusOk = server.status === 'RUNNING' || server.status === 'CONNECTED';
    const statusBadgeVariant = statusOk ? 'success' : 'error';
    const summaryStatusVariant: 'healthy' | 'critical' = statusOk ? 'healthy' : 'critical';

    let uptimeText = 'N/A';
    if (server.lastReportedTime) {
        const uptimeMs = Date.now() - new Date(server.lastReportedTime).getTime();
        const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
        const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        uptimeText = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
    }

    const nameDisplay = server.name || 'Unknown Server';
    const typeDisplay = server.type || 'Mule Runtime Server';
    const lastReportedStr = server.lastReportedTime
        ? new Date(server.lastReportedTime).toLocaleString()
        : 'N/A';

    const deploymentsRows =
        server.deployments && server.deployments.length > 0
            ? server.deployments
                  .map(
                      (app: any) => `
              <tr class="am-row">
                <td>${escapeHtml(app.name || 'Unknown App')}</td>
                <td>${badge(String(app.status || 'N/A'), app.status === 'RUNNING' || app.status === 'STARTED' ? 'success' : 'default')}</td>
              </tr>`
                  )
                  .join('')
            : '';

    const clusterSection = server.clusterNodeId
        ? `
          <div class="am-card hybrid-section-card">
            <div class="am-card-title">Cluster information</div>
            <div class="hybrid-info-grid">
              ${infoRow('Cluster Node ID', String(server.clusterNodeId))}
              ${infoRow('Cluster Name', server.clusterName || 'N/A')}
            </div>
          </div>`
        : '';

    const serverGroupSection = server.serverGroupId
        ? `
          <div class="am-card hybrid-section-card">
            <div class="am-card-title">Server group information</div>
            <div class="hybrid-info-grid">
              ${infoRow('Server Group ID', String(server.serverGroupId))}
              ${infoRow('Server Group Name', server.serverGroupName || 'N/A')}
            </div>
          </div>`
        : '';

    const deploymentsSection =
        server.deployments && server.deployments.length > 0
            ? `
          <div class="am-card hybrid-section-card">
            <div class="am-card-title">Deployed applications (${server.deployments.length})</div>
            <div class="am-table-container">
              <table class="am-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${deploymentsRows}
                </tbody>
              </table>
            </div>
          </div>`
            : '';

    const body = `
    <div class="am-container">
      <div class="am-page-header hybrid-page-header">
        <div class="hybrid-header-top">
          <div>
            <h1>🖥️ ${escapeHtml(nameDisplay)}</h1>
            <div class="hybrid-server-type">${escapeHtml(typeDisplay)}</div>
          </div>
          <div class="am-page-header-right">
            ${badge(statusText, statusBadgeVariant, true)}
          </div>
        </div>
        <div class="hybrid-actions">
          ${button('Refresh', { variant: 'secondary', onclick: 'refreshServer()', icon: '🔄' })}
          <button type="button" class="am-btn hybrid-btn-warning" onclick="restartServer()"><span>⚡</span>Restart Server</button>
          <button type="button" class="am-btn hybrid-btn-warning" onclick="shutdownServer()"><span>🛑</span>Shutdown Server</button>
          ${button('Delete from Runtime Manager', { variant: 'danger', onclick: 'deleteServer()', icon: '🗑️' })}
        </div>
      </div>

      <div class="hybrid-warning-banner">
        <div class="hybrid-warning-icon">⚠️</div>
        <div class="hybrid-warning-text">
          <strong>Important:</strong> After shutting down a server, you cannot start it from Runtime Manager.
          You'll need to manually restart the Mule runtime on the host system where it's installed.
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '📦', value: server.muleVersion || 'N/A', label: 'Mule version' })}
        ${summaryCard({ icon: '●', value: statusText, label: 'Status', variant: summaryStatusVariant })}
        ${summaryCard({ icon: '⏱', value: uptimeText, label: 'Time since last report' })}
        ${summaryCard({ icon: '🖥', value: server.type || 'N/A', label: 'Server type' })}
      </div>

      <div class="am-card hybrid-section-card">
        <div class="am-card-title">Server information</div>
        <div class="hybrid-info-grid">
          ${infoRow('Server ID', server.id || 'N/A')}
          ${infoRow('Server Name', server.name || 'N/A')}
          ${infoRow('Status', statusText)}
          ${infoRow('Mule Version', server.muleVersion || 'N/A')}
          ${infoRow('Agent Version', server.agentVersion || 'N/A')}
          ${infoRow('Last Reported Time', lastReportedStr)}
          ${infoRow('Operating System', server.osInfo || server.osName || 'N/A')}
          ${infoRow('IP Address', server.ipAddress || server.hostAddress || 'N/A')}
        </div>
      </div>

      ${clusterSection}
      ${serverGroupSection}
      ${deploymentsSection}
    </div>`;

    const extraStyles = `
        .hybrid-page-header {
            flex-direction: column;
            align-items: stretch;
            gap: 20px;
        }
        .hybrid-header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            width: 100%;
        }
        .hybrid-server-type {
            font-size: 14px;
            color: var(--am-text-secondary);
            margin-top: 6px;
        }
        .hybrid-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .hybrid-btn-warning {
            background: color-mix(in srgb, var(--am-warning) 18%, transparent);
            color: var(--am-warning);
            border: 1px solid var(--am-warning);
        }
        .hybrid-btn-warning:hover {
            filter: brightness(1.08);
        }
        .hybrid-warning-banner {
            background: color-mix(in srgb, var(--am-warning) 12%, transparent);
            border: 1px solid var(--am-warning);
            border-radius: var(--am-radius-md);
            padding: 16px;
            margin-bottom: 24px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }
        .hybrid-warning-icon {
            font-size: 24px;
            line-height: 1;
            color: var(--am-warning);
        }
        .hybrid-warning-text {
            font-size: 14px;
            line-height: 1.5;
            color: var(--am-text-primary);
        }
        .hybrid-section-card {
            margin-bottom: 24px;
        }
        .hybrid-section-card:last-child {
            margin-bottom: 0;
        }
        .hybrid-info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 0 16px;
        }
        .hybrid-info-item {
            padding: 12px 0;
            border-bottom: 1px solid var(--am-border);
        }
        .hybrid-info-item:last-child {
            border-bottom: none;
        }
        .hybrid-info-label {
            font-size: 13px;
            color: var(--am-text-secondary);
            margin-bottom: 4px;
        }
        .hybrid-info-value {
            font-size: 14px;
            font-weight: 500;
            color: var(--am-text-primary);
        }
    `;

    const scripts = `
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
    `;

    return wrapWebviewHtml({
        title: `Server Details - ${nameDisplay}`,
        body,
        scripts,
        extraStyles,
    });
}
