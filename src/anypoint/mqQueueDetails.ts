import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';
import { getAnypointMqAdminBase, getAnypointMqStatsBase } from '../constants.js';
import {
    wrapWebviewHtml,
    badge,
    summaryCard,
    button,
    escapeHtml,
} from '../webview/ui-kit';

/** Escape for single-quoted JavaScript string literals inside inline handlers / script. */
function escapeJsString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function mqQueueDetailsExtraStyles(): string {
    return `
        .mq-loading-wrap {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 60vh;
            text-align: center;
        }
        .mq-loading-inner h2 { margin-bottom: 8px; color: var(--am-text-primary); }
        .mq-loading-inner p { color: var(--am-text-secondary); }
        .mq-spinner {
            border: 4px solid var(--am-border);
            border-top: 4px solid var(--am-accent, var(--am-info));
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: mq-spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes mq-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .mq-error-panel {
            background: color-mix(in srgb, var(--am-error) 12%, transparent);
            border: 1px solid var(--am-error);
            padding: 24px;
            border-radius: var(--am-radius-md);
        }
        .mq-error-panel .mq-error-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .mq-header-meta {
            display: flex;
            gap: 20px;
            margin-top: 10px;
            flex-wrap: wrap;
        }
        .mq-header-meta .mq-meta-block {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .mq-meta-label {
            font-size: 11px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .mq-meta-value {
            font-size: 14px;
            font-weight: 600;
            color: var(--am-text-primary);
        }
        .mq-actions {
            display: flex;
            gap: 10px;
            margin-bottom: 24px;
            flex-wrap: wrap;
            align-items: center;
        }
        .mq-section-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--am-text-primary);
        }
        .mq-property-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
        }
        .mq-property { display: flex; flex-direction: column; }
        .mq-property-label {
            font-size: 12px;
            color: var(--am-text-secondary);
            margin-bottom: 4px;
        }
        .mq-property-value {
            font-size: 14px;
            font-weight: 500;
            color: var(--am-text-primary);
        }
        .mq-stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stats-detail-card {
            background: linear-gradient(135deg, var(--am-bg-surface) 0%, var(--am-bg-secondary) 100%);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 16px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .stats-detail-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--am-shadow-md);
        }
        .stats-detail-label {
            font-size: 11px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            font-weight: 600;
        }
        .stats-detail-value {
            font-size: 28px;
            font-weight: 700;
            color: var(--am-info);
            margin-bottom: 8px;
        }
        .stats-detail-bar {
            height: 4px;
            background: var(--am-border);
            border-radius: 2px;
            overflow: hidden;
            margin-top: 8px;
        }
        .stats-detail-bar-fill {
            height: 100%;
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        .loading-messages { text-align: center; padding: 40px; }
        .loading-messages .mq-spinner {
            width: 40px;
            height: 40px;
            border-width: 3px;
        }
        .message-card {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 20px;
            margin-bottom: 20px;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--am-border);
        }
        .message-title { display: flex; flex-direction: column; gap: 5px; }
        .message-number {
            font-size: 18px;
            font-weight: 700;
            color: var(--am-text-primary);
        }
        .message-id {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            color: var(--am-text-muted);
            word-break: break-all;
        }
        .message-actions { display: flex; gap: 8px; }
        .message-action-btn {
            padding: 4px 10px;
            background: var(--am-btn-secondary-bg);
            color: var(--am-btn-secondary-fg);
            border: none;
            border-radius: var(--am-radius-sm);
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;
        }
        .message-action-btn:hover {
            background: var(--am-btn-secondary-hover);
        }
        .message-metadata {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 15px;
            padding: 12px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
        }
        .metadata-item { display: flex; flex-direction: column; gap: 4px; }
        .metadata-label {
            font-size: 10px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        .metadata-value {
            font-size: 13px;
            color: var(--am-text-primary);
            font-family: var(--vscode-editor-font-family, monospace);
        }
        .message-body-container { margin-bottom: 15px; }
        .message-body-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .message-body-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--am-text-primary);
        }
        .message-body {
            background: var(--am-bg-secondary);
            padding: 15px;
            border-radius: var(--am-radius-md);
            font-family: var(--vscode-editor-font-family, 'Monaco', 'Menlo', monospace);
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid var(--am-border);
        }
        .message-properties {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 12px;
            padding: 12px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
        }
        .message-property { display: flex; flex-direction: column; gap: 4px; }
        .message-property-label {
            font-size: 10px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        .message-property-value {
            font-size: 12px;
            color: var(--am-text-primary);
            font-family: var(--vscode-editor-font-family, monospace);
            word-break: break-all;
        }
        .message-navigation {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            margin-bottom: 20px;
        }
        .nav-info {
            font-size: 13px;
            color: var(--am-text-primary);
            font-weight: 600;
        }
        .nav-buttons { display: flex; gap: 10px; }
        .nav-btn {
            padding: 8px 16px;
            background: var(--am-btn-bg);
            color: var(--am-btn-fg);
            border: none;
            border-radius: var(--am-radius-sm);
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .nav-btn:hover:not(:disabled) {
            background: var(--am-btn-hover);
        }
        .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .mq-msg-count-badge {
            display: inline-block;
            margin-left: 8px;
            vertical-align: middle;
        }
        .message-list-item {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 15px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .message-list-item:hover {
            background: var(--am-bg-surface-hover);
            border-color: var(--am-accent, var(--am-info));
            transform: translateX(4px);
            box-shadow: -4px 0 0 var(--am-accent, var(--am-info));
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
            color: var(--am-accent, var(--am-info));
            min-width: 30px;
        }
        .message-list-id {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            color: var(--am-text-muted);
            flex: 1;
        }
        .message-list-time {
            font-size: 11px;
            color: var(--am-text-muted);
        }
        .message-list-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
        }
        .message-list-badge.delivery {
            background: color-mix(in srgb, var(--am-warning) 25%, transparent);
            color: var(--am-warning);
            border: 1px solid color-mix(in srgb, var(--am-warning) 40%, transparent);
        }
        .message-list-preview {
            font-size: 12px;
            color: var(--am-text-primary);
            font-family: var(--vscode-editor-font-family, monospace);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding-left: 42px;
        }
        .no-messages {
            text-align: center;
            padding: 40px;
            color: var(--am-text-muted);
        }
        .bindings-list { margin-top: 0; }
        .mq-bindings-empty {
            padding: 20px;
            text-align: center;
            color: var(--am-text-muted);
            background: var(--am-bg-surface);
            border: 1px dashed var(--am-border);
            border-radius: var(--am-radius-md);
            margin-top: 0;
        }
        .mq-stat-empty {
            color: var(--am-text-muted);
            padding: 20px;
            text-align: center;
        }
        .mq-messages-section { margin-top: 8px; }
        #messagesSection { display: none; }
    `;
}

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
  telemetryService.trackPageView('mqQueueDetails');
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
  const body = `
    <div class="am-container mq-loading-wrap">
      <div class="mq-loading-inner">
        <div class="mq-spinner" role="status" aria-label="Loading"></div>
        <h2>Loading ${destinationType.toLowerCase()} details...</h2>
        <p>Fetching information for <strong>${escapeHtml(queueId)}</strong></p>
      </div>
    </div>
  `;
  return wrapWebviewHtml({
    title: `Loading ${destinationType} Details`,
    body,
    extraStyles: mqQueueDetailsExtraStyles(),
  });
}

function getErrorHtml(queueId: string, errorMessage: string): string {
  const body = `
    <div class="am-container">
      <div class="am-card mq-error-panel">
        <div class="mq-error-icon" aria-hidden="true">⚠️</div>
        <h2 class="mq-section-title" style="margin-bottom: 12px;">Failed to Load Queue Details</h2>
        <p><strong>Queue:</strong> ${escapeHtml(queueId)}</p>
        <p style="margin-top: 8px;"><strong>Error:</strong> ${escapeHtml(errorMessage)}</p>
      </div>
    </div>
  `;
  return wrapWebviewHtml({
    title: 'Error Loading Queue',
    body,
    extraStyles: mqQueueDetailsExtraStyles(),
  });
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
  const detailedStats: Record<string, number> = {};

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

  const typeBadge = badge(queueType, queueDetails.fifo ? 'info' : 'default', true);
  const encryptedBadge = queueDetails.encrypted
    ? badge('🔒 Yes', 'success', true)
    : badge('🔓 No', 'default', true);

  const bindingsTableHtml = bindings && Array.isArray(bindings) && bindings.length > 0
    ? `
    <div class="am-table-container bindings-list">
      <table class="am-table">
        <thead>
          <tr>
            <th>Queue / destination</th>
            <th>Routing rule</th>
          </tr>
        </thead>
        <tbody>
          ${bindings.map((binding: any) => {
            const qName = binding.queueId || binding.destination || 'Unknown Queue';
            const ruleText = binding.routingRule ? escapeHtml(JSON.stringify(binding.routingRule)) : '—';
            return `
            <tr class="am-row">
              <td><strong>${escapeHtml(String(qName))}</strong></td>
              <td><code style="font-size: 11px;">${ruleText}</code></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    `
    : `
    <div class="mq-bindings-empty">
      ${bindings === null
        ? '⚠️ Unable to fetch bindings. The bindings API may not be available or this exchange may not have any bindings configured.'
        : '📭 No bindings configured for this exchange yet.'}
    </div>
    `;

  const detailedStatsHtml = statsAvailable && Object.keys(detailedStats).length > 0
    ? (() => {
        const maxValue = Math.max(...Object.values(detailedStats), 1);
        return Object.entries(detailedStats).map(([key, value]) => {
          const label = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
          const percentage = maxValue > 0 ? (value / maxValue * 100) : 0;
          let colorVar = 'var(--am-info)';
          if (key.toLowerCase().includes('sent') || key.toLowerCase().includes('acked')) {
            colorVar = 'var(--am-success)';
          } else if (key.toLowerCase().includes('inflight')) {
            colorVar = 'var(--am-warning)';
          } else if (key.toLowerCase().includes('received')) {
            colorVar = 'var(--am-accent, var(--am-info))';
          }
          return `
          <div class="stats-detail-card">
            <div class="stats-detail-label">${escapeHtml(label)}</div>
            <div class="stats-detail-value" style="color: ${colorVar};">${value.toLocaleString()}</div>
            <div class="stats-detail-bar">
              <div class="stats-detail-bar-fill" style="width: ${percentage}%; background: ${colorVar};"></div>
            </div>
          </div>
          `;
        }).join('');
      })()
    : '';

  const statsSectionHtml = statsAvailable && Object.keys(detailedStats).length > 0
    ? `
  <div class="am-card" style="margin-bottom: 24px;">
    <div class="mq-section-title">📊 Statistics Details</div>
    <div class="mq-stats-grid">
      ${detailedStatsHtml}
    </div>
  </div>
  `
    : statsAvailable
      ? `
  <div class="am-card" style="margin-bottom: 24px;">
    <div class="mq-section-title">📊 Statistics Details</div>
    <p class="mq-stat-empty">No detailed statistics available for this queue.</p>
  </div>
  `
      : '';

  const summaryCardsHtml = !isExchange
    ? `
    <div class="am-summary-cards">
      ${summaryCard({ icon: '📬', value: messages.toLocaleString(), label: 'Messages', variant: 'healthy', animationDelay: '0.05s' })}
      ${summaryCard({ icon: '✈️', value: inflightMessages.toLocaleString(), label: 'In-Flight Messages', variant: 'warning', animationDelay: '0.1s' })}
    </div>
    `
    : '';

  const destSection = isExchange
    ? `
  <div id="bindingsSection" class="mq-messages-section">
    <div class="am-card" style="margin-bottom: 24px;">
      <div class="mq-section-title">🔗 Exchange Bindings</div>
      ${bindingsTableHtml}
    </div>
  </div>
  `
    : `
  <div id="messagesSection" class="mq-messages-section">
    <div class="am-card" style="margin-bottom: 24px;">
      <div class="mq-section-title">Messages Preview</div>
      <div id="messagesContainer">
        <div class="loading-messages">
          <div class="mq-spinner"></div>
          <p>Loading messages...</p>
        </div>
      </div>
    </div>
  </div>
  `;

  const body = `
  <div class="am-container">
    <div class="am-page-header">
      <div>
        <h1 style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span aria-hidden="true">📋</span>
          <span>${escapeHtml(queueId)}</span>
          ${typeBadge}
        </h1>
        <div class="mq-header-meta">
          <div class="mq-meta-block">
            <span class="mq-meta-label">Environment</span>
            <span class="mq-meta-value">${escapeHtml(environmentName)}</span>
          </div>
          <div class="mq-meta-block">
            <span class="mq-meta-label">Region</span>
            <span class="mq-meta-value">${escapeHtml(regionName)}</span>
          </div>
          <div class="mq-meta-block">
            <span class="mq-meta-label">Last Updated</span>
            <span class="mq-meta-value">${escapeHtml(new Date().toLocaleTimeString())}</span>
          </div>
        </div>
      </div>
    </div>

    ${summaryCardsHtml}

    <div class="mq-actions">
      ${button('Refresh', { variant: 'primary', icon: '🔄', onclick: 'refresh()' })}
      ${isExchange
    ? button('View Bindings', { variant: 'secondary', icon: '🔗', onclick: 'showBindings()' })
    : button('Browse Messages', { variant: 'secondary', icon: '📬', onclick: 'browseMessages()' })}
    </div>

    ${destSection}

    <div class="am-card" style="margin-bottom: 24px;">
      <div class="mq-section-title">Queue Configuration</div>
      <div class="mq-property-grid">
        <div class="mq-property">
          <div class="mq-property-label">Queue ID</div>
          <div class="mq-property-value">${escapeHtml(String(queueId))}</div>
        </div>
        <div class="mq-property">
          <div class="mq-property-label">Type</div>
          <div class="mq-property-value">${escapeHtml(queueType)}</div>
        </div>
        <div class="mq-property">
          <div class="mq-property-label">Encrypted</div>
          <div class="mq-property-value">${encryptedBadge}</div>
        </div>
        <div class="mq-property">
          <div class="mq-property-label">Default TTL</div>
          <div class="mq-property-value">${queueDetails.defaultTtl ? (queueDetails.defaultTtl / 1000 / 60).toFixed(0) + ' minutes' : 'N/A'}</div>
        </div>
        <div class="mq-property">
          <div class="mq-property-label">Default Lock TTL</div>
          <div class="mq-property-value">${queueDetails.defaultLockTtl ? (queueDetails.defaultLockTtl / 1000).toFixed(0) + ' seconds' : 'N/A'}</div>
        </div>
        <div class="mq-property">
          <div class="mq-property-label">Max Deliveries</div>
          <div class="mq-property-value">${queueDetails.maxDeliveries !== null && queueDetails.maxDeliveries !== undefined ? escapeHtml(String(queueDetails.maxDeliveries)) : 'N/A'}</div>
        </div>
        ${queueDetails.deadLetterQueueId ? `
        <div class="mq-property">
          <div class="mq-property-label">Dead Letter Queue</div>
          <div class="mq-property-value">${escapeHtml(String(queueDetails.deadLetterQueueId))}</div>
        </div>
        ` : ''}
      </div>
    </div>

    ${statsSectionHtml}
  </div>
  `;

  const qidJs = escapeJsString(String(queueId));
  const regionJs = escapeJsString(String(regionId));
  const orgJs = escapeJsString(String(organizationID));
  const envJs = escapeJsString(String(environmentId));

  const scripts = `
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function showBindings() {
      const el = document.getElementById('bindingsSection');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }

    function browseMessages() {
      const messagesSection = document.getElementById('messagesSection');
      const messagesContainer = document.getElementById('messagesContainer');

      messagesSection.style.display = 'block';
      messagesContainer.innerHTML = \`
        <div class="loading-messages">
          <div class="mq-spinner"></div>
          <p>Loading messages...</p>
        </div>
      \`;

      vscode.postMessage({
        command: 'browseMessages',
        queueId: '${qidJs}',
        regionId: '${regionJs}',
        organizationID: '${orgJs}',
        environmentId: '${envJs}'
      });
    }

    window.addEventListener('message', event => {
      const message = event.data;

      if (message.command === 'displayMessages') {
        displayMessages(message.messages);
      }
    });

    let allMessages = [];
    let currentView = 'list';
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
            <h3 style="margin: 0; color: var(--am-text-primary);">
              📬 Messages in Queue
              <span class="am-badge am-badge-info mq-msg-count-badge">\${allMessages.length} message\${allMessages.length !== 1 ? 's' : ''}</span>
            </h3>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            \${allMessages.map((msg, index) => {
              const headers = msg.headers || {};
              const messageId = headers.messageId || msg.messageId || msg.id || \`Message \${index + 1}\`;
              const timestamp = headers.timestamp || msg.timestamp || new Date().toISOString();
              const deliveryCount = headers.deliveryCount || 0;

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
      }

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
  `;

  return wrapWebviewHtml({
    title: `${destinationType}: ${queueId}`,
    body,
    scripts,
    extraStyles: mqQueueDetailsExtraStyles(),
  });
}
