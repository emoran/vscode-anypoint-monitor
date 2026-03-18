import * as vscode from 'vscode';
import { CostRecommendation, FleetCostSummary, TimeWindow } from './types';

export function showCostOptimizerPanel(
    context: vscode.ExtensionContext,
    recommendations: CostRecommendation[],
    summary: FleetCostSummary,
    environmentName: string,
    timeWindow: TimeWindow
): void {
    const panel = vscode.window.createWebviewPanel(
        'costOptimizer',
        `Cost Optimizer - ${environmentName}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getCostOptimizerHtml(recommendations, summary, environmentName, timeWindow);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'exportCsv':
                await exportCsv(recommendations, summary);
                break;
            case 'exportMarkdown':
                await exportMarkdown(recommendations, summary, environmentName, timeWindow);
                break;
        }
    });
}

async function exportCsv(recommendations: CostRecommendation[], summary: FleetCostSummary): Promise<void> {
    const rows = ['App Name,Type,Status,Current Allocation,Recommended Allocation,Current Monthly Cost,Recommended Monthly Cost,Monthly Savings,Annual Savings,CPU P95,Memory P95,Reasoning'];
    for (const r of recommendations) {
        const currentAlloc = r.currentAllocation.workerType
            ? `${r.currentAllocation.workers}x ${r.currentAllocation.workerType}`
            : `${r.currentAllocation.replicas || 1}x (${r.currentAllocation.cpuReserved} CPU / ${r.currentAllocation.memoryReserved} GB)`;
        const recAlloc = r.recommendedAllocation.workerType
            ? `${r.recommendedAllocation.workers}x ${r.recommendedAllocation.workerType}`
            : `${r.recommendedAllocation.replicas || 1}x (${r.recommendedAllocation.cpuReserved} CPU / ${r.recommendedAllocation.memoryReserved} GB)`;
        rows.push(`"${r.appName}","${r.appType}","${r.status}","${currentAlloc}","${recAlloc}",${r.currentMonthlyCost},${r.recommendedMonthlyCost},${r.monthlySavings},${r.annualSavings},${r.cpuStats.p95.toFixed(1)},${r.memoryStats.p95.toFixed(1)},"${r.reasoning.replace(/"/g, '""')}"`);
    }

    const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Cost Report CSV'
    });
    if (uri) {
        const fs = await import('fs');
        await fs.promises.writeFile(uri.fsPath, rows.join('\n'), 'utf-8');
        vscode.window.showInformationMessage(`Cost report exported to ${uri.fsPath}`);
    }
}

async function exportMarkdown(
    recommendations: CostRecommendation[],
    summary: FleetCostSummary,
    envName: string,
    timeWindow: TimeWindow
): Promise<void> {
    let md = `# Cost Optimization Report\n\n`;
    md += `**Environment:** ${envName}  \n`;
    md += `**Analysis Window:** ${timeWindow === '7d' ? '7 days' : '30 days'}  \n`;
    md += `**Generated:** ${new Date().toISOString()}  \n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Apps Analyzed | ${summary.totalAppsAnalyzed} |\n`;
    md += `| Over-Provisioned | ${summary.overProvisioned} |\n`;
    md += `| Under-Provisioned | ${summary.underProvisioned} |\n`;
    md += `| Right-Sized | ${summary.rightSized} |\n`;
    md += `| Current Monthly Spend | $${summary.currentMonthlySpend.toFixed(2)} |\n`;
    md += `| Optimized Monthly Spend | $${summary.optimizedMonthlySpend.toFixed(2)} |\n`;
    md += `| **Potential Monthly Savings** | **$${summary.potentialMonthlySavings.toFixed(2)}** |\n`;
    md += `| **Potential Annual Savings** | **$${summary.potentialAnnualSavings.toFixed(2)}** |\n\n`;

    md += `## Recommendations\n\n`;
    md += `| App | Type | Status | Monthly Savings | Reasoning |\n|-----|------|--------|----------------|----------|\n`;
    for (const r of recommendations) {
        md += `| ${r.appName} | ${r.appType} | ${r.status} | $${r.monthlySavings.toFixed(2)} | ${r.reasoning} |\n`;
    }

    const uri = await vscode.window.showSaveDialog({
        filters: { 'Markdown Files': ['md'] },
        saveLabel: 'Save Cost Report'
    });
    if (uri) {
        const fs = await import('fs');
        await fs.promises.writeFile(uri.fsPath, md, 'utf-8');
        vscode.window.showInformationMessage(`Cost report exported to ${uri.fsPath}`);
    }
}

function formatCurrency(val: number): string {
    return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getCostOptimizerHtml(
    recommendations: CostRecommendation[],
    summary: FleetCostSummary,
    environmentName: string,
    timeWindow: TimeWindow
): string {
    const recsJson = JSON.stringify(recommendations);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Cost Optimizer - ${environmentName}</title>
<style>
:root {
    --bg: #1e1e1e; --surface: #252526; --surface2: #2d2d30;
    --border: #3e3e42; --text: #cccccc; --text-muted: #888;
    --red: #f44747; --yellow: #cca700; --green: #4ec9b0;
    --blue: #569cd6; --orange: #ce9178;
    --radius: 6px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 20px; }

.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.header h1 { font-size: 22px; font-weight: 600; }
.header-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.header-actions { display: flex; gap: 8px; }
.btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); color: var(--text); cursor: pointer; font-size: 13px; }
.btn:hover { background: var(--border); }

.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; text-align: center; }
.card-value { font-size: 28px; font-weight: 700; }
.card-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; }
.card-value.savings { color: var(--green); }
.card-value.warning { color: var(--yellow); }
.card-value.danger { color: var(--red); }
.card-value.neutral { color: var(--blue); }

.score-ring { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.score-ring svg { transform: rotate(-90deg); }
.score-ring .score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 20px; font-weight: 700; }

.filter-bar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.filter-bar select, .filter-bar input { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 5px 8px; font-size: 12px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; cursor: pointer; user-select: none; }
th:hover { color: var(--text); }
td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
tr:hover { background: var(--surface); }

.status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.status-badge.over-provisioned { background: rgba(244,71,71,0.15); color: var(--red); }
.status-badge.under-provisioned { background: rgba(204,167,0,0.15); color: var(--yellow); }
.status-badge.right-sized { background: rgba(78,201,176,0.15); color: var(--green); }

.savings-positive { color: var(--green); font-weight: 600; }
.savings-negative { color: var(--red); font-weight: 600; }
.savings-zero { color: var(--text-muted); }

.detail-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-top: 16px; display: none; }
.detail-panel.visible { display: block; }
.detail-panel h3 { font-size: 15px; margin-bottom: 12px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.detail-col h4 { font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
.detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.detail-row .label { color: var(--text-muted); }
.arrow { color: var(--blue); font-size: 18px; text-align: center; padding: 20px 0; }

.whatif-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.whatif-section h4 { font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
.whatif-result { font-size: 14px; padding: 8px 12px; background: var(--surface2); border-radius: 4px; }
</style>
</head>
<body>
<div class="header">
    <div>
        <h1>Cost Optimizer</h1>
        <div class="header-sub">${environmentName} &middot; ${timeWindow === '7d' ? '7-day' : '30-day'} analysis &middot; ${new Date().toLocaleDateString()}</div>
    </div>
    <div class="header-actions">
        <button class="btn" onclick="exportCsv()">Export CSV</button>
        <button class="btn" onclick="exportMarkdown()">Export Report</button>
    </div>
</div>

<div class="summary-cards">
    <div class="card">
        <div class="card-value neutral">${summary.totalAppsAnalyzed}</div>
        <div class="card-label">Apps Analyzed</div>
    </div>
    <div class="card">
        <div class="card-value">${formatCurrency(summary.currentMonthlySpend)}</div>
        <div class="card-label">Current Monthly</div>
    </div>
    <div class="card">
        <div class="card-value">${formatCurrency(summary.optimizedMonthlySpend)}</div>
        <div class="card-label">Optimized Monthly</div>
    </div>
    <div class="card">
        <div class="card-value savings">${formatCurrency(summary.potentialMonthlySavings)}</div>
        <div class="card-label">Monthly Savings</div>
    </div>
    <div class="card">
        <div class="card-value savings">${formatCurrency(summary.potentialAnnualSavings)}</div>
        <div class="card-label">Annual Savings</div>
    </div>
    <div class="card">
        <div class="score-ring">
            <svg width="80" height="80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface2)" stroke-width="6"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="${summary.optimizationScore >= 80 ? 'var(--green)' : summary.optimizationScore >= 50 ? 'var(--yellow)' : 'var(--red)'}" stroke-width="6" stroke-dasharray="${summary.optimizationScore * 2.136} 213.6" stroke-linecap="round"/>
            </svg>
            <div class="score-text">${summary.optimizationScore}</div>
        </div>
        <div class="card-label">Optimization Score</div>
    </div>
    <div class="card">
        <div class="card-value danger">${summary.overProvisioned}</div>
        <div class="card-label">Over-Provisioned</div>
    </div>
    <div class="card">
        <div class="card-value warning">${summary.underProvisioned}</div>
        <div class="card-label">Under-Provisioned</div>
    </div>
</div>

<div class="filter-bar">
    <select id="statusFilter" onchange="filterTable()">
        <option value="all">All Statuses</option>
        <option value="over-provisioned">Over-Provisioned</option>
        <option value="under-provisioned">Under-Provisioned</option>
        <option value="right-sized">Right-Sized</option>
    </select>
    <select id="typeFilter" onchange="filterTable()">
        <option value="all">All Types</option>
        <option value="CH1">CH1</option>
        <option value="CH2">CH2</option>
    </select>
    <input type="text" id="searchInput" placeholder="Search apps..." oninput="filterTable()" style="flex:1"/>
</div>

<div id="tableContainer"></div>
<div class="detail-panel" id="detailPanel"></div>

<script>
const vscode = acquireVsCodeApi();
const allRecs = ${recsJson};
let sortCol = 'monthlySavings';
let sortDir = -1;
let selectedApp = null;

function formatCurrency(val) {
    return '$' + val.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
}

function formatAlloc(a) {
    if (a.workerType) return a.workers + 'x ' + a.workerType;
    return (a.replicas || 1) + 'x (' + (a.cpuReserved || 0.5) + ' CPU, ' + (a.memoryReserved || 1) + ' GB)';
}

function filterTable() {
    const status = document.getElementById('statusFilter').value;
    const type = document.getElementById('typeFilter').value;
    const search = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allRecs;
    if (status !== 'all') filtered = filtered.filter(r => r.status === status);
    if (type !== 'all') filtered = filtered.filter(r => r.appType === type);
    if (search) filtered = filtered.filter(r => r.appName.toLowerCase().includes(search));

    filtered.sort((a, b) => {
        let va = a[sortCol], vb = b[sortCol];
        if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
        return ((va || 0) - (vb || 0)) * sortDir;
    });

    renderTable(filtered);
}

function sortTable(col) {
    if (sortCol === col) sortDir *= -1;
    else { sortCol = col; sortDir = -1; }
    filterTable();
}

function renderTable(recs) {
    const arrow = sortDir === 1 ? ' &#9650;' : ' &#9660;';
    let html = '<table><thead><tr>';
    html += '<th onclick="sortTable(\\'appName\\')">App' + (sortCol === 'appName' ? arrow : '') + '</th>';
    html += '<th onclick="sortTable(\\'appType\\')">Type' + (sortCol === 'appType' ? arrow : '') + '</th>';
    html += '<th onclick="sortTable(\\'status\\')">Status' + (sortCol === 'status' ? arrow : '') + '</th>';
    html += '<th>Current</th>';
    html += '<th>Recommended</th>';
    html += '<th onclick="sortTable(\\'cpuStats\\')">CPU P95' + (sortCol === 'cpuStats' ? arrow : '') + '</th>';
    html += '<th onclick="sortTable(\\'memoryStats\\')">Mem P95' + (sortCol === 'memoryStats' ? arrow : '') + '</th>';
    html += '<th onclick="sortTable(\\'currentMonthlyCost\\')">Current Cost' + (sortCol === 'currentMonthlyCost' ? arrow : '') + '</th>';
    html += '<th onclick="sortTable(\\'monthlySavings\\')">Savings/mo' + (sortCol === 'monthlySavings' ? arrow : '') + '</th>';
    html += '</tr></thead><tbody>';

    for (const r of recs) {
        const savingsClass = r.monthlySavings > 0 ? 'savings-positive' : r.monthlySavings < 0 ? 'savings-negative' : 'savings-zero';
        html += '<tr onclick="showDetail(\\'' + r.appName + '\\')" style="cursor:pointer">';
        html += '<td><strong>' + r.appName + '</strong></td>';
        html += '<td>' + r.appType + '</td>';
        html += '<td><span class="status-badge ' + r.status + '">' + r.status.replace('-', ' ') + '</span></td>';
        html += '<td style="font-size:12px">' + formatAlloc(r.currentAllocation) + '</td>';
        html += '<td style="font-size:12px">' + formatAlloc(r.recommendedAllocation) + '</td>';
        html += '<td>' + r.cpuStats.p95.toFixed(1) + '%</td>';
        html += '<td>' + r.memoryStats.p95.toFixed(1) + '%</td>';
        html += '<td>' + formatCurrency(r.currentMonthlyCost) + '</td>';
        html += '<td class="' + savingsClass + '">' + (r.monthlySavings > 0 ? '+' : '') + formatCurrency(r.monthlySavings) + '</td>';
        html += '</tr>';
    }

    html += '</tbody></table>';
    document.getElementById('tableContainer').innerHTML = html;
}

function showDetail(appName) {
    const r = allRecs.find(x => x.appName === appName);
    if (!r) return;
    selectedApp = r;

    const panel = document.getElementById('detailPanel');
    panel.classList.add('visible');

    let html = '<h3>' + r.appName + ' - Optimization Detail</h3>';
    html += '<div class="detail-grid">';

    html += '<div class="detail-col">';
    html += '<h4>Current Allocation</h4>';
    html += '<div class="detail-row"><span class="label">Configuration</span><span>' + formatAlloc(r.currentAllocation) + '</span></div>';
    html += '<div class="detail-row"><span class="label">Monthly Cost</span><span>' + formatCurrency(r.currentMonthlyCost) + '</span></div>';
    html += '<div class="detail-row"><span class="label">CPU P50 / P95 / P99</span><span>' + r.cpuStats.p50.toFixed(1) + '% / ' + r.cpuStats.p95.toFixed(1) + '% / ' + r.cpuStats.p99.toFixed(1) + '%</span></div>';
    html += '<div class="detail-row"><span class="label">Memory P50 / P95 / P99</span><span>' + r.memoryStats.p50.toFixed(1) + '% / ' + r.memoryStats.p95.toFixed(1) + '% / ' + r.memoryStats.p99.toFixed(1) + '%</span></div>';
    html += '</div>';

    html += '<div class="detail-col">';
    html += '<h4>Recommended Allocation</h4>';
    html += '<div class="detail-row"><span class="label">Configuration</span><span>' + formatAlloc(r.recommendedAllocation) + '</span></div>';
    html += '<div class="detail-row"><span class="label">Monthly Cost</span><span>' + formatCurrency(r.recommendedMonthlyCost) + '</span></div>';
    html += '<div class="detail-row"><span class="label">Monthly Savings</span><span class="' + (r.monthlySavings > 0 ? 'savings-positive' : 'savings-negative') + '">' + formatCurrency(r.monthlySavings) + '</span></div>';
    html += '<div class="detail-row"><span class="label">Annual Savings</span><span class="' + (r.annualSavings > 0 ? 'savings-positive' : 'savings-negative') + '">' + formatCurrency(r.annualSavings) + '</span></div>';
    html += '</div>';

    html += '</div>';

    html += '<div style="margin-top:12px;padding:10px;background:var(--surface2);border-radius:4px;font-size:13px">';
    html += '<strong>Analysis:</strong> ' + r.reasoning;
    html += '</div>';

    panel.innerHTML = html;
}

function exportCsv() { vscode.postMessage({ command: 'exportCsv' }); }
function exportMarkdown() { vscode.postMessage({ command: 'exportMarkdown' }); }

filterTable();
</script>
</body>
</html>`;
}
