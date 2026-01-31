import * as vscode from 'vscode';
import * as fs from 'fs';
import { showQueueDetailsWebview } from './mqQueueDetails.js';
import { telemetryService } from '../services/telemetryService';

/**
 * Creates a webview panel and displays AnypointMQ Statistics
 */
export function showAnypointMQStatsWebview(
  context: vscode.ExtensionContext,
  data: any
) {
  telemetryService.trackPageView('mqStats');
  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'mqStatsView',
    'AnypointMQ Statistics',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Build the HTML based on whether we're showing all regions or a single region
  if (data.allRegions) {
    panel.webview.html = getAnypointMQStatsHtmlAllRegions(
      data.regionsData,
      data.environmentName,
      panel.webview,
      context.extensionUri,
      data.organizationID,
      data.environmentId
    );
  } else {
    panel.webview.html = getAnypointMQStatsHtml(
      data.queues,
      data.stats,
      data.region,
      data.regionName,
      data.environmentName,
      panel.webview,
      context.extensionUri,
      data.organizationID,
      data.environmentId
    );
  }

  const { environmentId, environmentName, organizationID } = data;

  // Listen for messages (for CSV download, refresh, and queue details)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'viewQueueDetails') {
      // Show queue details in a new webview
      await showQueueDetailsWebview(
        context,
        message.queueId,
        message.regionId,
        message.regionName,
        environmentId,
        environmentName,
        organizationID,
        message.isExchange || false
      );
    } else if (message.command === 'downloadCsv') {
      let csvContent = '';

      if (data.allRegions) {
        csvContent = generateMQStatsCsvAllRegions(data.regionsData);
      } else {
        csvContent = generateMQStatsCsv(data.queues, data.stats, data.regionName);
      }

      // Prompt for save location
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save MQ Statistics as CSV',
      });

      if (uri) {
        try {
          await fs.promises.writeFile(uri.fsPath, csvContent, 'utf-8');
          vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to save CSV file: ${error.message}`);
        }
      }
    } else if (message.command === 'refreshStats') {
      // Re-fetch the statistics
      const { getAnypointMQStats } = await import('../controllers/anypointService.js');
      await getAnypointMQStats(context, environmentId);
      panel.dispose();
    }
  });
}

function getAnypointMQStatsHtml(
  queues: any[],
  stats: any[],
  region: string,
  regionName: string,
  environmentName?: string,
  webview?: vscode.Webview,
  extensionUri?: vscode.Uri,
  organizationID?: string,
  environmentId?: string
): string {
  // Merge destination data with stats data (queues and exchanges)
  const enrichedQueues = queues.map(queue => {
    const destinationId = queue.queueId || queue.exchangeId || queue.id;
    const queueStats = stats.find(stat =>
      stat.destination === destinationId ||
      stat.queueId === destinationId ||
      stat.exchangeId === destinationId ||
      stat.destinationId === destinationId
    );

    return {
      ...queue,
      stats: queueStats || {
        messages: 0,
        inflightMessages: 0
      }
    };
  });

  // Calculate summary statistics
  const totalQueues = enrichedQueues.length;
  const totalMessages = enrichedQueues.reduce((sum, q) => sum + (q.stats.messages || 0), 0);
  const totalInflight = enrichedQueues.reduce((sum, q) => sum + (q.stats.inflightMessages || 0), 0);
  const activeQueues = enrichedQueues.filter(q => (q.stats.messages || 0) > 0).length;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnypointMQ Statistics</title>
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
    .stat-card.active .stat-value {
      color: var(--vscode-charts-purple);
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
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
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .search-box {
      margin-bottom: 20px;
    }
    .search-box input {
      width: 100%;
      padding: 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 14px;
    }
    .search-box input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: var(--vscode-editor-background);
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }
    thead {
      background: var(--vscode-editor-background);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      color: var(--vscode-foreground);
      border-bottom: 2px solid var(--vscode-panel-border);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
    }
    th:hover {
      background: var(--vscode-list-hoverBackground);
    }
    th .sort-indicator {
      margin-left: 5px;
      font-size: 10px;
      opacity: 0.5;
    }
    td {
      padding: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 13px;
    }
    tr:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .queue-name {
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
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
    .badge.queue {
      background: var(--vscode-charts-blue);
      color: white;
    }
    .badge.exchange {
      background: var(--vscode-charts-purple);
      color: white;
    }
    .metric-value {
      font-weight: 600;
      font-size: 14px;
    }
    .metric-value.high {
      color: var(--vscode-charts-red);
    }
    .metric-value.medium {
      color: var(--vscode-charts-orange);
    }
    .metric-value.low {
      color: var(--vscode-charts-green);
    }
    .action-btn {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .action-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 20px;
      opacity: 0.5;
    }
    .empty-state-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .no-results {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span>📊</span>
      AnypointMQ Statistics
    </h1>
    <div class="header-info">
      <div class="info-item">
        <span class="info-label">Environment</span>
        <span class="info-value">${environmentName || 'Unknown'}</span>
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
    <div class="stat-card">
      <div class="stat-label">Total Queues</div>
      <div class="stat-value">${totalQueues}</div>
    </div>
    <div class="stat-card messages">
      <div class="stat-label">Total Messages</div>
      <div class="stat-value">${totalMessages.toLocaleString()}</div>
    </div>
    <div class="stat-card inflight">
      <div class="stat-label">In-Flight Messages</div>
      <div class="stat-value">${totalInflight.toLocaleString()}</div>
    </div>
    <div class="stat-card active">
      <div class="stat-label">Active Queues</div>
      <div class="stat-value">${activeQueues}</div>
    </div>
  </div>

  <div class="actions">
    <button onclick="refreshStats()">🔄 Refresh Statistics</button>
    <button class="secondary" onclick="downloadCsv()">💾 Download CSV</button>
  </div>

  <div class="search-box">
    <input type="text" id="searchInput" placeholder="🔍 Search queues by name..." onkeyup="filterQueues()">
  </div>

  ${enrichedQueues.length > 0 ? `
  <table id="queuesTable">
    <thead>
      <tr>
        <th onclick="sortTable(0)">Destination Name <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(1)">Destination Type <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(2)">Queue Type <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(3)">Messages <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(4)">In-Flight <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(5)">Default TTL <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(6)">Default Lock TTL <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(7)">Encrypted <span class="sort-indicator">▼</span></th>
        <th>Actions <span class="sort-indicator"></span></th>
      </tr>
    </thead>
    <tbody id="queuesTableBody">
      ${enrichedQueues.map(queue => {
        // Extract ID - could be queueId, exchangeId, or just id
        const destinationId = queue.queueId || queue.exchangeId || queue.id;

        // Determine type - check destinationType first, then exchangeId, default to queue
        const destinationType = queue.destinationType || (queue.exchangeId ? 'exchange' : 'queue');

        const queueType = queue.fifo ? 'FIFO' : 'Standard';
        const messages = queue.stats.messages || 0;
        const inflight = queue.stats.inflightMessages || 0;

        let messageClass = 'low';
        if (messages > 1000) {
          messageClass = 'high';
        } else if (messages > 100) {
          messageClass = 'medium';
        }

        const isExchange = destinationType === 'exchange';

        return `
        <tr>
          <td><span class="queue-name">${destinationId}</span></td>
          <td><span class="badge ${isExchange ? 'exchange' : 'queue'}">${isExchange ? '🔀 Exchange' : '📋 Queue'}</span></td>
          <td><span class="badge ${queue.fifo ? 'fifo' : 'standard'}">${isExchange ? 'N/A' : queueType}</span></td>
          <td><span class="metric-value ${messageClass}">${messages.toLocaleString()}</span></td>
          <td><span class="metric-value">${inflight.toLocaleString()}</span></td>
          <td>${queue.defaultTtl ? (queue.defaultTtl / 1000 / 60).toFixed(0) + ' min' : 'N/A'}</td>
          <td>${queue.defaultLockTtl ? (queue.defaultLockTtl / 1000).toFixed(0) + ' sec' : 'N/A'}</td>
          <td>${queue.encrypted ? '🔒 Yes' : '🔓 No'}</td>
          <td><button class="action-btn" onclick="openQueueDetails('${destinationId}', '${region}', ${isExchange})">📋 View Details</button></td>
        </tr>
        `;
      }).join('')}
    </tbody>
  </table>
  <div id="noResults" class="no-results" style="display: none;">
    No queues match your search criteria.
  </div>
  ` : `
  <div class="empty-state">
    <div class="empty-state-icon">📭</div>
    <div class="empty-state-title">No Queues Found</div>
    <p>There are no AnypointMQ queues in this region.</p>
  </div>
  `}

  <script>
    const vscode = acquireVsCodeApi();
    let sortDirection = {};

    const organizationID = '${organizationID || ''}';
    const environmentId = '${environmentId || ''}';
    const regionName = '${regionName}';

    function refreshStats() {
      vscode.postMessage({ command: 'refreshStats' });
    }

    function downloadCsv() {
      vscode.postMessage({ command: 'downloadCsv' });
    }

    function openQueueDetails(queueId, regionId, isExchange) {
      vscode.postMessage({
        command: 'viewQueueDetails',
        queueId: queueId,
        regionId: regionId,
        regionName: regionName,
        isExchange: isExchange || false
      });
    }

    function filterQueues() {
      const input = document.getElementById('searchInput');
      const filter = input.value.toLowerCase();
      const table = document.getElementById('queuesTable');
      const tbody = document.getElementById('queuesTableBody');
      const noResults = document.getElementById('noResults');

      if (!tbody) return;

      const rows = tbody.getElementsByTagName('tr');
      let visibleCount = 0;

      for (let i = 0; i < rows.length; i++) {
        const queueName = rows[i].getElementsByTagName('td')[0];
        if (queueName) {
          const textValue = queueName.textContent || queueName.innerText;
          if (textValue.toLowerCase().indexOf(filter) > -1) {
            rows[i].style.display = '';
            visibleCount++;
          } else {
            rows[i].style.display = 'none';
          }
        }
      }

      if (table && noResults) {
        if (visibleCount === 0 && filter !== '') {
          table.style.display = 'none';
          noResults.style.display = 'block';
        } else {
          table.style.display = 'table';
          noResults.style.display = 'none';
        }
      }
    }

    function sortTable(columnIndex) {
      const table = document.getElementById('queuesTable');
      if (!table) return;

      const tbody = table.getElementsByTagName('tbody')[0];
      const rows = Array.from(tbody.getElementsByTagName('tr'));

      const currentDirection = sortDirection[columnIndex] || 'asc';
      const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
      sortDirection = { [columnIndex]: newDirection };

      rows.sort((a, b) => {
        const aCell = a.getElementsByTagName('td')[columnIndex];
        const bCell = b.getElementsByTagName('td')[columnIndex];

        let aValue = aCell.textContent || aCell.innerText;
        let bValue = bCell.textContent || bCell.innerText;

        // Handle numeric columns
        if (columnIndex === 2 || columnIndex === 3) {
          aValue = parseInt(aValue.replace(/,/g, '')) || 0;
          bValue = parseInt(bValue.replace(/,/g, '')) || 0;
        }

        if (aValue < bValue) return newDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return newDirection === 'asc' ? 1 : -1;
        return 0;
      });

      rows.forEach(row => tbody.appendChild(row));

      // Update sort indicators
      const headers = table.getElementsByTagName('th');
      for (let i = 0; i < headers.length; i++) {
        const indicator = headers[i].querySelector('.sort-indicator');
        if (indicator) {
          if (i === columnIndex) {
            indicator.textContent = newDirection === 'asc' ? '▲' : '▼';
            indicator.style.opacity = '1';
          } else {
            indicator.textContent = '▼';
            indicator.style.opacity = '0.5';
          }
        }
      }
    }
  </script>
</body>
</html>
  `;
}

function generateMQStatsCsv(queues: any[], stats: any[], regionName?: string): string {
  const headers = [
    'Region',
    'Destination ID',
    'Destination Type',
    'Queue Type',
    'Messages',
    'In-Flight Messages',
    'Default TTL (ms)',
    'Default Lock TTL (ms)',
    'Max Deliveries',
    'Encrypted',
    'Dead Letter Queue',
    'FIFO'
  ];

  const rows = queues.map(queue => {
    const destinationId = queue.queueId || queue.exchangeId || queue.id;
    const destinationType = queue.destinationType || (queue.exchangeId ? 'exchange' : 'queue');
    const queueStats = stats.find(stat =>
      stat.destination === destinationId ||
      stat.queueId === destinationId ||
      stat.exchangeId === destinationId ||
      stat.destinationId === destinationId
    );

    return [
      regionName || 'N/A',
      destinationId,
      destinationType,
      queue.fifo ? 'FIFO' : 'Standard',
      queueStats?.messages || 0,
      queueStats?.inflightMessages || 0,
      queue.defaultTtl || 'N/A',
      queue.defaultLockTtl || 'N/A',
      queue.maxDeliveries || 'N/A',
      queue.encrypted ? 'Yes' : 'No',
      queue.deadLetterQueueId || 'None',
      queue.fifo ? 'Yes' : 'No'
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}

function generateMQStatsCsvAllRegions(regionsData: any[]): string {
  const headers = [
    'Region',
    'Queue ID',
    'Type',
    'Messages',
    'In-Flight Messages',
    'Default TTL (ms)',
    'Default Lock TTL (ms)',
    'Max Deliveries',
    'Encrypted',
    'Dead Letter Queue',
    'FIFO'
  ];

  const rows: any[] = [];

  regionsData.forEach(regionData => {
    const { regionName, queues, stats } = regionData;

    queues.forEach((queue: any) => {
      const queueId = queue.queueId || queue.id;
      const queueStats = stats.find((stat: any) =>
        stat.destination === queueId ||
        stat.queueId === queueId ||
        stat.destinationId === queueId
      );

      rows.push([
        regionName,
        queueId,
        queue.fifo ? 'FIFO' : 'Standard',
        queueStats?.messages || 0,
        queueStats?.inflightMessages || 0,
        queue.defaultTtl || 'N/A',
        queue.defaultLockTtl || 'N/A',
        queue.maxDeliveries || 'N/A',
        queue.encrypted ? 'Yes' : 'No',
        queue.deadLetterQueueId || 'None',
        queue.fifo ? 'Yes' : 'No'
      ]);
    });
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}

function getAnypointMQStatsHtmlAllRegions(
  regionsData: any[],
  environmentName?: string,
  webview?: vscode.Webview,
  extensionUri?: vscode.Uri,
  organizationID?: string,
  environmentId?: string
): string {
  // Aggregate all queues from all regions
  const allQueues: any[] = [];

  regionsData.forEach(regionData => {
    const { regionName, regionId, queues, stats } = regionData;

    queues.forEach((queue: any) => {
      // Extract ID - could be queueId, exchangeId, or just id
      const destinationId = queue.queueId || queue.exchangeId || queue.id;

      // Find matching stats
      const queueStats = stats.find((stat: any) =>
        stat.destination === destinationId ||
        stat.queueId === destinationId ||
        stat.exchangeId === destinationId ||
        stat.destinationId === destinationId
      );

      allQueues.push({
        ...queue,
        region: regionName,
        regionId: regionId,
        stats: queueStats || {
          messages: 0,
          inflightMessages: 0
        }
      });
    });
  });

  // Calculate summary statistics
  const totalQueues = allQueues.length;
  const totalMessages = allQueues.reduce((sum, q) => sum + (q.stats.messages || 0), 0);
  const totalInflight = allQueues.reduce((sum, q) => sum + (q.stats.inflightMessages || 0), 0);
  const activeQueues = allQueues.filter(q => (q.stats.messages || 0) > 0).length;
  const totalRegions = regionsData.length;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnypointMQ Statistics - All Regions</title>
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
    .stats-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
    .stat-card.regions .stat-value {
      color: var(--vscode-charts-purple);
    }
    .stat-card.messages .stat-value {
      color: var(--vscode-charts-green);
    }
    .stat-card.inflight .stat-value {
      color: var(--vscode-charts-orange);
    }
    .stat-card.active .stat-value {
      color: var(--vscode-charts-red);
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
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
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .search-box {
      margin-bottom: 20px;
    }
    .search-box input {
      width: 100%;
      padding: 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 14px;
    }
    .search-box input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: var(--vscode-editor-background);
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }
    thead {
      background: var(--vscode-editor-background);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      color: var(--vscode-foreground);
      border-bottom: 2px solid var(--vscode-panel-border);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
    }
    th:hover {
      background: var(--vscode-list-hoverBackground);
    }
    th .sort-indicator {
      margin-left: 5px;
      font-size: 10px;
      opacity: 0.5;
    }
    td {
      padding: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 13px;
    }
    tr:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .queue-name {
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
    }
    .region-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: var(--vscode-charts-purple);
      color: white;
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
    .metric-value {
      font-weight: 600;
      font-size: 14px;
    }
    .metric-value.high {
      color: var(--vscode-charts-red);
    }
    .metric-value.medium {
      color: var(--vscode-charts-orange);
    }
    .metric-value.low {
      color: var(--vscode-charts-green);
    }
    .action-btn {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .action-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .no-results {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span>🌍</span>
      AnypointMQ Statistics - All Regions
    </h1>
    <div class="header-info">
      <div class="info-item">
        <span class="info-label">Environment</span>
        <span class="info-value">${environmentName || 'Unknown'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Regions</span>
        <span class="info-value">${totalRegions}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Last Updated</span>
        <span class="info-value">${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  </div>

  <div class="stats-summary">
    <div class="stat-card regions">
      <div class="stat-label">Total Regions</div>
      <div class="stat-value">${totalRegions}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Queues</div>
      <div class="stat-value">${totalQueues}</div>
    </div>
    <div class="stat-card messages">
      <div class="stat-label">Total Messages</div>
      <div class="stat-value">${totalMessages.toLocaleString()}</div>
    </div>
    <div class="stat-card inflight">
      <div class="stat-label">In-Flight Messages</div>
      <div class="stat-value">${totalInflight.toLocaleString()}</div>
    </div>
    <div class="stat-card active">
      <div class="stat-label">Active Queues</div>
      <div class="stat-value">${activeQueues}</div>
    </div>
  </div>

  <div class="actions">
    <button onclick="refreshStats()">🔄 Refresh Statistics</button>
    <button class="secondary" onclick="downloadCsv()">💾 Download CSV</button>
  </div>

  <div class="search-box">
    <input type="text" id="searchInput" placeholder="🔍 Search queues by name or region..." onkeyup="filterQueues()">
  </div>

  <table id="queuesTable">
    <thead>
      <tr>
        <th onclick="sortTable(0)">Region <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(1)">Destination Name <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(2)">Destination Type <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(3)">Queue Type <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(4)">Messages <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(5)">In-Flight <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(6)">Default TTL <span class="sort-indicator">▼</span></th>
        <th onclick="sortTable(7)">Encrypted <span class="sort-indicator">▼</span></th>
        <th>Actions <span class="sort-indicator"></span></th>
      </tr>
    </thead>
    <tbody id="queuesTableBody">
      ${allQueues.map(queue => {
        // Extract ID - could be queueId, exchangeId, or just id
        const destinationId = queue.queueId || queue.exchangeId || queue.id;

        // Determine type - check destinationType first, then exchangeId, default to queue
        const destinationType = queue.destinationType || (queue.exchangeId ? 'exchange' : 'queue');

        const queueType = queue.fifo ? 'FIFO' : 'Standard';
        const messages = queue.stats.messages || 0;
        const inflight = queue.stats.inflightMessages || 0;

        let messageClass = 'low';
        if (messages > 1000) {
          messageClass = 'high';
        } else if (messages > 100) {
          messageClass = 'medium';
        }

        const isExchange = destinationType === 'exchange';

        return `
        <tr>
          <td><span class="region-badge">${queue.region}</span></td>
          <td><span class="queue-name">${destinationId}</span></td>
          <td><span class="badge ${isExchange ? 'exchange' : 'queue'}">${isExchange ? '🔀 Exchange' : '📋 Queue'}</span></td>
          <td><span class="badge ${queue.fifo ? 'fifo' : 'standard'}">${isExchange ? 'N/A' : queueType}</span></td>
          <td><span class="metric-value ${messageClass}">${messages.toLocaleString()}</span></td>
          <td><span class="metric-value">${inflight.toLocaleString()}</span></td>
          <td>${queue.defaultTtl ? (queue.defaultTtl / 1000 / 60).toFixed(0) + ' min' : 'N/A'}</td>
          <td>${queue.encrypted ? '🔒 Yes' : '🔓 No'}</td>
          <td><button class="action-btn" onclick="openQueueDetails('${destinationId}', '${queue.regionId}', '${queue.region}', ${isExchange})">📋 View Details</button></td>
        </tr>
        `;
      }).join('')}
    </tbody>
  </table>
  <div id="noResults" class="no-results" style="display: none;">
    No queues match your search criteria.
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let sortDirection = {};

    const organizationID = '${organizationID || ''}';
    const environmentId = '${environmentId || ''}';

    function refreshStats() {
      vscode.postMessage({ command: 'refreshStats' });
    }

    function downloadCsv() {
      vscode.postMessage({ command: 'downloadCsv' });
    }

    function openQueueDetails(queueId, regionId, regionName, isExchange) {
      vscode.postMessage({
        command: 'viewQueueDetails',
        queueId: queueId,
        regionId: regionId,
        regionName: regionName,
        isExchange: isExchange || false
      });
    }

    function filterQueues() {
      const input = document.getElementById('searchInput');
      const filter = input.value.toLowerCase();
      const table = document.getElementById('queuesTable');
      const tbody = document.getElementById('queuesTableBody');
      const noResults = document.getElementById('noResults');

      if (!tbody) {
        return;
      }

      const rows = tbody.getElementsByTagName('tr');
      let visibleCount = 0;

      for (let i = 0; i < rows.length; i++) {
        const region = rows[i].getElementsByTagName('td')[0];
        const queueName = rows[i].getElementsByTagName('td')[1];

        if (region && queueName) {
          const regionText = region.textContent || region.innerText;
          const queueText = queueName.textContent || queueName.innerText;
          const combinedText = (regionText + ' ' + queueText).toLowerCase();

          if (combinedText.indexOf(filter) > -1) {
            rows[i].style.display = '';
            visibleCount++;
          } else {
            rows[i].style.display = 'none';
          }
        }
      }

      if (table && noResults) {
        if (visibleCount === 0 && filter !== '') {
          table.style.display = 'none';
          noResults.style.display = 'block';
        } else {
          table.style.display = 'table';
          noResults.style.display = 'none';
        }
      }
    }

    function sortTable(columnIndex) {
      const table = document.getElementById('queuesTable');
      if (!table) {
        return;
      }

      const tbody = table.getElementsByTagName('tbody')[0];
      const rows = Array.from(tbody.getElementsByTagName('tr'));

      const currentDirection = sortDirection[columnIndex] || 'asc';
      const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
      sortDirection = { [columnIndex]: newDirection };

      rows.sort((a, b) => {
        const aCell = a.getElementsByTagName('td')[columnIndex];
        const bCell = b.getElementsByTagName('td')[columnIndex];

        let aValue = aCell.textContent || aCell.innerText;
        let bValue = bCell.textContent || bCell.innerText;

        // Handle numeric columns (Messages and In-Flight)
        if (columnIndex === 3 || columnIndex === 4) {
          aValue = parseInt(aValue.replace(/,/g, '')) || 0;
          bValue = parseInt(bValue.replace(/,/g, '')) || 0;
        }

        if (aValue < bValue) {
          return newDirection === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return newDirection === 'asc' ? 1 : -1;
        }
        return 0;
      });

      rows.forEach(row => tbody.appendChild(row));

      // Update sort indicators
      const headers = table.getElementsByTagName('th');
      for (let i = 0; i < headers.length; i++) {
        const indicator = headers[i].querySelector('.sort-indicator');
        if (indicator) {
          if (i === columnIndex) {
            indicator.textContent = newDirection === 'asc' ? '▲' : '▼';
            indicator.style.opacity = '1';
          } else {
            indicator.textContent = '▼';
            indicator.style.opacity = '0.5';
          }
        }
      }
    }
  </script>
</body>
</html>
  `;
}
