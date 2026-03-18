import * as vscode from 'vscode';
import { AlertEngine } from './alertEngine';
import { AccountService } from '../../controllers/accountService';
import { AlertConfig, PollingInterval } from './types';
import { telemetryService } from '../../services/telemetryService';

export async function showAlertingHub(context: vscode.ExtensionContext): Promise<void> {
    telemetryService.trackPageView('alertingHub');

    const engine = AlertEngine.getInstance(context);

    const panel = vscode.window.createWebviewPanel(
        'alertingHub',
        'Alerting Hub',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    engine.setPanel(panel);

    const state = engine.getState();
    const config = engine.getConfig();

    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    let environments: Array<{ id: string; name: string }> = [];

    if (activeAccount) {
        try {
            const envJson = await accountService.getActiveAccountEnvironments();
            if (envJson) {
                const parsed = JSON.parse(envJson);
                environments = (parsed.data || parsed || []).map((e: any) => ({
                    id: e.id,
                    name: e.name
                }));
            }
        } catch { /* no environments */ }
    }

    panel.webview.html = getAlertingHubHtml(state, config, environments);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'startPolling': {
                const envIds: string[] = message.environments || [];
                const envs = environments.filter(e => envIds.includes(e.id));
                engine.updateConfig({
                    enabled: true,
                    monitoredEnvironments: envs,
                    pollingIntervalMs: message.interval || 60000
                });
                engine.start();
                break;
            }
            case 'stopPolling':
                engine.stop();
                break;
            case 'acknowledge':
                engine.acknowledgeAlert(message.eventId);
                break;
            case 'snooze':
                engine.snoozeAlert(message.eventId, message.durationMs);
                break;
            case 'resolve':
                engine.resolveAlert(message.eventId);
                break;
            case 'clearResolved':
                engine.clearResolved();
                break;
            case 'muteApp':
                engine.muteApp(message.appName);
                break;
            case 'unmuteApp':
                engine.unmuteApp(message.appName);
                break;
            case 'updateRule': {
                const cfg = engine.getConfig();
                const rule = cfg.rules.find(r => r.id === message.ruleId);
                if (rule) {
                    if (message.enabled !== undefined) { rule.enabled = message.enabled; }
                    if (message.threshold !== undefined) { rule.threshold = message.threshold; }
                    engine.updateConfig({ rules: cfg.rules });
                }
                break;
            }
            case 'updateInterval':
                engine.updateConfig({ pollingIntervalMs: message.interval as PollingInterval });
                if (engine.isRunning()) {
                    engine.stop();
                    engine.start();
                }
                break;
            case 'exportCsv':
                await exportAlertsCsv(engine);
                break;
        }
    });

    panel.onDidDispose(() => {
        engine.setPanel(undefined);
    });
}

async function exportAlertsCsv(engine: AlertEngine): Promise<void> {
    const state = engine.getState();
    const rows = ['Timestamp,App,Rule,Severity,Status,Message'];
    for (const e of state.events) {
        rows.push(`"${e.firedAt}","${e.appName}","${e.ruleName}","${e.severity}","${e.status}","${e.message.replace(/"/g, '""')}"`);
    }

    const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Alerts CSV'
    });
    if (uri) {
        const fs = await import('fs');
        await fs.promises.writeFile(uri.fsPath, rows.join('\n'), 'utf-8');
        vscode.window.showInformationMessage(`Alerts exported to ${uri.fsPath}`);
    }
}

function getAlertingHubHtml(
    state: any,
    config: AlertConfig,
    environments: Array<{ id: string; name: string }>
): string {
    const eventsJson = JSON.stringify(state.events || []);
    const configJson = JSON.stringify(config);
    const envsJson = JSON.stringify(environments);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Alerting Hub</title>
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
.header-actions { display: flex; gap: 8px; }
.btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); color: var(--text); cursor: pointer; font-size: 13px; }
.btn:hover { background: var(--border); }
.btn-primary { background: var(--blue); border-color: var(--blue); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-danger { background: var(--red); border-color: var(--red); color: #fff; }
.btn-danger:hover { opacity: 0.9; }

.tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.tab { padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); font-size: 13px; }
.tab.active { color: var(--blue); border-bottom-color: var(--blue); }
.tab-content { display: none; }
.tab-content.active { display: block; }

.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; text-align: center; }
.card-value { font-size: 28px; font-weight: 700; }
.card-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; }
.card-value.critical { color: var(--red); }
.card-value.warning { color: var(--yellow); }
.card-value.ok { color: var(--green); }

.status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.status-badge.active { background: rgba(244,71,71,0.15); color: var(--red); }
.status-badge.acknowledged { background: rgba(204,167,0,0.15); color: var(--yellow); }
.status-badge.snoozed { background: rgba(86,156,214,0.15); color: var(--blue); }
.status-badge.resolved { background: rgba(78,201,176,0.15); color: var(--green); }

.sev-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.sev-badge.critical { background: rgba(244,71,71,0.2); color: var(--red); }
.sev-badge.warning { background: rgba(204,167,0,0.2); color: var(--yellow); }
.sev-badge.info { background: rgba(86,156,214,0.2); color: var(--blue); }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
tr:hover { background: var(--surface); }
.actions-cell { display: flex; gap: 4px; }
.actions-cell .btn { padding: 3px 8px; font-size: 11px; }

.config-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.config-section h3 { font-size: 14px; margin-bottom: 12px; }
.config-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.config-row label { min-width: 160px; font-size: 13px; }
.config-row input, .config-row select { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 4px 8px; font-size: 13px; }
.config-row input[type="checkbox"] { width: 16px; height: 16px; }

.env-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.env-chip { padding: 4px 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; font-size: 12px; cursor: pointer; }
.env-chip.selected { background: var(--blue); border-color: var(--blue); color: #fff; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state h2 { font-size: 18px; margin-bottom: 8px; color: var(--text); }

.info-banner { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; overflow: hidden; }
.info-banner-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; user-select: none; }
.info-banner-header h3 { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.info-banner-body { padding: 0 14px 14px; font-size: 12px; line-height: 1.6; color: var(--text-muted); }
.info-banner-body .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 10px; }
.info-banner-body .step { background: var(--surface2); border-radius: var(--radius); padding: 12px; }
.info-banner-body .step-number { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--blue); color: #fff; font-size: 11px; font-weight: 700; margin-bottom: 6px; }
.info-banner-body .step-title { font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
.info-banner-body .what-monitored { margin-top: 12px; }
.info-banner-body .what-monitored ul { margin: 4px 0 0 16px; }
.chevron { transition: transform 0.2s; display: inline-block; }
.chevron.collapsed { transform: rotate(-90deg); }

.onboarding { text-align: center; padding: 40px 20px; }
.onboarding h2 { font-size: 20px; margin-bottom: 6px; color: var(--text); }
.onboarding p { color: var(--text-muted); font-size: 13px; margin-bottom: 20px; max-width: 480px; margin-left: auto; margin-right: auto; }
.onboarding .btn-primary { font-size: 14px; padding: 10px 24px; }

.polling-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
.polling-dot { width: 8px; height: 8px; border-radius: 50%; }
.polling-dot.active { background: var(--green); animation: pulse 2s infinite; }
.polling-dot.inactive { background: var(--red); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

.filter-bar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.filter-bar select, .filter-bar input { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 5px 8px; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
    <div>
        <h1>Alerting Hub</h1>
        <div class="polling-indicator">
            <span class="polling-dot ${state.isPolling ? 'active' : 'inactive'}"></span>
            <span id="pollingStatus">${state.isPolling ? 'Monitoring active' : 'Monitoring paused'}</span>
            <span id="lastPollTime" style="margin-left:8px">${state.lastPollAt ? `Last poll: ${new Date(state.lastPollAt).toLocaleTimeString()}` : ''}</span>
        </div>
    </div>
    <div class="header-actions">
        <button class="btn" onclick="exportCsv()">Export CSV</button>
        <span id="monitorToggleContainer">
        ${state.isPolling
            ? '<button class="btn btn-danger" onclick="stopPolling()">Stop Monitoring</button>'
            : '<button class="btn btn-primary" onclick="startPolling()">Start Monitoring</button>'
        }
        </span>
    </div>
</div>

<div class="tabs">
    <div class="tab active" data-tab="alerts" onclick="switchTab('alerts')">Alerts</div>
    <div class="tab" data-tab="config" onclick="switchTab('config')">Configuration</div>
</div>

<div id="tab-alerts" class="tab-content active">
    <div class="info-banner" id="infoBanner">
        <div class="info-banner-header" onclick="toggleInfoBanner()">
            <h3><span>&#9432;</span> How the Alerting Hub Works</h3>
            <span class="chevron" id="infoBannerChevron">&#9660;</span>
        </div>
        <div class="info-banner-body" id="infoBannerBody">
            <div class="steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-title">Select Environments</div>
                    Go to the <strong>Configuration</strong> tab and click on the environments you want to monitor.
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-title">Start Monitoring</div>
                    Click <strong>Start Monitoring</strong>. The engine will poll your apps at the configured interval (default: 60s).
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-title">Get Alerted</div>
                    When a rule condition is met, an alert fires here and a VS Code notification appears. The status bar also shows the active alert count.
                </div>
                <div class="step">
                    <div class="step-number">4</div>
                    <div class="step-title">Take Action</div>
                    <strong>Acknowledge</strong> to signal you're on it, <strong>Snooze</strong> to silence temporarily, <strong>Resolve</strong> when fixed, or <strong>Mute App</strong> to exclude noisy apps.
                </div>
            </div>
            <div class="what-monitored">
                <strong style="color:var(--text)">What is checked on every poll:</strong>
                <ul>
                    <li><strong>App Status</strong> &mdash; Alerts if any app is not in a healthy running state (STARTED for CH1, APPLIED/RUNNING for CH2)</li>
                    <li><strong>CPU Usage</strong> &mdash; Warning at 85%, Critical at 95%</li>
                    <li><strong>Memory Usage</strong> &mdash; Warning at 85%, Critical at 95%</li>
                    <li><strong>Error Rate</strong> &mdash; Warning when errors exceed 5% of total requests</li>
                </ul>
                <p style="margin-top:8px">All thresholds and rules are customizable in the <strong>Configuration</strong> tab. You can stop monitoring at any time.</p>
            </div>
        </div>
    </div>

    <div id="onboardingSection" style="${state.isPolling || (state.events && state.events.length > 0) ? 'display:none' : ''}">
        <div class="onboarding">
            <h2>No Active Monitoring</h2>
            <p>Select environments in the <strong>Configuration</strong> tab, then click <strong>Start Monitoring</strong> to begin. The Alerting Hub continuously checks your CloudHub 1.0 and 2.0 applications for issues and notifies you in real time.</p>
            <button class="btn btn-primary" onclick="switchTab('config')">Go to Configuration</button>
        </div>
    </div>

    <div id="alertsDashboard" style="${!state.isPolling && (!state.events || state.events.length === 0) ? 'display:none' : ''}">
        <div class="summary-cards">
            <div class="card"><div class="card-value" id="totalAlerts">0</div><div class="card-label">Total Active</div></div>
            <div class="card"><div class="card-value critical" id="criticalAlerts">0</div><div class="card-label">Critical</div></div>
            <div class="card"><div class="card-value warning" id="warningAlerts">0</div><div class="card-label">Warning</div></div>
            <div class="card"><div class="card-value ok" id="resolvedAlerts">0</div><div class="card-label">Resolved</div></div>
        </div>

        <div class="filter-bar">
            <select id="statusFilter" onchange="filterAlerts()">
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="snoozed">Snoozed</option>
                <option value="resolved">Resolved</option>
            </select>
            <select id="severityFilter" onchange="filterAlerts()">
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
            </select>
            <input type="text" id="searchInput" placeholder="Search alerts..." oninput="filterAlerts()" style="flex:1"/>
            <button class="btn" onclick="clearResolved()">Clear Resolved</button>
        </div>

        <div id="alertsTable"></div>
    </div>
</div>

<div id="tab-config" class="tab-content">
    <div class="config-section">
        <h3>Monitoring Settings</h3>
        <div class="config-row">
            <label>Polling Interval</label>
            <select id="intervalSelect" onchange="updateInterval()">
                <option value="30000" ${config.pollingIntervalMs === 30000 ? 'selected' : ''}>30 seconds</option>
                <option value="60000" ${config.pollingIntervalMs === 60000 ? 'selected' : ''}>1 minute</option>
                <option value="300000" ${config.pollingIntervalMs === 300000 ? 'selected' : ''}>5 minutes</option>
            </select>
        </div>
    </div>

    <div class="config-section">
        <h3>Monitored Environments</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Select environments to monitor. Click to toggle.</p>
        <div class="env-list" id="envList">
            ${environments.map(e => {
                const selected = config.monitoredEnvironments.some(me => me.id === e.id);
                return `<div class="env-chip ${selected ? 'selected' : ''}" data-id="${e.id}" data-name="${e.name}" onclick="toggleEnv(this)">${e.name}</div>`;
            }).join('')}
        </div>
    </div>

    <div class="config-section">
        <h3>Alert Rules</h3>
        <table>
            <thead><tr><th>Enabled</th><th>Rule</th><th>Description</th><th>Severity</th><th>Threshold</th></tr></thead>
            <tbody>
            ${config.rules.map(r => `
                <tr>
                    <td><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRule('${r.id}', this.checked)"/></td>
                    <td>${r.name}</td>
                    <td style="color:var(--text-muted)">${r.description}</td>
                    <td><span class="sev-badge ${r.severity}">${r.severity}</span></td>
                    <td><input type="text" value="${r.threshold}" style="width:60px" onchange="updateThreshold('${r.id}', this.value)"/></td>
                </tr>
            `).join('')}
            </tbody>
        </table>
    </div>

    <div class="config-section">
        <h3>Muted Applications</h3>
        ${config.mutedApps.length === 0
            ? '<p style="color:var(--text-muted);font-size:12px">No muted applications</p>'
            : config.mutedApps.map(a => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span>${a}</span><button class="btn" onclick="unmuteApp('${a}')" style="padding:2px 6px;font-size:11px">Unmute</button></div>`).join('')
        }
    </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let allEvents = ${eventsJson};
let currentConfig = ${configJson};
const allEnvironments = ${envsJson};
let isPolling = ${state.isPolling ? 'true' : 'false'};

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => { if (t.getAttribute('data-tab') === tab) { t.classList.add('active'); } });
    document.getElementById('tab-' + tab).classList.add('active');
}

function toggleInfoBanner() {
    const body = document.getElementById('infoBannerBody');
    const chevron = document.getElementById('infoBannerChevron');
    if (body.style.display === 'none') {
        body.style.display = '';
        chevron.classList.remove('collapsed');
    } else {
        body.style.display = 'none';
        chevron.classList.add('collapsed');
    }
}

function updateSectionVisibility() {
    const hasEvents = allEvents && allEvents.length > 0;
    const onboarding = document.getElementById('onboardingSection');
    const dashboard = document.getElementById('alertsDashboard');
    if (isPolling || hasEvents) {
        onboarding.style.display = 'none';
        dashboard.style.display = '';
    } else {
        onboarding.style.display = '';
        dashboard.style.display = 'none';
    }
}

function renderAlerts() {
    updateSectionVisibility();

    if (!isPolling && (!allEvents || allEvents.length === 0)) {
        return;
    }

    const statusFilter = document.getElementById('statusFilter').value;
    const sevFilter = document.getElementById('severityFilter').value;
    const search = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allEvents;
    if (statusFilter !== 'all') filtered = filtered.filter(e => e.status === statusFilter);
    if (sevFilter !== 'all') filtered = filtered.filter(e => e.severity === sevFilter);
    if (search) filtered = filtered.filter(e => e.appName.toLowerCase().includes(search) || e.message.toLowerCase().includes(search));

    const active = allEvents.filter(e => e.status === 'active');
    document.getElementById('totalAlerts').textContent = active.length;
    document.getElementById('criticalAlerts').textContent = active.filter(e => e.severity === 'critical').length;
    document.getElementById('warningAlerts').textContent = active.filter(e => e.severity === 'warning').length;
    document.getElementById('resolvedAlerts').textContent = allEvents.filter(e => e.status === 'resolved').length;

    if (filtered.length === 0) {
        document.getElementById('alertsTable').innerHTML = isPolling
            ? '<div class="empty-state"><h2>All Clear</h2><p>Monitoring is active. No alerts have been triggered — your applications are healthy.</p></div>'
            : '<div class="empty-state"><h2>No alerts</h2><p>Start monitoring to see alerts here.</p></div>';
        return;
    }

    let html = '<table><thead><tr><th>Time</th><th>App</th><th>Severity</th><th>Status</th><th>Message</th><th>Actions</th></tr></thead><tbody>';
    for (const e of filtered) {
        const time = new Date(e.firedAt).toLocaleString();
        html += '<tr>';
        html += '<td style="white-space:nowrap">' + time + '</td>';
        html += '<td><strong>' + e.appName + '</strong><br/><span style="font-size:11px;color:var(--text-muted)">' + e.environmentName + ' / ' + e.appType + '</span></td>';
        html += '<td><span class="sev-badge ' + e.severity + '">' + e.severity + '</span></td>';
        html += '<td><span class="status-badge ' + e.status + '">' + e.status + '</span></td>';
        html += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">' + e.message + '</td>';
        html += '<td class="actions-cell">';
        if (e.status === 'active') {
            html += '<button class="btn" onclick="ack(\\'' + e.id + '\\')">Ack</button>';
            html += '<button class="btn" onclick="snooze(\\'' + e.id + '\\', 3600000)">Snooze 1h</button>';
            html += '<button class="btn" onclick="resolve(\\'' + e.id + '\\')">Resolve</button>';
            html += '<button class="btn" onclick="muteApp(\\'' + e.appName + '\\')">Mute App</button>';
        } else if (e.status === 'acknowledged') {
            html += '<button class="btn" onclick="resolve(\\'' + e.id + '\\')">Resolve</button>';
        }
        html += '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById('alertsTable').innerHTML = html;
}

function filterAlerts() { renderAlerts(); }
function ack(id) { vscode.postMessage({ command: 'acknowledge', eventId: id }); }
function snooze(id, ms) { vscode.postMessage({ command: 'snooze', eventId: id, durationMs: ms }); }
function resolve(id) { vscode.postMessage({ command: 'resolve', eventId: id }); }
function clearResolved() { vscode.postMessage({ command: 'clearResolved' }); }
function muteApp(name) { vscode.postMessage({ command: 'muteApp', appName: name }); }
function unmuteApp(name) { vscode.postMessage({ command: 'unmuteApp', appName: name }); }
function exportCsv() { vscode.postMessage({ command: 'exportCsv' }); }

function toggleRule(id, enabled) { vscode.postMessage({ command: 'updateRule', ruleId: id, enabled: enabled }); }
function updateThreshold(id, val) {
    const num = parseFloat(val);
    vscode.postMessage({ command: 'updateRule', ruleId: id, threshold: isNaN(num) ? val : num });
}
function updateInterval() {
    const val = parseInt(document.getElementById('intervalSelect').value);
    vscode.postMessage({ command: 'updateInterval', interval: val });
}

function toggleEnv(el) {
    el.classList.toggle('selected');
}

function getSelectedEnvs() {
    return Array.from(document.querySelectorAll('.env-chip.selected')).map(el => el.dataset.id);
}

function startPolling() {
    const envs = getSelectedEnvs();
    if (envs.length === 0) {
        switchTab('config');
        alert('Select at least one environment to monitor in the Configuration tab, then click Start Monitoring.');
        return;
    }
    const interval = parseInt(document.getElementById('intervalSelect').value);
    vscode.postMessage({ command: 'startPolling', environments: envs, interval: interval });
    switchTab('alerts');
}

function stopPolling() { vscode.postMessage({ command: 'stopPolling' }); }

window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'stateUpdate') {
        allEvents = msg.state.events || [];
        currentConfig = msg.config;
        isPolling = msg.state.isPolling;
        renderAlerts();

        const dot = document.querySelector('.polling-dot');
        const status = document.getElementById('pollingStatus');
        const toggleContainer = document.getElementById('monitorToggleContainer');

        if (isPolling) {
            dot.className = 'polling-dot active';
            status.textContent = 'Monitoring active';
            toggleContainer.innerHTML = '<button class="btn btn-danger" onclick="stopPolling()">Stop Monitoring</button>';
        } else {
            dot.className = 'polling-dot inactive';
            status.textContent = 'Monitoring paused';
            toggleContainer.innerHTML = '<button class="btn btn-primary" onclick="startPolling()">Start Monitoring</button>';
        }

        if (msg.state.lastPollAt) {
            const lastPollEl = document.getElementById('lastPollTime');
            if (lastPollEl) {
                lastPollEl.textContent = 'Last poll: ' + new Date(msg.state.lastPollAt).toLocaleTimeString();
            }
        }
    }
});

renderAlerts();
</script>
</body>
</html>`;
}
