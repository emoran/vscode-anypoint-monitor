import * as vscode from 'vscode';
import * as fs from 'fs';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    emptyState,
    escapeHtml as uiEscapeHtml,
    escapeAttr
} from '../webview/ui-kit';

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
      const { showHybridServerDetails } = await import('./hybridServerDetails.js');
      await showHybridServerDetails(context, message.serverData, environmentId);
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

  const tableRows = servers.map((s, index) => {
    const isRunning = s.status === 'RUNNING' || s.status === 'CONNECTED';
    const statusVariant: 'success' | 'error' = isRunning ? 'success' : 'error';
    return `
      <tr class="am-row" style="cursor:pointer" onclick="openServerDetails(${index})">
        <td><a href="#" class="hs-server-link" onclick="event.preventDefault();openServerDetails(${index})">${uiEscapeHtml(s.name || 'N/A')}</a></td>
        <td>${badge(uiEscapeHtml(s.status || 'UNKNOWN'), statusVariant, true)}</td>
        <td>${uiEscapeHtml(s.type || 'N/A')}</td>
        <td>${uiEscapeHtml(s.muleVersion || 'N/A')}</td>
        <td style="white-space:nowrap">${s.lastReportedTime ? new Date(s.lastReportedTime).toLocaleString() : 'N/A'}</td>
      </tr>`;
  }).join('');

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>Hybrid Servers</h1>
          <div class="am-page-header-meta">
            <span style="color:var(--am-text-muted);font-size:12px">Mule Runtime instances registered in Runtime Manager</span>
          </div>
        </div>
        <div class="am-page-header-right">
          ${button('Download CSV', { variant: 'primary', onclick: 'downloadCsv()' })}
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '🖥️', value: totalServers, label: 'Total Servers', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '✅', value: runningServers, label: 'Running', variant: 'healthy', animationDelay: '0.15s' })}
        ${summaryCard({ icon: '🔴', value: disconnectedServers, label: 'Disconnected', variant: 'critical', animationDelay: '0.2s' })}
      </div>

      ${servers.length > 0 ? `
        <div class="am-table-container">
          <table class="am-table">
            <thead><tr>
              <th>Server Name</th><th>Status</th><th>Type</th><th>Mule Version</th><th>Last Reported</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      ` : emptyState({ icon: '🖥️', title: 'No Servers', description: 'No hybrid servers found in this environment.' })}
    </div>`;

  const scripts = `
    const vscode = acquireVsCodeApi();
    const serversData = ${JSON.stringify(servers)};

    function downloadCsv() { vscode.postMessage({ command: 'downloadAllCsv' }); }

    function openServerDetails(index) {
      const serverData = serversData[index];
      vscode.postMessage({ command: 'openServerDetails', serverName: serverData.name, serverData: serverData });
    }
  `;

  return wrapWebviewHtml({
    title: 'Hybrid Servers',
    body,
    scripts,
    extraStyles: `
      .hs-server-link {
        color: var(--am-text-link); text-decoration: none; font-weight: 500;
        transition: color 0.2s;
      }
      .hs-server-link:hover { text-decoration: underline; }
    `
  });
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
