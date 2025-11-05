import * as vscode from 'vscode';
import { ApiHelper } from '../controllers/apiHelper.js';
import { AccountService } from '../controllers/accountService.js';
import { BASE_URL } from '../constants';

interface MetricsSession {
    panel: vscode.WebviewPanel;
    intervalId: NodeJS.Timeout | null;
    isStreaming: boolean;
    context: vscode.ExtensionContext;
    refreshRate: number;
    environmentId: string;
    organizationId: string;
    applicationName: string;
    deploymentId: string;
    resourceId: string;
}

const activeSessions = new Map<string, MetricsSession>();

/**
 * Show CloudHub 2.0 Metrics Dashboard for an application
 */
export async function showCloudHub2Metrics(
    context: vscode.ExtensionContext,
    environmentId: string
) {
    try {
        const accountService = new AccountService(context);
        const activeAccount = await accountService.getActiveAccount();

        if (!activeAccount) {
            vscode.window.showErrorMessage('No active account found. Please log in first.');
            return;
        }

        // Verify we have a valid access token
        const accessToken = await accountService.getActiveAccountAccessToken();
        if (!accessToken) {
            vscode.window.showErrorMessage('No access token found. Please log in again.');
            return;
        }

        const organizationID = activeAccount.organizationId;
        const apiHelper = new ApiHelper(context);

        console.log(`CloudHub 2.0 Metrics: Fetching applications for org ${organizationID}, env ${environmentId}`);
        console.log(`CloudHub 2.0 Metrics: Active account: ${activeAccount.userEmail} (${activeAccount.organizationName})`);

        // Fetch CloudHub 2.0 applications
        const ch2Response = await apiHelper.get(
            `${BASE_URL}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments`
        );

        let ch2Apps: any[] = [];
        if (Array.isArray(ch2Response.data)) {
            ch2Apps = ch2Response.data;
        } else if (ch2Response.data?.data) {
            ch2Apps = ch2Response.data.data;
        }

        console.log(`CloudHub 2.0 Metrics: Found ${ch2Apps.length} applications`);

        if (ch2Apps.length === 0) {
            vscode.window.showErrorMessage('No CloudHub 2.0 applications found in this environment.');
            return;
        }

        // Show application selection
        const applicationOptions = ch2Apps.map(app => ({
            label: `${app.name} (${app.status})`,
            name: app.name,
            id: app.id,
            status: app.status
        }));

        const selectedAppLabel = await vscode.window.showQuickPick(
            applicationOptions.map(opt => opt.label),
            {
                placeHolder: 'Select an application to monitor',
                title: 'CloudHub 2.0 Metrics - Select Application'
            }
        );

        if (!selectedAppLabel) {
            vscode.window.showInformationMessage('No application selected.');
            return;
        }

        const selectedApp = applicationOptions.find(opt => opt.label === selectedAppLabel);
        if (!selectedApp) {
            vscode.window.showErrorMessage('Failed to determine selected application.');
            return;
        }

        // Get resource ID for metrics query
        const resourceId = `${organizationID}:${environmentId}:${selectedApp.id}`;

        const sessionKey = `${environmentId}-${selectedApp.name}`;

        // Close existing session if any
        if (activeSessions.has(sessionKey)) {
            const existingSession = activeSessions.get(sessionKey)!;
            existingSession.panel.dispose();
            if (existingSession.intervalId) {
                clearInterval(existingSession.intervalId);
            }
            activeSessions.delete(sessionKey);
        }

        const panel = vscode.window.createWebviewPanel(
            'cloudhub2Metrics',
            `CloudHub 2.0 Metrics - ${selectedApp.name}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const session: MetricsSession = {
            panel,
            intervalId: null,
            isStreaming: false,
            context,
            refreshRate: 30000, // Default 30 seconds
            environmentId,
            organizationId: organizationID,
            applicationName: selectedApp.name,
            deploymentId: selectedApp.id,
            resourceId
        };

        activeSessions.set(sessionKey, session);

        // Fetch initial metrics
        console.log('CloudHub 2.0 Metrics: Fetching initial metrics...');
        const initialMetrics = await fetchApplicationMetrics(context, session);
        console.log('CloudHub 2.0 Metrics: Initial metrics fetched');

        panel.webview.html = getMetricsDashboardHtml(
            panel.webview,
            context.extensionUri,
            selectedApp.name,
            initialMetrics
        );

        console.log('CloudHub 2.0 Metrics: Dashboard initialized successfully');

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'startStreaming':
                    await startMetricsStreaming(context, session);
                    break;
                case 'stopStreaming':
                    stopMetricsStreaming(session);
                    break;
                case 'refreshMetrics':
                    const metrics = await fetchApplicationMetrics(context, session);
                    panel.webview.postMessage({ command: 'updateMetrics', metrics });
                    break;
                case 'setRefreshRate':
                    await setRefreshRate(session, message.rate);
                    break;
                case 'setTimeRange':
                    await updateTimeRange(context, session, message.range);
                    break;
            }
        });

        // Clean up when panel is closed
        panel.onDidDispose(() => {
            if (session.intervalId) {
                clearInterval(session.intervalId);
            }
            activeSessions.delete(sessionKey);
        });

        // Auto-start streaming
        await startMetricsStreaming(context, session);

    } catch (error: any) {
        console.error('CloudHub 2.0 Metrics: Error occurred:', error);
        console.error('CloudHub 2.0 Metrics: Error message:', error.message);
        console.error('CloudHub 2.0 Metrics: Error stack:', error.stack);

        // Provide helpful error message based on error type
        let errorMessage = `Error showing CloudHub 2.0 metrics: ${error.message}`;

        if (error.message.includes('Authentication failed') || error.message.includes('401')) {
            errorMessage = 'Authentication failed. Your session may have expired. Please try logging in again using "AM: Login into Anypoint Platform".';
        } else if (error.message.includes('Access denied') || error.message.includes('403')) {
            errorMessage = 'Access denied. Your account may not have Anypoint Monitoring enabled or you may lack the required permissions. Please check with your Anypoint Platform administrator.';
        } else if (error.message.includes('No active account')) {
            errorMessage = 'No active account found. Please log in using "AM: Login into Anypoint Platform".';
        }

        vscode.window.showErrorMessage(errorMessage);
    }
}

/**
 * Fetch comprehensive application metrics
 */
async function fetchApplicationMetrics(
    context: vscode.ExtensionContext,
    session: MetricsSession
): Promise<any> {
    try {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        // Anypoint Monitoring Metrics API endpoint
        const metricsEndpoint = 'https://anypoint.mulesoft.com/observability/api/v1/metrics:search';

        console.log(`Fetching metrics for resource: ${session.resourceId}`);

        // Fetch multiple metric types in parallel
        const [
            performanceMetrics,
            jvmMetrics,
            infrastructureMetrics,
            requestMetrics,
            errorMetrics
        ] = await Promise.allSettled([
            // Performance Metrics
            fetchMetricData(context, metricsEndpoint, session.resourceId,
                'mulesoft.application.performance.response_time',
                oneHourAgo, now),

            // JVM Metrics
            fetchMetricData(context, metricsEndpoint, session.resourceId,
                'mulesoft.application.jvm.memory.heap.used',
                oneHourAgo, now),

            // Infrastructure Metrics
            fetchMetricData(context, metricsEndpoint, session.resourceId,
                'mulesoft.application.infrastructure.cpu.usage',
                oneHourAgo, now),

            // Request Count
            fetchMetricData(context, metricsEndpoint, session.resourceId,
                'mulesoft.application.inbound.request.count',
                oneHourAgo, now),

            // Error Count
            fetchMetricData(context, metricsEndpoint, session.resourceId,
                'mulesoft.application.failures.count',
                oneHourAgo, now)
        ]);

        // Log results
        console.log('Metrics fetch results:', {
            performance: performanceMetrics.status,
            jvm: jvmMetrics.status,
            infrastructure: infrastructureMetrics.status,
            requests: requestMetrics.status,
            errors: errorMetrics.status
        });

        // Also fetch deployment details for additional context
        const deploymentDetails = await fetchDeploymentDetails(context, session);

        return {
            performance: performanceMetrics.status === 'fulfilled' ? performanceMetrics.value : null,
            jvm: jvmMetrics.status === 'fulfilled' ? jvmMetrics.value : null,
            infrastructure: infrastructureMetrics.status === 'fulfilled' ? infrastructureMetrics.value : null,
            requests: requestMetrics.status === 'fulfilled' ? requestMetrics.value : null,
            errors: errorMetrics.status === 'fulfilled' ? errorMetrics.value : null,
            deployment: deploymentDetails,
            timestamp: now
        };

    } catch (error: any) {
        console.error('Error fetching application metrics:', error);
        throw error;
    }
}

/**
 * Fetch metric data from Anypoint Monitoring API with proper authentication handling
 */
async function fetchMetricData(
    context: vscode.ExtensionContext,
    endpoint: string,
    resourceId: string,
    metricName: string,
    startTime: number,
    endTime: number
): Promise<any> {
    try {
        const accountService = new AccountService(context);
        const activeAccount = await accountService.getActiveAccount();

        if (!activeAccount) {
            throw new Error('No active account found. Please log in first.');
        }

        let accessToken = await accountService.getActiveAccountAccessToken();

        if (!accessToken) {
            throw new Error('No access token found for active account');
        }

        const query = {
            resourceId: resourceId,
            metric: metricName,
            startTime: startTime,
            endTime: endTime,
            aggregation: {
                type: 'avg',
                interval: '1m'
            }
        };

        console.log(`Fetching metric ${metricName} for resource ${resourceId}`);

        // Use fetch for Anypoint Monitoring API (similar to CH2 logs pattern)
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(query)
        });

        console.log(`Metric ${metricName} response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Metric ${metricName} error response:`, errorText);

            // Handle 401 - token expired, try to refresh
            if (response.status === 401) {
                console.log(`Metric ${metricName}: Token expired, refreshing...`);

                const { refreshAccessToken } = await import('../controllers/oauthService.js');
                const didRefresh = await refreshAccessToken(context, activeAccount.id);

                if (!didRefresh) {
                    throw new Error('Unable to refresh token');
                }

                const newAccessToken = await accountService.getActiveAccountAccessToken();
                if (!newAccessToken) {
                    throw new Error('Failed to get refreshed access token');
                }

                // Retry with new token
                const retryResponse = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${newAccessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(query)
                });

                if (!retryResponse.ok) {
                    throw new Error(`Failed to fetch metric after token refresh: ${retryResponse.status} ${retryResponse.statusText}`);
                }

                const data = await retryResponse.json();
                return {
                    name: metricName,
                    data: data,
                    query: query
                };
            } else {
                throw new Error(`Failed to fetch metric ${metricName}: ${response.status} ${response.statusText}`);
            }
        }

        const data = await response.json();
        return {
            name: metricName,
            data: data,
            query: query
        };
    } catch (error: any) {
        console.error(`Error fetching metric ${metricName}:`, error);
        return {
            name: metricName,
            data: null,
            error: error.message
        };
    }
}

/**
 * Fetch deployment details for additional context
 */
async function fetchDeploymentDetails(
    context: vscode.ExtensionContext,
    session: MetricsSession
): Promise<any> {
    try {
        const apiHelper = new ApiHelper(context);
        const url = `${BASE_URL}/amc/application-manager/api/v2/organizations/${session.organizationId}/environments/${session.environmentId}/deployments/${session.deploymentId}`;

        console.log(`Fetching deployment details from: ${url}`);
        const response = await apiHelper.get(url);
        console.log('Deployment details fetched successfully');
        return response.data;
    } catch (error: any) {
        console.error('Error fetching deployment details:', error);
        console.error('Error details:', error.message);
        // Return null instead of throwing to allow metrics dashboard to still display
        return null;
    }
}

/**
 * Start streaming metrics
 */
async function startMetricsStreaming(context: vscode.ExtensionContext, session: MetricsSession) {
    if (session.isStreaming) {
        return;
    }

    session.isStreaming = true;
    session.panel.webview.postMessage({
        command: 'streamingStatus',
        isStreaming: true
    });

    const fetchMetrics = async () => {
        try {
            const metrics = await fetchApplicationMetrics(context, session);
            session.panel.webview.postMessage({
                command: 'updateMetrics',
                metrics: metrics
            });
        } catch (error: any) {
            session.panel.webview.postMessage({
                command: 'error',
                message: `Failed to fetch metrics: ${error.message}`
            });
        }
    };

    // Initial fetch
    await fetchMetrics();

    // Set up interval for continuous streaming
    session.intervalId = setInterval(fetchMetrics, session.refreshRate);
}

/**
 * Stop streaming metrics
 */
function stopMetricsStreaming(session: MetricsSession) {
    session.isStreaming = false;
    if (session.intervalId) {
        clearInterval(session.intervalId);
        session.intervalId = null;
    }
    session.panel.webview.postMessage({
        command: 'streamingStatus',
        isStreaming: false
    });
}

/**
 * Set refresh rate for metrics streaming
 */
async function setRefreshRate(session: MetricsSession, rate: number) {
    session.refreshRate = rate;

    if (session.intervalId) {
        clearInterval(session.intervalId);
        session.intervalId = null;
    }

    if (session.isStreaming) {
        await startMetricsStreaming(session.context, session);
    }
}

/**
 * Update time range for metrics
 */
async function updateTimeRange(
    context: vscode.ExtensionContext,
    session: MetricsSession,
    range: string
) {
    const metrics = await fetchApplicationMetrics(context, session);
    session.panel.webview.postMessage({
        command: 'updateMetrics',
        metrics: metrics
    });
}

/**
 * Generate HTML for metrics dashboard
 */
function getMetricsDashboardHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    applicationName: string,
    initialMetrics: any
): string {
    const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
    const logoSrc = webview.asWebviewUri(logoPath);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CloudHub 2.0 Metrics - ${applicationName}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap" />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        /* Code Time inspired theme */
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
            --accent-purple: #bc8cff;
            --accent-green: #3fb950;
            --accent-orange: #db6d28;
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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
            background: var(--background-primary);
            color: var(--text-primary);
            font-size: 14px;
            line-height: 1.5;
        }

        /* Header Section */
        .header {
            background-color: var(--background-secondary);
            border-bottom: 1px solid var(--border-primary);
            padding: 24px 32px;
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-left img {
            height: 32px;
            width: auto;
        }

        .header-info h1 {
            font-size: 28px;
            font-weight: 600;
            margin: 0 0 4px 0;
            color: var(--text-primary);
        }

        .header-info p {
            font-size: 16px;
            color: var(--text-secondary);
            margin: 0;
        }

        .header-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Status Indicator */
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--error);
        }

        .status-dot.streaming {
            background: var(--success);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }

        /* Container */
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 32px;
        }

        /* Controls Section */
        .controls {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            align-items: center;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn {
            padding: 8px 16px;
            border: 1px solid var(--border-primary);
            background: var(--surface-secondary);
            color: var(--text-primary);
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .btn:hover {
            background: var(--surface-accent);
            border-color: var(--accent-blue);
        }

        .btn-primary {
            background: var(--accent-blue);
            border-color: var(--accent-blue);
            color: white;
        }

        .btn-primary:hover {
            background: var(--accent-light);
        }

        .btn-success {
            background: var(--success);
            border-color: var(--success);
            color: white;
        }

        .btn-danger {
            background: var(--error);
            border-color: var(--error);
            color: white;
        }

        select {
            padding: 8px 12px;
            background: var(--background-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 14px;
        }

        label {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
        }

        /* Metrics Grid */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .metric-card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            transition: all 0.2s;
            position: relative;
            overflow: hidden;
        }

        .metric-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
        }

        .metric-card:hover {
            border-color: var(--accent-blue);
            transform: translateY(-2px);
        }

        .metric-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .metric-title {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
            margin: 0;
        }

        .metric-icon {
            font-size: 24px;
        }

        .metric-value {
            font-size: 32px;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 8px 0;
            line-height: 1.2;
        }

        .metric-subtitle {
            font-size: 13px;
            color: var(--text-muted);
            margin: 0;
        }

        .metric-trend {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            font-weight: 500;
            margin-top: 8px;
        }

        .metric-trend.up {
            color: var(--success);
        }

        .metric-trend.down {
            color: var(--error);
        }

        /* Charts Section */
        .charts-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .chart-card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
        }

        .chart-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-muted);
        }

        .chart-header h3 {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
            color: var(--text-primary);
        }

        .chart-container {
            position: relative;
            height: 300px;
        }

        /* Deployment Info */
        .deployment-info {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }

        .deployment-info h3 {
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 20px 0;
            color: var(--text-primary);
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 16px;
        }

        .info-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .info-label {
            font-size: 12px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .info-value {
            font-size: 14px;
            color: var(--text-primary);
            font-weight: 500;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header {
                padding: 16px;
            }

            .container {
                padding: 16px;
            }

            .metrics-grid {
                grid-template-columns: 1fr;
            }

            .charts-section {
                grid-template-columns: 1fr;
            }

            .controls {
                flex-direction: column;
                align-items: stretch;
            }
        }
    </style>
</head>
<body>
    <!-- Header -->
    <div class="header">
        <div class="header-content">
            <div class="header-left">
                <img src="${logoSrc}" alt="Logo"/>
                <div class="header-info">
                    <h1>CloudHub 2.0 Metrics Dashboard</h1>
                    <p>${applicationName} • Premium Feature</p>
                </div>
            </div>
            <div>
                <div class="header-badge">🏆 PREMIUM</div>
                <div class="status-indicator" style="margin-top: 8px;">
                    <div class="status-dot" id="statusDot"></div>
                    <span id="statusText">Stopped</span>
                </div>
            </div>
        </div>
    </div>

    <div class="container">
        <!-- Info Banner -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 16px 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 24px;">ℹ️</span>
            <div>
                <strong style="color: white; font-size: 14px;">Anypoint Monitoring Required</strong>
                <p style="color: rgba(255,255,255,0.9); font-size: 13px; margin: 4px 0 0 0;">
                    This feature requires Anypoint Monitoring to be enabled for your organization. If metrics are not loading, please verify your subscription includes Anypoint Monitoring.
                </p>
            </div>
        </div>

        <!-- Controls -->
        <div class="controls">
            <div class="control-group">
                <button class="btn btn-success" id="startBtn">
                    <span>▶</span> Start Monitoring
                </button>
                <button class="btn btn-danger" id="stopBtn" disabled>
                    <span>⏸</span> Stop
                </button>
                <button class="btn" id="refreshBtn">
                    <span>🔄</span> Refresh Now
                </button>
            </div>

            <div class="control-group">
                <label>Refresh Rate:</label>
                <select id="refreshRate">
                    <option value="10000">10s</option>
                    <option value="30000" selected>30s</option>
                    <option value="60000">1m</option>
                    <option value="300000">5m</option>
                </select>
            </div>

            <div class="control-group">
                <label>Time Range:</label>
                <select id="timeRange">
                    <option value="15m">Last 15 minutes</option>
                    <option value="1h" selected>Last hour</option>
                    <option value="6h">Last 6 hours</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                </select>
            </div>
        </div>

        <!-- Key Metrics Grid -->
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">Average Response Time</h3>
                    <span class="metric-icon">⚡</span>
                </div>
                <div class="metric-value" id="avgResponseTime">-- ms</div>
                <p class="metric-subtitle">Performance indicator</p>
                <div class="metric-trend up" id="responseTrend">
                    <span>↑</span> --% from last period
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">Total Requests</h3>
                    <span class="metric-icon">📊</span>
                </div>
                <div class="metric-value" id="totalRequests">--</div>
                <p class="metric-subtitle">Inbound requests</p>
                <div class="metric-trend up" id="requestsTrend">
                    <span>↑</span> --% from last period
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">Error Rate</h3>
                    <span class="metric-icon">⚠️</span>
                </div>
                <div class="metric-value" id="errorRate">--%</div>
                <p class="metric-subtitle">Failed requests</p>
                <div class="metric-trend down" id="errorTrend">
                    <span>↓</span> --% from last period
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">CPU Usage</h3>
                    <span class="metric-icon">💻</span>
                </div>
                <div class="metric-value" id="cpuUsage">--%</div>
                <p class="metric-subtitle">Infrastructure</p>
                <div class="metric-trend" id="cpuTrend">
                    <span>↑</span> --% from last period
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">Memory Usage</h3>
                    <span class="metric-icon">🧠</span>
                </div>
                <div class="metric-value" id="memoryUsage">-- MB</div>
                <p class="metric-subtitle">JVM Heap</p>
                <div class="metric-trend" id="memoryTrend">
                    <span>↑</span> --% from last period
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-header">
                    <h3 class="metric-title">Replicas</h3>
                    <span class="metric-icon">🔄</span>
                </div>
                <div class="metric-value" id="replicas">--</div>
                <p class="metric-subtitle">Active instances</p>
            </div>
        </div>

        <!-- Charts Section -->
        <div class="charts-section">
            <div class="chart-card">
                <div class="chart-header">
                    <h3>Response Time Trend</h3>
                </div>
                <div class="chart-container">
                    <canvas id="responseTimeChart"></canvas>
                </div>
            </div>

            <div class="chart-card">
                <div class="chart-header">
                    <h3>Request Volume</h3>
                </div>
                <div class="chart-container">
                    <canvas id="requestVolumeChart"></canvas>
                </div>
            </div>

            <div class="chart-card">
                <div class="chart-header">
                    <h3>CPU & Memory Usage</h3>
                </div>
                <div class="chart-container">
                    <canvas id="resourceUsageChart"></canvas>
                </div>
            </div>

            <div class="chart-card">
                <div class="chart-header">
                    <h3>Error Rate</h3>
                </div>
                <div class="chart-container">
                    <canvas id="errorRateChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Deployment Info -->
        <div class="deployment-info">
            <h3>Deployment Information</h3>
            <div class="info-grid" id="deploymentInfo">
                <div class="info-item">
                    <span class="info-label">Status</span>
                    <span class="info-value" id="deployStatus">Loading...</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Runtime Version</span>
                    <span class="info-value" id="runtimeVersion">Loading...</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Last Updated</span>
                    <span class="info-value" id="lastUpdated">Loading...</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Region</span>
                    <span class="info-value" id="region">Loading...</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isStreaming = false;
        let charts = {};

        // Initialize charts
        function initializeCharts() {
            const chartConfig = {
                type: 'line',
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f0f6fc'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#7d8590' },
                            grid: { color: '#30363d' }
                        },
                        y: {
                            ticks: { color: '#7d8590' },
                            grid: { color: '#30363d' }
                        }
                    }
                }
            };

            charts.responseTime = new Chart(
                document.getElementById('responseTimeChart'),
                { ...chartConfig, data: { labels: [], datasets: [{ label: 'Response Time (ms)', data: [], borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.1)' }] } }
            );

            charts.requestVolume = new Chart(
                document.getElementById('requestVolumeChart'),
                { ...chartConfig, data: { labels: [], datasets: [{ label: 'Requests/min', data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63, 185, 80, 0.1)' }] } }
            );

            charts.resourceUsage = new Chart(
                document.getElementById('resourceUsageChart'),
                { ...chartConfig, data: { labels: [], datasets: [
                    { label: 'CPU %', data: [], borderColor: '#bc8cff', backgroundColor: 'rgba(188, 140, 255, 0.1)' },
                    { label: 'Memory MB', data: [], borderColor: '#db6d28', backgroundColor: 'rgba(219, 109, 40, 0.1)' }
                ] } }
            );

            charts.errorRate = new Chart(
                document.getElementById('errorRateChart'),
                { ...chartConfig, data: { labels: [], datasets: [{ label: 'Error Rate %', data: [], borderColor: '#f85149', backgroundColor: 'rgba(248, 81, 73, 0.1)' }] } }
            );
        }

        // Update metrics display
        function updateMetricsDisplay(metrics) {
            if (!metrics) {
                console.log('No metrics data received');
                return;
            }

            console.log('Updating metrics display with:', metrics);

            // Update key metrics with fallback for no data
            if (metrics.performance?.data && !metrics.performance.error) {
                const avgResponseTime = calculateAverage(metrics.performance.data);
                document.getElementById('avgResponseTime').textContent = avgResponseTime > 0 ? avgResponseTime.toFixed(2) + ' ms' : 'No data';
            } else {
                document.getElementById('avgResponseTime').textContent = 'No data';
                console.log('Performance metric error:', metrics.performance?.error);
            }

            if (metrics.requests?.data && !metrics.requests.error) {
                const totalRequests = calculateSum(metrics.requests.data);
                document.getElementById('totalRequests').textContent = totalRequests > 0 ? totalRequests.toLocaleString() : 'No data';
            } else {
                document.getElementById('totalRequests').textContent = 'No data';
                console.log('Requests metric error:', metrics.requests?.error);
            }

            if (metrics.errors?.data && !metrics.errors.error) {
                const errorRate = calculateErrorRate(metrics.errors.data, metrics.requests?.data);
                document.getElementById('errorRate').textContent = errorRate >= 0 ? errorRate.toFixed(2) + '%' : 'No data';
            } else {
                document.getElementById('errorRate').textContent = 'No data';
                console.log('Errors metric error:', metrics.errors?.error);
            }

            if (metrics.infrastructure?.data && !metrics.infrastructure.error) {
                const cpuUsage = calculateAverage(metrics.infrastructure.data);
                document.getElementById('cpuUsage').textContent = cpuUsage > 0 ? cpuUsage.toFixed(2) + '%' : 'No data';
            } else {
                document.getElementById('cpuUsage').textContent = 'No data';
                console.log('Infrastructure metric error:', metrics.infrastructure?.error);
            }

            if (metrics.jvm?.data && !metrics.jvm.error) {
                const memoryUsage = calculateAverage(metrics.jvm.data);
                document.getElementById('memoryUsage').textContent = memoryUsage > 0 ? (memoryUsage / 1024 / 1024).toFixed(2) + ' MB' : 'No data';
            } else {
                document.getElementById('memoryUsage').textContent = 'No data';
                console.log('JVM metric error:', metrics.jvm?.error);
            }

            // Update deployment info
            if (metrics.deployment) {
                const deployment = metrics.deployment;
                document.getElementById('deployStatus').textContent = deployment.status || 'N/A';
                document.getElementById('runtimeVersion').textContent = deployment.currentRuntimeVersion || deployment.lastSuccessfulRuntimeVersion || 'N/A';
                document.getElementById('lastUpdated').textContent = deployment.lastModifiedDate ? new Date(deployment.lastModifiedDate).toLocaleString() : 'N/A';
                document.getElementById('replicas').textContent = deployment.replicas || 'N/A';
            }

            // Update charts
            updateCharts(metrics);
        }

        // Update charts with new data
        function updateCharts(metrics) {
            const timeLabels = generateTimeLabels(12);

            if (metrics.performance?.data) {
                updateChart(charts.responseTime, timeLabels, metrics.performance.data);
            }

            if (metrics.requests?.data) {
                updateChart(charts.requestVolume, timeLabels, metrics.requests.data);
            }

            if (metrics.infrastructure?.data && metrics.jvm?.data) {
                charts.resourceUsage.data.labels = timeLabels;
                charts.resourceUsage.data.datasets[0].data = processMetricData(metrics.infrastructure.data);
                charts.resourceUsage.data.datasets[1].data = processMetricData(metrics.jvm.data).map(v => v / 1024 / 1024);
                charts.resourceUsage.update();
            }

            if (metrics.errors?.data) {
                updateChart(charts.errorRate, timeLabels, metrics.errors.data);
            }
        }

        function updateChart(chart, labels, data) {
            chart.data.labels = labels;
            chart.data.datasets[0].data = processMetricData(data);
            chart.update();
        }

        function processMetricData(data) {
            // Process Anypoint Monitoring API response
            if (!data) return [];
            if (Array.isArray(data)) return data;
            if (data.dataPoints) return data.dataPoints.map(dp => dp.value || 0);
            if (data.results) return data.results.map(r => r.value || 0);
            return [];
        }

        function generateTimeLabels(count) {
            const labels = [];
            const now = new Date();
            for (let i = count - 1; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 5 * 60 * 1000);
                labels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
            return labels;
        }

        function calculateAverage(data) {
            const values = processMetricData(data);
            if (values.length === 0) return 0;
            return values.reduce((a, b) => a + b, 0) / values.length;
        }

        function calculateSum(data) {
            const values = processMetricData(data);
            return values.reduce((a, b) => a + b, 0);
        }

        function calculateErrorRate(errorData, requestData) {
            const errors = calculateSum(errorData);
            const requests = calculateSum(requestData);
            if (requests === 0) return 0;
            return (errors / requests) * 100;
        }

        // Event listeners
        document.getElementById('startBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'startStreaming' });
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'stopStreaming' });
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refreshMetrics' });
        });

        document.getElementById('refreshRate').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setRefreshRate', rate: parseInt(e.target.value) });
        });

        document.getElementById('timeRange').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setTimeRange', range: e.target.value });
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.command) {
                case 'streamingStatus':
                    isStreaming = message.isStreaming;
                    document.getElementById('statusDot').classList.toggle('streaming', isStreaming);
                    document.getElementById('statusText').textContent = isStreaming ? 'Monitoring' : 'Stopped';
                    document.getElementById('startBtn').disabled = isStreaming;
                    document.getElementById('stopBtn').disabled = !isStreaming;
                    break;
                case 'updateMetrics':
                    updateMetricsDisplay(message.metrics);
                    break;
                case 'error':
                    console.error('Error:', message.message);
                    break;
            }
        });

        // Initialize
        initializeCharts();
        updateMetricsDisplay(${JSON.stringify(initialMetrics)});
    </script>
</body>
</html>
    `;
}
