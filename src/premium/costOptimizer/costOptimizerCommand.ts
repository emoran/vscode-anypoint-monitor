import * as vscode from 'vscode';
import axios from 'axios';
import { AccountService } from '../../controllers/accountService';
import { getBaseUrl } from '../../constants';
import { AppHistoricalMetrics, ResourceAllocation, TimeWindow } from './types';
import { analyzeUtilization, computeFleetSummary } from './costAnalyzer';
import { showCostOptimizerPanel } from './costOptimizerPanel';
import { telemetryService } from '../../services/telemetryService';

const DATASOURCE_CACHE_TTL = 300000;

interface CachedDatasource {
    id: number;
    database: string;
    baseUrl: string;
    fetchedAt: number;
}

let cachedDatasource: CachedDatasource | undefined;

export async function showCostOptimizer(context: vscode.ExtensionContext): Promise<void> {
    telemetryService.trackPageView('costOptimizer');

    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showWarningMessage('Please log in first.');
        return;
    }

    // Select environment
    let envJson = await accountService.getActiveAccountEnvironments();
    if (!envJson) {
        envJson = await context.secrets.get('anypoint.environments') || null;
    }
    if (!envJson) {
        vscode.window.showErrorMessage('No environments found. Please log in first.');
        return;
    }

    const parsed = JSON.parse(envJson);
    const environments = parsed.data || parsed || [];
    const envItems: Array<vscode.QuickPickItem & { id: string }> = environments.map((e: any) => ({
        label: e.name,
        description: e.type || '',
        id: e.id
    }));

    const selectedEnv = await vscode.window.showQuickPick(envItems, {
        placeHolder: 'Select environment for cost analysis'
    });
    if (!selectedEnv) { return; }

    const environmentId = selectedEnv.id;
    const environmentName = selectedEnv.label;

    // Select time window
    const windowItems = [
        { label: '7 days', description: 'Analyze last 7 days of metrics', value: '7d' as TimeWindow },
        { label: '30 days', description: 'Analyze last 30 days of metrics (more accurate)', value: '30d' as TimeWindow }
    ];

    const selectedWindow = await vscode.window.showQuickPick(windowItems, {
        placeHolder: 'Select analysis time window'
    });
    if (!selectedWindow) { return; }

    const timeWindow = (selectedWindow as any).value as TimeWindow;
    const daysNum = timeWindow === '7d' ? 7 : 30;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Cost Optimizer',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Fetching applications...' });

        const accessToken = await accountService.getActiveAccountAccessToken() || '';
        const organizationId = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
        const baseUrl = await getBaseUrl(context);

        const apps = await fetchAllApps(baseUrl, accessToken, organizationId, environmentId);

        if (apps.length === 0) {
            vscode.window.showWarningMessage('No applications found in this environment.');
            return;
        }

        progress.report({ message: `Fetching ${daysNum}-day historical metrics for ${apps.length} apps...` });

        const metricsMap = await fetchHistoricalMetrics(
            apps, baseUrl, accessToken, organizationId, environmentId, daysNum, progress
        );

        progress.report({ message: 'Analyzing utilization and generating recommendations...' });

        const recommendations = analyzeUtilization(apps, metricsMap);
        const summary = computeFleetSummary(recommendations);

        showCostOptimizerPanel(context, recommendations, summary, environmentName, timeWindow);
    });
}

interface AppInfo {
    name: string;
    type: 'CH1' | 'CH2';
    allocation: ResourceAllocation;
}

async function fetchAllApps(
    baseUrl: string,
    accessToken: string,
    organizationId: string,
    environmentId: string
): Promise<AppInfo[]> {
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'X-ANYPNT-ENV-ID': environmentId,
        'X-ANYPNT-ORG-ID': organizationId
    };

    const apps: AppInfo[] = [];

    // CH1
    try {
        const resp = await axios.get(`${baseUrl}/cloudhub/api/applications`, {
            headers, timeout: 15000
        });
        for (const app of (Array.isArray(resp.data) ? resp.data : [])) {
            const workerType = app.workers?.type?.name || app.workerType || '1 vCore';
            const workers = app.workers?.amount || app.workers || 1;
            apps.push({
                name: app.domain || app.name,
                type: 'CH1',
                allocation: {
                    vCores: parseFloat(app.workers?.type?.weight || '1'),
                    workers: typeof workers === 'number' ? workers : 1,
                    workerType
                }
            });
        }
    } catch { /* CH1 unavailable */ }

    // CH2
    try {
        const resp = await axios.get(
            `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments`,
            { headers, timeout: 15000 }
        );
        const items = resp.data?.items || resp.data || [];
        for (const item of items) {
            const app = item.application || item;
            const target = item.target || {};
            const cpuReserved = parseFloat(target.cpuReserved || app.cpuReserved || '0.5');
            const memoryReserved = parseFloat(target.memoryReserved || app.memoryReserved || '1');
            const replicas = target.replicas || app.replicas || 1;

            apps.push({
                name: app.name || item.name || 'unknown',
                type: 'CH2',
                allocation: {
                    vCores: cpuReserved,
                    workers: replicas,
                    cpuReserved,
                    memoryReserved,
                    replicas
                }
            });
        }
    } catch { /* CH2 unavailable */ }

    return apps;
}

async function fetchHistoricalMetrics(
    apps: AppInfo[],
    baseUrl: string,
    accessToken: string,
    organizationId: string,
    environmentId: string,
    days: number,
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Map<string, AppHistoricalMetrics>> {
    const metricsMap = new Map<string, AppHistoricalMetrics>();
    const datasource = await getVisualizerDatasource(baseUrl, accessToken);

    if (!datasource) {
        return metricsMap;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const groupInterval = days <= 7 ? '5m' : '1h';
    const batchSize = 3;
    let completed = 0;

    for (let i = 0; i < apps.length; i += batchSize) {
        const batch = apps.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(async (app) => {
            try {
                const appId = app.type === 'CH1'
                    ? `${app.name}.us-e1.cloudhub.io`
                    : app.name.toLowerCase();

                const condition = `("org_id" = '${organizationId}' AND "env_id" = '${environmentId}' AND "app_id" = '${appId}')`;

                const cpuQuery = `SELECT mean("cpu") FROM "jvm.cpu.operatingsystem" WHERE ${condition} AND time >= now() - ${days}d GROUP BY time(${groupInterval}) fill(none) tz('${timezone}')`;
                const memQuery = `SELECT mean("heap_used") FROM "jvm.memory" WHERE ${condition} AND time >= now() - ${days}d GROUP BY time(${groupInterval}) fill(none) tz('${timezone}')`;

                const [cpuResp, memResp] = await Promise.allSettled([
                    axios.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query`, {
                        params: { db: `"${datasource.database}"`, q: cpuQuery, epoch: 'ms' },
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        timeout: 15000
                    }),
                    axios.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query`, {
                        params: { db: `"${datasource.database}"`, q: memQuery, epoch: 'ms' },
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        timeout: 15000
                    })
                ]);

                const cpuPoints = cpuResp.status === 'fulfilled' ? extractTimeSeries(cpuResp.value.data) : [];
                const memPoints = memResp.status === 'fulfilled' ? extractTimeSeries(memResp.value.data) : [];

                metricsMap.set(app.name, {
                    appName: app.name,
                    appType: app.type,
                    cpu: cpuPoints,
                    memory: memPoints,
                    timeWindowDays: days
                });
            } catch { /* metrics unavailable for this app */ }

            completed++;
            progress.report({
                message: `Fetching metrics: ${completed}/${apps.length} apps...`
            });
        }));

        if (i + batchSize < apps.length) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    return metricsMap;
}

function extractTimeSeries(data: any): Array<{ timestamp: number; value: number }> {
    try {
        const values = data?.results?.[0]?.series?.[0]?.values;
        if (!values || values.length === 0) { return []; }
        return values
            .filter((v: any[]) => v[1] !== null && v[1] !== undefined)
            .map((v: any[]) => ({ timestamp: v[0], value: v[1] }));
    } catch {
        return [];
    }
}

async function getVisualizerDatasource(baseUrl: string, accessToken: string): Promise<CachedDatasource | undefined> {
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
