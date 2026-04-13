import * as vscode from 'vscode';
import { AlertEngine } from './alertEngine';
import { AccountService } from '../../controllers/accountService';
import { AlertConfig, PollingInterval } from './types';
import { telemetryService } from '../../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    tabs,
    tabSwitchScript,
    emptyState,
    escapeHtml as uiEscapeHtml,
    escapeAttr
} from '../../webview/ui-kit';

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

    const headerHtml = `
    <div class="am-page-header">
        <div>
            <h1>Alerting Hub</h1>
            <div class="ah-polling-indicator">
                <span class="ah-polling-dot ${state.isPolling ? 'ah-active' : 'ah-inactive'}"></span>
                <span id="pollingStatus">${state.isPolling ? 'Monitoring active' : 'Monitoring paused'}</span>
                <span id="lastPollTime" style="margin-left:8px">${state.lastPollAt ? `Last poll: ${new Date(state.lastPollAt).toLocaleTimeString()}` : ''}</span>
            </div>
        </div>
        <div class="am-page-header-right">
            ${button('Export CSV', { variant: 'ghost', onclick: 'exportCsv()' })}
            <span id="monitorToggleContainer">
            ${state.isPolling
                ? button('Stop Monitoring', { variant: 'secondary', onclick: 'stopPolling()' })
                : button('Start Monitoring', { variant: 'primary', onclick: 'startPolling()' })
            }
            </span>
        </div>
    </div>`;

    const tabsHtml = tabs([
        { id: 'alerts', label: 'Alerts', active: true },
        { id: 'config', label: 'Configuration' }
    ]);

    const infoBannerHtml = `
    <div class="ah-info-banner" id="infoBanner">
        <div class="ah-info-banner-header" onclick="toggleInfoBanner()">
            <h3><span>&#9432;</span> How the Alerting Hub Works</h3>
            <span class="ah-chevron" id="infoBannerChevron">&#9660;</span>
        </div>
        <div class="ah-info-banner-body" id="infoBannerBody">
            <div class="ah-steps">
                <div class="ah-step"><div class="ah-step-number">1</div><div class="ah-step-title">Select Environments</div>Go to the <strong>Configuration</strong> tab and click on the environments you want to monitor.</div>
                <div class="ah-step"><div class="ah-step-number">2</div><div class="ah-step-title">Start Monitoring</div>Click <strong>Start Monitoring</strong>. The engine will poll your apps at the configured interval (default: 60s).</div>
                <div class="ah-step"><div class="ah-step-number">3</div><div class="ah-step-title">Get Alerted</div>When a rule condition is met, an alert fires here and a VS Code notification appears. The status bar also shows the active alert count.</div>
                <div class="ah-step"><div class="ah-step-number">4</div><div class="ah-step-title">Take Action</div><strong>Acknowledge</strong> to signal you're on it, <strong>Snooze</strong> to silence temporarily, <strong>Resolve</strong> when fixed, or <strong>Mute App</strong> to exclude noisy apps.</div>
            </div>
            <div class="ah-what-monitored">
                <strong>What is checked on every poll:</strong>
                <ul>
                    <li><strong>App Status</strong> &mdash; Alerts if any app is not in a healthy running state</li>
                    <li><strong>CPU Usage</strong> &mdash; Warning at 85%, Critical at 95%</li>
                    <li><strong>Memory Usage</strong> &mdash; Warning at 85%, Critical at 95%</li>
                    <li><strong>Error Rate</strong> &mdash; Warning when errors exceed 5% of total requests</li>
                </ul>
                <p style="margin-top:8px">All thresholds and rules are customizable in the <strong>Configuration</strong> tab.</p>
            </div>
        </div>
    </div>`;

    const onboardingHtml = `
    <div id="onboardingSection" style="${state.isPolling || (state.events && state.events.length > 0) ? 'display:none' : ''}">
        ${emptyState({
            icon: '📡',
            title: 'No Active Monitoring',
            description: 'Select environments in the Configuration tab, then click Start Monitoring to begin.',
            actionHtml: button('Go to Configuration', { variant: 'primary', onclick: "switchTab('config')" })
        })}
    </div>`;

    const dashboardHtml = `
    <div id="alertsDashboard" style="${!state.isPolling && (!state.events || state.events.length === 0) ? 'display:none' : ''}">
        <div class="am-summary-cards">
            ${summaryCard({ icon: '🔔', value: '0', label: 'Total Active', animationDelay: '0.1s' })}
            ${summaryCard({ icon: '🔴', value: '0', label: 'Critical', variant: 'critical', animationDelay: '0.15s' })}
            ${summaryCard({ icon: '⚠️', value: '0', label: 'Warning', variant: 'warning', animationDelay: '0.2s' })}
            ${summaryCard({ icon: '✅', value: '0', label: 'Resolved', variant: 'healthy', animationDelay: '0.25s' })}
        </div>

        <div class="am-filters">
            <select class="am-select" id="statusFilter" onchange="filterAlerts()">
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="snoozed">Snoozed</option>
                <option value="resolved">Resolved</option>
            </select>
            <select class="am-select" id="severityFilter" onchange="filterAlerts()">
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
            </select>
            <input type="text" class="am-input" id="searchInput" placeholder="Search alerts..." oninput="filterAlerts()"/>
            ${button('Clear Resolved', { variant: 'ghost', onclick: 'clearResolved()' })}
        </div>

        <div id="alertsTable"></div>
    </div>`;

    const configHtml = `
    <div class="ah-config-section">
        <h3>Monitoring Settings</h3>
        <div class="ah-config-row">
            <label>Polling Interval</label>
            <select class="am-select" id="intervalSelect" onchange="updateInterval()">
                <option value="30000" ${config.pollingIntervalMs === 30000 ? 'selected' : ''}>30 seconds</option>
                <option value="60000" ${config.pollingIntervalMs === 60000 ? 'selected' : ''}>1 minute</option>
                <option value="300000" ${config.pollingIntervalMs === 300000 ? 'selected' : ''}>5 minutes</option>
            </select>
        </div>
    </div>

    <div class="ah-config-section">
        <h3>Monitored Environments</h3>
        <p style="font-size:12px;color:var(--am-text-muted);margin-bottom:8px">Select environments to monitor. Click to toggle.</p>
        <div class="ah-env-list" id="envList">
            ${environments.map(e => {
                const selected = config.monitoredEnvironments.some(me => me.id === e.id);
                return `<div class="ah-env-chip ${selected ? 'ah-selected' : ''}" data-id="${escapeAttr(e.id)}" data-name="${escapeAttr(e.name)}" onclick="toggleEnv(this)">${uiEscapeHtml(e.name)}</div>`;
            }).join('')}
        </div>
    </div>

    <div class="ah-config-section">
        <h3>Alert Rules</h3>
        <div class="am-table-container">
            <table class="am-table">
                <thead><tr><th>Enabled</th><th>Rule</th><th>Description</th><th>Severity</th><th>Threshold</th></tr></thead>
                <tbody>
                ${config.rules.map(r => `
                    <tr class="am-row">
                        <td><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRule('${escapeAttr(r.id)}', this.checked)"/></td>
                        <td>${uiEscapeHtml(r.name)}</td>
                        <td style="color:var(--am-text-muted)">${uiEscapeHtml(r.description)}</td>
                        <td>${badge(r.severity, r.severity === 'critical' ? 'error' : r.severity === 'warning' ? 'warning' : 'info')}</td>
                        <td><input type="text" class="am-input" value="${escapeAttr(String(r.threshold))}" style="width:60px" onchange="updateThreshold('${escapeAttr(r.id)}', this.value)"/></td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <div class="ah-config-section">
        <h3>Muted Applications</h3>
        ${config.mutedApps.length === 0
            ? '<p style="color:var(--am-text-muted);font-size:12px">No muted applications</p>'
            : config.mutedApps.map(a => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span>${uiEscapeHtml(a)}</span>${button('Unmute', { variant: 'ghost', onclick: `unmuteApp('${escapeAttr(a)}')` })}</div>`).join('')
        }
    </div>`;

    const body = `
    <div class="am-container">
        ${headerHtml}
        ${tabsHtml}
        <div id="tab-alerts" class="am-tab-panel am-tab-panel-active">
            ${infoBannerHtml}
            ${onboardingHtml}
            ${dashboardHtml}
        </div>
        <div id="tab-config" class="am-tab-panel">
            ${configHtml}
        </div>
    </div>`;

    const scripts = `
    const vscode = acquireVsCodeApi();
    let allEvents = ${eventsJson};
    let currentConfig = ${configJson};
    const allEnvironments = ${envsJson};
    let isPolling = ${state.isPolling ? 'true' : 'false'};

    ${tabSwitchScript()}

    function toggleInfoBanner() {
        const body = document.getElementById('infoBannerBody');
        const chevron = document.getElementById('infoBannerChevron');
        if (body.style.display === 'none') { body.style.display = ''; chevron.classList.remove('ah-collapsed'); }
        else { body.style.display = 'none'; chevron.classList.add('ah-collapsed'); }
    }

    function updateSectionVisibility() {
        const hasEvents = allEvents && allEvents.length > 0;
        const onboarding = document.getElementById('onboardingSection');
        const dashboard = document.getElementById('alertsDashboard');
        if (isPolling || hasEvents) { onboarding.style.display = 'none'; dashboard.style.display = ''; }
        else { onboarding.style.display = ''; dashboard.style.display = 'none'; }
    }

    function renderAlerts() {
        updateSectionVisibility();
        if (!isPolling && (!allEvents || allEvents.length === 0)) return;

        const statusFilter = document.getElementById('statusFilter').value;
        const sevFilter = document.getElementById('severityFilter').value;
        const search = document.getElementById('searchInput').value.toLowerCase();

        let filtered = allEvents;
        if (statusFilter !== 'all') filtered = filtered.filter(e => e.status === statusFilter);
        if (sevFilter !== 'all') filtered = filtered.filter(e => e.severity === sevFilter);
        if (search) filtered = filtered.filter(e => e.appName.toLowerCase().includes(search) || e.message.toLowerCase().includes(search));

        const active = allEvents.filter(e => e.status === 'active');
        document.querySelectorAll('.am-summary-card .am-card-value')[0].textContent = active.length;
        document.querySelectorAll('.am-summary-card .am-card-value')[1].textContent = active.filter(e => e.severity === 'critical').length;
        document.querySelectorAll('.am-summary-card .am-card-value')[2].textContent = active.filter(e => e.severity === 'warning').length;
        document.querySelectorAll('.am-summary-card .am-card-value')[3].textContent = allEvents.filter(e => e.status === 'resolved').length;

        if (filtered.length === 0) {
            document.getElementById('alertsTable').innerHTML = isPolling
                ? '<div class="am-empty-state"><div class="am-empty-state-icon">\\u2705</div><div class="am-empty-state-title">All Clear</div><div class="am-empty-state-description">Monitoring is active. No alerts have been triggered.</div></div>'
                : '<div class="am-empty-state"><div class="am-empty-state-title">No alerts</div><div class="am-empty-state-description">Start monitoring to see alerts here.</div></div>';
            return;
        }

        let html = '<div class="am-table-container"><table class="am-table"><thead><tr><th>Time</th><th>App</th><th>Severity</th><th>Status</th><th>Message</th><th>Actions</th></tr></thead><tbody>';
        for (const e of filtered) {
            const time = new Date(e.firedAt).toLocaleString();
            const sevCls = e.severity === 'critical' ? 'am-badge-error' : e.severity === 'warning' ? 'am-badge-warning' : 'am-badge-info';
            const stCls = e.status === 'active' ? 'am-badge-error' : e.status === 'acknowledged' ? 'am-badge-warning' : e.status === 'snoozed' ? 'am-badge-info' : 'am-badge-success';
            html += '<tr class="am-row">';
            html += '<td style="white-space:nowrap">' + time + '</td>';
            html += '<td><strong>' + escHtml(e.appName) + '</strong><br/><span style="font-size:11px;color:var(--am-text-muted)">' + escHtml(e.environmentName) + ' / ' + escHtml(e.appType) + '</span></td>';
            html += '<td><span class="am-badge am-badge-pill ' + sevCls + '">' + escHtml(e.severity) + '</span></td>';
            html += '<td><span class="am-badge am-badge-pill ' + stCls + '">' + escHtml(e.status) + '</span></td>';
            html += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">' + escHtml(e.message) + '</td>';
            html += '<td class="am-actions">';
            if (e.status === 'active') {
                html += '<button class="am-btn-icon" onclick="ack(\\'' + escAttr(e.id) + '\\')" title="Acknowledge">&#10003;</button>';
                html += '<button class="am-btn-icon" onclick="snooze(\\'' + escAttr(e.id) + '\\', 3600000)" title="Snooze 1h">&#9202;</button>';
                html += '<button class="am-btn-icon" onclick="resolve(\\'' + escAttr(e.id) + '\\')" title="Resolve">&#10004;</button>';
                html += '<button class="am-btn-icon" onclick="muteApp(\\'' + escAttr(e.appName) + '\\')" title="Mute App">&#128263;</button>';
            } else if (e.status === 'acknowledged') {
                html += '<button class="am-btn-icon" onclick="resolve(\\'' + escAttr(e.id) + '\\')" title="Resolve">&#10004;</button>';
            }
            html += '</td></tr>';
        }
        html += '</tbody></table></div>';
        document.getElementById('alertsTable').innerHTML = html;
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function filterAlerts() { renderAlerts(); }
    function ack(id) { vscode.postMessage({ command: 'acknowledge', eventId: id }); }
    function snooze(id, ms) { vscode.postMessage({ command: 'snooze', eventId: id, durationMs: ms }); }
    function resolve(id) { vscode.postMessage({ command: 'resolve', eventId: id }); }
    function clearResolved() { vscode.postMessage({ command: 'clearResolved' }); }
    function muteApp(name) { vscode.postMessage({ command: 'muteApp', appName: name }); }
    function unmuteApp(name) { vscode.postMessage({ command: 'unmuteApp', appName: name }); }
    function exportCsv() { vscode.postMessage({ command: 'exportCsv' }); }
    function toggleRule(id, enabled) { vscode.postMessage({ command: 'updateRule', ruleId: id, enabled: enabled }); }
    function updateThreshold(id, val) { const num = parseFloat(val); vscode.postMessage({ command: 'updateRule', ruleId: id, threshold: isNaN(num) ? val : num }); }
    function updateInterval() { vscode.postMessage({ command: 'updateInterval', interval: parseInt(document.getElementById('intervalSelect').value) }); }
    function toggleEnv(el) { el.classList.toggle('ah-selected'); }
    function getSelectedEnvs() { return Array.from(document.querySelectorAll('.ah-env-chip.ah-selected')).map(el => el.dataset.id); }

    function startPolling() {
        const envs = getSelectedEnvs();
        if (envs.length === 0) { switchTab('config'); return; }
        vscode.postMessage({ command: 'startPolling', environments: envs, interval: parseInt(document.getElementById('intervalSelect').value) });
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

            const dot = document.querySelector('.ah-polling-dot');
            const status = document.getElementById('pollingStatus');
            const toggleContainer = document.getElementById('monitorToggleContainer');

            if (isPolling) {
                dot.className = 'ah-polling-dot ah-active';
                status.textContent = 'Monitoring active';
                toggleContainer.innerHTML = '<button class="am-btn am-btn-secondary" onclick="stopPolling()">Stop Monitoring</button>';
            } else {
                dot.className = 'ah-polling-dot ah-inactive';
                status.textContent = 'Monitoring paused';
                toggleContainer.innerHTML = '<button class="am-btn am-btn-primary" onclick="startPolling()">Start Monitoring</button>';
            }

            if (msg.state.lastPollAt) {
                const el = document.getElementById('lastPollTime');
                if (el) el.textContent = 'Last poll: ' + new Date(msg.state.lastPollAt).toLocaleTimeString();
            }
        }
    });

    renderAlerts();
    `;

    return wrapWebviewHtml({
        title: 'Alerting Hub',
        body,
        scripts,
        extraStyles: getAlertingHubStyles()
    });
}

function getAlertingHubStyles(): string {
    return `
        .ah-polling-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--am-text-muted); margin-top: 4px; }
        .ah-polling-dot { width: 8px; height: 8px; border-radius: 50%; }
        .ah-polling-dot.ah-active { background: var(--am-success); animation: am-pulse 2s infinite; }
        .ah-polling-dot.ah-inactive { background: var(--am-error); }

        .ah-info-banner { background: var(--am-bg-surface); border: 1px solid var(--am-border); border-radius: var(--am-radius-md); margin-bottom: 16px; overflow: hidden; }
        .ah-info-banner-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; user-select: none; }
        .ah-info-banner-header h3 { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .ah-info-banner-body { padding: 0 14px 14px; font-size: 12px; line-height: 1.6; color: var(--am-text-muted); }
        .ah-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 10px; }
        .ah-step { background: var(--am-bg-secondary); border-radius: var(--am-radius-md); padding: 12px; }
        .ah-step-number { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--am-info); color: #fff; font-size: 11px; font-weight: 700; margin-bottom: 6px; }
        .ah-step-title { font-size: 12px; font-weight: 600; color: var(--am-text-primary); margin-bottom: 4px; }
        .ah-what-monitored { margin-top: 12px; }
        .ah-what-monitored ul { margin: 4px 0 0 16px; }
        .ah-chevron { transition: transform 0.2s; display: inline-block; }
        .ah-chevron.ah-collapsed { transform: rotate(-90deg); }

        .ah-config-section { background: var(--am-bg-surface); border: 1px solid var(--am-border); border-radius: var(--am-radius-md); padding: 16px; margin-bottom: 16px; }
        .ah-config-section h3 { font-size: 14px; margin-bottom: 12px; }
        .ah-config-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
        .ah-config-row label { min-width: 160px; font-size: 13px; }

        .ah-env-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .ah-env-chip {
            padding: 4px 10px; background: var(--am-bg-secondary); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-pill); font-size: 12px; cursor: pointer;
            transition: all 0.2s;
        }
        .ah-env-chip:hover { border-color: var(--am-info); }
        .ah-env-chip.ah-selected { background: var(--am-info); border-color: var(--am-info); color: #fff; }
    `;
}
