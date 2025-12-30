import * as vscode from 'vscode';
import { getAnypointMqAdminBase, getAnypointMqStatsBase } from '../constants.js';

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
  organizationID: string,
  isExchange: boolean = false
) {
  const destinationType = isExchange ? 'Exchange' : 'Queue';

  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'mqQueueDetails',
    `${destinationType}: ${queueId}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Show loading state
  panel.webview.html = getLoadingHtml(queueId, isExchange);

  try {
    // Fetch queue/exchange details from the API
    const { ApiHelper } = await import('../controllers/apiHelper.js');
    const apiHelper = new ApiHelper(context);

    // Get region-specific MQ URLs
    const mqAdminBase = await getAnypointMqAdminBase(context);
    const mqStatsBase = await getAnypointMqStatsBase(context);

    const destinationPath = isExchange ? 'exchanges' : 'queues';
    const queueDetailsUrl = `${mqAdminBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/destinations/${destinationPath}/${queueId}`;

    console.log(`${destinationType} Details: Fetching ${destinationType.toLowerCase()} info from ${queueDetailsUrl}`);

    // Fetch destination details
    const queueDetailsResponse = await apiHelper.get(queueDetailsUrl);
    const queueDetails = queueDetailsResponse.data;

    console.log(`${destinationType} Details: ${destinationType} data:`, JSON.stringify(queueDetails, null, 2));

    let queueStats = null;
    let bindings = null;

    if (isExchange) {
      // For exchanges, try to fetch bindings instead of stats
      try {
        const bindingsUrl = `${mqAdminBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/bindings/exchanges/${queueId}`;
        console.log(`Exchange Details: Fetching bindings from ${bindingsUrl}`);

        const bindingsResponse = await apiHelper.get(bindingsUrl);
        bindings = bindingsResponse.data;
        console.log(`Exchange Details: Bindings data:`, JSON.stringify(bindings, null, 2));
      } catch (err: any) {
        console.warn(`Exchange Details: Failed to fetch bindings:`, err.message);
        bindings = null;
      }
    } else {
      // For queues, fetch stats
      const statsUrl = `${mqStatsBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/queues?destinationIds=${queueId}`;
      console.log(`Queue Details: Fetching stats from ${statsUrl}`);

      try {
        const statsResponse = await apiHelper.get(statsUrl);
        queueStats = statsResponse.data;

        console.log(`Queue Details: Stats data (raw):`, JSON.stringify(queueStats, null, 2));

        // Handle case where stats might be wrapped in an array
        if (Array.isArray(queueStats) && queueStats.length > 0) {
          console.log(`Queue Details: Stats is array with ${queueStats.length} elements, using first element`);
          queueStats = queueStats[0];
          console.log(`Queue Details: Extracted stats:`, JSON.stringify(queueStats, null, 2));
        }
      } catch (err: any) {
        console.warn(`Queue Details: Failed to fetch stats:`, err.message);
        queueStats = null;
      }
    }

    // Build the HTML with the fetched data
    panel.webview.html = getQueueDetailsHtml(
      queueDetails,
      queueStats,
      regionId,
      regionName,
      environmentName,
      organizationID,
      environmentId,
      isExchange,
      bindings
    );

    // Listen for messages
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'refresh') {
        showQueueDetailsWebview(context, queueId, regionId, regionName, environmentId, environmentName, organizationID, isExchange);
        panel.dispose();
      } else if (message.command === 'browseMessages') {
        try {
          const { ApiHelper } = await import('../controllers/apiHelper.js');
          const apiHelper = new ApiHelper(context);

          // Use the MQ Broker API to fetch messages
          // The Broker API uses a region-specific subdomain: mq-{regionId}.anypoint.mulesoft.com
          // Note: The API may not return all messages in one call due to:
          // - Messages being locked by other consumers
          // - Visibility timeouts
          // - API limitations

          const allMessages: any[] = [];
          const maxBatches = 5; // Try to fetch up to 5 batches to get more messages

          console.log(`Attempting to fetch messages in batches (max ${maxBatches} batches)...`);

          for (let batch = 0; batch < maxBatches; batch++) {
            const messagesUrl = `https://mq-${regionId}.anypoint.mulesoft.com/api/v1/organizations/${organizationID}/environments/${environmentId}/destinations/${queueId}/messages?batchSize=10`;

            console.log(`Batch ${batch + 1}: Fetching from ${messagesUrl}`);

            const messagesResponse = await apiHelper.get(messagesUrl);
            const messages = messagesResponse.data;

            console.log(`Batch ${batch + 1}: Fetched ${Array.isArray(messages) ? messages.length : 0} messages`);
            console.log(`Batch ${batch + 1} data:`, JSON.stringify(messages, null, 2));

            if (Array.isArray(messages) && messages.length > 0) {
              allMessages.push(...messages);

              // If we got fewer than 10 messages, there probably aren't more available
              if (messages.length < 10) {
                console.log(`Batch ${batch + 1}: Received fewer than 10 messages, stopping fetch.`);
                break;
              }
            } else {
              // No messages in this batch, stop trying
              console.log(`Batch ${batch + 1}: No messages returned, stopping fetch.`);
              break;
            }

            // Small delay between batches to avoid rate limiting
            if (batch < maxBatches - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }

          console.log(`Total messages fetched across all batches: ${allMessages.length}`);

          // Send messages to the webview
          panel.webview.postMessage({
            command: 'displayMessages',
            messages: allMessages
          });
        } catch (error: any) {
          console.error(`Error fetching messages:`, error);
          panel.webview.postMessage({
            command: 'displayMessages',
            messages: []
          });
        }
      }
    });

  } catch (error: any) {
    console.error(`Queue Details: Error:`, error);
    panel.webview.html = getErrorHtml(queueId, error.message);
  }
}

function getLoadingHtml(queueId: string, isExchange: boolean = false): string {
  const destinationType = isExchange ? 'Exchange' : 'Queue';
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
  environmentId: string,
  isExchange: boolean = false,
  bindings: any = null
): string {
  const queueId = queueDetails.queueId || queueDetails.exchangeId || queueDetails.id;
  const queueType = queueDetails.fifo ? 'FIFO' : 'Standard';
  const destinationType = isExchange ? 'Exchange' : 'Queue';

  // Safely extract numeric values from stats
  let messages = 0;
  let inflightMessages = 0;
  let statsAvailable = false;

  // Extract all available numeric stats for detailed display
  const detailedStats: any = {};

  if (queueStats) {
    statsAvailable = true;

    // Handle different possible response structures
    messages = typeof queueStats.messagesVisible === 'number' ? queueStats.messagesVisible :
               typeof queueStats.messages === 'number' ? queueStats.messages : 0;

    inflightMessages = typeof queueStats.messagesInflight === 'number' ? queueStats.messagesInflight :
                       typeof queueStats.inflightMessages === 'number' ? queueStats.inflightMessages : 0;

    // Extract all numeric stats for the detailed section
    Object.keys(queueStats).forEach(key => {
      if (typeof queueStats[key] === 'number') {
        detailedStats[key] = queueStats[key];
      }
    });
  }

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
    .stats-detail-card {
      background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .stats-detail-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    .stats-detail-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .stats-detail-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--vscode-charts-blue);
      margin-bottom: 8px;
    }
    .stats-detail-bar {
      height: 4px;
      background: var(--vscode-panel-border);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    }
    .stats-detail-bar-fill {
      height: 100%;
      background: var(--vscode-charts-blue);
      border-radius: 2px;
      transition: width 0.3s ease;
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
    .loading-messages {
      text-align: center;
      padding: 40px;
    }
    .message-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 2px solid var(--vscode-panel-border);
    }
    .message-title {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .message-number {
      font-size: 18px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }
    .message-id {
      font-family: monospace;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      word-break: break-all;
    }
    .message-actions {
      display: flex;
      gap: 8px;
    }
    .message-action-btn {
      padding: 4px 10px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
    }
    .message-action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .message-metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 15px;
      padding: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .metadata-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metadata-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .metadata-value {
      font-size: 13px;
      color: var(--vscode-foreground);
      font-family: monospace;
    }
    .message-body-container {
      margin-bottom: 15px;
    }
    .message-body-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .message-body-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .message-body {
      background: var(--vscode-textCodeBlock-background);
      padding: 15px;
      border-radius: 6px;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border);
    }
    .message-properties {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 12px;
      padding: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .message-property {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .message-property-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .message-property-value {
      font-size: 12px;
      color: var(--vscode-foreground);
      font-family: monospace;
      word-break: break-all;
    }
    .message-navigation {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .nav-info {
      font-size: 13px;
      color: var(--vscode-foreground);
      font-weight: 600;
    }
    .nav-buttons {
      display: flex;
      gap: 10px;
    }
    .nav-btn {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nav-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    .nav-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .badge-info {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      background: var(--vscode-charts-blue);
      color: white;
      margin-left: 8px;
    }
    .message-list-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 15px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .message-list-item:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-charts-blue);
      transform: translateX(4px);
      box-shadow: -4px 0 0 var(--vscode-charts-blue);
    }
    .message-list-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .message-list-number {
      font-weight: 700;
      font-size: 14px;
      color: var(--vscode-charts-blue);
      min-width: 30px;
    }
    .message-list-id {
      font-family: monospace;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex: 1;
    }
    .message-list-time {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .message-list-badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .message-list-badge.delivery {
      background: var(--vscode-charts-orange);
      color: white;
    }
    .message-list-preview {
      font-size: 12px;
      color: var(--vscode-foreground);
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-left: 42px;
    }
    .no-messages {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .bindings-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 15px;
    }
    .binding-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px 15px;
      transition: all 0.2s;
    }
    .binding-item:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-charts-blue);
      transform: translateX(4px);
      box-shadow: -4px 0 0 var(--vscode-charts-blue);
    }
    .binding-queue-name {
      font-weight: 600;
      font-size: 14px;
      color: var(--vscode-foreground);
      margin-bottom: 6px;
    }
    .binding-rule {
      font-family: monospace;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textCodeBlock-background);
      padding: 6px 8px;
      border-radius: 3px;
      margin-top: 6px;
    }
    .info-message {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-background);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      margin-top: 15px;
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
    ${isExchange ? `
    <button class="secondary" onclick="showBindings()">🔗 View Bindings</button>
    ` : `
    <button class="secondary" onclick="browseMessages()">📬 Browse Messages</button>
    `}
  </div>

  ${isExchange ? `
  <div id="bindingsSection" style="margin-top: 30px;">
    <div class="section">
      <div class="section-title">🔗 Exchange Bindings</div>
      ${bindings && Array.isArray(bindings) && bindings.length > 0 ? `
        <div class="bindings-list">
          ${bindings.map((binding: any) => `
            <div class="binding-item">
              <div class="binding-queue-name">📋 ${binding.queueId || binding.destination || 'Unknown Queue'}</div>
              ${binding.routingRule ? `<div class="binding-rule">Rule: ${JSON.stringify(binding.routingRule)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="info-message">
          ${bindings === null ?
            '⚠️ Unable to fetch bindings. The bindings API may not be available or this exchange may not have any bindings configured.' :
            '📭 No bindings configured for this exchange yet.'}
        </div>
      `}
    </div>
  </div>
  ` : `
  <div id="messagesSection" style="display: none; margin-top: 30px;">
    <div class="section">
      <div class="section-title">Messages Preview</div>
      <div id="messagesContainer">
        <div class="loading-messages">
          <div class="spinner"></div>
          <p>Loading messages...</p>
        </div>
      </div>
    </div>
  </div>
  `}

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

  ${statsAvailable && Object.keys(detailedStats).length > 0 ? `
  <div class="section">
    <div class="section-title">📊 Statistics Details</div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
      ${(() => {
        // Find the maximum value for percentage calculation
        const maxValue = Math.max(...Object.values(detailedStats).map(v => v as number), 1);

        return Object.entries(detailedStats).map(([key, value]) => {
          // Convert camelCase to readable format
          const label = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();

          // Calculate percentage for visual bar
          const percentage = maxValue > 0 ? ((value as number) / maxValue * 100) : 0;

          // Determine color based on stat type
          let color = 'var(--vscode-charts-blue)';
          if (key.toLowerCase().includes('sent') || key.toLowerCase().includes('acked')) {
            color = 'var(--vscode-charts-green)';
          } else if (key.toLowerCase().includes('inflight')) {
            color = 'var(--vscode-charts-orange)';
          } else if (key.toLowerCase().includes('received')) {
            color = 'var(--vscode-charts-purple)';
          }

          return `
          <div class="stats-detail-card">
            <div class="stats-detail-label">${label}</div>
            <div class="stats-detail-value" style="color: ${color};">${(value as number).toLocaleString()}</div>
            <div class="stats-detail-bar">
              <div class="stats-detail-bar-fill" style="width: ${percentage}%; background: ${color};"></div>
            </div>
          </div>
          `;
        }).join('');
      })()}
    </div>
  </div>
  ` : statsAvailable ? `
  <div class="section">
    <div class="section-title">📊 Statistics Details</div>
    <p style="color: var(--vscode-descriptionForeground); padding: 20px; text-align: center;">
      No detailed statistics available for this queue.
    </p>
  </div>
  ` : ''}

  <script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function browseMessages() {
      const messagesSection = document.getElementById('messagesSection');
      const messagesContainer = document.getElementById('messagesContainer');

      messagesSection.style.display = 'block';
      messagesContainer.innerHTML = \`
        <div class="loading-messages">
          <div class="spinner"></div>
          <p>Loading messages...</p>
        </div>
      \`;

      vscode.postMessage({
        command: 'browseMessages',
        queueId: '${queueId}',
        regionId: '${regionId}',
        organizationID: '${organizationID}',
        environmentId: '${environmentId}'
      });
    }

    // Listen for messages from the extension
    window.addEventListener('message', event => {
      const message = event.data;

      if (message.command === 'displayMessages') {
        displayMessages(message.messages);
      }
    });

    let allMessages = [];
    let currentView = 'list'; // 'list' or 'detail'
    let selectedMessageIndex = -1;

    function displayMessages(messages) {
      const messagesContainer = document.getElementById('messagesContainer');

      if (!messages || messages.length === 0) {
        messagesContainer.innerHTML = \`
          <div class="no-messages">
            <p>No messages found in queue</p>
          </div>
        \`;
        return;
      }

      allMessages = messages;
      currentView = 'list';
      renderMessageList();
    }

    function renderMessageList() {
      const messagesContainer = document.getElementById('messagesContainer');

      if (!messagesContainer) {
        console.error('Messages container not found');
        return;
      }

      const html = \`
        <div style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0; color: var(--vscode-foreground);">
              📬 Messages in Queue
              <span class="badge-info">\${allMessages.length} message\${allMessages.length !== 1 ? 's' : ''}</span>
            </h3>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            \${allMessages.map((msg, index) => {
              const headers = msg.headers || {};
              const messageId = headers.messageId || msg.messageId || msg.id || \`Message \${index + 1}\`;
              const timestamp = headers.timestamp || msg.timestamp || new Date().toISOString();
              const deliveryCount = headers.deliveryCount || 0;

              // Get a preview of the body
              let bodyPreview = msg.body || 'No body';
              if (typeof bodyPreview === 'object') {
                bodyPreview = JSON.stringify(bodyPreview);
              }
              if (bodyPreview.length > 80) {
                bodyPreview = bodyPreview.substring(0, 80) + '...';
              }

              return \`
                <div class="message-list-item" onclick="showMessageDetail(\${index})">
                  <div class="message-list-header">
                    <div class="message-list-number">#\${index + 1}</div>
                    <div class="message-list-id">\${messageId.substring(0, 24)}...</div>
                    <div class="message-list-time">\${formatTimestamp(timestamp)}</div>
                    \${deliveryCount > 0 ? \`<div class="message-list-badge delivery">\${deliveryCount} deliveries</div>\` : ''}
                  </div>
                  <div class="message-list-preview">\${escapeHtml(bodyPreview)}</div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>
      \`;

      messagesContainer.innerHTML = html;
    }

    function showMessageDetail(index) {
      selectedMessageIndex = index;
      currentView = 'detail';
      renderMessageDetail();
    }

    function backToList() {
      currentView = 'list';
      renderMessageList();
    }

    function renderMessageDetail() {
      try {
        const messagesContainer = document.getElementById('messagesContainer');

        if (!messagesContainer) {
          console.error('Messages container not found');
          return;
        }

        if (allMessages.length === 0) {
          console.log('No messages to display');
          return;
        }

        const msg = allMessages[selectedMessageIndex];
        const index = selectedMessageIndex;

        console.log('Rendering message detail', index + 1, 'of', allMessages.length);

      // Parse message body for better display
      let body = msg.body || 'No body';
      let isJSON = false;

      try {
        if (typeof body === 'string') {
          const parsed = JSON.parse(body);
          body = JSON.stringify(parsed, null, 2);
          isJSON = true;
        } else if (typeof body === 'object') {
          body = JSON.stringify(body, null, 2);
          isJSON = true;
        }
      } catch (e) {
        // Not JSON, keep as is
      }

      // Extract metadata from headers
      const headers = msg.headers || {};
      const messageId = headers.messageId || msg.messageId || msg.id || \`Message \${index + 1}\`;
      const deliveryCount = headers.deliveryCount || 0;
      const timestamp = headers.timestamp || msg.timestamp || new Date().toISOString();
      const lockId = headers.lockId || 'N/A';
      const contentType = headers.contentType || msg.contentType || 'text/plain';

      const html = \`
        <div style="margin-bottom: 15px;">
          <button class="nav-btn" onclick="backToList()" style="margin-bottom: 15px;">
            ← Back to Messages List
          </button>
        </div>

        <div class="message-navigation">
          <div class="nav-info">
            Viewing message <strong>\${index + 1}</strong> of <strong>\${allMessages.length}</strong>
          </div>
          <div class="nav-buttons">
            <button class="nav-btn" onclick="previousMessage()" \${index === 0 ? 'disabled' : ''}>
              ◀ Previous
            </button>
            <button class="nav-btn" onclick="nextMessage()" \${index === allMessages.length - 1 ? 'disabled' : ''}>
              Next ▶
            </button>
          </div>
        </div>

        <div class="message-card">
          <div class="message-header">
            <div class="message-title">
              <div class="message-number">Message #\${index + 1}</div>
              <div class="message-id">ID: \${messageId}</div>
            </div>
            <div class="message-actions">
              <button class="message-action-btn" onclick="copyMessageBody(\${index})">
                📋 Copy
              </button>
              <button class="message-action-btn" onclick="viewRaw(\${index})">
                🔍 Raw JSON
              </button>
            </div>
          </div>

          <div class="message-metadata">
            <div class="metadata-item">
              <div class="metadata-label">Content Type</div>
              <div class="metadata-value">\${contentType}</div>
            </div>
            <div class="metadata-item">
              <div class="metadata-label">Delivery Count</div>
              <div class="metadata-value">\${deliveryCount}</div>
            </div>
            <div class="metadata-item">
              <div class="metadata-label">Timestamp</div>
              <div class="metadata-value">\${formatTimestamp(timestamp)}</div>
            </div>
            <div class="metadata-item">
              <div class="metadata-label">Lock ID</div>
              <div class="metadata-value">\${lockId.substring(0, 20)}...</div>
            </div>
          </div>

          <div class="message-body-container">
            <div class="message-body-header">
              <div class="message-body-label">Message Payload \${isJSON ? '(JSON)' : ''}</div>
            </div>
            <div class="message-body">\${escapeHtml(body)}</div>
          </div>

          \${msg.properties && Object.keys(msg.properties).length > 0 ? \`
          <div>
            <div class="message-body-label" style="margin-bottom: 8px;">Custom Properties</div>
            <div class="message-properties">
              \${Object.entries(msg.properties).map(([key, value]) =>
                \`<div class="message-property">
                  <div class="message-property-label">\${escapeHtml(key)}</div>
                  <div class="message-property-value">\${escapeHtml(String(value))}</div>
                </div>\`
              ).join('')}
            </div>
          </div>
          \` : ''}
        </div>
      \`;

        messagesContainer.innerHTML = html;
      } catch (error) {
        console.error('Error rendering message:', error);
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
          messagesContainer.innerHTML = \`
            <div class="no-messages">
              <p>Error displaying message: \${error.message}</p>
            </div>
          \`;
        }
      }
    }

    function nextMessage() {
      if (selectedMessageIndex < allMessages.length - 1) {
        selectedMessageIndex++;
        renderMessageDetail();
      }
    }

    function previousMessage() {
      if (selectedMessageIndex > 0) {
        selectedMessageIndex--;
        renderMessageDetail();
      }
    }

    function formatTimestamp(ts) {
      try {
        const date = new Date(ts);
        return date.toLocaleString();
      } catch (e) {
        return ts;
      }
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        console.log('Copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    }

    function copyMessageBody(index) {
      const msg = allMessages[index];
      let body = msg.body || 'No body';

      try {
        if (typeof body === 'object') {
          body = JSON.stringify(body, null, 2);
        }
      } catch (e) {
        // Keep as is
      }

      copyToClipboard(body);
    }

    function viewRaw(index) {
      const msg = allMessages[index];
      const raw = JSON.stringify(msg, null, 2);

      const messagesContainer = document.getElementById('messagesContainer');
      const escapedRaw = escapeHtml(raw);

      messagesContainer.innerHTML = \`
        <div class="message-card">
          <div class="message-header">
            <div class="message-title">
              <div class="message-number">Raw Message Data</div>
            </div>
            <div class="message-actions">
              <button class="message-action-btn" onclick="renderMessageDetail()">
                ← Back to Message
              </button>
              <button class="message-action-btn" onclick="copyRawMessage(\${index})">
                📋 Copy All
              </button>
            </div>
          </div>
          <div class="message-body">\${escapedRaw}</div>
        </div>
      \`;
    }

    function copyRawMessage(index) {
      const msg = allMessages[index];
      const raw = JSON.stringify(msg, null, 2);
      copyToClipboard(raw);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>
  `;
}
