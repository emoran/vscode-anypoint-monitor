import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';

/**
 * Creates a webview panel and displays Hybrid clusters
 */
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
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Hybrid Clusters</title>
        <style>
          :root {
            --background-primary: #1e2328;
            --surface-primary: #21262d;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --border-primary: #30363d;
            --success: #3fb950;
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
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 32px;
          }
          h1 { font-size: 28px; margin-bottom: 24px; }
          .card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
          }
          .cluster-name {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
          }
          .cluster-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 16px;
          }
          .info-item {
            color: var(--text-secondary);
          }
          .info-value {
            color: var(--text-primary);
            font-weight: 500;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Hybrid Clusters</h1>
          ${clusters.length > 0 ? clusters.map(c => `
            <div class="card">
              <div class="cluster-name">${c.name || 'Unnamed Cluster'}</div>
              <div class="cluster-info">
                <div class="info-item">
                  <div>Status</div>
                  <div class="info-value">${c.status || 'N/A'}</div>
                </div>
                <div class="info-item">
                  <div>Nodes</div>
                  <div class="info-value">${c.serversCount || c.servers?.length || 0}</div>
                </div>
                <div class="info-item">
                  <div>Mule Version</div>
                  <div class="info-value">${c.muleVersion || 'N/A'}</div>
                </div>
                <div class="info-item">
                  <div>Multicast</div>
                  <div class="info-value">${c.multicastEnabled ? 'Enabled' : 'Disabled'}</div>
                </div>
              </div>
            </div>
          `).join('') : '<p style="color: var(--text-secondary);">No clusters found</p>'}
        </div>
      </body>
    </html>
  `;
}
