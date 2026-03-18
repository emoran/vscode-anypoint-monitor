import * as vscode from 'vscode';
import axios from 'axios';
import { AlertConfig, AlertEvent, AlertState, AppMetricsSnapshot, PollingInterval } from './types';
import { DEFAULT_RULES, evaluateRules, mergeRulesWithDefaults } from './alertRules';
import { AccountService } from '../../controllers/accountService';
import { getBaseUrl } from '../../constants';

const ALERT_STATE_KEY = 'anypointMonitor.alertState';
const ALERT_CONFIG_KEY = 'anypointMonitor.alertConfig';
const MAX_EVENTS = 200;
const DATASOURCE_CACHE_TTL = 300000;

interface VisualizerDatasource {
    id: number;
    database: string;
    baseUrl: string;
    fetchedAt: number;
}

let cachedDatasource: VisualizerDatasource | undefined;

export class AlertEngine {
    private static instance: AlertEngine | undefined;
    private context: vscode.ExtensionContext;
    private pollingTimer: NodeJS.Timeout | undefined;
    private statusBarItem: vscode.StatusBarItem;
    private config: AlertConfig;
    private state: AlertState;
    private lastFiredMap: Map<string, number> = new Map();
    private panel: vscode.WebviewPanel | undefined;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.command = 'anypoint-monitor.alertingHub';
        this.config = this.loadConfig();
        this.state = this.loadState();
        this.updateStatusBar();
        this.statusBarItem.show();
        context.subscriptions.push(this.statusBarItem);

        if (this.state.isPolling && this.config.monitoredEnvironments.length > 0) {
            console.log('AlertEngine: resuming background monitoring from previous session');
            this.start();
        }
    }

    static getInstance(context: vscode.ExtensionContext): AlertEngine {
        if (!AlertEngine.instance) {
            AlertEngine.instance = new AlertEngine(context);
        }
        return AlertEngine.instance;
    }

    static destroyInstance(): void {
        if (AlertEngine.instance) {
            AlertEngine.instance.stop();
            AlertEngine.instance = undefined;
        }
    }

    setPanel(panel: vscode.WebviewPanel | undefined): void {
        this.panel = panel;
    }

    getConfig(): AlertConfig {
        return { ...this.config };
    }

    getState(): AlertState {
        return {
            ...this.state,
            events: [...this.state.events]
        };
    }

    start(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
        }
        this.state.isPolling = true;
        this.saveState();
        this.updateStatusBar();
        this.notifyPanel();
        this.poll();
        this.pollingTimer = setInterval(() => this.poll(), this.config.pollingIntervalMs);
        console.log(`AlertEngine: started polling every ${this.config.pollingIntervalMs / 1000}s`);
    }

    stop(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = undefined;
        }
        this.state.isPolling = false;
        this.saveState();
        this.updateStatusBar();
        this.notifyPanel();
        console.log('AlertEngine: stopped polling');
    }

    isRunning(): boolean {
        return this.state.isPolling && !!this.pollingTimer;
    }

    updateConfig(updates: Partial<AlertConfig>): void {
        this.config = { ...this.config, ...updates };
        if (updates.rules) {
            this.config.rules = mergeRulesWithDefaults(updates.rules);
        }
        this.saveConfig();

        if (updates.pollingIntervalMs && this.isRunning()) {
            this.stop();
            this.start();
        }
    }

    acknowledgeAlert(eventId: string): void {
        const event = this.state.events.find(e => e.id === eventId);
        if (event) {
            event.status = 'acknowledged';
            event.acknowledgedAt = new Date().toISOString();
            this.saveState();
            this.updateStatusBar();
            this.notifyPanel();
        }
    }

    snoozeAlert(eventId: string, durationMs: number): void {
        const event = this.state.events.find(e => e.id === eventId);
        if (event) {
            event.status = 'snoozed';
            event.snoozedUntil = new Date(Date.now() + durationMs).toISOString();
            this.saveState();
            this.updateStatusBar();
            this.notifyPanel();
        }
    }

    resolveAlert(eventId: string): void {
        const event = this.state.events.find(e => e.id === eventId);
        if (event) {
            event.status = 'resolved';
            event.resolvedAt = new Date().toISOString();
            this.saveState();
            this.updateStatusBar();
            this.notifyPanel();
        }
    }

    clearResolved(): void {
        this.state.events = this.state.events.filter(e => e.status !== 'resolved');
        this.saveState();
        this.notifyPanel();
    }

    muteApp(appName: string): void {
        if (!this.config.mutedApps.includes(appName)) {
            this.config.mutedApps.push(appName);
            this.saveConfig();
        }
    }

    unmuteApp(appName: string): void {
        this.config.mutedApps = this.config.mutedApps.filter(a => a !== appName);
        this.saveConfig();
    }

    private async poll(): Promise<void> {
        if (this.config.monitoredEnvironments.length === 0) {
            return;
        }

        try {
            const accountService = new AccountService(this.context);
            const activeAccount = await accountService.getActiveAccount();
            if (!activeAccount) { return; }

            const accessToken = await accountService.getActiveAccountAccessToken();
            if (!accessToken) { return; }

            const organizationId = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
            const baseUrl = await getBaseUrl(this.context);

            // Unsnoze expired snoozed alerts
            const now = Date.now();
            for (const event of this.state.events) {
                if (event.status === 'snoozed' && event.snoozedUntil && new Date(event.snoozedUntil).getTime() <= now) {
                    event.status = 'active';
                    event.snoozedUntil = undefined;
                }
            }

            for (const env of this.config.monitoredEnvironments) {
                const apps = await this.fetchAppSnapshots(baseUrl, accessToken, organizationId, env.id);
                const filteredApps = apps.filter(a => !this.config.mutedApps.includes(a.name));
                const newEvents: AlertEvent[] = [];

                for (const app of filteredApps) {
                    const triggered = evaluateRules(app, this.config.rules, env.id, env.name);
                    for (const event of triggered) {
                        if (!this.isDuplicate(event)) {
                            newEvents.push(event);
                            this.lastFiredMap.set(this.dedupeKey(event), now);
                        }
                    }
                }

                // Auto-resolve alerts for apps that are now healthy
                this.autoResolve(apps, env.id);

                if (newEvents.length > 0) {
                    this.state.events.unshift(...newEvents);
                    this.trimEvents();
                    this.notifyUser(newEvents);
                }
            }

            this.state.lastPollAt = new Date().toISOString();
            this.saveState();
            this.updateStatusBar();
            this.notifyPanel();
        } catch (error) {
            console.error('AlertEngine: poll error', error);
        }
    }

    private async fetchAppSnapshots(
        baseUrl: string,
        accessToken: string,
        organizationId: string,
        environmentId: string
    ): Promise<AppMetricsSnapshot[]> {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationId
        };

        const snapshots: AppMetricsSnapshot[] = [];

        // Fetch CH1 apps
        try {
            const ch1Resp = await axios.get(`${baseUrl}/cloudhub/api/applications`, {
                headers, timeout: 15000
            });
            const ch1Apps = Array.isArray(ch1Resp.data) ? ch1Resp.data : [];
            for (const app of ch1Apps) {
                snapshots.push({
                    name: app.domain || app.name,
                    type: 'CH1',
                    status: app.status || 'UNKNOWN'
                });
            }
        } catch { /* CH1 may not be available */ }

        // Fetch CH2 apps
        try {
            const ch2Resp = await axios.get(
                `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments`,
                { headers, timeout: 15000 }
            );
            const ch2Items = ch2Resp.data?.items || ch2Resp.data || [];
            for (const item of ch2Items) {
                const app = item.application || item;
                snapshots.push({
                    name: app.name || item.name || 'unknown',
                    type: 'CH2',
                    status: item.status || app.status || 'UNKNOWN'
                });
            }
        } catch { /* CH2 may not be available */ }

        // Fetch metrics for all apps (batched)
        await this.enrichWithMetrics(snapshots, baseUrl, accessToken, organizationId, environmentId);

        return snapshots;
    }

    private async enrichWithMetrics(
        apps: AppMetricsSnapshot[],
        baseUrl: string,
        accessToken: string,
        organizationId: string,
        environmentId: string
    ): Promise<void> {
        const datasource = await this.getVisualizerDatasource(baseUrl, accessToken);
        if (!datasource) { return; }

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const batchSize = 5;

        for (let i = 0; i < apps.length; i += batchSize) {
            const batch = apps.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(async (app) => {
                try {
                    const appId = app.type === 'CH1'
                        ? `${app.name}.us-e1.cloudhub.io`
                        : app.name.toLowerCase();

                    const condition = `("org_id" = '${organizationId}' AND "env_id" = '${environmentId}' AND "app_id" = '${appId}')`;

                    const cpuQuery = `SELECT mean("cpu") FROM "jvm.cpu.operatingsystem" WHERE ${condition} AND time >= now() - 15m GROUP BY time(1m) fill(none) tz('${timezone}')`;
                    const memQuery = `SELECT mean("heap_used") FROM "jvm.memory" WHERE ${condition} AND time >= now() - 15m GROUP BY time(1m) fill(none) tz('${timezone}')`;

                    const [cpuResp, memResp] = await Promise.allSettled([
                        axios.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query`, {
                            params: { db: `"${datasource.database}"`, q: cpuQuery, epoch: 'ms' },
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            timeout: 8000
                        }),
                        axios.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query`, {
                            params: { db: `"${datasource.database}"`, q: memQuery, epoch: 'ms' },
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            timeout: 8000
                        })
                    ]);

                    if (cpuResp.status === 'fulfilled') {
                        const val = this.extractLatestValue(cpuResp.value.data);
                        if (val !== undefined) { app.cpu = val * 100; }
                    }
                    if (memResp.status === 'fulfilled') {
                        const val = this.extractLatestValue(memResp.value.data);
                        if (val !== undefined) { app.memory = val / (1024 * 1024); }
                    }
                } catch { /* metrics unavailable for this app */ }
            }));

            if (i + batchSize < apps.length) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }

    private async getVisualizerDatasource(baseUrl: string, accessToken: string): Promise<VisualizerDatasource | undefined> {
        if (cachedDatasource && (Date.now() - cachedDatasource.fetchedAt) < DATASOURCE_CACHE_TTL) {
            return cachedDatasource;
        }

        try {
            const resp = await axios.get(`${baseUrl}/monitoring/api/visualizer/api/bootdata`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                timeout: 10000
            });

            const datasources = resp.data?.Settings?.datasources || [];
            const influx = datasources.find((d: any) => d.name === 'influxdb')
                || datasources.find((d: any) => d.type === 'influxdb' || d.meta?.id === 'influxdb');

            if (!influx) { return undefined; }

            cachedDatasource = {
                id: influx.id,
                database: influx.database || influx.jsonData?.database || 'anypoint_monitoring',
                baseUrl,
                fetchedAt: Date.now()
            };
            return cachedDatasource;
        } catch {
            return undefined;
        }
    }

    private extractLatestValue(data: any): number | undefined {
        try {
            const values = data?.results?.[0]?.series?.[0]?.values;
            if (!values || values.length === 0) { return undefined; }
            for (let i = values.length - 1; i >= 0; i--) {
                if (values[i][1] !== null && values[i][1] !== undefined) {
                    return values[i][1];
                }
            }
        } catch { /* parse error */ }
        return undefined;
    }

    private isDuplicate(event: AlertEvent): boolean {
        const key = this.dedupeKey(event);
        const lastFired = this.lastFiredMap.get(key);
        if (!lastFired) { return false; }

        const rule = this.config.rules.find(r => r.id === event.ruleId);
        const cooldown = rule?.cooldownMs || 300000;
        return (Date.now() - lastFired) < cooldown;
    }

    private dedupeKey(event: AlertEvent): string {
        return `${event.appName}:${event.ruleId}:${event.environmentId}`;
    }

    private autoResolve(apps: AppMetricsSnapshot[], environmentId: string): void {
        for (const event of this.state.events) {
            if (event.status !== 'active' || event.environmentId !== environmentId) {
                continue;
            }
            const app = apps.find(a => a.name === event.appName);
            if (!app) { continue; }

            const rule = this.config.rules.find(r => r.id === event.ruleId);
            if (!rule) { continue; }

            const triggered = evaluateRules(app, [rule], environmentId, event.environmentName);
            if (triggered.length === 0) {
                event.status = 'resolved';
                event.resolvedAt = new Date().toISOString();
            }
        }
    }

    private notifyUser(events: AlertEvent[]): void {
        const criticals = events.filter(e => e.severity === 'critical');
        const warnings = events.filter(e => e.severity === 'warning');

        if (criticals.length > 0) {
            const msg = criticals.length === 1
                ? criticals[0].message
                : `${criticals.length} critical alerts fired`;
            vscode.window.showErrorMessage(msg, 'Open Alerting Hub').then(action => {
                if (action) { vscode.commands.executeCommand('anypoint-monitor.alertingHub'); }
            });
        } else if (warnings.length > 0) {
            const msg = warnings.length === 1
                ? warnings[0].message
                : `${warnings.length} warning alerts fired`;
            vscode.window.showWarningMessage(msg, 'Open Alerting Hub').then(action => {
                if (action) { vscode.commands.executeCommand('anypoint-monitor.alertingHub'); }
            });
        }
    }

    private updateStatusBar(): void {
        const activeCount = this.state.events.filter(e => e.status === 'active').length;
        const criticalCount = this.state.events.filter(e => e.status === 'active' && e.severity === 'critical').length;

        if (!this.state.isPolling) {
            this.statusBarItem.text = '$(bell-slash) Alerts Off';
            this.statusBarItem.tooltip = 'Alerting Hub - Click to configure';
            this.statusBarItem.backgroundColor = undefined;
        } else if (criticalCount > 0) {
            this.statusBarItem.text = `$(bell-dot) ${activeCount} Alert${activeCount !== 1 ? 's' : ''}`;
            this.statusBarItem.tooltip = `${criticalCount} critical, ${activeCount - criticalCount} warning`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (activeCount > 0) {
            this.statusBarItem.text = `$(bell-dot) ${activeCount} Alert${activeCount !== 1 ? 's' : ''}`;
            this.statusBarItem.tooltip = `${activeCount} active alert${activeCount !== 1 ? 's' : ''}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.text = '$(bell) 0 Alerts';
            this.statusBarItem.tooltip = 'Alerting Hub - All clear';
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    private notifyPanel(): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'stateUpdate',
                state: this.getState(),
                config: this.getConfig()
            });
        }
    }

    private trimEvents(): void {
        if (this.state.events.length > MAX_EVENTS) {
            this.state.events = this.state.events.slice(0, MAX_EVENTS);
        }
    }

    private loadConfig(): AlertConfig {
        const stored = this.context.globalState.get<AlertConfig>(ALERT_CONFIG_KEY);
        if (!stored) {
            return {
                enabled: false,
                pollingIntervalMs: 60000,
                rules: [...DEFAULT_RULES],
                monitoredEnvironments: [],
                mutedApps: []
            };
        }
        return {
            ...stored,
            rules: mergeRulesWithDefaults(stored.rules)
        };
    }

    private saveConfig(): void {
        this.context.globalState.update(ALERT_CONFIG_KEY, this.config);
    }

    private loadState(): AlertState {
        const stored = this.context.globalState.get<AlertState>(ALERT_STATE_KEY);
        return stored || {
            events: [],
            isPolling: false,
            pollingIntervalMs: 60000,
            monitoredEnvironments: []
        };
    }

    private saveState(): void {
        this.context.globalState.update(ALERT_STATE_KEY, this.state);
    }
}
