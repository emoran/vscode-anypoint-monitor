import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    wrapWebviewHtml,
    badge,
    summaryCard,
    button,
    escapeHtml as escHtml,
    type BadgeVariant,
} from '../webview/ui-kit';
import {
    WarRoomReport,
    WarRoomData,
    TimelineEvent,
    CorrelationResult,
} from './types';

const WARROOM_DIR = '.warroom';
const REPORTS_DIR = 'reports';

export async function generateReport(
    data: WarRoomData,
    timeline: TimelineEvent[],
    correlations: CorrelationResult[]
): Promise<string> {
    const report: WarRoomReport = {
        config: data.config,
        blastRadius: data.blastRadius,
        timeline,
        correlations,
        apps: data.apps,
        collectionErrors: data.collectionErrors,
        collectionTime: data.collectionTime,
        generatedAt: new Date().toISOString()
    };

    const markdown = renderMarkdown(report);
    const filePath = await saveReport(markdown);

    // Open formatted webview panel
    const panel = vscode.window.createWebviewPanel(
        'warRoomReport',
        `War Room: ${data.config.severity} — ${data.config.environment}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = renderWebview(report);

    // Handle webview messages for interactive actions
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'copyReport':
                await vscode.env.clipboard.writeText(markdown);
                panel.webview.postMessage({ command: 'toast', text: 'Report copied to clipboard' });
                break;
            case 'refreshReport':
                panel.dispose();
                await vscode.commands.executeCommand('anypoint-monitor.startWarRoom');
                break;
            case 'openMarkdown':
                if (filePath) {
                    const doc = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
                } else {
                    const doc = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
                }
                break;
            case 'openCommandCenter':
                await vscode.commands.executeCommand('anypoint-monitor.commandCenter');
                panel.webview.postMessage({ command: 'toast', text: `Opening Command Center — select ${message.appName}` });
                break;
            case 'openLogs':
                await vscode.commands.executeCommand('anypoint-monitor.realTimeLogs');
                panel.webview.postMessage({ command: 'toast', text: `Opening Real-Time Logs — select ${message.appName}` });
                break;
        }
    });

    // Also reveal the saved file path in status bar
    if (filePath) {
        vscode.window.setStatusBarMessage(`War Room report saved: ${filePath}`, 8000);
    }

    return markdown;
}

// ─── Webview renderer ────────────────────────────────────────────────────────

function warSeverityBadgeVariant(sev: string): BadgeVariant {
    if (sev === 'SEV1') { return 'error'; }
    if (sev === 'SEV2') { return 'warning'; }
    return 'info';
}

function confidenceBadgeVariant(confidence: string): BadgeVariant {
    if (confidence === 'high') { return 'success'; }
    if (confidence === 'medium') { return 'warning'; }
    return 'default';
}

function directionBadgeHtml(dir: string): string {
    const dirCls = dir === 'SEED' ? 'war-dir-seed' : dir === 'UPSTREAM' ? 'war-dir-up' : 'war-dir-down';
    return `<span class="am-badge am-badge-pill ${dirCls}">${escHtml(dir)}</span>`;
}

function renderWebview(report: WarRoomReport): string {
    const { config, blastRadius, timeline, correlations, apps, collectionErrors, collectionTime } = report;

    const primary = correlations[0];
    const totalErrors = [...apps.values()].reduce((s, a) => s + a.logs.errors, 0);
    const totalWarnings = [...apps.values()].reduce((s, a) => s + a.logs.warnings, 0);
    const totalDeployments = [...apps.values()].reduce((s, a) => s + a.deployments.length, 0);
    const totalAnomalies = [...apps.values()].reduce((s, a) => s + a.metrics.anomalies.length, 0);
    const suspiciousDeployments = [...apps.values()].flatMap(a => a.deployments).filter(d => d.suspicious).length;

    const sevClass =
        config.severity === 'SEV1' ? 'war-sev-sev1' : config.severity === 'SEV2' ? 'war-sev-sev2' : 'war-sev-sev3';

    const blastRows = [
        ...blastRadius.seedApps.map(a => ({ app: a, dir: 'SEED', hops: 0 })),
        ...blastRadius.upstream.map(u => ({ app: u.app, dir: 'UPSTREAM', hops: u.hops })),
        ...blastRadius.downstream.map(d => ({ app: d.app, dir: 'DOWNSTREAM', hops: d.hops }))
    ];

    const extraStyles = `
        .am-page-header.war-report-header { flex-wrap: wrap; align-items: flex-start; margin-bottom: 20px; }
        .am-page-header.war-report-header .war-header-title-row {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;
        }
        .am-page-header.war-report-header h1 { font-size: 20px; margin-bottom: 0; }
        .am-page-header.war-sev-sev1::before {
            background: linear-gradient(90deg, var(--am-error), var(--am-info), var(--am-success));
        }
        .am-page-header.war-sev-sev2::before {
            background: linear-gradient(90deg, var(--am-warning), var(--am-info), var(--am-success));
        }
        .am-page-header.war-sev-sev3::before {
            background: linear-gradient(90deg, var(--am-info), var(--am-success));
        }
        .war-meta-pill {
            padding: 3px 10px;
            border-radius: var(--am-radius-pill);
            font-size: 12px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            color: var(--am-text-secondary);
        }
        .war-header-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .war-section { margin-bottom: 20px; }
        .war-section-header {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--am-text-secondary);
            padding: 12px 16px;
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-bottom: none;
            border-radius: var(--am-radius-md) var(--am-radius-md) 0 0;
        }
        .war-section-body {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: 0 0 var(--am-radius-md) var(--am-radius-md);
            overflow: hidden;
        }
        .war-cause-box { padding: 16px 20px; }
        .war-cause-label {
            font-size: 12px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        .war-cause-text { font-size: 15px; font-weight: 600; color: var(--am-text-primary); margin-bottom: 8px; }
        .war-conf-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .war-evidence-list {
            list-style: none;
            border-top: 1px solid var(--am-border);
            padding-top: 12px;
            margin-top: 4px;
        }
        .war-evidence-list li {
            padding: 4px 0 4px 16px;
            position: relative;
            color: var(--am-text-secondary);
            font-size: 13px;
        }
        .war-evidence-list li::before {
            content: '›';
            position: absolute;
            left: 0;
            color: var(--am-info);
        }
        .am-table.war-table { font-size: 13px; }
        .am-table.war-table tr:last-child td { border-bottom: none; }
        .am-table.war-table .war-empty-row td {
            color: var(--am-text-muted);
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
        .am-table.war-table tr.war-row-sev-critical td {
            background: color-mix(in srgb, var(--am-error) 6%, transparent);
        }
        .am-table.war-table tr.war-row-sev-warning td {
            background: color-mix(in srgb, var(--am-warning) 6%, transparent);
        }
        .war-sev-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 4px;
            vertical-align: middle;
        }
        .war-sev-dot.critical { background: var(--am-error); }
        .war-sev-dot.warning { background: var(--am-warning); }
        .war-sev-dot.info { background: var(--am-info); }
        .war-flag-suspicious { color: var(--am-warning); font-size: 12px; }
        .war-flag-none { color: var(--am-text-muted); }
        .am-badge.war-dir-seed {
            background: color-mix(in srgb, var(--am-text-link) 18%, transparent);
            color: var(--am-text-link);
            border-color: color-mix(in srgb, var(--am-text-link) 35%, transparent);
        }
        .am-badge.war-dir-up {
            background: color-mix(in srgb, var(--am-info) 15%, transparent);
            color: var(--am-info);
            border-color: color-mix(in srgb, var(--am-info) 30%, transparent);
        }
        .am-badge.war-dir-down {
            background: color-mix(in srgb, var(--am-warning) 15%, transparent);
            color: var(--am-warning);
            border-color: color-mix(in srgb, var(--am-warning) 30%, transparent);
        }
        .war-actions-list { list-style: none; padding: 16px 20px; margin: 0; }
        .war-actions-list li {
            padding: 10px 14px;
            margin-bottom: 8px;
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            display: flex;
            gap: 10px;
            align-items: flex-start;
        }
        .war-actions-list li:last-child { margin-bottom: 0; }
        .war-action-num {
            min-width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--am-bg-surface-hover);
            font-size: 11px;
            font-weight: 700;
            color: var(--am-text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-top: 1px;
        }
        .war-action-text { color: var(--am-text-primary); font-size: 13px; line-height: 1.5; }
        .war-action-text strong { color: var(--am-text-primary); font-weight: 600; }
        .war-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
        .war-meta-item {
            padding: 12px 16px;
            border-bottom: 1px solid var(--am-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .war-meta-item:nth-child(odd) { border-right: 1px solid var(--am-border); }
        .war-meta-item:last-child,
        .war-meta-item:nth-last-child(2):nth-child(odd) { border-bottom: none; }
        .war-meta-key { color: var(--am-text-secondary); font-size: 12px; }
        .war-meta-val { color: var(--am-text-primary); font-size: 13px; font-weight: 500; text-align: right; }
        .war-meta-val.war-meta-val-error { color: var(--am-error); }
        .war-err-item {
            padding: 8px 16px;
            border-bottom: 1px solid var(--am-border);
            display: flex;
            gap: 8px;
            align-items: flex-start;
        }
        .war-err-item:last-child { border-bottom: none; }
        .war-err-icon { color: var(--am-error); font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .war-err-text { font-size: 12px; color: var(--am-text-secondary); }
        .war-err-text strong { color: var(--am-text-primary); }
        .war-app-actions { display: flex; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .war-app-link {
            padding: 2px 8px;
            border-radius: var(--am-radius-sm);
            font-size: 11px;
            color: var(--am-text-link);
            background: color-mix(in srgb, var(--am-info) 10%, transparent);
            border: 1px solid color-mix(in srgb, var(--am-info) 22%, transparent);
            cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }
        .war-app-link:hover {
            background: color-mix(in srgb, var(--am-info) 18%, transparent);
            border-color: color-mix(in srgb, var(--am-info) 40%, transparent);
        }
        .war-err-pattern { cursor: pointer; position: relative; }
        .war-err-pattern:hover { color: var(--am-info); }
        .war-err-short { display: inline; }
        .war-err-full {
            display: none;
            white-space: pre-wrap;
            word-break: break-all;
            margin-top: 6px;
            padding: 8px;
            background: var(--am-bg-primary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
            color: var(--am-text-secondary);
            max-height: 200px;
            overflow-y: auto;
        }
        .war-err-pattern.war-expanded .war-err-short { display: none; }
        .war-err-pattern.war-expanded .war-err-full { display: block; }
        .war-err-expand-hint { color: var(--am-text-muted); font-size: 10px; margin-left: 4px; }
        .war-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--am-bg-surface-hover);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 10px 18px;
            font-size: 13px;
            color: var(--am-text-primary);
            box-shadow: var(--am-shadow-lg);
            z-index: 100;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
            pointer-events: none;
        }
        .war-toast.war-toast-show { opacity: 1; transform: translateY(0); }
        .war-report-footer {
            text-align: center;
            color: var(--am-text-muted);
            font-size: 12px;
            margin-top: 28px;
            padding-top: 16px;
            border-top: 1px solid var(--am-border);
        }
        .war-code { font-size: 12px; color: var(--am-info); }
        .war-cell-muted { font-size: 12px; color: var(--am-text-secondary); }
        .war-cell-nowrap { white-space: nowrap; }
        .war-count-error { color: var(--am-error); font-weight: 600; }
        .war-count-warn { color: var(--am-warning); font-weight: 600; }
        .war-count-zero { color: var(--am-text-muted); }
    `;

    const scripts = `
const vscode = acquireVsCodeApi();
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('war-toast-show');
    setTimeout(() => t.classList.remove('war-toast-show'), 2500);
}
function copyReport() {
    vscode.postMessage({ command: 'copyReport' });
}
function refreshReport() {
    vscode.postMessage({ command: 'refreshReport' });
}
function openMarkdown() {
    vscode.postMessage({ command: 'openMarkdown' });
}
function openCommandCenter(appName) {
    vscode.postMessage({ command: 'openCommandCenter', appName });
}
function openLogs(appName) {
    vscode.postMessage({ command: 'openLogs', appName });
}
window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'toast') { showToast(msg.text); }
});
`.trim();

    const body = `
<div class="am-container">
    <header class="am-page-header war-report-header ${sevClass}">
        <div style="flex:1;min-width:200px">
            <div class="war-header-title-row">
                ${badge(config.severity, warSeverityBadgeVariant(config.severity), true)}
                <h1>War Room Incident Report</h1>
            </div>
            <div class="am-page-header-meta">
                <span class="war-meta-pill">🏢 ${escHtml(config.environment)}</span>
                <span class="war-meta-pill">📱 ${config.applications.map(a => escHtml(a.name)).join(', ')}</span>
            </div>
            <div class="am-timestamp">
                ${fmtDate(config.timeWindow.start)} → ${fmtDate(config.timeWindow.end)}
                · Generated ${fmtDate(new Date(report.generatedAt))}
            </div>
            <div class="war-header-actions">
                ${button('Copy Report', { variant: 'ghost', icon: '📋', onclick: 'copyReport()' })}
                ${button('Refresh', { variant: 'ghost', icon: '🔄', onclick: 'refreshReport()' })}
                ${button('Open Markdown', { variant: 'ghost', icon: '📄', onclick: 'openMarkdown()' })}
            </div>
        </div>
    </header>

    <div class="am-summary-cards">
        ${summaryCard({ icon: '📦', value: apps.size, label: 'Apps Analyzed', animationDelay: '0.05s' })}
        ${summaryCard({
        icon: '✖',
        value: totalErrors,
        label: 'Log Errors',
        variant: totalErrors > 0 ? 'critical' : 'healthy',
        animationDelay: '0.1s'
    })}
        ${summaryCard({
        icon: '⚠',
        value: totalWarnings,
        label: 'Log Warnings',
        variant: totalWarnings > 0 ? 'warning' : 'healthy',
        animationDelay: '0.15s'
    })}
        ${summaryCard({
        icon: '🚀',
        value: totalDeployments,
        label: 'Deployments',
        variant: totalDeployments > 0 ? 'warning' : 'healthy',
        animationDelay: '0.2s'
    })}
        ${summaryCard({
        icon: '🎯',
        value: suspiciousDeployments,
        label: 'Suspicious',
        variant: suspiciousDeployments > 0 ? 'warning' : 'healthy',
        animationDelay: '0.25s'
    })}
        ${summaryCard({
        icon: '📈',
        value: totalAnomalies,
        label: 'Anomalies',
        variant: totalAnomalies > 0 ? 'critical' : 'healthy',
        animationDelay: '0.3s'
    })}
    </div>

    <section class="war-section">
        <div class="war-section-header">🔍 Probable Cause</div>
        <div class="war-section-body">
            <div class="war-cause-box">
                <div class="war-cause-label">Assessment</div>
                <div class="war-cause-text">${primary ? escHtml(primary.probableCause) : 'Insufficient data for root cause analysis'}</div>
                ${primary ? `<div class="war-conf-row">
                    ${badge(primary.confidence.toUpperCase() + ' CONFIDENCE', confidenceBadgeVariant(primary.confidence), true)}
                    <span class="war-cell-muted">${primary.category.replace(/_/g, ' ').toUpperCase()}</span>
                </div>
                <ul class="war-evidence-list">
                    ${primary.evidence.map(e => `<li>${escHtml(e)}</li>`).join('')}
                </ul>` : '<p class="war-cell-muted">No correlation patterns detected in the collected data.</p>'}
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">💥 Blast Radius (${blastRows.length} apps)</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr>
                        <th>Application</th><th>Direction</th><th>Hops</th>
                        <th>Status</th><th>Errors</th><th>Warnings</th><th>Actions</th>
                    </tr></thead>
                    <tbody>
                    ${blastRows.map(r => {
        const appData = apps.get(r.app);
        const st = appData?.status.status || 'UNKNOWN';
        return `<tr class="am-row">
                            <td><strong>${escHtml(r.app)}</strong></td>
                            <td>${directionBadgeHtml(r.dir)}</td>
                            <td class="war-cell-muted">${r.hops}</td>
                            <td>${statusBadge(st)}</td>
                            <td>${appData?.logs.errors ? `<span class="war-count-error">${appData.logs.errors}</span>` : '<span class="war-count-zero">0</span>'}</td>
                            <td>${appData?.logs.warnings ? `<span class="war-count-warn">${appData.logs.warnings}</span>` : '<span class="war-count-zero">0</span>'}</td>
                            <td><div class="war-app-actions">
                                <span class="war-app-link" onclick="openCommandCenter(${JSON.stringify(r.app)})">Command Center</span>
                                <span class="war-app-link" onclick="openLogs(${JSON.stringify(r.app)})">Logs</span>
                            </div></td>
                        </tr>`;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">⏱ Timeline (${timeline.length} events)</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr><th>Time</th><th>App</th><th>Type</th><th>Severity</th><th>Description</th></tr></thead>
                    <tbody>
                    ${timeline.length === 0
        ? `<tr class="war-empty-row"><td colspan="5">No significant events detected in the time window.</td></tr>`
        : timeline.slice(0, 100).map(ev => `<tr class="am-row war-row-sev-${ev.severity}">
                            <td class="war-cell-muted war-cell-nowrap">${fmtTime(ev.timestamp)}</td>
                            <td class="war-cell-nowrap"><strong>${escHtml(ev.app)}</strong></td>
                            <td>${badge(ev.type, 'default')}</td>
                            <td><span class="war-sev-dot ${ev.severity}"></span>${escHtml(ev.severity)}</td>
                            <td class="war-cell-muted">${escHtml(ev.description.substring(0, 120))}</td>
                        </tr>`).join('')
    }
                    ${timeline.length > 100 ? `<tr class="war-empty-row"><td colspan="5">${timeline.length - 100} more events omitted</td></tr>` : ''}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">🚨 Error Summary</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr><th>App</th><th>Count</th><th>First Seen</th><th>Last Seen</th><th>Pattern</th></tr></thead>
                    <tbody>
                    ${(() => {
        const rows: string[] = [];
        for (const [appName, appData] of apps) {
            for (const g of appData.logs.groups.filter(g => g.level === 'ERROR').slice(0, 10)) {
                const short = escHtml(g.pattern.substring(0, 100));
                const full = escHtml(g.pattern);
                const expandable = g.pattern.length > 100;
                rows.push(`<tr class="am-row">
                            <td><strong>${escHtml(appName)}</strong></td>
                            <td><span class="war-count-error">${g.count}</span></td>
                            <td class="war-cell-muted">${fmtTime(g.firstSeen)}</td>
                            <td class="war-cell-muted">${fmtTime(g.lastSeen)}</td>
                            <td style="font-family:monospace;font-size:12px" class="war-cell-muted">${expandable
        ? `<div class="war-err-pattern" onclick="this.classList.toggle('war-expanded')"><span class="war-err-short">${short}…<span class="war-err-expand-hint">(click to expand)</span></span><div class="war-err-full">${full}</div></div>`
        : short}</td>
                        </tr>`);
            }
        }
        return rows.length > 0
            ? rows.join('')
            : `<tr class="war-empty-row"><td colspan="5">No ERROR-level log entries found in the time window.</td></tr>`;
    })()}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    ${renderWarningsSectionHtml(apps)}

    <section class="war-section">
        <div class="war-section-header">🚀 Recent Deployments</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr><th>App</th><th>Version</th><th>Timestamp</th><th>Status</th><th>Triggered By</th><th>Flag</th></tr></thead>
                    <tbody>
                    ${(() => {
        const rows: string[] = [];
        for (const [, appData] of apps) {
            for (const dep of appData.deployments) {
                const flag = dep.suspicious
                    ? `<span class="war-flag-suspicious">⚠ ${escHtml(dep.suspiciousReason || 'Near incident window')}</span>`
                    : `<span class="war-flag-none">—</span>`;
                rows.push(`<tr class="am-row${dep.suspicious ? ' am-row-warning war-row-sev-warning' : ''}">
                            <td><strong>${escHtml(dep.appName)}</strong></td>
                            <td><code class="war-code">${escHtml(dep.version)}</code></td>
                            <td class="war-cell-muted war-cell-nowrap">${fmtTime(dep.timestamp)}</td>
                            <td>${statusBadge(dep.status)}</td>
                            <td class="war-cell-muted">${escHtml(dep.triggeredBy)}</td>
                            <td>${flag}</td>
                        </tr>`);
            }
        }
        return rows.length > 0
            ? rows.join('')
            : `<tr class="war-empty-row"><td colspan="6">No deployments found in or near the time window.</td></tr>`;
    })()}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">📈 Metric Anomalies</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr><th>App</th><th>Metric</th><th>Current</th><th>Baseline</th><th>Deviation</th><th>Severity</th></tr></thead>
                    <tbody>
                    ${(() => {
        const rows: string[] = [];
        for (const [appName, appData] of apps) {
            for (const a of appData.metrics.anomalies) {
                rows.push(`<tr class="am-row">
                            <td><strong>${escHtml(appName)}</strong></td>
                            <td>${escHtml(a.metric)}</td>
                            <td><span class="war-count-error">${fmtMetric(a.current, a.metric)}</span></td>
                            <td class="war-cell-muted">${fmtMetric(a.baseline, a.metric)}</td>
                            <td>${badge(a.deviation.toFixed(1) + 'x', 'warning')}</td>
                            <td>${a.severity === 'high'
        ? badge('HIGH', 'error')
        : badge('MEDIUM', 'warning')}</td>
                        </tr>`);
            }
        }
        return rows.length > 0
            ? rows.join('')
            : `<tr class="war-empty-row"><td colspan="6">No metric anomalies detected.</td></tr>`;
    })()}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">🖥 Application Status</div>
        <div class="war-section-body">
            <div class="am-table-container">
                <table class="am-table war-table">
                    <thead><tr><th>Application</th><th>Status</th><th>Workers</th><th>Mule Runtime</th><th>Region</th><th>Last Modified</th><th>Actions</th></tr></thead>
                    <tbody>
                    ${[...apps.values()].map(appData => {
        const s = appData.status;
        return `<tr class="am-row">
                    <td><strong>${escHtml(s.name)}</strong></td>
                    <td>${statusBadge(s.status)}</td>
                    <td class="war-cell-muted">${s.workerCount ?? '—'}</td>
                    <td class="war-cell-muted">${s.runtimeVersion ? escHtml(s.runtimeVersion) : '—'}</td>
                    <td class="war-cell-muted">${s.region ? escHtml(s.region) : '—'}</td>
                    <td class="war-cell-muted">${s.lastRestart ? fmtTime(s.lastRestart) : '—'}</td>
                    <td><div class="war-app-actions">
                        <span class="war-app-link" onclick="openCommandCenter(${JSON.stringify(s.name)})">Command Center</span>
                        <span class="war-app-link" onclick="openLogs(${JSON.stringify(s.name)})">Logs</span>
                    </div></td>
                </tr>`;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">✅ Recommended Actions</div>
        <div class="war-section-body">
            <ol class="war-actions-list">
            ${generateRecommendations(report).map((action, i) => `
                <li>
                    <div class="war-action-num">${i + 1}</div>
                    <div class="war-action-text">${markdownBold(escHtml(action))}</div>
                </li>
            `).join('')}
            </ol>
        </div>
    </section>

    <section class="war-section">
        <div class="war-section-header">📋 Collection Metadata</div>
        <div class="war-section-body">
            <div class="war-meta-grid">
                <div class="war-meta-item"><span class="war-meta-key">Collection Time</span><span class="war-meta-val">${(collectionTime / 1000).toFixed(1)}s</span></div>
                <div class="war-meta-item"><span class="war-meta-key">Apps Analyzed</span><span class="war-meta-val">${apps.size}</span></div>
                <div class="war-meta-item"><span class="war-meta-key">Timeline Events</span><span class="war-meta-val">${timeline.length}</span></div>
                <div class="war-meta-item"><span class="war-meta-key">Collection Errors</span><span class="war-meta-val${collectionErrors.length > 0 ? ' war-meta-val-error' : ''}">${collectionErrors.length}</span></div>
            </div>
            ${collectionErrors.length > 0 ? `
            <div style="border-top:1px solid var(--am-border)">
                ${collectionErrors.map(err => `
                <div class="war-err-item">
                    <span class="war-err-icon">⚠</span>
                    <span class="war-err-text"><strong>${escHtml(err.collector)}</strong> (${escHtml(err.app)}): ${escHtml(err.error)}</span>
                </div>`).join('')}
            </div>` : ''}
        </div>
    </section>

    <div class="war-report-footer">Generated by Anypoint Monitor War Room Mode · ${fmtDate(new Date(report.generatedAt))}</div>
    <div class="war-toast" id="toast"></div>
</div>
`.trim();

    return wrapWebviewHtml({
        title: 'War Room Report',
        body,
        scripts,
        extraStyles,
    });
}

// ─── Markdown renderer (saved to disk) ───────────────────────────────────────

function renderMarkdown(report: WarRoomReport): string {
    const lines: string[] = [];
    const { config, blastRadius, timeline, correlations, apps, collectionErrors, collectionTime } = report;

    lines.push(`# War Room Incident Report`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Severity** | ${config.severity} |`);
    lines.push(`| **Environment** | ${config.environment} |`);
    lines.push(`| **Seed Applications** | ${config.applications.map(a => a.name).join(', ')} |`);
    lines.push(`| **Time Window** | ${fmtDate(config.timeWindow.start)} — ${fmtDate(config.timeWindow.end)} |`);
    lines.push(`| **Report Generated** | ${fmtDate(new Date(report.generatedAt))} |`);
    lines.push(`| **Total Apps Analyzed** | ${apps.size} |`);
    lines.push('');

    const primary = correlations[0];
    lines.push(`## Probable Cause`);
    lines.push('');
    if (primary) {
        lines.push(`> **${primary.probableCause}**`);
        lines.push(`> Confidence: **${primary.confidence.toUpperCase()}**`);
        lines.push('');
        lines.push('**Evidence:**');
        for (const e of primary.evidence) { lines.push(`- ${e}`); }
    } else {
        lines.push('*No clear correlation patterns detected.*');
    }
    lines.push('');

    lines.push(`## Blast Radius`);
    lines.push('');
    lines.push(`| App | Direction | Hops | Status | Errors | Warnings |`);
    lines.push(`|-----|-----------|------|--------|--------|----------|`);
    for (const seed of blastRadius.seedApps) {
        const d = apps.get(seed);
        lines.push(`| **${seed}** | SEED | 0 | ${d?.status.status ?? 'UNKNOWN'} | ${d?.logs.errors ?? 0} | ${d?.logs.warnings ?? 0} |`);
    }
    for (const u of blastRadius.upstream) {
        const d = apps.get(u.app);
        lines.push(`| ${u.app} | UPSTREAM | ${u.hops} | ${d?.status.status ?? 'UNKNOWN'} | ${d?.logs.errors ?? 0} | ${d?.logs.warnings ?? 0} |`);
    }
    for (const dn of blastRadius.downstream) {
        const d = apps.get(dn.app);
        lines.push(`| ${dn.app} | DOWNSTREAM | ${dn.hops} | ${d?.status.status ?? 'UNKNOWN'} | ${d?.logs.errors ?? 0} | ${d?.logs.warnings ?? 0} |`);
    }
    lines.push('');

    lines.push(`## Timeline`);
    lines.push('');
    if (timeline.length > 0) {
        lines.push(`| Time | App | Type | Severity | Description |`);
        lines.push(`|------|-----|------|----------|-------------|`);
        for (const ev of timeline.slice(0, 100)) {
            lines.push(`| ${fmtTime(ev.timestamp)} | ${ev.app} | ${ev.type} | ${ev.severity} | ${ev.description.substring(0, 120).replace(/\|/g, '\\|')} |`);
        }
    } else {
        lines.push('*No significant events detected.*');
    }
    lines.push('');

    lines.push(`## Warning Summary`);
    lines.push('');
    lines.push(`| App | Count | First Seen | Last Seen | Pattern |`);
    lines.push(`|-----|-------|------------|----------|---------|`);
    let anyWarnings = false;
    for (const [appName, appData] of apps) {
        for (const g of appData.logs.groups.filter(g => g.level === 'WARN').slice(0, 10)) {
            anyWarnings = true;
            lines.push(`| ${appName} | ${g.count} | ${fmtTime(g.firstSeen)} | ${fmtTime(g.lastSeen)} | ${g.pattern.substring(0, 100).replace(/\|/g, '\\|')} |`);
        }
    }
    if (!anyWarnings) { lines.push(`| *No WARN-level entries found* | | | | |`); }
    lines.push('');

    lines.push(`## Recent Deployments`);
    lines.push('');
    lines.push(`| App | Version | Timestamp | Status | Triggered By | Flag |`);
    lines.push(`|-----|---------|-----------|--------|--------------|------|`);
    let anyDep = false;
    for (const [, appData] of apps) {
        for (const dep of appData.deployments) {
            anyDep = true;
            lines.push(`| ${dep.appName} | ${dep.version} | ${fmtTime(dep.timestamp)} | ${dep.status} | ${dep.triggeredBy} | ${dep.suspicious ? '⚠ ' + (dep.suspiciousReason || '') : ''} |`);
        }
    }
    if (!anyDep) { lines.push(`| *No deployments found* | | | | | |`); }
    lines.push('');

    lines.push(`## Application Status`);
    lines.push('');
    lines.push(`| App | Status | Workers | Mule Runtime | Region | Last Modified |`);
    lines.push(`|-----|--------|---------|--------------|--------|---------------|`);
    for (const [, appData] of apps) {
        const s = appData.status;
        lines.push(`| ${s.name} | ${s.status} | ${s.workerCount ?? 'N/A'} | ${s.runtimeVersion || 'N/A'} | ${s.region || 'N/A'} | ${s.lastRestart ? fmtTime(s.lastRestart) : 'N/A'} |`);
    }
    lines.push('');

    lines.push(`## Recommended Actions`);
    lines.push('');
    generateRecommendations(report).forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');

    lines.push(`## Collection Metadata`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Collection Time | ${(collectionTime / 1000).toFixed(1)}s |`);
    lines.push(`| Apps Analyzed | ${apps.size} |`);
    lines.push(`| Collection Errors | ${collectionErrors.length} |`);
    if (collectionErrors.length > 0) {
        lines.push('');
        lines.push('### Collection Errors');
        for (const err of collectionErrors) {
            lines.push(`- **${err.collector}** (${err.app}): ${err.error}`);
        }
    }
    lines.push('');
    lines.push('---');
    lines.push('*Generated by Anypoint Monitor War Room Mode*');

    return lines.join('\n');
}

// ─── Recommendations ─────────────────────────────────────────────────────────

function generateRecommendations(report: WarRoomReport): string[] {
    const actions: string[] = [];
    const primary = report.correlations[0];

    if (!primary) {
        actions.push('Review application logs for any error patterns');
        actions.push('Check Anypoint Platform status page for known incidents');
        return actions;
    }

    switch (primary.category) {
        case 'recent_deployment': {
            for (const [, appData] of report.apps) {
                for (const dep of appData.deployments) {
                    if (dep.suspicious) {
                        actions.push(`**Rollback ${dep.appName}** to previous version (currently ${dep.version}, deployed by ${dep.triggeredBy})`);
                    }
                }
            }
            actions.push('Review deployment change logs and diff for the suspicious deployments');
            actions.push('Check if the deployment included configuration changes that may have caused the issue');
            break;
        }
        case 'resource_exhaustion': {
            for (const [appName, appData] of report.apps) {
                for (const anomaly of appData.metrics.anomalies) {
                    if (anomaly.metric === 'CPU' && anomaly.severity === 'high') {
                        actions.push(`**Scale up ${appName}** workers or increase worker size (CPU at ${anomaly.current.toFixed(1)}%)`);
                    }
                    if (anomaly.metric === 'Memory' && anomaly.severity === 'high') {
                        actions.push(`**Investigate memory leak in ${appName}** or increase worker memory (Memory at ${anomaly.current.toFixed(1)}%)`);
                    }
                }
            }
            actions.push('Consider enabling auto-scaling if available');
            actions.push('Review recent traffic patterns for unexpected load increases');
            break;
        }
        case 'downstream_failure': {
            const downstreamApps = report.blastRadius.downstream.map(d => d.app);
            actions.push(`**Investigate downstream services**: ${downstreamApps.join(', ')}`);
            actions.push('Check if downstream services are responding and healthy');
            actions.push('Review circuit breaker and retry policies in calling applications');
            actions.push('Consider enabling fallback responses for degraded downstream services');
            break;
        }
        case 'connectivity_failure': {
            // Extract source→target pairs from evidence lines
            const connPairs: Array<{ source: string; target: string }> = [];
            for (const ev of primary.evidence) {
                const match = ev.match(/^(.+?) errors reference (.+?):/);
                if (match) {
                    connPairs.push({ source: match[1], target: match[2] });
                }
            }
            if (connPairs.length > 0) {
                const uniqueTargets = [...new Set(connPairs.map(p => p.target))];
                const uniqueSources = [...new Set(connPairs.map(p => p.source))];
                actions.push(`**Investigate connectivity between ${uniqueSources.join(', ')} and ${uniqueTargets.join(', ')}**`);
                for (const target of uniqueTargets) {
                    actions.push(`Check if **${target}** is healthy, responding, and reachable from calling apps`);
                }
            } else {
                actions.push('**Investigate connectivity** between the apps referenced in error messages');
            }
            actions.push('Review network policies, firewall rules, and DNS resolution');
            actions.push('Check circuit breaker and retry configuration in calling applications');
            break;
        }
        case 'shared_dependency': {
            actions.push('Check shared infrastructure: load balancers, VPNs, databases');
            actions.push('Review Anypoint Platform status page for regional outages');
            actions.push('Check network connectivity between applications');
            actions.push('Verify shared credentials and certificates have not expired');
            break;
        }
        default: {
            // Build contextual actions from actual findings instead of generic advice
            const appsWithErrors: string[] = [];
            const appsWithWarnings: string[] = [];
            const stoppedApps: string[] = [];
            const topWarningPatterns: Array<{ app: string; pattern: string; count: number }> = [];

            for (const [appName, appData] of report.apps) {
                if (appData.logs.errors > 0) { appsWithErrors.push(appName); }
                if (appData.logs.warnings > 0) {
                    appsWithWarnings.push(appName);
                    for (const g of appData.logs.groups.filter(g => g.level === 'WARN').slice(0, 3)) {
                        topWarningPatterns.push({ app: appName, pattern: g.pattern.substring(0, 80), count: g.count });
                    }
                }
                const st = appData.status.status.toUpperCase();
                if (['STOPPED', 'FAILED', 'UNDEPLOYED'].includes(st)) { stoppedApps.push(appName); }
            }

            if (stoppedApps.length > 0) {
                actions.push(`**Investigate stopped/failed apps**: ${stoppedApps.join(', ')} — check deployment status and restart if needed`);
            }
            if (appsWithErrors.length > 0) {
                actions.push(`**Review errors** on ${appsWithErrors.join(', ')} — see Error Summary above for patterns`);
            }
            if (topWarningPatterns.length > 0) {
                actions.push(`**Review ${topWarningPatterns.reduce((s, p) => s + p.count, 0)} warnings** on ${appsWithWarnings.join(', ')} — see Warning Summary above for patterns`);
                for (const wp of topWarningPatterns.slice(0, 3)) {
                    actions.push(`Investigate warning on **${wp.app}** (${wp.count}x): "${wp.pattern}"`);
                }
            }
            if (appsWithErrors.length === 0 && topWarningPatterns.length === 0 && stoppedApps.length === 0) {
                actions.push('No errors, warnings, or failures detected — consider widening the time window');
                actions.push('Check Anypoint Platform status page for known incidents');
                actions.push('Verify application health via Real-Time Logs for live troubleshooting');
            }
        }
    }

    if (report.config.severity === 'SEV1') {
        actions.push('**[SEV1]** Escalate to on-call engineering lead immediately');
        actions.push('**[SEV1]** Begin customer communication if external impact confirmed');
    } else if (report.config.severity === 'SEV2') {
        actions.push('**[SEV2]** Notify engineering team lead within 30 minutes');
    }

    return actions;
}

// ─── Save to disk ─────────────────────────────────────────────────────────────

async function saveReport(markdown: string): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { return null; }

    const reportsDir = path.join(workspaceFolders[0].uri.fsPath, WARROOM_DIR, REPORTS_DIR);
    if (!fs.existsSync(reportsDir)) { fs.mkdirSync(reportsDir, { recursive: true }); }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(reportsDir, `incident-${timestamp}.md`);
    fs.writeFileSync(filePath, markdown, 'utf-8');
    return filePath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert **bold** markdown inside already-escaped HTML back to <strong> */
function markdownBold(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function fmtDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) { return String(date); }
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function fmtTime(timestamp: string): string {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) { return timestamp; }
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function fmtMetric(value: number, metric: string): string {
    if (metric === 'Response Time') { return `${value.toFixed(0)}ms`; }
    if (metric === 'Message Count') { return `${value.toFixed(0)}`; }
    return `${value.toFixed(1)}%`;
}

function statusBadge(status: string): string {
    const upper = (status || 'UNKNOWN').toUpperCase();
    if (['STARTED', 'RUNNING', 'DEPLOYED', 'APPLIED'].includes(upper)) {
        return badge(status, 'success');
    }
    if (['STOPPED', 'FAILED', 'UNDEPLOYED'].includes(upper)) {
        return badge(status, 'error');
    }
    if (['DEPLOYING', 'STARTING', 'RESTARTING'].includes(upper)) {
        return badge(status, 'warning');
    }
    return badge(status, 'default');
}

function renderWarningsSectionHtml(apps: Map<string, import('./types').AppWarRoomData>): string {
    const rows: string[] = [];
    for (const [appName, appData] of apps) {
        for (const g of appData.logs.groups.filter(g => g.level === 'WARN').slice(0, 10)) {
            const short = escHtml(g.pattern.substring(0, 100));
            const full = escHtml(g.pattern);
            const expandable = g.pattern.length > 100;
            rows.push(`<tr class="am-row">
                <td><strong>${escHtml(appName)}</strong></td>
                <td><span class="war-count-warn">${g.count}</span></td>
                <td class="war-cell-muted">${fmtTime(g.firstSeen)}</td>
                <td class="war-cell-muted">${fmtTime(g.lastSeen)}</td>
                <td style="font-family:monospace;font-size:12px" class="war-cell-muted">${expandable
                    ? `<div class="war-err-pattern" onclick="this.classList.toggle('war-expanded')"><span class="war-err-short">${short}…<span class="war-err-expand-hint">(click to expand)</span></span><div class="war-err-full">${full}</div></div>`
                    : short}</td>
            </tr>`);
        }
    }

    const tbody = rows.length > 0
        ? rows.join('')
        : `<tr class="war-empty-row"><td colspan="5">No WARN-level log entries found in the time window.</td></tr>`;

    return `<section class="war-section">
    <div class="war-section-header">⚠ Warning Summary</div>
    <div class="war-section-body">
        <div class="am-table-container">
        <table class="am-table war-table">
            <thead><tr><th>App</th><th>Count</th><th>First Seen</th><th>Last Seen</th><th>Pattern</th></tr></thead>
            <tbody>${tbody}</tbody>
        </table>
        </div>
    </div>
</section>`;
}
