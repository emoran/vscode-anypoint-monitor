import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    emptyState,
    escapeHtml as uiEscapeHtml
} from '../webview/ui-kit';

export function showHybridServerGroupsWebview(
  context: vscode.ExtensionContext,
  data: any,
  environmentId?: string
) {
  telemetryService.trackPageView('hybridServerGroups');
  const groupsArray = Array.isArray(data) ? data : data.data || [];

  const panel = vscode.window.createWebviewPanel(
    'hybridServerGroupsView',
    'Hybrid Server Groups',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getHybridServerGroupsHtml(groupsArray);
}

function getHybridServerGroupsHtml(groups: any[]): string {
  const totalServers = groups.reduce((sum: number, g: any) => sum + (g.serverCount || g.servers?.length || 0), 0);

  const tableRows = groups.map(g => {
    const serverNames = g.servers?.map((s: any) => uiEscapeHtml(s.name)).join(', ') || 'No servers';
    const serverCount = g.serverCount || g.servers?.length || 0;
    return `
      <tr class="am-row">
        <td style="font-weight:500">${uiEscapeHtml(g.name || 'Unnamed Group')}</td>
        <td>${serverCount}</td>
        <td style="color:var(--am-text-muted);font-size:12px">${serverNames}</td>
      </tr>`;
  }).join('');

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div><h1>Hybrid Server Groups</h1></div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '📦', value: groups.length, label: 'Server Groups', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '🖥️', value: totalServers, label: 'Total Servers', animationDelay: '0.15s' })}
      </div>

      ${groups.length > 0 ? `
        <div class="am-table-container">
          <table class="am-table">
            <thead><tr><th>Group Name</th><th>Servers</th><th>Server List</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      ` : emptyState({ icon: '📦', title: 'No Server Groups', description: 'No hybrid server groups found in this environment.' })}
    </div>`;

  return wrapWebviewHtml({ title: 'Hybrid Server Groups', body });
}
