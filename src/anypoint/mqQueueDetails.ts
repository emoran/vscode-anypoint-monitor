import * as vscode from 'vscode';

/**
 * Creates a webview panel and displays detailed queue information
 */
export async function showQueueDetailsWebview(
  context: vscode.ExtensionContext,
  queueId: string,
  regionId: string,
  regionName: string,
  environmentId: string,
  environmentName: string,
  organizationID: string
) {
  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'mqQueueDetails',
    `Queue: ${queueId}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Show loading state
  panel.webview.html = getLoadingHtml(queueId);

  try {
    // Fetch queue details from the API
    const { ApiHelper } = await import('../controllers/apiHelper.js');
    const apiHelper = new ApiHelper(context);

    const queueDetailsUrl = `https://anypoint.mulesoft.com/mq/admin/api/v1/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/destinations/queues/${queueId}`;
    const statsUrl = `https://anypoint.mulesoft.com/mq/stats/api/v1/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/queues/${queueId}`;

    console.log(`Queue Details: Fetching queue info from ${queueDetailsUrl}`);
    console.log(`Queue Details: Fetching stats from ${statsUrl}`);

    // Fetch both queue details and stats in parallel
    const [queueDetailsResponse, statsResponse] = await Promise.all([
      apiHelper.get(queueDetailsUrl),
      apiHelper.get(statsUrl).catch(err => {
        console.warn(`Queue Details: Failed to fetch stats:`, err.message);
        return { data: null };
      })
    ]);

    const queueDetails = queueDetailsResponse.data;
    const queueStats = statsResponse.data;

    console.log(`Queue Details: Queue data:`, JSON.stringify(queueDetails, null, 2));
    console.log(`Queue Details: Stats data:`, JSON.stringify(queueStats, null, 2));

    // Build the HTML with the fetched data
    panel.webview.html = getQueueDetailsHtml(
      queueDetails,
      queueStats,
      regionId,
      regionName,
      environmentName,
      organizationID,
      environmentId
    );

    // Listen for refresh messages
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'refresh') {
        showQueueDetailsWebview(context, queueId, regionId, regionName, environmentId, environmentName, organizationID);
        panel.dispose();
      }
    });

  } catch (error: any) {
    console.error(`Queue Details: Error:`, error);
    panel.webview.html = getErrorHtml(queueId, error.message);
  }
}

function getLoadingHtml(queueId: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading Queue Details</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      padding: 40px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .loading {
      text-align: center;
    }
    .spinner {
      border: 4px solid var(--vscode-panel-border);
      border-top: 4px solid var(--vscode-button-background);
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <h2>Loading queue details...</h2>
    <p>Fetching information for <strong>${queueId}</strong></p>
  </div>
</body>
</html>
  `;
}

function getErrorHtml(queueId: string, errorMessage: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error Loading Queue</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      padding: 40px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      padding: 20px;
      border-radius: 8px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="error">
    <div class="error-icon">⚠️</div>
    <h2>Failed to Load Queue Details</h2>
    <p><strong>Queue:</strong> ${queueId}</p>
    <p><strong>Error:</strong> ${errorMessage}</p>
  </div>
</body>
</html>
  `;
}

function getQueueDetailsHtml(
  queueDetails: any,
  queueStats: any,
  regionId: string,
  regionName: string,
  environmentName: string,
  organizationID: string,
  environmentId: string
): string {
  const queueId = queueDetails.queueId || queueDetails.id;
  const queueType = queueDetails.fifo ? 'FIFO' : 'Standard';
  const messages = queueStats?.messagesVisible || queueStats?.messages || 0;
  const inflightMessages = queueStats?.messagesInflight || queueStats?.inflightMessages || 0;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Queue Details: ${queueId}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      padding: 20px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .header {
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--vscode-panel-border);
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-info {
      display: flex;
      gap: 20px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-top: 2px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge.fifo {
      background: var(--vscode-charts-blue);
      color: white;
    }
    .badge.standard {
      background: var(--vscode-charts-gray);
      color: white;
    }
    .stats-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
    }
    .stat-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--vscode-charts-blue);
    }
    .stat-card.messages .stat-value {
      color: var(--vscode-charts-green);
    }
    .stat-card.inflight .stat-value {
      color: var(--vscode-charts-orange);
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    button {
      padding: 10px 20px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .section {
      margin-bottom: 30px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 20px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 15px;
      color: var(--vscode-foreground);
    }
    .property-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
    }
    .property {
      display: flex;
      flex-direction: column;
    }
    .property-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .property-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--vscode-foreground);
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-badge.encrypted {
      background: var(--vscode-charts-green);
      color: white;
    }
    .status-badge.not-encrypted {
      background: var(--vscode-charts-gray);
      color: white;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span>📋</span>
      ${queueId}
      <span class="badge ${queueDetails.fifo ? 'fifo' : 'standard'}">${queueType}</span>
    </h1>
    <div class="header-info">
      <div class="info-item">
        <span class="info-label">Environment</span>
        <span class="info-value">${environmentName}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Region</span>
        <span class="info-value">${regionName}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Last Updated</span>
        <span class="info-value">${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  </div>

  <div class="stats-summary">
    <div class="stat-card messages">
      <div class="stat-label">Messages</div>
      <div class="stat-value">${messages.toLocaleString()}</div>
    </div>
    <div class="stat-card inflight">
      <div class="stat-label">In-Flight Messages</div>
      <div class="stat-value">${inflightMessages.toLocaleString()}</div>
    </div>
  </div>

  <div class="actions">
    <button onclick="refresh()">🔄 Refresh</button>
  </div>

  <div class="section">
    <div class="section-title">Queue Configuration</div>
    <div class="property-grid">
      <div class="property">
        <div class="property-label">Queue ID</div>
        <div class="property-value">${queueId}</div>
      </div>
      <div class="property">
        <div class="property-label">Type</div>
        <div class="property-value">${queueType}</div>
      </div>
      <div class="property">
        <div class="property-label">Encrypted</div>
        <div class="property-value">
          <span class="status-badge ${queueDetails.encrypted ? 'encrypted' : 'not-encrypted'}">
            ${queueDetails.encrypted ? '🔒 Yes' : '🔓 No'}
          </span>
        </div>
      </div>
      <div class="property">
        <div class="property-label">Default TTL</div>
        <div class="property-value">${queueDetails.defaultTtl ? (queueDetails.defaultTtl / 1000 / 60).toFixed(0) + ' minutes' : 'N/A'}</div>
      </div>
      <div class="property">
        <div class="property-label">Default Lock TTL</div>
        <div class="property-value">${queueDetails.defaultLockTtl ? (queueDetails.defaultLockTtl / 1000).toFixed(0) + ' seconds' : 'N/A'}</div>
      </div>
      <div class="property">
        <div class="property-label">Max Deliveries</div>
        <div class="property-value">${queueDetails.maxDeliveries || 'N/A'}</div>
      </div>
      ${queueDetails.deadLetterQueueId ? `
      <div class="property">
        <div class="property-label">Dead Letter Queue</div>
        <div class="property-value">${queueDetails.deadLetterQueueId}</div>
      </div>
      ` : ''}
    </div>
  </div>

  ${queueStats ? `
  <div class="section">
    <div class="section-title">Statistics Details</div>
    <div class="property-grid">
      ${queueStats.messagesVisible !== undefined ? `
      <div class="property">
        <div class="property-label">Visible Messages</div>
        <div class="property-value">${queueStats.messagesVisible.toLocaleString()}</div>
      </div>
      ` : ''}
      ${queueStats.messagesInflight !== undefined ? `
      <div class="property">
        <div class="property-label">In-Flight Messages</div>
        <div class="property-value">${queueStats.messagesInflight.toLocaleString()}</div>
      </div>
      ` : ''}
      ${queueStats.messagesReceived !== undefined ? `
      <div class="property">
        <div class="property-label">Messages Received</div>
        <div class="property-value">${queueStats.messagesReceived.toLocaleString()}</div>
      </div>
      ` : ''}
      ${queueStats.messagesSent !== undefined ? `
      <div class="property">
        <div class="property-label">Messages Sent</div>
        <div class="property-value">${queueStats.messagesSent.toLocaleString()}</div>
      </div>
      ` : ''}
      ${queueStats.messagesAcked !== undefined ? `
      <div class="property">
        <div class="property-label">Messages Acknowledged</div>
        <div class="property-value">${queueStats.messagesAcked.toLocaleString()}</div>
      </div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  <script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>
  `;
}
