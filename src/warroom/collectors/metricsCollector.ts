import * as vscode from 'vscode';
import { MetricSnapshot, Anomaly, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
import { getBaseUrl } from '../../constants';

const COLLECTOR_TIMEOUT = 30000;
const METRICS_QUERY_TIMEOUT = 8000;

export interface MetricsCollectorResult {
    current: MetricSnapshot;
    baseline: MetricSnapshot;
    anomalies: Anomaly[];
}

/**
 * Cached Visualizer datasource info so we only fetch bootdata once per session.
 */
interface VisualizerDatasource {
    id: number;
    database: string;
    baseUrl: string;
}

let cachedDatasource: VisualizerDatasource | null = null;

async function getVisualizerDatasource(apiHelper: ApiHelper, baseUrl: string): Promise<VisualizerDatasource | null> {
    if (cachedDatasource) { return cachedDatasource; }

    try {
        const bootResponse = await apiHelper.get(`${baseUrl}/monitoring/api/visualizer/api/bootdata`);
        const dataSources = bootResponse.data?.Settings?.datasources;
        if (!dataSources) { return null; }

        const datasourcesArray = Object.values(dataSources) as any[];
        const influxCandidates = datasourcesArray.filter((source: any) =>
            (source?.type === 'influxdb') || source?.meta?.id === 'influxdb'
        );

        const influxEntry = influxCandidates.find((source: any) => {
            const name = (source?.name || source?.meta?.name || '').toLowerCase();
            return name === 'influxdb';
        }) || influxCandidates[0];

        if (!influxEntry) { return null; }

        const datasourceId = Number(influxEntry.id || influxEntry.meta?.datasourceId || influxEntry.meta?.id);
        const databaseRaw = influxEntry.database || influxEntry.jsonData?.database;
        const database = typeof databaseRaw === 'string' ? databaseRaw.replace(/"/g, '') : undefined;

        if (!datasourceId || !database) { return null; }

        cachedDatasource = { id: datasourceId, database, baseUrl };
        return cachedDatasource;
    } catch {
        return null;
    }
}

async function queryInflux(
    apiHelper: ApiHelper,
    datasource: VisualizerDatasource,
    query: string
): Promise<any> {
    const encodedQuery = encodeURIComponent(query);
    const url = `${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query?db="${datasource.database}"&q=${encodedQuery}&epoch=ms`;

    const response = await Promise.race([
        apiHelper.get(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Visualizer query timeout')), METRICS_QUERY_TIMEOUT))
    ]);

    return (response as any).data;
}

function extractLatestValue(data: any, scale: number = 1): number | null {
    try {
        const values = data?.results?.[0]?.series?.[0]?.values;
        if (!values || values.length === 0) { return null; }
        for (let i = values.length - 1; i >= 0; i--) {
            const v = values[i][1];
            if (v !== null && v !== undefined) {
                return v * scale;
            }
        }
    } catch { /* ignore */ }
    return null;
}

function extractMeanValue(data: any, scale: number = 1): number | null {
    try {
        const values = data?.results?.[0]?.series?.[0]?.values;
        if (!values || values.length === 0) { return null; }
        let sum = 0;
        let count = 0;
        for (const row of values) {
            if (row[1] !== null && row[1] !== undefined) {
                sum += row[1] * scale;
                count++;
            }
        }
        return count > 0 ? sum / count : null;
    } catch { /* ignore */ }
    return null;
}

export async function collectMetrics(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date }
): Promise<{ result: MetricsCollectorResult; errors: CollectionError[] }> {
    const errors: CollectionError[] = [];
    let current: MetricSnapshot = { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: new Date().toISOString() };
    let baseline: MetricSnapshot = { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' };
    const anomalies: Anomaly[] = [];

    try {
        const apiHelper = new ApiHelper(context);
        const baseUrl = await getBaseUrl(context);

        const datasource = await getVisualizerDatasource(apiHelper, baseUrl);
        if (!datasource) {
            errors.push({ collector: 'metrics', app: appName, error: 'Visualizer datasource not available' });
            return { result: { current, baseline, anomalies }, errors };
        }

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        // For CH2 apps, app_id is the lowercase app name
        // For CH1 apps, app_id is domain.region.cloudhub.io
        const appIdentifier = appName.toLowerCase();
        const condition = `("org_id" = '${organizationId}' AND "env_id" = '${environmentId}' AND "app_id" = '${appIdentifier}')`;

        // Time window duration in minutes for current metrics
        const durationMinutes = Math.round((timeWindow.end.getTime() - timeWindow.start.getTime()) / 60000);

        // Fetch current metrics
        const [cpuResult, memResult] = await Promise.allSettled([
            queryInflux(apiHelper, datasource,
                `SELECT mean("cpu") FROM "jvm.cpu.operatingsystem" WHERE ${condition} AND time >= now() - ${durationMinutes}m GROUP BY time(1m) fill(none) tz('${timezone}')`
            ),
            queryInflux(apiHelper, datasource,
                `SELECT mean("heap_used") FROM "jvm.memory" WHERE ${condition} AND time >= now() - ${durationMinutes}m GROUP BY time(1m) fill(none) tz('${timezone}')`
            )
        ]);

        if (cpuResult.status === 'fulfilled') {
            const val = extractLatestValue(cpuResult.value, 100);
            if (val !== null) { current.cpu = Math.max(0, Math.min(100, val)); }
        }
        if (memResult.status === 'fulfilled') {
            const val = extractLatestValue(memResult.value, 1 / (1024 * 1024));
            if (val !== null) { current.memory = val; }
        }

        current.timestamp = timeWindow.end.toISOString();

        // Fetch baseline metrics (past 24h, 1h before incident)
        const baselineEndMinutes = durationMinutes + 60;
        const baselineRangeMinutes = 24 * 60 + baselineEndMinutes;

        const [cpuBaseResult, memBaseResult] = await Promise.allSettled([
            queryInflux(apiHelper, datasource,
                `SELECT mean("cpu") FROM "jvm.cpu.operatingsystem" WHERE ${condition} AND time >= now() - ${baselineRangeMinutes}m AND time <= now() - ${baselineEndMinutes}m GROUP BY time(1h) fill(none) tz('${timezone}')`
            ),
            queryInflux(apiHelper, datasource,
                `SELECT mean("heap_used") FROM "jvm.memory" WHERE ${condition} AND time >= now() - ${baselineRangeMinutes}m AND time <= now() - ${baselineEndMinutes}m GROUP BY time(1h) fill(none) tz('${timezone}')`
            )
        ]);

        if (cpuBaseResult.status === 'fulfilled') {
            const val = extractMeanValue(cpuBaseResult.value, 100);
            if (val !== null) { baseline.cpu = Math.max(0, Math.min(100, val)); }
        }
        if (memBaseResult.status === 'fulfilled') {
            const val = extractMeanValue(memBaseResult.value, 1 / (1024 * 1024));
            if (val !== null) { baseline.memory = val; }
        }

        // Detect anomalies
        if (current.cpu !== null && baseline.cpu !== null && baseline.cpu > 0) {
            const deviation = current.cpu / baseline.cpu;
            if (deviation > 2 || current.cpu > 90) {
                anomalies.push({
                    metric: 'CPU',
                    current: current.cpu,
                    baseline: baseline.cpu,
                    deviation,
                    severity: current.cpu > 90 ? 'high' : 'medium',
                    description: `CPU at ${current.cpu.toFixed(1)}% (baseline: ${baseline.cpu.toFixed(1)}%, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }

        if (current.memory !== null && baseline.memory !== null && baseline.memory > 0) {
            const deviation = current.memory / baseline.memory;
            if (deviation > 2) {
                anomalies.push({
                    metric: 'Memory',
                    current: current.memory,
                    baseline: baseline.memory,
                    deviation,
                    severity: deviation > 3 ? 'high' : 'medium',
                    description: `Memory at ${current.memory.toFixed(0)}MB (baseline: ${baseline.memory.toFixed(0)}MB, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }
    } catch (error: any) {
        errors.push({ collector: 'metrics', app: appName, error: error.message || 'Unknown error' });
    }

    return { result: { current, baseline, anomalies }, errors };
}
