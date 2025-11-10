import * as vscode from 'vscode';

/**
 * Creates a webview panel and displays Hybrid server groups
 */
export function showHybridServerGroupsWebview(
  context: vscode.ExtensionContext,
  data: any,
  environmentId?: string
) {
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
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Hybrid Server Groups</title>
        <style>
          :root {
            --background-primary: #1e2328;
            --surface-primary: #21262d;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --border-primary: #30363d;
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
          .group-name {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
          }
          .server-list {
            color: var(--text-secondary);
            margin-top: 8px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Hybrid Server Groups</h1>
          ${groups.length > 0 ? groups.map(g => `
            <div class="card">
              <div class="group-name">${g.name || 'Unnamed Group'}</div>
              <div>Servers: ${g.serverCount || g.servers?.length || 0}</div>
              <div class="server-list">
                ${g.servers?.map((s: any) => s.name).join(', ') || 'No servers'}
              </div>
            </div>
          `).join('') : '<p style="color: var(--text-secondary);">No server groups found</p>'}
        </div>
      </body>
    </html>
  `;
}
