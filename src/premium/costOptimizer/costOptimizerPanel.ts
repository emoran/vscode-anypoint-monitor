import * as vscode from 'vscode';
import { CostRecommendation, FleetCostSummary, TimeWindow } from './types';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    escapeHtml as uiEscapeHtml,
    escapeAttr
} from '../../webview/ui-kit';

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

async function exportCsv(recommendations: CostRecommendation[], _summary: FleetCostSummary): Promise<void> {
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

function fmtCurrency(val: number): string {
    return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getCostOptimizerHtml(
    recommendations: CostRecommendation[],
    summary: FleetCostSummary,
    environmentName: string,
    timeWindow: TimeWindow
): string {
    const recsJson = JSON.stringify(recommendations);

    const scoreColor = summary.optimizationScore >= 80 ? 'var(--am-success)' : summary.optimizationScore >= 50 ? 'var(--am-warning)' : 'var(--am-error)';

    const body = `
    <div class="am-container">
        <div class="am-page-header">
            <div>
                <h1>Cost Optimizer</h1>
                <div class="am-page-header-meta">
                    ${badge(uiEscapeHtml(environmentName), 'info', true)}
                    ${badge(timeWindow === '7d' ? '7-day analysis' : '30-day analysis', 'default', true)}
                    <span class="am-timestamp">${new Date().toLocaleDateString()}</span>
                </div>
            </div>
            <div class="am-page-header-right">
                ${button('Export CSV', { variant: 'ghost', onclick: 'exportCsv()' })}
                ${button('Export Report', { variant: 'primary', onclick: 'exportMarkdown()' })}
            </div>
        </div>

        <div class="am-summary-cards">
            ${summaryCard({ icon: '📊', value: summary.totalAppsAnalyzed, label: 'Apps Analyzed', animationDelay: '0.1s' })}
            ${summaryCard({ icon: '💰', value: fmtCurrency(summary.currentMonthlySpend), label: 'Current Monthly', animationDelay: '0.15s' })}
            ${summaryCard({ icon: '📉', value: fmtCurrency(summary.optimizedMonthlySpend), label: 'Optimized Monthly', animationDelay: '0.2s' })}
            ${summaryCard({ icon: '✅', value: fmtCurrency(summary.potentialMonthlySavings), label: 'Monthly Savings', variant: 'healthy', animationDelay: '0.25s' })}
            ${summaryCard({ icon: '📈', value: fmtCurrency(summary.potentialAnnualSavings), label: 'Annual Savings', variant: 'healthy', animationDelay: '0.3s' })}
            <div class="am-summary-card" style="animation-delay: 0.35s">
                <div class="co-score-ring">
                    <svg width="80" height="80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--am-bg-secondary)" stroke-width="6"/>
                        <circle cx="40" cy="40" r="34" fill="none" stroke="${scoreColor}" stroke-width="6" stroke-dasharray="${summary.optimizationScore * 2.136} 213.6" stroke-linecap="round" style="transform:rotate(-90deg);transform-origin:center"/>
                    </svg>
                    <div class="co-score-text" style="color:${scoreColor}">${summary.optimizationScore}</div>
                </div>
                <div class="am-card-label">Optimization Score</div>
            </div>
            ${summaryCard({ icon: '🔴', value: summary.overProvisioned, label: 'Over-Provisioned', variant: 'critical', animationDelay: '0.4s' })}
            ${summaryCard({ icon: '⚠️', value: summary.underProvisioned, label: 'Under-Provisioned', variant: 'warning', animationDelay: '0.45s' })}
        </div>

        <div class="am-filters">
            <select class="am-select" id="statusFilter" onchange="filterTable()">
                <option value="all">All Statuses</option>
                <option value="over-provisioned">Over-Provisioned</option>
                <option value="under-provisioned">Under-Provisioned</option>
                <option value="right-sized">Right-Sized</option>
            </select>
            <select class="am-select" id="typeFilter" onchange="filterTable()">
                <option value="all">All Types</option>
                <option value="CH1">CH1</option>
                <option value="CH2">CH2</option>
            </select>
            <input type="text" class="am-input" id="searchInput" placeholder="Search apps..." oninput="filterTable()"/>
        </div>

        <div id="tableContainer"></div>
        <div class="co-detail-panel" id="detailPanel"></div>
    </div>`;

    const scripts = `
    const vscode = acquireVsCodeApi();
    const allRecs = ${recsJson};
    let sortCol = 'monthlySavings';
    let sortDir = -1;
    let selectedApp = null;

    function fmtCurrency(val) {
        return '$' + val.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    }

    function formatAlloc(a) {
        if (a.workerType) return a.workers + 'x ' + a.workerType;
        return (a.replicas || 1) + 'x (' + (a.cpuReserved || 0.5) + ' CPU, ' + (a.memoryReserved || 1) + ' GB)';
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
        const arrow = sortDir === 1 ? ' \\u25b2' : ' \\u25bc';
        let html = '<div class="am-table-container"><table class="am-table"><thead><tr>';
        html += '<th class="am-sortable" onclick="sortTable(\\'appName\\')">App' + (sortCol === 'appName' ? arrow : '') + '</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'appType\\')">Type' + (sortCol === 'appType' ? arrow : '') + '</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'status\\')">Status' + (sortCol === 'status' ? arrow : '') + '</th>';
        html += '<th>Current</th><th>Recommended</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'cpuStats\\')">CPU P95</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'memoryStats\\')">Mem P95</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'currentMonthlyCost\\')">Current Cost</th>';
        html += '<th class="am-sortable" onclick="sortTable(\\'monthlySavings\\')">Savings/mo' + (sortCol === 'monthlySavings' ? arrow : '') + '</th>';
        html += '</tr></thead><tbody>';

        for (const r of recs) {
            const savingsClass = r.monthlySavings > 0 ? 'co-savings-positive' : r.monthlySavings < 0 ? 'co-savings-negative' : 'co-savings-zero';
            const statusVariant = r.status === 'over-provisioned' ? 'error' : r.status === 'under-provisioned' ? 'warning' : 'success';
            html += '<tr class="am-row" onclick="showDetail(\\'' + escHtml(r.appName) + '\\')" style="cursor:pointer">';
            html += '<td><strong>' + escHtml(r.appName) + '</strong></td>';
            html += '<td>' + escHtml(r.appType) + '</td>';
            html += '<td><span class="am-badge am-badge-pill am-badge-' + statusVariant + '">' + escHtml(r.status.replace(/-/g, ' ')) + '</span></td>';
            html += '<td style="font-size:12px">' + formatAlloc(r.currentAllocation) + '</td>';
            html += '<td style="font-size:12px">' + formatAlloc(r.recommendedAllocation) + '</td>';
            html += '<td>' + r.cpuStats.p95.toFixed(1) + '%</td>';
            html += '<td>' + r.memoryStats.p95.toFixed(1) + '%</td>';
            html += '<td>' + fmtCurrency(r.currentMonthlyCost) + '</td>';
            html += '<td class="' + savingsClass + '">' + (r.monthlySavings > 0 ? '+' : '') + fmtCurrency(r.monthlySavings) + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        document.getElementById('tableContainer').innerHTML = html;
    }

    function showDetail(appName) {
        const r = allRecs.find(x => x.appName === appName);
        if (!r) return;
        selectedApp = r;

        const panel = document.getElementById('detailPanel');
        panel.classList.add('co-visible');

        let html = '<h3>' + escHtml(r.appName) + ' - Optimization Detail</h3>';
        html += '<div class="co-detail-grid">';

        html += '<div class="co-detail-col"><h4>Current Allocation</h4>';
        html += '<div class="co-detail-row"><span class="co-label">Configuration</span><span>' + formatAlloc(r.currentAllocation) + '</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">Monthly Cost</span><span>' + fmtCurrency(r.currentMonthlyCost) + '</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">CPU P50/P95/P99</span><span>' + r.cpuStats.p50.toFixed(1) + '% / ' + r.cpuStats.p95.toFixed(1) + '% / ' + r.cpuStats.p99.toFixed(1) + '%</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">Memory P50/P95/P99</span><span>' + r.memoryStats.p50.toFixed(1) + '% / ' + r.memoryStats.p95.toFixed(1) + '% / ' + r.memoryStats.p99.toFixed(1) + '%</span></div>';
        html += '</div>';

        html += '<div class="co-detail-col"><h4>Recommended Allocation</h4>';
        html += '<div class="co-detail-row"><span class="co-label">Configuration</span><span>' + formatAlloc(r.recommendedAllocation) + '</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">Monthly Cost</span><span>' + fmtCurrency(r.recommendedMonthlyCost) + '</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">Monthly Savings</span><span class="' + (r.monthlySavings > 0 ? 'co-savings-positive' : 'co-savings-negative') + '">' + fmtCurrency(r.monthlySavings) + '</span></div>';
        html += '<div class="co-detail-row"><span class="co-label">Annual Savings</span><span class="' + (r.annualSavings > 0 ? 'co-savings-positive' : 'co-savings-negative') + '">' + fmtCurrency(r.annualSavings) + '</span></div>';
        html += '</div></div>';

        html += '<div class="co-analysis-box"><strong>Analysis:</strong> ' + escHtml(r.reasoning) + '</div>';
        panel.innerHTML = html;
    }

    function exportCsv() { vscode.postMessage({ command: 'exportCsv' }); }
    function exportMarkdown() { vscode.postMessage({ command: 'exportMarkdown' }); }

    filterTable();
    `;

    return wrapWebviewHtml({
        title: `Cost Optimizer - ${uiEscapeHtml(environmentName)}`,
        body,
        scripts,
        extraStyles: getCostOptimizerStyles()
    });
}

function getCostOptimizerStyles(): string {
    return `
        .co-score-ring { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
        .co-score-ring svg { display: block; }
        .co-score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 20px; font-weight: 700; }

        .co-savings-positive { color: var(--am-success); font-weight: 600; }
        .co-savings-negative { color: var(--am-error); font-weight: 600; }
        .co-savings-zero { color: var(--am-text-muted); }

        .co-detail-panel {
            background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md); padding: 16px; margin-top: 16px;
            display: none;
        }
        .co-detail-panel.co-visible { display: block; animation: am-slideUp 0.3s ease-out; }
        .co-detail-panel h3 { font-size: 15px; margin-bottom: 12px; }
        .co-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .co-detail-col h4 { font-size: 12px; color: var(--am-text-muted); text-transform: uppercase; margin-bottom: 8px; }
        .co-detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
        .co-label { color: var(--am-text-muted); }
        .co-analysis-box {
            margin-top: 12px; padding: 10px; background: var(--am-bg-secondary);
            border-radius: var(--am-radius-sm); font-size: 13px;
        }
    `;
}
