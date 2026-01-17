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
    runtimeVersion?: string;
    replicas?: number;
    workers?: number;
    workerType?: string;
    region?: string;
    lastUpdated?: number;
    deploymentId?: string;
    specificationId?: string;
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
}

// ============================================================================
// CONSTANTS
// ============================================================================

const METRICS_BATCH_SIZE = 5;
const METRICS_BATCH_DELAY = 300;
const METRICS_TIMEOUT = 8000;

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
    return {
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
}

function normalizeCH2App(app: any): ApplicationSummary {
    const appName = app.name || app.artifact?.name || app.application?.domain || 'Unknown';
    const status = app.application?.status || app.status || app.lastReportedStatus || 'UNKNOWN';

    return {
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
}

function normalizeHybridApp(app: any): ApplicationSummary {
    const appName = app.name || app.artifact?.name || 'Unknown';

    return {
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
}

// ============================================================================
// METRICS FETCHING
// ============================================================================

async function handleLoadMetrics(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    dashboardData: DashboardData
): Promise<void> {
    const { applications, environmentId, organizationId } = dashboardData;

    if (applications.length === 0) {
        return;
    }

    dashboardData.metricsLoadingState = 'loading';
    panel.webview.postMessage({
        command: 'metricsLoadingStarted',
        total: applications.length
    });

    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);

    // Process in batches
    const batches = chunkArray(applications, METRICS_BATCH_SIZE);
    let completed = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        const batchResults = await Promise.allSettled(
            batch.map(app => fetchSingleAppMetrics(apiHelper, baseUrl, app, environmentId, organizationId))
        );

        // Update metrics for each app
        batchResults.forEach((result, idx) => {
            const app = batch[idx];
            if (result.status === 'fulfilled' && result.value.success && result.value.metrics) {
                app.metrics = result.value.metrics;
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
            total: applications.length,
            updatedApps: batch.map(app => ({
                id: app.id,
                metrics: app.metrics,
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

async function fetchSingleAppMetrics(
    apiHelper: ApiHelper,
    baseUrl: string,
    app: ApplicationSummary,
    environmentId: string,
    organizationId: string
): Promise<MetricsBatchResponse> {
    try {
        const to = new Date();
        const from = new Date(to.getTime() - 15 * 60 * 1000); // Last 15 minutes

        const params = new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
            detailed: 'false'
        });

        const appIdentifier = app.deploymentId || app.domain;
        const url = `${baseUrl}/monitoring/query/api/v1/organizations/${organizationId}/environments/${environmentId}/applications/${encodeURIComponent(appIdentifier)}?${params.toString()}`;

        const response = await Promise.race([
            apiHelper.get(url, {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationId
                }
            }),
            rejectAfterTimeout(METRICS_TIMEOUT)
        ]) as any;

        if (response.status === 200 && response.data) {
            const metrics = extractMetricsFromResponse(response.data);
            return { appId: app.id, success: true, metrics };
        }

        return { appId: app.id, success: false, error: 'No data' };
    } catch (error: any) {
        return { appId: app.id, success: false, error: error.message || 'Timeout' };
    }
}

function extractMetricsFromResponse(data: any): MetricsBatchResponse['metrics'] {
    const metrics: MetricsBatchResponse['metrics'] = {};

    try {
        // Try different response structures
        if (data.metrics) {
            if (data.metrics['cpu-usage']) {
                const cpuData = data.metrics['cpu-usage'];
                const lastValue = Array.isArray(cpuData) ? cpuData[cpuData.length - 1] : cpuData;
                metrics.cpu = lastValue?.value ?? lastValue?.avg ?? undefined;
            }
            if (data.metrics['memory-usage']) {
                const memData = data.metrics['memory-usage'];
                const lastValue = Array.isArray(memData) ? memData[memData.length - 1] : memData;
                metrics.memory = lastValue?.value ?? lastValue?.avg ?? undefined;
                if (metrics.memory) {
                    metrics.memory = Math.round(metrics.memory / (1024 * 1024)); // Convert to MB
                }
            }
        }

        // Alternative structure
        if (data.cpu !== undefined) {
            metrics.cpu = data.cpu;
        }
        if (data.memory !== undefined) {
            metrics.memory = Math.round(data.memory / (1024 * 1024));
        }
    } catch (error) {
        console.warn('Error extracting metrics:', error);
    }

    return metrics;
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

    // CPU threshold (20 points)
    const cpu = metrics?.cpu ?? app.metrics?.cpu;
    if (cpu !== undefined) {
        if (cpu > 90) {
            score -= 20;
        } else if (cpu > 75) {
            score -= 10;
        }
    }

    // Memory threshold (20 points)
    const memory = metrics?.memory ?? app.metrics?.memory;
    if (memory !== undefined && app.cloudhubVersion !== 'HYBRID') {
        // Estimate memory percentage (assume 1GB allocation as default)
        const memoryLimit = 1024; // MB
        const memoryPercent = (memory / memoryLimit) * 100;
        if (memoryPercent > 90) {
            score -= 20;
        } else if (memoryPercent > 75) {
            score -= 10;
        }
    }

    // Error rate (20 points)
    const errorRate = metrics?.errorRate ?? app.metrics?.errorRate;
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
                healthCell.innerHTML = '<div class="health-indicator ' + app.healthStatus + '"><span class="health-icon">' + icon + '</span><span class="health-score">' + app.healthScore + '%</span></div>';
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

            return '<tr class="app-row ' + app.healthStatus + '" data-app-id="' + app.id + '">' +
                '<td class="app-name"><span class="type-icon">' + typeIcon + '</span> ' + escapeHtmlJS(app.name) + '</td>' +
                '<td><span class="type-badge ' + app.cloudhubVersion.toLowerCase() + '">' + app.cloudhubVersion + '</span></td>' +
                '<td><span class="status-badge ' + statusClass + '">' + (app.applicationStatus || 'Unknown') + '</span></td>' +
                '<td class="health-cell"><div class="health-indicator ' + app.healthStatus + '"><span class="health-icon">' + healthIcon + '</span><span class="health-score">' + app.healthScore + '%</span></div></td>' +
                '<td class="cpu-cell">' + (app.metrics?.cpu !== undefined ? app.metrics.cpu.toFixed(1) + '%' : 'N/A') + '</td>' +
                '<td class="mem-cell">' + (app.metrics?.memory !== undefined ? app.metrics.memory + ' MB' : 'N/A') + '</td>' +
                '<td class="actions-cell">' +
                    '<button class="action-btn" onclick="openCommandCenter(\\'' + app.id + '\\')" title="Command Center">&#127919;</button>' +
                    '<button class="action-btn" onclick="openLogs(\\'' + app.id + '\\')" title="View Logs">&#128203;</button>' +
                '</td>' +
            '</tr>';
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

    return `
        <tr class="app-row ${app.healthStatus}" data-app-id="${app.id}">
            <td class="app-name"><span class="type-icon">${typeIcon}</span> ${escapeHtml(app.name)}</td>
            <td><span class="type-badge ${app.cloudhubVersion.toLowerCase()}">${app.cloudhubVersion}</span></td>
            <td><span class="status-badge ${statusClass}">${app.applicationStatus || 'Unknown'}</span></td>
            <td class="health-cell">
                <div class="health-indicator ${app.healthStatus}">
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

function getBaseStyles(): string {
    return `
        :root {
            --background-primary: #1e2328;
            --background-secondary: #161b22;
            --surface-primary: #21262d;
            --surface-secondary: #30363d;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --text-muted: #656d76;
            --accent-blue: #58a6ff;
            --accent-light: #79c0ff;
            --border-primary: #30363d;
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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background-color: var(--background-primary);
            color: var(--text-primary);
            line-height: 1.5;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
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
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-primary);
        }

        .dashboard-header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .header-badges {
            display: flex;
            gap: 8px;
        }

        .badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }

        .env-badge {
            background: var(--accent-blue);
            color: white;
        }

        .org-badge {
            background: var(--surface-secondary);
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
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-primary {
            background: var(--accent-blue);
            color: white;
        }

        .btn-primary:hover {
            background: var(--accent-light);
        }

        .btn-secondary {
            background: var(--surface-secondary);
            color: var(--text-primary);
        }

        .btn-secondary:hover {
            background: var(--surface-primary);
        }

        /* Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .summary-card {
            background: var(--surface-primary);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid var(--border-primary);
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
            transition: background 0.2s;
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
        }

        .type-badge.ch1 { background: #2e4a62; color: #79c0ff; }
        .type-badge.ch2 { background: #1f4a2e; color: #7ee787; }
        .type-badge.hybrid { background: #4a3a1f; color: #e3b341; }

        .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
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
        }

        .health-indicator.healthy .health-icon { color: var(--success); }
        .health-indicator.warning .health-icon { color: var(--warning); }
        .health-indicator.critical .health-icon { color: var(--error); }

        .health-score {
            font-weight: 500;
        }

        .actions-cell {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            background: var(--surface-secondary);
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }

        .action-btn:hover {
            background: var(--accent-blue);
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
    `;
}
