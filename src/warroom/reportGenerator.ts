import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

function renderWebview(report: WarRoomReport): string {
    const { config, blastRadius, timeline, correlations, apps, collectionErrors, collectionTime } = report;

    const primary = correlations[0];
    const totalErrors = [...apps.values()].reduce((s, a) => s + a.logs.errors, 0);
    const totalWarnings = [...apps.values()].reduce((s, a) => s + a.logs.warnings, 0);
    const totalDeployments = [...apps.values()].reduce((s, a) => s + a.deployments.length, 0);
    const totalAnomalies = [...apps.values()].reduce((s, a) => s + a.metrics.anomalies.length, 0);
    const suspiciousDeployments = [...apps.values()].flatMap(a => a.deployments).filter(d => d.suspicious).length;

    const sevColor = config.severity === 'SEV1' ? '#f85149' : config.severity === 'SEV2' ? '#e3b341' : '#58a6ff';
    const sevBg = config.severity === 'SEV1' ? 'rgba(248,81,73,0.15)' : config.severity === 'SEV2' ? 'rgba(227,179,65,0.15)' : 'rgba(88,166,255,0.15)';

    const blastRows = [
        ...blastRadius.seedApps.map(a => ({ app: a, dir: 'SEED', hops: 0 })),
        ...blastRadius.upstream.map(u => ({ app: u.app, dir: 'UPSTREAM', hops: u.hops })),
        ...blastRadius.downstream.map(d => ({ app: d.app, dir: 'DOWNSTREAM', hops: d.hops }))
    ];

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>War Room Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
    --bg:#0d1117;--bg2:#161b22;--surface:#21262d;--surface2:#30363d;
    --text:#f0f6fc;--text2:#8b949e;--text3:#656d76;
    --blue:#58a6ff;--green:#3fb950;--yellow:#e3b341;--red:#f85149;--purple:#bc8cff;
    --border:#30363d;--border2:#21262d;
    --radius:8px;--radius2:12px;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;padding:24px;min-height:100vh}
a{color:var(--blue);text-decoration:none}

/* Header */
.report-header{
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius2);
    padding:24px 28px;margin-bottom:20px;position:relative;overflow:hidden;
    animation:slideDown .4s ease-out;
}
.report-header::before{
    content:'';position:absolute;top:0;left:0;right:0;height:3px;
    background:linear-gradient(90deg,${sevColor},var(--blue),var(--purple));
}
.header-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.header-title{display:flex;align-items:center;gap:12px}
.header-title h1{font-size:20px;font-weight:700;color:var(--text)}
.sev-badge{
    padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;
    background:${sevBg};color:${sevColor};border:1px solid ${sevColor};letter-spacing:.5px;
}
.header-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.meta-pill{
    padding:3px 10px;border-radius:20px;font-size:12px;
    background:var(--surface);border:1px solid var(--border);color:var(--text2);
}
.header-time{font-size:12px;color:var(--text3);margin-top:4px}

/* Summary cards */
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}
.card{
    background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
    padding:16px;text-align:center;animation:slideUp .4s ease-out both;
}
.card-val{font-size:28px;font-weight:700;margin-bottom:2px}
.card-lbl{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px}
.card.has-errors .card-val{color:var(--red)}
.card.has-warnings .card-val{color:var(--yellow)}
.card.has-suspicious .card-val{color:var(--yellow)}
.card.ok .card-val{color:var(--green)}

/* Sections */
section{margin-bottom:20px}
.section-header{
    font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;
    color:var(--text2);padding:12px 16px;background:var(--bg2);
    border:1px solid var(--border);border-bottom:none;border-radius:var(--radius) var(--radius) 0 0;
}
.section-body{
    background:var(--surface);border:1px solid var(--border);
    border-radius:0 0 var(--radius) var(--radius);overflow:hidden;
}

/* Probable cause */
.cause-box{padding:16px 20px}
.cause-label{font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.cause-text{font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px}
.conf-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.conf-badge{padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;border:1px solid}
.conf-high{background:rgba(63,185,80,.15);color:var(--green);border-color:var(--green)}
.conf-medium{background:rgba(227,179,65,.15);color:var(--yellow);border-color:var(--yellow)}
.conf-low{background:rgba(139,148,158,.15);color:var(--text2);border-color:var(--border)}
.evidence-list{list-style:none;border-top:1px solid var(--border2);padding-top:12px;margin-top:4px}
.evidence-list li{padding:4px 0;padding-left:16px;position:relative;color:var(--text2);font-size:13px}
.evidence-list li::before{content:'›';position:absolute;left:0;color:var(--blue)}

/* Tables */
.tbl-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{
    background:var(--bg2);padding:10px 14px;text-align:left;
    font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;
    color:var(--text2);border-bottom:1px solid var(--border);white-space:nowrap;
}
td{padding:10px 14px;border-bottom:1px solid var(--border2);color:var(--text);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(48,54,61,.5)}
.empty-row td{color:var(--text3);font-style:italic;text-align:center;padding:20px}

/* Badges */
.badge{display:inline-block;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:500;border:1px solid}
.badge-green{background:rgba(63,185,80,.15);color:var(--green);border-color:rgba(63,185,80,.3)}
.badge-red{background:rgba(248,81,73,.15);color:var(--red);border-color:rgba(248,81,73,.3)}
.badge-yellow{background:rgba(227,179,65,.15);color:var(--yellow);border-color:rgba(227,179,65,.3)}
.badge-blue{background:rgba(88,166,255,.15);color:var(--blue);border-color:rgba(88,166,255,.3)}
.badge-gray{background:rgba(139,148,158,.15);color:var(--text2);border-color:var(--border)}
.badge-purple{background:rgba(188,140,255,.15);color:var(--purple);border-color:rgba(188,140,255,.3)}

/* Timeline severity row coloring */
tr.sev-critical td{background:rgba(248,81,73,.04)}
tr.sev-warning td{background:rgba(227,179,65,.04)}
.sev-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}
.sev-dot.critical{background:var(--red)}
.sev-dot.warning{background:var(--yellow)}
.sev-dot.info{background:var(--blue)}

/* Flag cell */
.flag-suspicious{color:var(--yellow);font-size:12px}
.flag-none{color:var(--text3)}

/* Direction badges */
.dir-seed{background:rgba(188,140,255,.15);color:var(--purple);border-color:rgba(188,140,255,.3)}
.dir-up{background:rgba(88,166,255,.15);color:var(--blue);border-color:rgba(88,166,255,.3)}
.dir-down{background:rgba(227,179,65,.15);color:var(--yellow);border-color:rgba(227,179,65,.3)}

/* Actions */
.actions-list{list-style:none;padding:16px 20px}
.actions-list li{
    padding:10px 14px;margin-bottom:8px;background:var(--bg2);
    border:1px solid var(--border);border-radius:var(--radius);
    display:flex;gap:10px;align-items:flex-start;
}
.actions-list li:last-child{margin-bottom:0}
.action-num{
    min-width:22px;height:22px;border-radius:50%;background:var(--surface2);
    font-size:11px;font-weight:700;color:var(--text2);display:flex;align-items:center;justify-content:center;
    flex-shrink:0;margin-top:1px;
}
.action-text{color:var(--text);font-size:13px;line-height:1.5}
strong{color:var(--text);font-weight:600}

/* Metadata */
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.meta-item{padding:12px 16px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center}
.meta-item:nth-child(odd){border-right:1px solid var(--border2)}
.meta-item:last-child,.meta-item:nth-last-child(2):nth-child(odd){border-bottom:none}
.meta-key{color:var(--text2);font-size:12px}
.meta-val{color:var(--text);font-size:13px;font-weight:500;text-align:right}

/* Error item */
.err-item{padding:8px 16px;border-bottom:1px solid var(--border2);display:flex;gap:8px;align-items:flex-start}
.err-item:last-child{border-bottom:none}
.err-icon{color:var(--red);font-size:14px;flex-shrink:0;margin-top:1px}
.err-text{font-size:12px;color:var(--text2)}
.err-text strong{color:var(--text)}

/* Action buttons */
.header-actions{display:flex;gap:8px;margin-top:12px}
.btn{
    display:inline-flex;align-items:center;gap:5px;padding:6px 14px;
    background:var(--surface);border:1px solid var(--border);border-radius:6px;
    color:var(--text);font-size:12px;font-weight:500;cursor:pointer;
    transition:all .2s ease;white-space:nowrap;
}
.btn:hover{background:var(--surface2);border-color:var(--blue);color:var(--blue);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn-icon{font-size:14px}

/* Inline app action links */
.app-actions{display:flex;gap:4px;margin-top:2px}
.app-link{
    padding:2px 8px;border-radius:4px;font-size:11px;
    color:var(--blue);background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.15);
    cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:3px;
}
.app-link:hover{background:rgba(88,166,255,.15);border-color:rgba(88,166,255,.3)}

/* Expandable error patterns */
.err-pattern{cursor:pointer;position:relative}
.err-pattern:hover{color:var(--blue)}
.err-short{display:inline}
.err-full{display:none;white-space:pre-wrap;word-break:break-all;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text2);max-height:200px;overflow-y:auto}
.err-pattern.expanded .err-short{display:none}
.err-pattern.expanded .err-full{display:block}
.err-expand-hint{color:var(--text3);font-size:10px;margin-left:4px}

/* Toast notifications */
.toast{
    position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border);
    border-radius:var(--radius);padding:10px 18px;font-size:13px;color:var(--text);
    box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:100;opacity:0;transform:translateY(10px);
    transition:all .3s ease;pointer-events:none;
}
.toast.show{opacity:1;transform:translateY(0)}

/* Footer */
.report-footer{text-align:center;color:var(--text3);font-size:12px;margin-top:28px;padding-top:16px;border-top:1px solid var(--border2)}

/* Animations */
@keyframes slideDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>

<!-- Header -->
<div class="report-header">
    <div class="header-top">
        <div>
            <div class="header-title">
                <span class="sev-badge">${escHtml(config.severity)}</span>
                <h1>War Room Incident Report</h1>
            </div>
            <div class="header-meta">
                <span class="meta-pill">🏢 ${escHtml(config.environment)}</span>
                <span class="meta-pill">📱 ${config.applications.map(a => escHtml(a.name)).join(', ')}</span>
            </div>
            <div class="header-time">
                ${fmtDate(config.timeWindow.start)} → ${fmtDate(config.timeWindow.end)}
                &nbsp;·&nbsp; Generated ${fmtDate(new Date(report.generatedAt))}
            </div>
            <div class="header-actions">
                <button class="btn" onclick="copyReport()"><span class="btn-icon">📋</span> Copy Report</button>
                <button class="btn" onclick="refreshReport()"><span class="btn-icon">🔄</span> Refresh</button>
                <button class="btn" onclick="openMarkdown()"><span class="btn-icon">📄</span> Open Markdown</button>
            </div>
        </div>
    </div>
</div>

<!-- Summary cards -->
<div class="summary-grid">
    <div class="card">
        <div class="card-val">${apps.size}</div>
        <div class="card-lbl">Apps Analyzed</div>
    </div>
    <div class="card ${totalErrors > 0 ? 'has-errors' : 'ok'}">
        <div class="card-val">${totalErrors}</div>
        <div class="card-lbl">Log Errors</div>
    </div>
    <div class="card ${totalWarnings > 0 ? 'has-warnings' : 'ok'}">
        <div class="card-val">${totalWarnings}</div>
        <div class="card-lbl">Log Warnings</div>
    </div>
    <div class="card ${totalDeployments > 0 ? 'has-warnings' : 'ok'}">
        <div class="card-val">${totalDeployments}</div>
        <div class="card-lbl">Deployments</div>
    </div>
    <div class="card ${suspiciousDeployments > 0 ? 'has-suspicious' : 'ok'}">
        <div class="card-val">${suspiciousDeployments}</div>
        <div class="card-lbl">Suspicious</div>
    </div>
    <div class="card ${totalAnomalies > 0 ? 'has-errors' : 'ok'}">
        <div class="card-val">${totalAnomalies}</div>
        <div class="card-lbl">Anomalies</div>
    </div>
</div>

<!-- Probable Cause -->
<section>
    <div class="section-header">🔍 Probable Cause</div>
    <div class="section-body">
        <div class="cause-box">
            <div class="cause-label">Assessment</div>
            <div class="cause-text">${primary ? escHtml(primary.probableCause) : 'Insufficient data for root cause analysis'}</div>
            ${primary ? `<div class="conf-row">
                <span class="conf-badge ${confClass(primary.confidence)}">${primary.confidence.toUpperCase()} CONFIDENCE</span>
                <span style="font-size:12px;color:var(--text3)">${primary.category.replace(/_/g, ' ').toUpperCase()}</span>
            </div>
            <ul class="evidence-list">
                ${primary.evidence.map(e => `<li>${escHtml(e)}</li>`).join('')}
            </ul>` : '<p style="color:var(--text3);font-size:13px">No correlation patterns detected in the collected data.</p>'}
        </div>
    </div>
</section>

<!-- Blast Radius -->
<section>
    <div class="section-header">💥 Blast Radius (${blastRows.length} apps)</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr>
                <th>Application</th><th>Direction</th><th>Hops</th>
                <th>Status</th><th>Errors</th><th>Warnings</th><th>Actions</th>
            </tr></thead>
            <tbody>
            ${blastRows.map(r => {
                const appData = apps.get(r.app);
                const st = appData?.status.status || 'UNKNOWN';
                return `<tr>
                    <td><strong>${escHtml(r.app)}</strong></td>
                    <td><span class="badge badge-${dirBadge(r.dir)} dir-${r.dir.toLowerCase()}">${r.dir}</span></td>
                    <td style="color:var(--text2)">${r.hops}</td>
                    <td>${statusBadge(st)}</td>
                    <td>${appData?.logs.errors ? `<span style="color:var(--red);font-weight:600">${appData.logs.errors}</span>` : '<span style="color:var(--text3)">0</span>'}</td>
                    <td>${appData?.logs.warnings ? `<span style="color:var(--yellow)">${appData.logs.warnings}</span>` : '<span style="color:var(--text3)">0</span>'}</td>
                    <td><div class="app-actions"><span class="app-link" onclick="openCommandCenter('${escHtml(r.app)}')">Command Center</span><span class="app-link" onclick="openLogs('${escHtml(r.app)}')">Logs</span></div></td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Timeline -->
<section>
    <div class="section-header">⏱ Timeline (${timeline.length} events)</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>Time</th><th>App</th><th>Type</th><th>Severity</th><th>Description</th></tr></thead>
            <tbody>
            ${timeline.length === 0
                ? `<tr class="empty-row"><td colspan="5">No significant events detected in the time window.</td></tr>`
                : timeline.slice(0, 100).map(ev => `<tr class="sev-${ev.severity}">
                    <td style="white-space:nowrap;color:var(--text2);font-size:12px">${fmtTime(ev.timestamp)}</td>
                    <td style="white-space:nowrap"><strong>${escHtml(ev.app)}</strong></td>
                    <td><span class="badge badge-gray">${escHtml(ev.type)}</span></td>
                    <td><span class="sev-dot ${ev.severity}"></span>${escHtml(ev.severity)}</td>
                    <td style="color:var(--text2);font-size:12px">${escHtml(ev.description.substring(0, 120))}</td>
                </tr>`).join('')
            }
            ${timeline.length > 100 ? `<tr class="empty-row"><td colspan="5">${timeline.length - 100} more events omitted</td></tr>` : ''}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Error Summary -->
<section>
    <div class="section-header">🚨 Error Summary</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>App</th><th>Count</th><th>First Seen</th><th>Last Seen</th><th>Pattern</th></tr></thead>
            <tbody>
            ${(() => {
                const rows: string[] = [];
                for (const [appName, appData] of apps) {
                    for (const g of appData.logs.groups.filter(g => g.level === 'ERROR').slice(0, 10)) {
                        const short = escHtml(g.pattern.substring(0, 100));
                        const full = escHtml(g.pattern);
                        const expandable = g.pattern.length > 100;
                        rows.push(`<tr>
                            <td><strong>${escHtml(appName)}</strong></td>
                            <td><span style="color:var(--red);font-weight:600">${g.count}</span></td>
                            <td style="font-size:12px;color:var(--text2)">${fmtTime(g.firstSeen)}</td>
                            <td style="font-size:12px;color:var(--text2)">${fmtTime(g.lastSeen)}</td>
                            <td style="font-family:monospace;font-size:12px;color:var(--text2)">${expandable
                                ? `<div class="err-pattern" onclick="this.classList.toggle('expanded')"><span class="err-short">${short}…<span class="err-expand-hint">(click to expand)</span></span><div class="err-full">${full}</div></div>`
                                : short}</td>
                        </tr>`);
                    }
                }
                return rows.length > 0
                    ? rows.join('')
                    : `<tr class="empty-row"><td colspan="5">No ERROR-level log entries found in the time window.</td></tr>`;
            })()}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Warning Summary -->
${renderWarningsSectionHtml(apps)}

<!-- Recent Deployments -->
<section>
    <div class="section-header">🚀 Recent Deployments</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>App</th><th>Version</th><th>Timestamp</th><th>Status</th><th>Triggered By</th><th>Flag</th></tr></thead>
            <tbody>
            ${(() => {
                const rows: string[] = [];
                for (const [, appData] of apps) {
                    for (const dep of appData.deployments) {
                        const flag = dep.suspicious
                            ? `<span class="flag-suspicious">⚠ ${escHtml(dep.suspiciousReason || 'Near incident window')}</span>`
                            : `<span class="flag-none">—</span>`;
                        rows.push(`<tr${dep.suspicious ? ' class="sev-warning"' : ''}>
                            <td><strong>${escHtml(dep.appName)}</strong></td>
                            <td><code style="font-size:12px;color:var(--blue)">${escHtml(dep.version)}</code></td>
                            <td style="font-size:12px;color:var(--text2);white-space:nowrap">${fmtTime(dep.timestamp)}</td>
                            <td>${statusBadge(dep.status)}</td>
                            <td style="color:var(--text2)">${escHtml(dep.triggeredBy)}</td>
                            <td>${flag}</td>
                        </tr>`);
                    }
                }
                return rows.length > 0
                    ? rows.join('')
                    : `<tr class="empty-row"><td colspan="6">No deployments found in or near the time window.</td></tr>`;
            })()}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Metric Anomalies -->
<section>
    <div class="section-header">📈 Metric Anomalies</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>App</th><th>Metric</th><th>Current</th><th>Baseline</th><th>Deviation</th><th>Severity</th></tr></thead>
            <tbody>
            ${(() => {
                const rows: string[] = [];
                for (const [appName, appData] of apps) {
                    for (const a of appData.metrics.anomalies) {
                        rows.push(`<tr>
                            <td><strong>${escHtml(appName)}</strong></td>
                            <td>${escHtml(a.metric)}</td>
                            <td style="color:var(--red);font-weight:600">${fmtMetric(a.current, a.metric)}</td>
                            <td style="color:var(--text2)">${fmtMetric(a.baseline, a.metric)}</td>
                            <td><span class="badge badge-yellow">${a.deviation.toFixed(1)}x</span></td>
                            <td>${a.severity === 'high'
                                ? '<span class="badge badge-red">HIGH</span>'
                                : '<span class="badge badge-yellow">MEDIUM</span>'}</td>
                        </tr>`);
                    }
                }
                return rows.length > 0
                    ? rows.join('')
                    : `<tr class="empty-row"><td colspan="6">No metric anomalies detected.</td></tr>`;
            })()}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Application Status -->
<section>
    <div class="section-header">🖥 Application Status</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>Application</th><th>Status</th><th>Workers</th><th>Mule Runtime</th><th>Region</th><th>Last Modified</th><th>Actions</th></tr></thead>
            <tbody>
            ${[...apps.values()].map(appData => {
                const s = appData.status;
                return `<tr>
                    <td><strong>${escHtml(s.name)}</strong></td>
                    <td>${statusBadge(s.status)}</td>
                    <td style="color:var(--text2)">${s.workerCount ?? '—'}</td>
                    <td style="font-size:12px;color:var(--text2)">${s.runtimeVersion ? escHtml(s.runtimeVersion) : '—'}</td>
                    <td style="font-size:12px;color:var(--text2)">${s.region ? escHtml(s.region) : '—'}</td>
                    <td style="font-size:12px;color:var(--text2)">${s.lastRestart ? fmtTime(s.lastRestart) : '—'}</td>
                    <td><div class="app-actions"><span class="app-link" onclick="openCommandCenter('${escHtml(s.name)}')">Command Center</span><span class="app-link" onclick="openLogs('${escHtml(s.name)}')">Logs</span></div></td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>
        </div>
    </div>
</section>

<!-- Recommended Actions -->
<section>
    <div class="section-header">✅ Recommended Actions</div>
    <div class="section-body">
        <ol class="actions-list">
        ${generateRecommendations(report).map((action, i) => `
            <li>
                <div class="action-num">${i + 1}</div>
                <div class="action-text">${markdownBold(escHtml(action))}</div>
            </li>
        `).join('')}
        </ol>
    </div>
</section>

<!-- Collection Metadata -->
<section>
    <div class="section-header">📋 Collection Metadata</div>
    <div class="section-body">
        <div class="meta-grid">
            <div class="meta-item"><span class="meta-key">Collection Time</span><span class="meta-val">${(collectionTime / 1000).toFixed(1)}s</span></div>
            <div class="meta-item"><span class="meta-key">Apps Analyzed</span><span class="meta-val">${apps.size}</span></div>
            <div class="meta-item"><span class="meta-key">Timeline Events</span><span class="meta-val">${timeline.length}</span></div>
            <div class="meta-item"><span class="meta-key">Collection Errors</span><span class="meta-val ${collectionErrors.length > 0 ? 'style="color:var(--red)"' : ''}">${collectionErrors.length}</span></div>
        </div>
        ${collectionErrors.length > 0 ? `
        <div style="border-top:1px solid var(--border2)">
            ${collectionErrors.map(err => `
            <div class="err-item">
                <span class="err-icon">⚠</span>
                <span class="err-text"><strong>${escHtml(err.collector)}</strong> (${escHtml(err.app)}): ${escHtml(err.error)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>
</section>

<div class="report-footer">Generated by Anypoint Monitor War Room Mode · ${fmtDate(new Date(report.generatedAt))}</div>
<div class="toast" id="toast"></div>
<script>
const vscode = acquireVsCodeApi();
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
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
</script>
</body>
</html>`;
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

function escHtml(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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
        return `<span class="badge badge-green">${escHtml(status)}</span>`;
    }
    if (['STOPPED', 'FAILED', 'UNDEPLOYED'].includes(upper)) {
        return `<span class="badge badge-red">${escHtml(status)}</span>`;
    }
    if (['DEPLOYING', 'STARTING', 'RESTARTING'].includes(upper)) {
        return `<span class="badge badge-yellow">${escHtml(status)}</span>`;
    }
    return `<span class="badge badge-gray">${escHtml(status)}</span>`;
}

function confClass(confidence: string): string {
    if (confidence === 'high') { return 'conf-high'; }
    if (confidence === 'medium') { return 'conf-medium'; }
    return 'conf-low';
}

function dirBadge(dir: string): string {
    if (dir === 'SEED') { return 'purple dir-seed'; }
    if (dir === 'UPSTREAM') { return 'blue dir-up'; }
    return 'yellow dir-down';
}

function renderWarningsSectionHtml(apps: Map<string, import('./types').AppWarRoomData>): string {
    const rows: string[] = [];
    for (const [appName, appData] of apps) {
        for (const g of appData.logs.groups.filter(g => g.level === 'WARN').slice(0, 10)) {
            const short = escHtml(g.pattern.substring(0, 100));
            const full = escHtml(g.pattern);
            const expandable = g.pattern.length > 100;
            rows.push(`<tr>
                <td><strong>${escHtml(appName)}</strong></td>
                <td><span style="color:var(--yellow);font-weight:600">${g.count}</span></td>
                <td style="font-size:12px;color:var(--text2)">${fmtTime(g.firstSeen)}</td>
                <td style="font-size:12px;color:var(--text2)">${fmtTime(g.lastSeen)}</td>
                <td style="font-family:monospace;font-size:12px;color:var(--text2)">${expandable
                    ? `<div class="err-pattern" onclick="this.classList.toggle('expanded')"><span class="err-short">${short}…<span class="err-expand-hint">(click to expand)</span></span><div class="err-full">${full}</div></div>`
                    : short}</td>
            </tr>`);
        }
    }

    const tbody = rows.length > 0
        ? rows.join('')
        : `<tr class="empty-row"><td colspan="5">No WARN-level log entries found in the time window.</td></tr>`;

    return `<section>
    <div class="section-header">⚠ Warning Summary</div>
    <div class="section-body">
        <div class="tbl-wrap">
        <table>
            <thead><tr><th>App</th><th>Count</th><th>First Seen</th><th>Last Seen</th><th>Pattern</th></tr></thead>
            <tbody>${tbody}</tbody>
        </table>
        </div>
    </div>
</section>`;
}
