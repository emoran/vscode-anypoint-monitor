import * as vscode from 'vscode';
import { getBaseUrl, getHybridApplicationsEndpoint } from '../constants';
import { ApiHelper } from '../controllers/apiHelper';
import { AccountService } from '../controllers/accountService';
import { showApplicationCommandCenter } from './applicationCommandCenter';
import { showRealTimeLogs } from './realTimeLogs';

// ============================================================================
// INTERFACES
// ============================================================================

interface ApplicationSummary {
    id: string;
    name: string;
    domain: string;
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID';
    status: string;
    applicationStatus: string;
    healthScore: number;
    healthStatus: 'healthy' | 'warning' | 'critical';
    metrics: {
        cpu?: number;
        memory?: number;
        requestsPerMin?: number;
        errorRate?: number;
    };
    metricsError?: string;
    metricsStatus?: number;
    runtimeVersion?: string;
    replicas?: number;
    workers?: number;
    workerType?: string;
    region?: string;
    lastUpdated?: number;
    deploymentId?: string;
    specificationId?: string;
    memoryLimitMB?: number;
    rawData?: any;
}

interface DashboardData {
    applications: ApplicationSummary[];
    environmentId: string;
    environmentName: string;
    organizationId: string;
    organizationName: string;
    lastRefreshed: number;
    summary: {
        total: number;
        healthy: number;
        warning: number;
        critical: number;
        stopped: number;
        running: number;
        ch1Count: number;
        ch2Count: number;
        hybridCount: number;
    };
    metricsLoadingState: 'idle' | 'loading' | 'complete' | 'error';
    metricsProgress?: number;
    metricsError?: string;
}

interface MetricsBatchResponse {
    appId: string;
    success: boolean;
    metrics?: {
        cpu?: number;
        memory?: number;
        requestsPerMin?: number;
        errorRate?: number;
    };
    error?: string;
    status?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const METRICS_BATCH_SIZE = 5;
const METRICS_BATCH_DELAY = 300;
const METRICS_TIMEOUT = 8000;
const METRICS_DEBUG_LOG = true;

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function showMultiAppDashboard(
    context: vscode.ExtensionContext,
    environmentId: string
): Promise<void> {
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();

    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    // Get environment name
    let environmentName = environmentId;
    const storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (storedEnvironments) {
        try {
            const environments = JSON.parse(storedEnvironments);
            const env = environments.data?.find((e: any) => e.id === environmentId);
            if (env) {
                environmentName = env.name;
            }
        } catch (error) {
            console.warn('Failed to parse environments for name lookup');
        }
    }

    const organizationId = await getEffectiveOrganizationId(context, activeAccount.organizationId);

    // Create webview panel
    const panel = vscode.window.createWebviewPanel(
        'multiAppDashboard',
        `Multi-App Dashboard - ${environmentName}`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Show loading state
    panel.webview.html = getLoadingHtml(environmentName);

    try {
        // Fetch all applications
        const applications = await fetchAllApplications(context, environmentId, organizationId);

        // Calculate initial health (without metrics)
        applications.forEach(app => {
            const health = calculateApplicationHealth(app);
            app.healthScore = health.score;
            app.healthStatus = health.status;
        });

        // Build dashboard data
        const dashboardData: DashboardData = {
            applications,
            environmentId,
            environmentName,
            organizationId,
            organizationName: activeAccount.organizationName,
            lastRefreshed: Date.now(),
            summary: calculateSummary(applications),
            metricsLoadingState: 'idle'
        };

        // Render initial dashboard (without metrics)
        panel.webview.html = getMultiAppDashboardHtml(dashboardData);

        // Set up message handler
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'refresh':
                    await handleRefresh(context, panel, environmentId, organizationId, environmentName, activeAccount.organizationName);
                    break;

                case 'loadMetrics':
                    await handleLoadMetrics(context, panel, dashboardData);
                    break;

                case 'openCommandCenter':
                    await handleOpenCommandCenter(context, message.appData, environmentId, environmentName);
                    break;

                case 'openLogs':
                    await handleOpenLogs(context, message.appData, environmentId);
                    break;

                case 'exportCSV':
                    await handleExportCSV(dashboardData);
                    break;
            }
        });

        // Auto-load metrics after initial render
        setTimeout(() => {
            panel.webview.postMessage({ command: 'triggerLoadMetrics' });
        }, 500);

    } catch (error: any) {
        console.error('Error loading Multi-App Dashboard:', error);
        panel.webview.html = getErrorHtml(error.message, environmentName);
    }
}

// ============================================================================
// APPLICATION FETCHING
// ============================================================================

async function fetchAllApplications(
    context: vscode.ExtensionContext,
    environmentId: string,
    organizationId: string
): Promise<ApplicationSummary[]> {
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    const regionId = activeAccount?.region || 'us';

    const envHeaders = {
        'X-ANYPNT-ENV-ID': environmentId,
        'X-ANYPNT-ORG-ID': organizationId
    };

    console.log(`Multi-App Dashboard: Fetching apps for org ${organizationId}, env ${environmentId}`);

    // Fetch all app types in parallel
    const [ch1Result, ch2Result, hybridResult] = await Promise.allSettled([
        // CH1 Applications
        apiHelper.get(`${baseUrl}/cloudhub/api/applications`, { headers: envHeaders }),

        // CH2 Applications (handle US vs EU/GOV)
        fetchCH2Applications(apiHelper, baseUrl, organizationId, environmentId, regionId),

        // Hybrid Applications
        apiHelper.get(await getHybridApplicationsEndpoint(context), { headers: envHeaders })
    ]);

    const applications: ApplicationSummary[] = [];

    // Process CH1
    if (ch1Result.status === 'fulfilled' && ch1Result.value.status === 200) {
        const ch1Apps = normalizeToArray(ch1Result.value.data);
        console.log(`Multi-App Dashboard: Found ${ch1Apps.length} CH1 applications`);
        applications.push(...ch1Apps.map(app => normalizeCH1App(app)));
    } else {
        console.warn('CH1 fetch failed or returned non-200:', ch1Result);
    }

    // Process CH2
    if (ch2Result.status === 'fulfilled') {
        console.log(`Multi-App Dashboard: Found ${ch2Result.value.length} CH2 applications`);
        applications.push(...ch2Result.value.map((app: any) => normalizeCH2App(app)));
    } else {
        console.warn('CH2 fetch failed:', ch2Result);
    }

    // Process Hybrid
    if (hybridResult.status === 'fulfilled' && hybridResult.value.status === 200) {
        const hybridApps = normalizeToArray(hybridResult.value.data?.data || hybridResult.value.data);
        console.log(`Multi-App Dashboard: Found ${hybridApps.length} Hybrid applications`);
        applications.push(...hybridApps.map(app => normalizeHybridApp(app)));
    } else {
        console.warn('Hybrid fetch failed or returned non-200:', hybridResult);
    }

    console.log(`Multi-App Dashboard: Total applications found: ${applications.length}`);
    return applications;
}

async function fetchCH2Applications(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    regionId: string
): Promise<any[]> {
    try {
        let response;

        if (regionId === 'us') {
            // US uses Application Manager API
            response = await apiHelper.get(
                `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments`
            );
        } else {
            // EU/GOV uses ARM API
            response = await apiHelper.get(
                `${baseUrl}/armui/api/v2/applications`,
                {
                    headers: {
                        'X-Anypnt-Org-Id': organizationId,
                        'X-Anypnt-Env-Id': environmentId
                    }
                }
            );
        }

        if (response.status === 200) {
            let apps = normalizeToArray(response.data?.data || response.data?.items || response.data);

            // For ARM API, filter CH2 apps only
            if (regionId !== 'us') {
                apps = apps.filter((app: any) =>
                    app.target?.type === 'MC' && app.target?.subtype === 'shared-space'
                );
            }

            return apps;
        }
    } catch (error) {
        console.warn('CH2 fetch error:', error);
    }

    return [];
}

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

function normalizeToArray(data: any): any[] {
    if (Array.isArray(data)) {
        return data;
    }
    if (data?.data && Array.isArray(data.data)) {
        return data.data;
    }
    if (data?.items && Array.isArray(data.items)) {
        return data.items;
    }
    return [];
}

function normalizeCH1App(app: any): ApplicationSummary {
    const normalized: ApplicationSummary = {
        id: app.domain || app.id || `ch1-${Date.now()}`,
        name: app.domain || app.name || 'Unknown',
        domain: app.domain || app.name || 'Unknown',
        cloudhubVersion: 'CH1',
        status: app.status || 'UNKNOWN',
        applicationStatus: app.status || 'UNKNOWN',
        healthScore: 100,
        healthStatus: 'healthy',
        metrics: {},
        runtimeVersion: app.muleVersion?.version || app.muleVersion || 'N/A',
        workers: app.workers?.amount || app.workers || 1,
        workerType: app.workers?.type?.name || app.workerType || 'N/A',
        region: app.region || 'N/A',
        lastUpdated: app.lastUpdateTime ? new Date(app.lastUpdateTime).getTime() : undefined,
        rawData: app
    };
    normalized.memoryLimitMB = resolveMemoryLimitMB(normalized);
    return normalized;
}

function normalizeCH2App(app: any): ApplicationSummary {
    const appName = app.name || app.artifact?.name || app.application?.domain || 'Unknown';
    const status = app.application?.status || app.status || app.lastReportedStatus || 'UNKNOWN';

    const normalized: ApplicationSummary = {
        id: app.id || `ch2-${Date.now()}`,
        name: appName,
        domain: appName,
        cloudhubVersion: 'CH2',
        status: status,
        applicationStatus: status,
        healthScore: 100,
        healthStatus: 'healthy',
        metrics: {},
        runtimeVersion: app.currentRuntimeVersion || app.muleVersion?.version || app.muleVersion || 'N/A',
        replicas: app.replicas || app.target?.replicas || 1,
        region: app.target?.name || app.region || 'N/A',
        lastUpdated: app.lastModifiedDate ? new Date(app.lastModifiedDate).getTime() : undefined,
        deploymentId: app.id,
        rawData: app
    };
    normalized.memoryLimitMB = resolveMemoryLimitMB(normalized);
    return normalized;
}

function normalizeHybridApp(app: any): ApplicationSummary {
    const appName = app.name || app.artifact?.name || 'Unknown';

    const normalized: ApplicationSummary = {
        id: app.id || `hybrid-${Date.now()}`,
        name: appName,
        domain: appName,
        cloudhubVersion: 'HYBRID',
        status: app.status || app.desiredStatus || 'UNKNOWN',
        applicationStatus: app.status || app.desiredStatus || 'UNKNOWN',
        healthScore: 100,
        healthStatus: 'healthy',
        metrics: {},
        runtimeVersion: app.muleVersion?.version || 'N/A',
        lastUpdated: app.lastUpdateTime ? new Date(app.lastUpdateTime).getTime() : undefined,
        rawData: app
    };
    normalized.memoryLimitMB = resolveMemoryLimitMB(normalized);
    return normalized;
}

// ============================================================================
// VISUALIZER DATASOURCE CACHE
// ============================================================================

interface VisualizerDatasource {
    id: number;
    database: string;
    baseUrl: string;
    fetchedAt: number;
}

let cachedDatasource: VisualizerDatasource | null = null;
const DATASOURCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getVisualizerDatasource(
    apiHelper: ApiHelper,
    baseUrl: string
): Promise<VisualizerDatasource | null> {
    // Return cached if still valid
    if (cachedDatasource && (Date.now() - cachedDatasource.fetchedAt) < DATASOURCE_CACHE_TTL) {
        return cachedDatasource;
    }

    try {
        const bootResponse = await apiHelper.get(`${baseUrl}/monitoring/api/visualizer/api/bootdata`);
        const dataSources = bootResponse.data?.Settings?.datasources;

        if (!dataSources) {
            console.warn('Multi-App Dashboard: No datasources returned from monitoring boot endpoint');
            return null;
        }

        const datasourcesArray = Object.values(dataSources) as any[];
        const influxCandidates = datasourcesArray.filter((source: any) =>
            (source?.type === 'influxdb') || source?.meta?.id === 'influxdb'
        );

        const influxEntry = influxCandidates.find((source: any) => {
            const name = (source?.name || source?.meta?.name || '').toLowerCase();
            return name === 'influxdb';
        }) || influxCandidates[0];

        if (!influxEntry) {
            console.warn('Multi-App Dashboard: InfluxDB datasource not configured');
            return null;
        }

        const datasourceId = Number(influxEntry.id || influxEntry.meta?.datasourceId || influxEntry.meta?.id);
        const databaseRaw = influxEntry.database || influxEntry.jsonData?.database;
        const database = typeof databaseRaw === 'string' ? databaseRaw.replace(/"/g, '') : undefined;

        if (!datasourceId || !database) {
            console.warn('Multi-App Dashboard: Incomplete datasource metadata');
            return null;
        }

        cachedDatasource = {
            id: datasourceId,
            database,
            baseUrl,
            fetchedAt: Date.now()
        };

        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: Cached Visualizer datasource', {
                datasourceId,
                database
            });
        }

        return cachedDatasource;
    } catch (error: any) {
        console.error('Multi-App Dashboard: Failed to get Visualizer datasource:', error?.message);
        return null;
    }
}

// ============================================================================
// METRICS FETCHING (Using Visualizer API like Command Center)
// ============================================================================

async function handleLoadMetrics(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    dashboardData: DashboardData
): Promise<void> {
    const { applications, environmentId, organizationId } = dashboardData;

    // Filter to only CloudHub apps (not Hybrid - they don't have Visualizer metrics)
    const cloudhubApps = applications.filter(app => app.cloudhubVersion !== 'HYBRID');

    if (cloudhubApps.length === 0) {
        dashboardData.metricsLoadingState = 'complete';
        panel.webview.postMessage({
            command: 'metricsLoadingComplete',
            summary: dashboardData.summary
        });
        return;
    }

    dashboardData.metricsLoadingState = 'loading';
    panel.webview.postMessage({
        command: 'metricsLoadingStarted',
        total: cloudhubApps.length
    });

    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);

    // Get Visualizer datasource (cached)
    const datasource = await getVisualizerDatasource(apiHelper, baseUrl);

    if (!datasource) {
        // Fallback: mark all as no metrics available
        cloudhubApps.forEach(app => {
            app.metricsError = 'Visualizer not available';
            const health = calculateApplicationHealth(app, undefined);
            app.healthScore = health.score;
            app.healthStatus = health.status;
        });

        dashboardData.summary = calculateSummary(applications);
        dashboardData.metricsLoadingState = 'complete';

        panel.webview.postMessage({
            command: 'metricsLoadingComplete',
            summary: dashboardData.summary
        });
        return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    // Process in batches
    const batches = chunkArray(cloudhubApps, METRICS_BATCH_SIZE);
    let completed = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        const batchResults = await Promise.allSettled(
            batch.map(app => fetchAppVisualizerMetrics(
                apiHelper,
                datasource,
                app,
                environmentId,
                organizationId,
                timezone
            ))
        );

        // Update metrics for each app
        batchResults.forEach((result, idx) => {
            const app = batch[idx];
            if (result.status === 'fulfilled' && result.value.success && result.value.metrics) {
                app.metrics = result.value.metrics;
                app.metricsError = undefined;
                app.metricsStatus = undefined;
            } else if (result.status === 'fulfilled') {
                app.metricsError = result.value.error || 'Metrics unavailable';
                app.metricsStatus = result.value.status;
            } else {
                app.metricsError = 'Metrics request failed';
                app.metricsStatus = undefined;
            }
            // Recalculate health with metrics
            const health = calculateApplicationHealth(app, app.metrics);
            app.healthScore = health.score;
            app.healthStatus = health.status;
        });

        completed += batch.length;

        // Send progress update
        panel.webview.postMessage({
            command: 'metricsProgress',
            completed,
            total: cloudhubApps.length,
            updatedApps: batch.map(app => ({
                id: app.id,
                metrics: app.metrics,
                metricsError: app.metricsError,
                metricsStatus: app.metricsStatus,
                healthScore: app.healthScore,
                healthStatus: app.healthStatus
            }))
        });

        // Rate limiting delay
        if (i < batches.length - 1) {
            await delay(METRICS_BATCH_DELAY);
        }
    }

    // Update summary with new health scores
    dashboardData.summary = calculateSummary(applications);
    dashboardData.metricsLoadingState = 'complete';

    panel.webview.postMessage({
        command: 'metricsLoadingComplete',
        summary: dashboardData.summary
    });
}

async function fetchAppVisualizerMetrics(
    apiHelper: ApiHelper,
    datasource: VisualizerDatasource,
    app: ApplicationSummary,
    environmentId: string,
    organizationId: string,
    timezone: string
): Promise<MetricsBatchResponse> {
    const rangeMinutes = 15;
    const appIdentifier = deriveAppIdentifier(app);
    const condition = `("org_id" = '${organizationId}' AND "env_id" = '${environmentId}' AND "app_id" = '${appIdentifier}')`;

    if (METRICS_DEBUG_LOG) {
        console.log('Multi-App Dashboard: Fetching Visualizer metrics', {
            appId: app.id,
            appName: app.name,
            appIdentifier,
            cloudhubVersion: app.cloudhubVersion
        });
    }

    try {
        // Fetch CPU, Memory, and Error Rate in parallel
        const [cpuResult, memoryResult, errorRateResult] = await Promise.allSettled([
            fetchVisualizerMetric(apiHelper, datasource, 'jvm.cpu.operatingsystem', 'cpu', condition, timezone, rangeMinutes, 100),
            fetchVisualizerMetric(apiHelper, datasource, 'jvm.memory', 'heap_used', condition, timezone, rangeMinutes, 1 / (1024 * 1024)),
            fetchErrorRate(apiHelper, datasource, condition, timezone, rangeMinutes)
        ]);

        const metrics: MetricsBatchResponse['metrics'] = {};

        if (cpuResult.status === 'fulfilled' && cpuResult.value !== undefined) {
            metrics.cpu = Math.max(0, Math.min(100, cpuResult.value));
        }

        if (memoryResult.status === 'fulfilled' && memoryResult.value !== undefined) {
            metrics.memory = Math.round(memoryResult.value);
        }

        if (errorRateResult.status === 'fulfilled' && errorRateResult.value !== undefined) {
            metrics.errorRate = errorRateResult.value;
        }

        const hasMetrics = metrics.cpu !== undefined || metrics.memory !== undefined || metrics.errorRate !== undefined;

        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: Visualizer metrics result', {
                appId: app.id,
                appName: app.name,
                metrics,
                hasMetrics
            });
        }

        return {
            appId: app.id,
            success: hasMetrics,
            metrics: hasMetrics ? metrics : undefined,
            error: hasMetrics ? undefined : 'No metrics data'
        };
    } catch (error: any) {
        console.warn('Multi-App Dashboard: Visualizer metrics error', {
            appId: app.id,
            appName: app.name,
            error: error?.message
        });
        return {
            appId: app.id,
            success: false,
            error: error?.message || 'Failed to fetch metrics'
        };
    }
}

async function fetchVisualizerMetric(
    apiHelper: ApiHelper,
    datasource: VisualizerDatasource,
    measurement: string,
    field: string,
    condition: string,
    timezone: string,
    rangeMinutes: number,
    scale: number
): Promise<number | undefined> {
    const query = `SELECT mean("${field}") FROM "${measurement}" WHERE ${condition} AND time >= now() - ${rangeMinutes}m GROUP BY time(1m) fill(none) tz('${timezone}')`;
    const encodedQuery = encodeURIComponent(query);
    const url = `${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query?db="${datasource.database}"&q=${encodedQuery}&epoch=ms`;

    try {
        const response = await Promise.race([
            apiHelper.get(url),
            rejectAfterTimeout(METRICS_TIMEOUT)
        ]) as any;

        if (response.status === 200 && response.data?.results?.[0]?.series?.[0]?.values) {
            const values = response.data.results[0].series[0].values;
            // Get the most recent non-null value
            for (let i = values.length - 1; i >= 0; i--) {
                const value = values[i][1];
                if (value !== null && value !== undefined) {
                    return value * scale;
                }
            }
        }
        return undefined;
    } catch (error) {
        return undefined;
    }
}

async function fetchErrorRate(
    apiHelper: ApiHelper,
    datasource: VisualizerDatasource,
    condition: string,
    timezone: string,
    rangeMinutes: number
): Promise<number | undefined> {
    try {
        // Fetch total requests and failed requests in parallel
        // Use GROUP BY time(1m) and fill(0) to match Command Center query format
        const totalQuery = `SELECT sum("avg_request_count") FROM "app_inbound_metric" WHERE ${condition} AND time >= now() - ${rangeMinutes}m GROUP BY time(1m) fill(0) tz('${timezone}')`;
        const failedQuery = `SELECT sum("avg_request_count") FROM "app_inbound_metric" WHERE ${condition} AND "response_type" = 'FAILED' AND time >= now() - ${rangeMinutes}m GROUP BY time(1m) fill(0) tz('${timezone}')`;

        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: Fetching error rate', { totalQuery, failedQuery });
        }

        const [totalResponse, failedResponse] = await Promise.all([
            Promise.race([
                apiHelper.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query?db="${datasource.database}"&q=${encodeURIComponent(totalQuery)}&epoch=ms`),
                rejectAfterTimeout(METRICS_TIMEOUT)
            ]) as Promise<any>,
            Promise.race([
                apiHelper.get(`${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query?db="${datasource.database}"&q=${encodeURIComponent(failedQuery)}&epoch=ms`),
                rejectAfterTimeout(METRICS_TIMEOUT)
            ]) as Promise<any>
        ]);

        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: Error rate responses', {
                totalStatus: totalResponse.status,
                totalHasSeries: !!totalResponse.data?.results?.[0]?.series,
                failedStatus: failedResponse.status,
                failedHasSeries: !!failedResponse.data?.results?.[0]?.series
            });
        }

        // Extract total request count
        let totalRequests = 0;
        if (totalResponse.status === 200 && totalResponse.data?.results?.[0]?.series?.[0]?.values) {
            const values = totalResponse.data.results[0].series[0].values;
            for (const row of values) {
                if (row[1] !== null && row[1] !== undefined) {
                    totalRequests += row[1];
                }
            }
        }

        // Extract failed request count
        let failedRequests = 0;
        if (failedResponse.status === 200 && failedResponse.data?.results?.[0]?.series?.[0]?.values) {
            const values = failedResponse.data.results[0].series[0].values;
            for (const row of values) {
                if (row[1] !== null && row[1] !== undefined) {
                    failedRequests += row[1];
                }
            }
        }

        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: Error rate counts', { totalRequests, failedRequests });
        }

        // Calculate error rate as percentage
        if (totalRequests > 0) {
            const errorRate = (failedRequests / totalRequests) * 100;
            if (METRICS_DEBUG_LOG) {
                console.log('Multi-App Dashboard: Error rate calculated', {
                    totalRequests,
                    failedRequests,
                    errorRate: errorRate.toFixed(2) + '%'
                });
            }
            return Math.round(errorRate * 100) / 100; // Round to 2 decimal places
        }

        // No requests in the time range - return 0 (no errors)
        if (METRICS_DEBUG_LOG) {
            console.log('Multi-App Dashboard: No requests found, returning 0% error rate');
        }
        return 0;
    } catch (error: any) {
        if (METRICS_DEBUG_LOG) {
            console.warn('Multi-App Dashboard: Error fetching error rate', {
                message: error?.message,
                stack: error?.stack
            });
        }
        return undefined;
    }
}

function deriveAppIdentifier(app: ApplicationSummary): string {
    // For CH1: use domain with cloudhub.io suffix
    if (app.cloudhubVersion === 'CH1') {
        const domain = app.domain || app.name;
        // Check if already has cloudhub.io
        if (domain.includes('.cloudhub.io')) {
            return domain.toLowerCase();
        }
        // Try to derive from rawData
        const fullDomain = app.rawData?.fullDomain ||
                          app.rawData?.fullDomains?.[0] ||
                          app.rawData?.dnsInfo?.fullDomain;
        if (fullDomain) {
            return fullDomain.toLowerCase();
        }
        // Build from region
        const region = app.rawData?.region || app.region || 'us-e1';
        return `${domain}.${region}.cloudhub.io`.toLowerCase();
    }

    // For CH2: use application name
    return (app.name || app.domain).toLowerCase();
}

function extractMetricsFromResponse(data: any): MetricsBatchResponse['metrics'] {
    const metrics: MetricsBatchResponse['metrics'] = {};

    try {
        // Try different response structures
        if (data.metrics) {
            if (data.metrics['cpu-usage']) {
                const cpuData = data.metrics['cpu-usage'];
                const lastValue = Array.isArray(cpuData) ? cpuData[cpuData.length - 1] : cpuData;
                metrics.cpu = normalizeCpuValue(lastValue?.value ?? lastValue?.avg ?? undefined);
            }
            if (data.metrics['memory-usage']) {
                const memData = data.metrics['memory-usage'];
                const lastValue = Array.isArray(memData) ? memData[memData.length - 1] : memData;
                const normalizedMemory = normalizeMemoryValue(lastValue?.value ?? lastValue?.avg ?? undefined);
                metrics.memory = normalizedMemory !== undefined ? Math.round(normalizedMemory) : undefined;
            }
        }

        // Alternative structure
        if (data.cpu !== undefined) {
            metrics.cpu = normalizeCpuValue(data.cpu);
        }
        if (data.memory !== undefined) {
            const normalizedMemory = normalizeMemoryValue(data.memory);
            metrics.memory = normalizedMemory !== undefined ? Math.round(normalizedMemory) : undefined;
        }
    } catch (error) {
        console.warn('Error extracting metrics:', error);
    }

    return metrics;
}

function normalizeCpuValue(value?: number): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return undefined;
    }
    const normalized = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, normalized));
}

function normalizeMemoryValue(value?: number): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return undefined;
    }
    if (value > 1024 * 1024) {
        return value / (1024 * 1024);
    }
    if (value > 1024) {
        return value / 1024;
    }
    return value;
}

function resolveMemoryLimitMB(app: ApplicationSummary): number {
    const candidates = [
        app.rawData?.workers?.type?.memory,
        app.rawData?.workers?.type?.memoryInMB,
        app.rawData?.workerType?.memory,
        app.rawData?.resources?.memory,
        app.rawData?.target?.resources?.memory,
        app.rawData?.memoryReserved
    ];

    for (const candidate of candidates) {
        const parsed = parseMemoryLimitMB(candidate);
        if (parsed !== undefined) {
            return parsed;
        }
    }

    const workerTypeName = app.workerType || app.rawData?.workers?.type?.name || app.rawData?.workerType?.name;
    if (typeof workerTypeName === 'string') {
        const parsed = parseMemoryLimitFromString(workerTypeName);
        if (parsed !== undefined) {
            return parsed;
        }
    }

    return 1024;
}

function parseMemoryLimitMB(value: unknown): number | undefined {
    if (typeof value === 'number' && !Number.isNaN(value)) {
        const normalized = normalizeMemoryValue(value);
        return normalized !== undefined ? Math.round(normalized) : undefined;
    }
    if (typeof value === 'string') {
        return parseMemoryLimitFromString(value);
    }
    return undefined;
}

function parseMemoryLimitFromString(value: string): number | undefined {
    const match = value.match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
    if (!match) {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) {
            return Math.round(numeric);
        }
        return undefined;
    }
    const amount = Number(match[1]);
    if (Number.isNaN(amount)) {
        return undefined;
    }
    return match[2].toUpperCase() === 'GB' ? Math.round(amount * 1024) : Math.round(amount);
}

// ============================================================================
// HEALTH CALCULATION
// ============================================================================

function calculateApplicationHealth(
    app: ApplicationSummary,
    metrics?: MetricsBatchResponse['metrics']
): { score: number; status: 'healthy' | 'warning' | 'critical' } {
    let score = 100;

    // Status check (40 points)
    const runningStatuses = ['RUNNING', 'STARTED', 'APPLIED', 'DEPLOYING'];
    const stoppedStatuses = ['STOPPED', 'UNDEPLOYED', 'NOT_RUNNING'];

    const status = app.applicationStatus?.toUpperCase() || '';

    if (runningStatuses.includes(status)) {
        // No deduction
    } else if (stoppedStatuses.includes(status)) {
        score -= 40;
    } else {
        score -= 20; // Unknown or transitional state
    }

    const cpu = normalizeCpuValue(metrics?.cpu ?? app.metrics?.cpu);
    const memory = normalizeMemoryValue(metrics?.memory ?? app.metrics?.memory);
    const errorRate = metrics?.errorRate ?? app.metrics?.errorRate;
    const hasAnyMetrics = cpu !== undefined || memory !== undefined || errorRate !== undefined;

    if (runningStatuses.includes(status) && !hasAnyMetrics) {
        score -= 25;
    }

    // CPU threshold (20 points)
    if (cpu !== undefined) {
        if (cpu > 90) {
            score -= 20;
        } else if (cpu > 75) {
            score -= 10;
        }
    }

    // Memory threshold (20 points)
    if (memory !== undefined && app.cloudhubVersion !== 'HYBRID') {
        const memoryLimit = app.memoryLimitMB ?? resolveMemoryLimitMB(app);
        const memoryPercent = (memory / memoryLimit) * 100;
        if (memoryPercent > 90) {
            score -= 20;
        } else if (memoryPercent > 75) {
            score -= 10;
        }
    }

    // Error rate (20 points)
    if (errorRate !== undefined) {
        if (errorRate > 10) {
            score -= 20;
        } else if (errorRate > 5) {
            score -= 10;
        } else if (errorRate > 1) {
            score -= 5;
        }
    }

    // Ensure bounds
    score = Math.max(0, Math.min(100, score));

    // Determine status
    let healthStatus: 'healthy' | 'warning' | 'critical';
    if (score >= 80) {
        healthStatus = 'healthy';
    } else if (score >= 60) {
        healthStatus = 'warning';
    } else {
        healthStatus = 'critical';
    }

    return { score, status: healthStatus };
}

function calculateSummary(applications: ApplicationSummary[]): DashboardData['summary'] {
    const runningStatuses = ['RUNNING', 'STARTED', 'APPLIED'];

    return {
        total: applications.length,
        healthy: applications.filter(a => a.healthStatus === 'healthy').length,
        warning: applications.filter(a => a.healthStatus === 'warning').length,
        critical: applications.filter(a => a.healthStatus === 'critical').length,
        stopped: applications.filter(a => !runningStatuses.includes(a.applicationStatus?.toUpperCase())).length,
        running: applications.filter(a => runningStatuses.includes(a.applicationStatus?.toUpperCase())).length,
        ch1Count: applications.filter(a => a.cloudhubVersion === 'CH1').length,
        ch2Count: applications.filter(a => a.cloudhubVersion === 'CH2').length,
        hybridCount: applications.filter(a => a.cloudhubVersion === 'HYBRID').length
    };
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

async function handleRefresh(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    environmentId: string,
    organizationId: string,
    environmentName: string,
    organizationName: string
): Promise<void> {
    panel.webview.html = getLoadingHtml(environmentName);

    try {
        const applications = await fetchAllApplications(context, environmentId, organizationId);

        applications.forEach(app => {
            const health = calculateApplicationHealth(app);
            app.healthScore = health.score;
            app.healthStatus = health.status;
        });

        const dashboardData: DashboardData = {
            applications,
            environmentId,
            environmentName,
            organizationId,
            organizationName,
            lastRefreshed: Date.now(),
            summary: calculateSummary(applications),
            metricsLoadingState: 'idle'
        };

        panel.webview.html = getMultiAppDashboardHtml(dashboardData);

        // Auto-load metrics
        setTimeout(() => {
            panel.webview.postMessage({ command: 'triggerLoadMetrics' });
        }, 500);

        vscode.window.showInformationMessage('Dashboard refreshed');
    } catch (error: any) {
        panel.webview.html = getErrorHtml(error.message, environmentName);
    }
}

async function handleOpenCommandCenter(
    context: vscode.ExtensionContext,
    appData: ApplicationSummary,
    environmentId: string,
    environmentName: string
): Promise<void> {
    try {
        // Pass rawData which should contain cloudhubVersion info for Command Center to detect
        const enrichedAppData = {
            ...appData.rawData,
            cloudhubVersion: appData.cloudhubVersion,
            deploymentId: appData.deploymentId
        };
        await showApplicationCommandCenter(
            context,
            environmentId,
            environmentName,
            appData.name,
            enrichedAppData
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open Command Center: ${error.message}`);
    }
}

async function handleOpenLogs(
    context: vscode.ExtensionContext,
    appData: ApplicationSummary,
    environmentId: string
): Promise<void> {
    try {
        await showRealTimeLogs(
            context,
            environmentId,
            appData.domain,
            appData.cloudhubVersion,
            appData.deploymentId,
            appData.specificationId
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open logs: ${error.message}`);
    }
}

async function handleExportCSV(dashboardData: DashboardData): Promise<void> {
    const headers = ['Application', 'Type', 'Status', 'Health Score', 'Health Status', 'CPU %', 'Memory MB', 'Runtime Version', 'Region'];
    const rows = dashboardData.applications.map(app => [
        app.name,
        app.cloudhubVersion,
        app.applicationStatus,
        app.healthScore.toString(),
        app.healthStatus,
        app.metrics.cpu?.toFixed(1) || 'N/A',
        app.metrics.memory?.toString() || 'N/A',
        app.runtimeVersion || 'N/A',
        app.region || 'N/A'
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`anypoint-apps-${dashboardData.environmentName}-${Date.now()}.csv`),
        filters: { 'CSV files': ['csv'] }
    });

    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, 'utf8'));
        vscode.window.showInformationMessage(`Exported ${dashboardData.applications.length} applications to CSV`);
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function rejectAfterTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

async function getEffectiveOrganizationId(context: vscode.ExtensionContext, fallbackOrgId?: string): Promise<string> {
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const effectiveOrgId = await accountService.getEffectiveOrganizationId();
    return effectiveOrgId || fallbackOrgId || '';
}

// ============================================================================
// HTML GENERATION
// ============================================================================

function getLoadingHtml(environmentName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <style>
        ${getBaseStyles()}
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            gap: 20px;
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid var(--border-primary);
            border-top-color: var(--accent-blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Loading applications for ${environmentName}...</div>
    </div>
</body>
</html>`;
}

function getErrorHtml(errorMessage: string, environmentName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Error</title>
    <style>
        ${getBaseStyles()}
        .error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            gap: 20px;
            text-align: center;
            padding: 20px;
        }
        .error-icon { font-size: 48px; }
        .error-message { color: var(--error); max-width: 600px; }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">&#9888;</div>
        <h2>Failed to Load Dashboard</h2>
        <div class="error-message">${escapeHtml(errorMessage)}</div>
        <p>Environment: ${escapeHtml(environmentName)}</p>
    </div>
</body>
</html>`;
}

function getMultiAppDashboardHtml(data: DashboardData): string {
    const { applications, summary, environmentName, organizationName, lastRefreshed } = data;

    const appRows = applications.map(app => renderAppRow(app)).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Multi-App Dashboard - ${escapeHtml(environmentName)}</title>
    <style>
        ${getBaseStyles()}
        ${getDashboardStyles()}
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="dashboard-header">
            <div class="header-left">
                <h1>Multi-App Overview</h1>
                <div class="header-badges">
                    <span class="badge env-badge">${escapeHtml(environmentName)}</span>
                    <span class="badge org-badge">${escapeHtml(organizationName)}</span>
                </div>
            </div>
            <div class="header-right">
                <span class="last-updated">Updated: ${new Date(lastRefreshed).toLocaleTimeString()}</span>
                <button class="btn btn-primary" onclick="refreshDashboard()">
                    <span class="btn-icon">&#8635;</span> Refresh
                </button>
                <button class="btn btn-secondary" onclick="exportCSV()">
                    <span class="btn-icon">&#8681;</span> Export
                </button>
            </div>
        </header>

        <!-- Summary Cards -->
        <section class="summary-cards">
            <div class="summary-card total">
                <div class="card-value">${summary.total}</div>
                <div class="card-label">Total Apps</div>
                <div class="card-breakdown">${summary.ch1Count} CH1 | ${summary.ch2Count} CH2 | ${summary.hybridCount} Hybrid</div>
            </div>
            <div class="summary-card healthy">
                <div class="card-icon">&#9679;</div>
                <div class="card-value">${summary.healthy}</div>
                <div class="card-label">Healthy</div>
            </div>
            <div class="summary-card warning">
                <div class="card-icon">&#9679;</div>
                <div class="card-value">${summary.warning}</div>
                <div class="card-label">Warning</div>
            </div>
            <div class="summary-card critical">
                <div class="card-icon">&#9679;</div>
                <div class="card-value">${summary.critical}</div>
                <div class="card-label">Critical</div>
            </div>
            <div class="summary-card running">
                <div class="card-value">${summary.running}</div>
                <div class="card-label">Running</div>
            </div>
        </section>

        <!-- Metrics Progress -->
        <div id="metrics-progress" class="metrics-progress" style="display: none;">
            <div class="progress-bar">
                <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
            </div>
            <span id="progress-text">Loading metrics...</span>
        </div>

        <!-- Filters -->
        <section class="filters-section">
            <input type="text" id="search-input" class="search-input" placeholder="Search applications..." oninput="filterApps()">
            <select id="status-filter" class="filter-select" onchange="filterApps()">
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
            </select>
            <select id="health-filter" class="filter-select" onchange="filterApps()">
                <option value="all">All Health</option>
                <option value="healthy">Healthy</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
            </select>
            <select id="type-filter" class="filter-select" onchange="filterApps()">
                <option value="all">All Types</option>
                <option value="CH1">CloudHub 1.0</option>
                <option value="CH2">CloudHub 2.0</option>
                <option value="HYBRID">Hybrid</option>
            </select>
        </section>

        <!-- Applications Table -->
        <section class="table-container">
            <table class="apps-table" id="apps-table">
                <thead>
                    <tr>
                        <th class="sortable" onclick="sortTable('name')">Application <span class="sort-icon" data-col="name"></span></th>
                        <th class="sortable" onclick="sortTable('type')">Type <span class="sort-icon" data-col="type"></span></th>
                        <th class="sortable" onclick="sortTable('status')">Status <span class="sort-icon" data-col="status"></span></th>
                        <th class="sortable" onclick="sortTable('health')">Health <span class="sort-icon" data-col="health"></span></th>
                        <th class="sortable" onclick="sortTable('cpu')">CPU <span class="sort-icon" data-col="cpu"></span></th>
                        <th class="sortable" onclick="sortTable('memory')">Memory <span class="sort-icon" data-col="memory"></span></th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="apps-tbody">
                    ${appRows}
                </tbody>
            </table>
            ${applications.length === 0 ? '<div class="no-apps">No applications found in this environment</div>' : ''}
        </section>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
    let applications = ${JSON.stringify(applications)};
        let currentSort = { column: 'name', direction: 'asc' };

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'triggerLoadMetrics':
                    loadMetrics();
                    break;
                case 'metricsLoadingStarted':
                    showMetricsProgress(0, message.total);
                    break;
                case 'metricsProgress':
                    updateMetricsProgress(message.completed, message.total, message.updatedApps);
                    break;
                case 'metricsLoadingComplete':
                    hideMetricsProgress();
                    updateSummaryCards(message.summary);
                    break;
            }
        });

        function loadMetrics() {
            vscode.postMessage({ command: 'loadMetrics' });
        }

        function showMetricsProgress(completed, total) {
            const progress = document.getElementById('metrics-progress');
            progress.style.display = 'flex';
            updateProgressBar(completed, total);
        }

        function updateMetricsProgress(completed, total, updatedApps) {
            updateProgressBar(completed, total);
            // Update individual app rows
            updatedApps.forEach(app => {
                const appIdx = applications.findIndex(a => a.id === app.id);
                if (appIdx !== -1) {
                    applications[appIdx].metrics = app.metrics;
                    applications[appIdx].healthScore = app.healthScore;
                    applications[appIdx].healthStatus = app.healthStatus;
                    applications[appIdx].metricsError = app.metricsError;
                    applications[appIdx].metricsStatus = app.metricsStatus;
                    updateAppRow(applications[appIdx]);
                }
            });
        }

        function updateProgressBar(completed, total) {
            const fill = document.getElementById('progress-fill');
            const text = document.getElementById('progress-text');
            const percent = Math.round((completed / total) * 100);
            fill.style.width = percent + '%';
            text.textContent = 'Loading metrics... ' + completed + '/' + total;
        }

        function hideMetricsProgress() {
            const progress = document.getElementById('metrics-progress');
            progress.style.display = 'none';
        }

        function updateSummaryCards(summary) {
            document.querySelector('.summary-card.healthy .card-value').textContent = summary.healthy;
            document.querySelector('.summary-card.warning .card-value').textContent = summary.warning;
            document.querySelector('.summary-card.critical .card-value').textContent = summary.critical;
        }

        function updateAppRow(app) {
            const row = document.querySelector('tr[data-app-id="' + app.id + '"]');
            if (!row) return;

            // Update health cell
            const healthCell = row.querySelector('.health-cell');
            if (healthCell) {
                const icon = app.healthStatus === 'healthy' ? '&#9679;' : app.healthStatus === 'warning' ? '&#9679;' : '&#9679;';
                const tooltip = buildHealthTooltip(app);
                healthCell.innerHTML = '<div class="health-indicator ' + app.healthStatus + '" data-tooltip="' + escapeHtmlJS(tooltip) + '" aria-label="' + escapeHtmlJS(tooltip) + '" tabindex="0"><span class="health-icon">' + icon + '</span><span class="health-score">' + app.healthScore + '%</span></div>';
            }

            // Update metrics cells
            const cpuCell = row.querySelector('.cpu-cell');
            if (cpuCell) {
                cpuCell.textContent = app.metrics?.cpu !== undefined ? app.metrics.cpu.toFixed(1) + '%' : 'N/A';
            }

            const memCell = row.querySelector('.mem-cell');
            if (memCell) {
                memCell.textContent = app.metrics?.memory !== undefined ? app.metrics.memory + ' MB' : 'N/A';
            }

            // Update row class
            row.className = 'app-row ' + app.healthStatus;
        }

        function refreshDashboard() {
            vscode.postMessage({ command: 'refresh' });
        }

        function exportCSV() {
            vscode.postMessage({ command: 'exportCSV' });
        }

        function openCommandCenter(appId) {
            const app = applications.find(a => a.id === appId);
            if (app) {
                vscode.postMessage({ command: 'openCommandCenter', appData: app });
            }
        }

        function openLogs(appId) {
            const app = applications.find(a => a.id === appId);
            if (app) {
                vscode.postMessage({ command: 'openLogs', appData: app });
            }
        }

        function filterApps() {
            const search = document.getElementById('search-input').value.toLowerCase();
            const statusFilter = document.getElementById('status-filter').value;
            const healthFilter = document.getElementById('health-filter').value;
            const typeFilter = document.getElementById('type-filter').value;

            const rows = document.querySelectorAll('#apps-tbody .app-row');
            rows.forEach(row => {
                const appId = row.getAttribute('data-app-id');
                const app = applications.find(a => a.id === appId);
                if (!app) return;

                let visible = true;

                // Search filter
                if (search && !app.name.toLowerCase().includes(search)) {
                    visible = false;
                }

                // Status filter
                if (statusFilter !== 'all') {
                    const isRunning = ['RUNNING', 'STARTED', 'APPLIED'].includes(app.applicationStatus?.toUpperCase());
                    if (statusFilter === 'running' && !isRunning) visible = false;
                    if (statusFilter === 'stopped' && isRunning) visible = false;
                }

                // Health filter
                if (healthFilter !== 'all' && app.healthStatus !== healthFilter) {
                    visible = false;
                }

                // Type filter
                if (typeFilter !== 'all' && app.cloudhubVersion !== typeFilter) {
                    visible = false;
                }

                row.style.display = visible ? '' : 'none';
            });
        }

        function sortTable(column) {
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            applications.sort((a, b) => {
                let valA, valB;
                switch (column) {
                    case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                    case 'type': valA = a.cloudhubVersion; valB = b.cloudhubVersion; break;
                    case 'status': valA = a.applicationStatus; valB = b.applicationStatus; break;
                    case 'health': valA = a.healthScore; valB = b.healthScore; break;
                    case 'cpu': valA = a.metrics?.cpu ?? -1; valB = b.metrics?.cpu ?? -1; break;
                    case 'memory': valA = a.metrics?.memory ?? -1; valB = b.metrics?.memory ?? -1; break;
                    default: valA = a.name; valB = b.name;
                }

                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });

            // Re-render table
            const tbody = document.getElementById('apps-tbody');
            tbody.innerHTML = applications.map(app => renderAppRowJS(app)).join('');

            // Update sort icons
            document.querySelectorAll('.sort-icon').forEach(icon => {
                icon.textContent = '';
            });
            const activeIcon = document.querySelector('.sort-icon[data-col="' + column + '"]');
            if (activeIcon) {
                activeIcon.textContent = currentSort.direction === 'asc' ? ' \\u25B2' : ' \\u25BC';
            }
        }

        function renderAppRowJS(app) {
            const healthIcon = app.healthStatus === 'healthy' ? '&#9679;' : '&#9679;';
            const statusClass = ['RUNNING', 'STARTED', 'APPLIED'].includes(app.applicationStatus?.toUpperCase()) ? 'status-running' : 'status-stopped';
            const typeIcon = app.cloudhubVersion === 'CH1' ? '&#9729;' : app.cloudhubVersion === 'CH2' ? '&#9730;' : '&#9731;';
            const tooltip = buildHealthTooltip(app);

            return '<tr class="app-row ' + app.healthStatus + '" data-app-id="' + app.id + '">' +
                '<td class="app-name"><span class="type-icon">' + typeIcon + '</span> ' + escapeHtmlJS(app.name) + '</td>' +
                '<td><span class="type-badge ' + app.cloudhubVersion.toLowerCase() + '">' + app.cloudhubVersion + '</span></td>' +
                '<td><span class="status-badge ' + statusClass + '">' + (app.applicationStatus || 'Unknown') + '</span></td>' +
                '<td class="health-cell"><div class="health-indicator ' + app.healthStatus + '" data-tooltip="' + escapeHtmlJS(tooltip) + '" aria-label="' + escapeHtmlJS(tooltip) + '" tabindex="0"><span class="health-icon">' + healthIcon + '</span><span class="health-score">' + app.healthScore + '%</span></div></td>' +
                '<td class="cpu-cell">' + (app.metrics?.cpu !== undefined ? app.metrics.cpu.toFixed(1) + '%' : 'N/A') + '</td>' +
                '<td class="mem-cell">' + (app.metrics?.memory !== undefined ? app.metrics.memory + ' MB' : 'N/A') + '</td>' +
                '<td class="actions-cell">' +
                    '<button class="action-btn" onclick="openCommandCenter(\\'' + app.id + '\\')" title="Command Center">&#127919;</button>' +
                    '<button class="action-btn" onclick="openLogs(\\'' + app.id + '\\')" title="View Logs">&#128203;</button>' +
                '</td>' +
            '</tr>';
        }

        function buildHealthTooltip(app) {
            const lines = [];
            const status = (app.applicationStatus || '').toUpperCase();
            const runningStatuses = ['RUNNING', 'STARTED', 'APPLIED', 'DEPLOYING'];
            const stoppedStatuses = ['STOPPED', 'UNDEPLOYED', 'NOT_RUNNING'];
            const cpu = normalizeCpuValue(app.metrics?.cpu);
            const memory = normalizeMemoryValue(app.metrics?.memory);
            const errorRate = app.metrics?.errorRate;
            const hasAnyMetrics = cpu !== undefined || memory !== undefined || errorRate !== undefined;

            lines.push('Score: ' + app.healthScore + '% (' + app.healthStatus + ')');

            if (app.metricsError) {
                const statusLabel = app.metricsStatus ? 'HTTP ' + app.metricsStatus : 'Unknown error';
                lines.push('Metrics: ' + app.metricsError + ' (' + statusLabel + ')');
            }

            if (runningStatuses.includes(status)) {
                lines.push('Status: ' + status + ' (0)');
            } else if (stoppedStatuses.includes(status)) {
                lines.push('Status: ' + (status || 'UNKNOWN') + ' (-40)');
            } else {
                lines.push('Status: ' + (status || 'UNKNOWN') + ' (-20)');
            }

            if (runningStatuses.includes(status) && !hasAnyMetrics) {
                lines.push('Metrics: missing while running (-25)');
            }

            if (cpu !== undefined) {
                const cpuPenalty = cpu > 90 ? -20 : cpu > 75 ? -10 : 0;
                lines.push('CPU: ' + cpu.toFixed(1) + '% (' + cpuPenalty + ')');
            } else {
                lines.push('CPU: N/A');
            }

            if (memory !== undefined && app.cloudhubVersion !== 'HYBRID') {
                const limit = app.memoryLimitMB || 1024;
                const memoryPercent = (memory / limit) * 100;
                const memPenalty = memoryPercent > 90 ? -20 : memoryPercent > 75 ? -10 : 0;
                lines.push('Memory: ' + Math.round(memory) + ' MB of ' + limit + ' MB (' + memPenalty + ')');
            } else if (app.cloudhubVersion !== 'HYBRID') {
                lines.push('Memory: N/A');
            }

            if (errorRate !== undefined) {
                const errPenalty = errorRate > 10 ? -20 : errorRate > 5 ? -10 : errorRate > 1 ? -5 : 0;
                lines.push('Error rate: ' + errorRate.toFixed(1) + '% (' + errPenalty + ')');
            } else {
                lines.push('Error rate: N/A');
            }

            return lines.join('\\n');
        }

        function normalizeCpuValue(value) {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return undefined;
            }
            const normalized = value <= 1 ? value * 100 : value;
            return Math.max(0, Math.min(100, normalized));
        }

        function normalizeMemoryValue(value) {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return undefined;
            }
            if (value > 1024 * 1024) {
                return value / (1024 * 1024);
            }
            if (value > 1024) {
                return value / 1024;
            }
            return value;
        }

        function escapeHtmlJS(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
    </script>
</body>
</html>`;
}

function renderAppRow(app: ApplicationSummary): string {
    const healthIcon = '&#9679;';
    const statusClass = ['RUNNING', 'STARTED', 'APPLIED'].includes(app.applicationStatus?.toUpperCase()) ? 'status-running' : 'status-stopped';
    const typeIcon = app.cloudhubVersion === 'CH1' ? '&#9729;' : app.cloudhubVersion === 'CH2' ? '&#9730;' : '&#9731;';
    const tooltip = buildHealthTooltip(app);

    return `
        <tr class="app-row ${app.healthStatus}" data-app-id="${app.id}">
            <td class="app-name"><span class="type-icon">${typeIcon}</span> ${escapeHtml(app.name)}</td>
            <td><span class="type-badge ${app.cloudhubVersion.toLowerCase()}">${app.cloudhubVersion}</span></td>
            <td><span class="status-badge ${statusClass}">${app.applicationStatus || 'Unknown'}</span></td>
            <td class="health-cell">
                <div class="health-indicator ${app.healthStatus}" data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}" tabindex="0">
                    <span class="health-icon">${healthIcon}</span>
                    <span class="health-score">${app.healthScore}%</span>
                </div>
            </td>
            <td class="cpu-cell">${app.metrics?.cpu !== undefined ? app.metrics.cpu.toFixed(1) + '%' : 'N/A'}</td>
            <td class="mem-cell">${app.metrics?.memory !== undefined ? app.metrics.memory + ' MB' : 'N/A'}</td>
            <td class="actions-cell">
                <button class="action-btn" onclick="openCommandCenter('${app.id}')" title="Command Center">&#127919;</button>
                <button class="action-btn" onclick="openLogs('${app.id}')" title="View Logs">&#128203;</button>
            </td>
        </tr>
    `;
}

function escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHealthTooltip(app: ApplicationSummary): string {
    const lines: string[] = [];
    const status = app.applicationStatus?.toUpperCase() || '';
    const runningStatuses = ['RUNNING', 'STARTED', 'APPLIED', 'DEPLOYING'];
    const stoppedStatuses = ['STOPPED', 'UNDEPLOYED', 'NOT_RUNNING'];
    const cpu = normalizeCpuValue(app.metrics?.cpu);
    const memory = normalizeMemoryValue(app.metrics?.memory);
    const errorRate = app.metrics?.errorRate;
    const hasAnyMetrics = cpu !== undefined || memory !== undefined || errorRate !== undefined;

    lines.push(`Score: ${app.healthScore}% (${app.healthStatus})`);

    if (app.metricsError) {
        const statusLabel = app.metricsStatus ? `HTTP ${app.metricsStatus}` : 'Unknown error';
        lines.push(`Metrics: ${app.metricsError} (${statusLabel})`);
    }

    if (runningStatuses.includes(status)) {
        lines.push(`Status: ${status || 'UNKNOWN'} (0)`);
    } else if (stoppedStatuses.includes(status)) {
        lines.push(`Status: ${status || 'UNKNOWN'} (-40)`);
    } else {
        lines.push(`Status: ${status || 'UNKNOWN'} (-20)`);
    }

    if (runningStatuses.includes(status) && !hasAnyMetrics) {
        lines.push('Metrics: missing while running (-25)');
    }

    if (cpu !== undefined) {
        const cpuPenalty = cpu > 90 ? -20 : cpu > 75 ? -10 : 0;
        lines.push(`CPU: ${cpu.toFixed(1)}% (${cpuPenalty})`);
    } else {
        lines.push('CPU: N/A');
    }

    if (memory !== undefined && app.cloudhubVersion !== 'HYBRID') {
        const limit = app.memoryLimitMB ?? 1024;
        const memoryPercent = (memory / limit) * 100;
        const memPenalty = memoryPercent > 90 ? -20 : memoryPercent > 75 ? -10 : 0;
        lines.push(`Memory: ${Math.round(memory)} MB of ${limit} MB (${memPenalty})`);
    } else if (app.cloudhubVersion !== 'HYBRID') {
        lines.push('Memory: N/A');
    }

    if (errorRate !== undefined) {
        const errPenalty = errorRate > 10 ? -20 : errorRate > 5 ? -10 : errorRate > 1 ? -5 : 0;
        lines.push(`Error rate: ${errorRate.toFixed(1)}% (${errPenalty})`);
    } else {
        lines.push('Error rate: N/A');
    }

    return lines.join('\n');
}

function getBaseStyles(): string {
    return `
        :root {
            --background-primary: #1e2328;
            --background-secondary: #161b22;
            --surface-primary: #21262d;
            --surface-secondary: #30363d;
            --surface-accent: #0d1117;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --text-muted: #656d76;
            --accent-blue: #58a6ff;
            --accent-light: #79c0ff;
            --border-primary: #30363d;
            --border-muted: #21262d;
            --success: #3fb950;
            --warning: #d29922;
            --error: #f85149;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            background: var(--background-primary);
            color: var(--text-primary);
            line-height: 1.5;
            padding: 24px;
            overflow-x: hidden;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
}

function getDashboardStyles(): string {
    return `
        /* Header */
        .dashboard-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding: 24px;
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            animation: slideDown 0.6s ease-out;
            position: relative;
            overflow: hidden;
        }

        .dashboard-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--accent-blue), var(--success), var(--accent-light));
        }

        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-30px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .dashboard-header h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .header-badges {
            display: flex;
            gap: 8px;
        }

        .badge {
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--border-primary);
            background: var(--surface-primary);
            color: var(--text-secondary);
        }

        .env-badge {
            background: var(--surface-primary);
            color: var(--text-primary);
        }

        .org-badge {
            background: var(--surface-primary);
            color: var(--text-secondary);
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .last-updated {
            color: var(--text-muted);
            font-size: 12px;
        }

        .btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 10px 18px;
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .btn-primary {
            background: var(--surface-primary);
            color: var(--text-primary);
        }

        .btn-primary:hover {
            background: var(--surface-secondary);
            border-color: var(--accent-blue);
            transform: translateY(-2px);
        }

        .btn-secondary {
            background: var(--surface-primary);
            color: var(--text-primary);
        }

        .btn-secondary:hover {
            background: var(--surface-secondary);
            border-color: var(--accent-blue);
            transform: translateY(-2px);
        }

        /* Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .summary-card {
            position: relative;
            background: var(--surface-primary);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            border: 1px solid var(--border-primary);
            transition: all 0.3s ease;
            animation: slideUp 0.6s ease-out 0.1s both;
        }

        .summary-card .card-icon {
            font-size: 12px;
            margin-bottom: 4px;
        }

        .summary-card .card-value {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .summary-card .card-label {
            font-size: 14px;
            color: var(--text-secondary);
        }

        .summary-card .card-breakdown {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 8px;
        }

        .summary-card:hover {
            background: var(--surface-secondary);
            transform: translateY(-4px);
            border-color: var(--accent-blue);
        }

        .summary-card.healthy .card-icon { color: var(--success); }
        .summary-card.healthy .card-value { color: var(--success); }
        .summary-card.warning .card-icon { color: var(--warning); }
        .summary-card.warning .card-value { color: var(--warning); }
        .summary-card.critical .card-icon { color: var(--error); }
        .summary-card.critical .card-value { color: var(--error); }

        /* Metrics Progress */
        .metrics-progress {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            padding: 12px 16px;
            background: var(--surface-primary);
            border-radius: 8px;
            border: 1px solid var(--border-primary);
        }

        .progress-bar {
            flex: 1;
            height: 8px;
            background: var(--surface-secondary);
            border-radius: 4px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--accent-blue);
            transition: width 0.3s ease;
        }

        #progress-text {
            font-size: 12px;
            color: var(--text-secondary);
            min-width: 150px;
        }

        /* Filters */
        .filters-section {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .search-input {
            flex: 1;
            min-width: 200px;
            padding: 10px 16px;
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 14px;
        }

        .search-input:focus {
            outline: none;
            border-color: var(--accent-blue);
        }

        .filter-select {
            padding: 10px 16px;
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 14px;
            cursor: pointer;
        }

        .search-input::placeholder {
            color: var(--text-muted);
        }

        /* Table */
        .table-container {
            background: var(--surface-primary);
            border-radius: 12px;
            border: 1px solid var(--border-primary);
            overflow: hidden;
        }

        .apps-table {
            width: 100%;
            border-collapse: collapse;
        }

        .apps-table th {
            background: var(--background-secondary);
            padding: 14px 16px;
            text-align: left;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-primary);
        }

        .apps-table th.sortable {
            cursor: pointer;
        }

        .apps-table th.sortable:hover {
            color: var(--accent-blue);
        }

        .apps-table td {
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-primary);
        }

        .app-row {
            transition: background 0.2s, transform 0.2s;
        }

        .app-row:hover {
            background: var(--surface-secondary);
        }

        .app-row.warning {
            border-left: 3px solid var(--warning);
        }

        .app-row.critical {
            border-left: 3px solid var(--error);
        }

        .app-name {
            font-weight: 500;
        }

        .type-icon {
            margin-right: 8px;
            opacity: 0.7;
        }

        .type-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--border-primary);
        }

        .type-badge.ch1 { background: var(--surface-primary); color: var(--accent-light); }
        .type-badge.ch2 { background: var(--surface-primary); color: var(--success); }
        .type-badge.hybrid { background: var(--surface-primary); color: var(--warning); }

        .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            border: 1px solid var(--border-primary);
        }

        .status-badge.status-running {
            background: rgba(63, 185, 80, 0.2);
            color: var(--success);
        }

        .status-badge.status-stopped {
            background: rgba(248, 81, 73, 0.2);
            color: var(--error);
        }

        .health-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 10px;
            border-radius: 999px;
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            width: fit-content;
            position: relative;
            cursor: help;
        }

        .health-indicator.healthy .health-icon { color: var(--success); }
        .health-indicator.warning .health-icon { color: var(--warning); }
        .health-indicator.critical .health-icon { color: var(--error); }

        .health-score {
            font-weight: 500;
        }

        .health-indicator::after {
            content: attr(data-tooltip);
            position: absolute;
            left: 50%;
            bottom: calc(100% + 12px);
            transform: translateX(-50%) translateY(6px);
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            color: var(--text-primary);
            font-size: 12px;
            line-height: 1.4;
            padding: 8px 10px;
            border-radius: 8px;
            white-space: pre-line;
            min-width: 200px;
            max-width: 260px;
            opacity: 0;
            pointer-events: none;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            z-index: 10;
            transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .health-indicator::before {
            content: '';
            position: absolute;
            left: 50%;
            bottom: calc(100% + 4px);
            transform: translateX(-50%);
            border: 6px solid transparent;
            border-top-color: var(--background-secondary);
            opacity: 0;
            transition: opacity 0.2s ease;
            z-index: 11;
        }

        .health-indicator:hover::after,
        .health-indicator:focus-visible::after,
        .health-indicator:hover::before,
        .health-indicator:focus-visible::before {
            opacity: 1;
        }

        .health-indicator:hover::after,
        .health-indicator:focus-visible::after {
            transform: translateX(-50%) translateY(0);
        }

        .actions-cell {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }

        .action-btn:hover {
            background: var(--surface-secondary);
            border-color: var(--accent-blue);
        }

        .no-apps {
            padding: 48px;
            text-align: center;
            color: var(--text-muted);
        }

        .sort-icon {
            font-size: 10px;
            margin-left: 4px;
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
}
