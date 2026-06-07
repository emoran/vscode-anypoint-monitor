import * as vscode from 'vscode';
import * as fs from 'fs';
import { showQueueDetailsWebview } from './mqQueueDetails.js';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    badge,
    summaryCard,
    button,
    emptyState,
    escapeHtml
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

function mqStatsExtraStyles(): string {
    return `
        .mq-header-meta {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            margin-top: 8px;
        }
        .mq-header-meta > div {
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
            align-items: center;
        }
        .mq-actions .am-input {
            flex: 1;
            min-width: 200px;
        }
        .mq-queue-name {
            font-weight: 600;
            color: var(--am-text-link);
        }
        .mq-metric { font-weight: 600; font-size: 14px; }
        .mq-metric-high { color: var(--am-error); }
        .mq-metric-medium { color: var(--am-warning); }
        .mq-metric-low { color: var(--am-success); }
        .mq-stats-table-wrap.am-table-container {
            margin-top: 16px;
            overflow-x: auto;
        }
        .mq-table-actions .am-btn {
            padding: 6px 12px;
            font-size: 12px;
        }
        .mq-no-results {
            text-align: center;
            padding: 40px;
            color: var(--am-text-muted);
            font-style: italic;
            display: none;
        }
    `;
}

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
  _webview?: vscode.Webview,
  _extensionUri?: vscode.Uri,
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

  const updatedAt = new Date().toLocaleTimeString();

  const tableBody = enrichedQueues.length > 0 ? `
  <div class="am-table-container mq-stats-table-wrap">
  <table class="am-table" id="queuesTable">
    <thead>
      <tr>
        <th class="am-sortable" onclick="sortTable(0)">Destination Name <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(1)">Destination Type <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(2)">Queue Type <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(3)">Messages <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(4)">In-Flight <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(5)">Default TTL <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(6)">Default Lock TTL <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(7)">Encrypted <span class="am-sort-icon">▼</span></th>
        <th>Actions <span class="am-sort-icon"></span></th>
      </tr>
    </thead>
    <tbody id="queuesTableBody">
      ${enrichedQueues.map(queue => {
        const destinationId = queue.queueId || queue.exchangeId || queue.id;
        const destinationType = queue.destinationType || (queue.exchangeId ? 'exchange' : 'queue');
        const messages = queue.stats.messages || 0;
        const inflight = queue.stats.inflightMessages || 0;

        let messageMetricClass = 'mq-metric-low';
        if (messages > 1000) {
          messageMetricClass = 'mq-metric-high';
        } else if (messages > 100) {
          messageMetricClass = 'mq-metric-medium';
        }

        const isExchange = destinationType === 'exchange';
        const destBadge = isExchange
          ? badge('🔀 Exchange', 'info')
          : badge('📋 Queue', 'default');
        const typeBadge = isExchange
          ? badge('N/A', 'default')
          : (queue.fifo ? badge('FIFO', 'info') : badge('Standard', 'default'));

        const rowOnclick = `openQueueDetails('${escapeJsString(String(destinationId))}', '${escapeJsString(String(region))}', ${isExchange})`;

        return `
        <tr class="am-row">
          <td><span class="mq-queue-name">${escapeHtml(String(destinationId))}</span></td>
          <td>${destBadge}</td>
          <td>${typeBadge}</td>
          <td><span class="mq-metric ${messageMetricClass}">${messages.toLocaleString()}</span></td>
          <td><span class="mq-metric">${inflight.toLocaleString()}</span></td>
          <td>${queue.defaultTtl ? (queue.defaultTtl / 1000 / 60).toFixed(0) + ' min' : 'N/A'}</td>
          <td>${queue.defaultLockTtl ? (queue.defaultLockTtl / 1000).toFixed(0) + ' sec' : 'N/A'}</td>
          <td>${queue.encrypted ? '🔒 Yes' : '🔓 No'}</td>
          <td class="mq-table-actions">${button('View Details', { variant: 'secondary', onclick: rowOnclick, icon: '📋' })}</td>
        </tr>
        `;
      }).join('')}
    </tbody>
  </table>
  </div>
  <div id="noResults" class="mq-no-results">
    No queues match your search criteria.
  </div>
  ` : emptyState({
    icon: '📭',
    title: 'No Queues Found',
    description: 'There are no AnypointMQ queues in this region.'
  });

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>AnypointMQ Statistics</h1>
          <div class="am-page-header-meta mq-header-meta">
            <div>
              <span class="mq-meta-label">Environment</span>
              <span class="mq-meta-value">${escapeHtml(environmentName || 'Unknown')}</span>
            </div>
            <div>
              <span class="mq-meta-label">Region</span>
              <span class="mq-meta-value">${escapeHtml(regionName)}</span>
            </div>
            <div>
              <span class="mq-meta-label">Last Updated</span>
              <span class="mq-meta-value">${escapeHtml(updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '📋', value: totalQueues, label: 'Total Queues', animationDelay: '0.05s' })}
        ${summaryCard({ icon: '💬', value: totalMessages.toLocaleString(), label: 'Total Messages', animationDelay: '0.1s', variant: 'healthy' })}
        ${summaryCard({ icon: '✈️', value: totalInflight.toLocaleString(), label: 'In-Flight Messages', animationDelay: '0.15s', variant: 'warning' })}
        ${summaryCard({ icon: '●', value: activeQueues, label: 'Active Queues', animationDelay: '0.2s' })}
      </div>

      ${enrichedQueues.length > 0 ? `
      <div class="am-filters mq-actions">
        ${button('Refresh Statistics', { variant: 'primary', onclick: 'refreshStats()', icon: '🔄' })}
        ${button('Download CSV', { variant: 'secondary', onclick: 'downloadCsv()', icon: '💾' })}
        <input type="text" class="am-input" id="searchInput" placeholder="Search queues by name..." onkeyup="filterQueues()">
      </div>
      ` : `
      <div class="am-filters mq-actions">
        ${button('Refresh Statistics', { variant: 'primary', onclick: 'refreshStats()', icon: '🔄' })}
        ${button('Download CSV', { variant: 'secondary', onclick: 'downloadCsv()', icon: '💾' })}
      </div>
      `}

      ${tableBody}
    </div>
  `;

  const scripts = `
    const vscode = acquireVsCodeApi();
    let sortDirection = {};

    const organizationID = '${escapeJsString(organizationID || '')}';
    const environmentId = '${escapeJsString(environmentId || '')}';
    const regionName = '${escapeJsString(regionName)}';

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

        if (columnIndex === 3 || columnIndex === 4) {
          aValue = parseInt(String(aValue).replace(/,/g, ''), 10) || 0;
          bValue = parseInt(String(bValue).replace(/,/g, ''), 10) || 0;
        }

        if (aValue < bValue) return newDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return newDirection === 'asc' ? 1 : -1;
        return 0;
      });

      rows.forEach(row => tbody.appendChild(row));

      const headers = table.getElementsByTagName('th');
      for (let i = 0; i < headers.length; i++) {
        const indicator = headers[i].querySelector('.am-sort-icon');
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
  `;

  return wrapWebviewHtml({
    title: 'AnypointMQ Statistics',
    body,
    scripts,
    extraStyles: mqStatsExtraStyles()
  });
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
  _webview?: vscode.Webview,
  _extensionUri?: vscode.Uri,
  organizationID?: string,
  environmentId?: string
): string {
  // Aggregate all queues from all regions
  const allQueues: any[] = [];

  regionsData.forEach(regionData => {
    const { regionName, regionId, queues, stats } = regionData;

    queues.forEach((queue: any) => {
      const destinationId = queue.queueId || queue.exchangeId || queue.id;

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

  const totalQueues = allQueues.length;
  const totalMessages = allQueues.reduce((sum, q) => sum + (q.stats.messages || 0), 0);
  const totalInflight = allQueues.reduce((sum, q) => sum + (q.stats.inflightMessages || 0), 0);
  const activeQueues = allQueues.filter(q => (q.stats.messages || 0) > 0).length;
  const totalRegions = regionsData.length;

  const updatedAt = new Date().toLocaleTimeString();

  const tableHtml = `
  <div class="am-table-container mq-stats-table-wrap">
  <table class="am-table" id="queuesTable">
    <thead>
      <tr>
        <th class="am-sortable" onclick="sortTable(0)">Region <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(1)">Destination Name <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(2)">Destination Type <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(3)">Queue Type <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(4)">Messages <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(5)">In-Flight <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(6)">Default TTL <span class="am-sort-icon">▼</span></th>
        <th class="am-sortable" onclick="sortTable(7)">Encrypted <span class="am-sort-icon">▼</span></th>
        <th>Actions <span class="am-sort-icon"></span></th>
      </tr>
    </thead>
    <tbody id="queuesTableBody">
      ${allQueues.map(queue => {
        const destinationId = queue.queueId || queue.exchangeId || queue.id;
        const destinationType = queue.destinationType || (queue.exchangeId ? 'exchange' : 'queue');
        const messages = queue.stats.messages || 0;
        const inflight = queue.stats.inflightMessages || 0;

        let messageMetricClass = 'mq-metric-low';
        if (messages > 1000) {
          messageMetricClass = 'mq-metric-high';
        } else if (messages > 100) {
          messageMetricClass = 'mq-metric-medium';
        }

        const isExchange = destinationType === 'exchange';
        const destBadge = isExchange
          ? badge('🔀 Exchange', 'info')
          : badge('📋 Queue', 'default');
        const typeBadge = isExchange
          ? badge('N/A', 'default')
          : (queue.fifo ? badge('FIFO', 'info') : badge('Standard', 'default'));

        const rowOnclick = `openQueueDetails('${escapeJsString(String(destinationId))}', '${escapeJsString(String(queue.regionId))}', '${escapeJsString(String(queue.region))}', ${isExchange ? 'true' : 'false'})`;

        return `
        <tr class="am-row">
          <td>${badge(String(queue.region), 'info')}</td>
          <td><span class="mq-queue-name">${escapeHtml(String(destinationId))}</span></td>
          <td>${destBadge}</td>
          <td>${typeBadge}</td>
          <td><span class="mq-metric ${messageMetricClass}">${messages.toLocaleString()}</span></td>
          <td><span class="mq-metric">${inflight.toLocaleString()}</span></td>
          <td>${queue.defaultTtl ? (queue.defaultTtl / 1000 / 60).toFixed(0) + ' min' : 'N/A'}</td>
          <td>${queue.encrypted ? '🔒 Yes' : '🔓 No'}</td>
          <td class="mq-table-actions">${button('View Details', { variant: 'secondary', onclick: rowOnclick, icon: '📋' })}</td>
        </tr>
        `;
      }).join('')}
    </tbody>
  </table>
  </div>
  <div id="noResults" class="mq-no-results">
    No queues match your search criteria.
  </div>
  `;

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>AnypointMQ Statistics · All Regions</h1>
          <div class="am-page-header-meta mq-header-meta">
            <div>
              <span class="mq-meta-label">Environment</span>
              <span class="mq-meta-value">${escapeHtml(environmentName || 'Unknown')}</span>
            </div>
            <div>
              <span class="mq-meta-label">Regions</span>
              <span class="mq-meta-value">${escapeHtml(String(totalRegions))}</span>
            </div>
            <div>
              <span class="mq-meta-label">Last Updated</span>
              <span class="mq-meta-value">${escapeHtml(updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '🌍', value: totalRegions, label: 'Total Regions', animationDelay: '0.05s' })}
        ${summaryCard({ icon: '📋', value: totalQueues, label: 'Total Queues', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '💬', value: totalMessages.toLocaleString(), label: 'Total Messages', animationDelay: '0.15s', variant: 'healthy' })}
        ${summaryCard({ icon: '✈️', value: totalInflight.toLocaleString(), label: 'In-Flight Messages', animationDelay: '0.2s', variant: 'warning' })}
        ${summaryCard({ icon: '●', value: activeQueues, label: 'Active Queues', animationDelay: '0.25s', variant: 'critical' })}
      </div>

      <div class="am-filters mq-actions">
        ${button('Refresh Statistics', { variant: 'primary', onclick: 'refreshStats()', icon: '🔄' })}
        ${button('Download CSV', { variant: 'secondary', onclick: 'downloadCsv()', icon: '💾' })}
        <input type="text" class="am-input" id="searchInput" placeholder="Search queues by name or region..." onkeyup="filterQueues()">
      </div>

      ${tableHtml}
    </div>
  `;

  const scripts = `
    const vscode = acquireVsCodeApi();
    let sortDirection = {};

    const organizationID = '${escapeJsString(organizationID || '')}';
    const environmentId = '${escapeJsString(environmentId || '')}';

    function refreshStats() {
      vscode.postMessage({ command: 'refreshStats' });
    }

    function downloadCsv() {
      vscode.postMessage({ command: 'downloadCsv' });
    }

    function openQueueDetails(queueId, regionId, regionNameParam, isExchange) {
      vscode.postMessage({
        command: 'viewQueueDetails',
        queueId: queueId,
        regionId: regionId,
        regionName: regionNameParam,
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

        if (columnIndex === 4 || columnIndex === 5) {
          aValue = parseInt(String(aValue).replace(/,/g, ''), 10) || 0;
          bValue = parseInt(String(bValue).replace(/,/g, ''), 10) || 0;
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

      const headers = table.getElementsByTagName('th');
      for (let i = 0; i < headers.length; i++) {
        const indicator = headers[i].querySelector('.am-sort-icon');
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
  `;

  return wrapWebviewHtml({
    title: 'AnypointMQ Statistics - All Regions',
    body,
    scripts,
    extraStyles: mqStatsExtraStyles()
  });
}
