import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    emptyState,
    escapeHtml as uiEscapeHtml
} from '../webview/ui-kit';

export function showHybridClustersWebview(
  context: vscode.ExtensionContext,
  data: any,
  environmentId?: string
) {
  telemetryService.trackPageView('hybridClusters');
  const clustersArray = Array.isArray(data) ? data : data.data || [];

  const panel = vscode.window.createWebviewPanel(
    'hybridClustersView',
    'Hybrid Clusters',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getHybridClustersHtml(clustersArray);
}

function getHybridClustersHtml(clusters: any[]): string {
  const totalNodes = clusters.reduce((sum: number, c: any) => sum + (c.serversCount || c.servers?.length || 0), 0);

  const tableRows = clusters.map(c => {
    const status = c.status || 'N/A';
    const statusVariant: 'success' | 'error' | 'warning' = status.toLowerCase().includes('running') ? 'success'
      : status.toLowerCase().includes('disconnect') ? 'error' : 'warning';
    return `
      <tr class="am-row">
        <td style="font-weight:500">${uiEscapeHtml(c.name || 'Unnamed Cluster')}</td>
        <td>${badge(uiEscapeHtml(status), statusVariant, true)}</td>
        <td>${c.serversCount || c.servers?.length || 0}</td>
        <td>${uiEscapeHtml(c.muleVersion || 'N/A')}</td>
        <td>${badge(c.multicastEnabled ? 'Enabled' : 'Disabled', c.multicastEnabled ? 'success' : 'default')}</td>
      </tr>`;
  }).join('');

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div><h1>Hybrid Clusters</h1></div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '🔗', value: clusters.length, label: 'Clusters', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '🖥️', value: totalNodes, label: 'Total Nodes', animationDelay: '0.15s' })}
      </div>

      ${clusters.length > 0 ? `
        <div class="am-table-container">
          <table class="am-table">
            <thead><tr><th>Cluster Name</th><th>Status</th><th>Nodes</th><th>Mule Version</th><th>Multicast</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      ` : emptyState({ icon: '🔗', title: 'No Clusters', description: 'No hybrid clusters found in this environment.' })}
    </div>`;

  return wrapWebviewHtml({ title: 'Hybrid Clusters', body });
}
