import * as vscode from 'vscode';
import { BASE_URL, ARM_BASE, HYBRID_APPLICATIONS_ENDPOINT, getBaseUrl, getArmBase, getHybridApplicationsEndpoint } from '../constants';
import { ApiHelper } from '../controllers/apiHelper';
import { AccountService } from '../controllers/accountService';
import { showRealTimeLogs } from './realTimeLogs';
import { telemetryService } from '../services/telemetryService';
import { wrapWebviewHtml } from '../webview/ui-kit';

interface CommandCenterData {
    application: any;
    deploymentHistory: any[];
    schedulers: any[];
    logs: any[];
    replicas?: any[];
    networkInfo?: any;
    specs?: any[];
    metrics?: any;
    alerts?: any[];
    healthScore: number;
    healthBreakdown?: string[];
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID';
    environmentId: string;
    environmentName: string;
    accountInfo: {
        userName: string;
        organizationName: string;
        email: string;
    };
    deploymentId?: string;
    specificationId?: string;
    allEnvironments?: any[];
    aiInsights?: string[];
    performanceMetrics?: {
        cpu: number[];
        memory: number[];
        timestamps: number[];
        source?: 'monitoring' | 'observability' | 'simulated';
        cpuLabel?: string;
        memoryLabel?: string;
    };
    networkTopology?: {
        externalEndpoints: string[];
        vpnConnections: string[];
        dependencies: string[];
    };
    visualizerMetrics?: VisualizerMetricsData;
    activeTab?: string;
    metricsRangeMinutes?: number;
}

interface MetricPoint {
    timestamp: number;
    value: number;
}

interface VisualizerMetricSeries {
    label: string;
    unit?: string;
    points: MetricPoint[];
}

interface VisualizerMetricPanel {
    id: string;
    title: string;
    description?: string;
    unit?: string;
    series: VisualizerMetricSeries[];
    fill?: 'none' | '0';
}

interface VisualizerMetricsData {
    status: 'live' | 'unavailable' | 'error';
    rangeMinutes: number;
    lastUpdated?: number;
    datasource?: {
        id: number;
        name?: string;
        database?: string;
    };
    panels: VisualizerMetricPanel[];
    errorMessage?: string;
}

/**
 * Calculate application health score based on multiple factors
 */
function calculateHealthScore(data: any): { score: number; breakdown: string[] } {
    let score = 100;
    const breakdown: string[] = [];

    // Status check (40 points)
    if (data.application?.status === 'RUNNING' || data.application?.status === 'STARTED' || data.application?.status === 'APPLIED') {
        breakdown.push('✅ Application is running (0 points deducted)');
    } else if (data.application?.status === 'STOPPED' || data.application?.status === 'UNDEPLOYED') {
        score -= 40;
        breakdown.push('❌ Application is stopped (-40 points)');
    } else {
        score -= 20;
        breakdown.push(`⚠️ Application status: ${data.application?.status} (-20 points)`);
    }

    // Recent errors (20 points)
    const recentLogs = data.logs?.slice(0, 100) || [];
    const errorLogs = recentLogs.filter((log: any) =>
        log.priority === 'ERROR' || log.message?.toLowerCase().includes('error')
    );
    const errorRate = recentLogs.length > 0 ? errorLogs.length / recentLogs.length : 0;
    if (errorRate > 0.1) {
        score -= 20;
        breakdown.push(`❌ High error rate: ${errorLogs.length}/${recentLogs.length} logs (-20 points)`);
    } else if (errorRate > 0.05) {
        score -= 10;
        breakdown.push(`⚠️ Elevated errors: ${errorLogs.length}/${recentLogs.length} logs (-10 points)`);
    } else if (errorLogs.length > 0) {
        breakdown.push(`✅ Low error rate: ${errorLogs.length}/${recentLogs.length} logs (0 points deducted)`);
    } else {
        breakdown.push('✅ No errors in recent logs (0 points deducted)');
    }

    // Deployment health (20 points)
    if (data.cloudhubVersion === 'CH2' && data.replicas && data.replicas.length > 0) {
        const totalReplicas = data.application?.replicas || data.replicas.length;
        const healthyReplicas = data.replicas.filter((r: any) =>
            r.state === 'RUNNING' || r.status === 'RUNNING' || r.deploymentStatus === 'APPLIED'
        ).length;
        if (healthyReplicas < totalReplicas) {
            const penalty = Math.round(20 * ((totalReplicas - healthyReplicas) / totalReplicas));
            score -= penalty;
            breakdown.push(`⚠️ ${healthyReplicas}/${totalReplicas} replicas healthy (-${penalty} points)`);
        } else {
            breakdown.push(`✅ All ${totalReplicas} replicas healthy (0 points deducted)`);
        }
    }

    // Active alerts (10 points)
    if (data.alerts && data.alerts.length > 0) {
        const penalty = Math.min(data.alerts.length * 3, 10);
        score -= penalty;
        breakdown.push(`⚠️ ${data.alerts.length} active alert(s) (-${penalty} points)`);
    } else {
        breakdown.push('✅ No active alerts (0 points deducted)');
    }

    // Scheduler health (10 points)
    if (data.schedulers && data.schedulers.length > 0) {
        const failedSchedulers = data.schedulers.filter((s: any) => s.status === 'FAILED');
        if (failedSchedulers.length > 0) {
            const penalty = Math.min(failedSchedulers.length * 5, 10);
            score -= penalty;
            breakdown.push(`⚠️ ${failedSchedulers.length} scheduler(s) failed (-${penalty} points)`);
        } else {
            breakdown.push(`✅ All ${data.schedulers.length} schedulers healthy (0 points deducted)`);
        }
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        breakdown
    };
}

/**
 * Calculate estimated monthly cost
 * NOTE: These are ESTIMATES based on typical MuleSoft pricing.
 * Actual costs vary by enterprise agreement and usage.
 * Contact MuleSoft sales for accurate pricing.
 */
function calculateCost(app: any, cloudhubVersion: 'CH1' | 'CH2'): { monthly: number; daily: number; currency: string; isEstimate: boolean } {
    let monthlyCost = 0;

    if (cloudhubVersion === 'CH1') {
        // CloudHub 1.0 pricing (estimated from public sources)
        const workers = app?.workers || 1;
        const workerType = app?.workerType?.name || app?.workerType || 'Micro';

        // Approximate pricing based on publicly available information
        const priceMap: { [key: string]: number } = {
            'Micro': 0, // Free tier
            '0.1 vCores': 15,
            '0.2 vCores': 30,
            '1 vCore': 122.50,
            '2 vCores': 245,
            '4 vCores': 490,
            '8 vCores': 980,
            '16 vCores': 1960
        };

        const basePrice = priceMap[workerType] || 122.50;
        monthlyCost = basePrice * workers;
    } else {
        // CloudHub 2.0 pricing (estimated)
        const replicas = app?.replicas || 1;
        const cpuReserved = parseFloat(app?.cpuReserved || '0.5');
        const memoryReserved = parseFloat(app?.memoryReserved || '1');

        // Estimated pricing based on compute resources
        const cpuCostPerHour = cpuReserved * 0.09;
        const memoryCostPerHour = memoryReserved * 0.01;
        const totalCostPerHour = (cpuCostPerHour + memoryCostPerHour) * replicas;

        monthlyCost = totalCostPerHour * 24 * 30; // 30 days
    }

    return {
        monthly: Math.round(monthlyCost * 100) / 100,
        daily: Math.round((monthlyCost / 30) * 100) / 100,
        currency: 'USD',
        isEstimate: true
    };
}

function formatBytes(bytes?: number): string {
    if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
        return 'N/A';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let index = 0;
    let value = bytes;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value?: number | string): string {
    if (value === undefined || value === null) {
        return 'N/A';
    }
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'N/A';
    }
    return date.toLocaleString();
}

/**
 * Generate AI insights based on application data and REAL log analysis
 */
function generateAIInsights(data: any): string[] {
    const insights: string[] = [];
    const app = data.application;
    const logs = data.logs || [];

    // Analyze REAL logs for patterns
    if (logs.length > 0) {
        // Find most common error messages
        const errorLogs = logs.filter((log: any) =>
            log.priority === 'ERROR' || log.message?.toLowerCase().includes('error')
        );

        if (errorLogs.length > 0) {
            // Group errors by message pattern
            const errorPatterns: { [key: string]: number } = {};
            errorLogs.forEach((log: any) => {
                const msg = log.message || '';
                // Extract key error pattern (first 100 chars)
                const pattern = msg.substring(0, 100);
                errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
            });

            // Find most frequent error
            const mostFrequentError = Object.entries(errorPatterns)
                .sort((a, b) => b[1] - a[1])[0];

            if (mostFrequentError && mostFrequentError[1] > 1) {
                insights.push(`🔴 Recurring error detected ${mostFrequentError[1]} times: "${mostFrequentError[0]}..."`);
            }
        }

        // Find timeout patterns
        const timeoutLogs = logs.filter((log: any) =>
            log.message?.toLowerCase().includes('timeout') ||
            log.message?.toLowerCase().includes('timed out')
        );
        if (timeoutLogs.length > 3) {
            insights.push(`⏱️ ${timeoutLogs.length} timeout events detected. Consider reviewing connection timeouts or performance.`);
        }

        // Find memory warnings
        const memoryLogs = logs.filter((log: any) =>
            log.message?.toLowerCase().includes('memory') ||
            log.message?.toLowerCase().includes('heap') ||
            log.message?.toLowerCase().includes('outofmemory')
        );
        if (memoryLogs.length > 0) {
            insights.push(`💾 ${memoryLogs.length} memory-related log entries. Monitor memory usage closely.`);
        }

        // Find connection issues
        const connectionLogs = logs.filter((log: any) =>
            log.message?.toLowerCase().includes('connection') ||
            log.message?.toLowerCase().includes('refused') ||
            log.message?.toLowerCase().includes('unreachable')
        );
        if (connectionLogs.length > 2) {
            insights.push(`🔌 ${connectionLogs.length} connection issues detected. Check network connectivity and external services.`);
        }
    }

    // Memory insights
    if (data.cloudhubVersion === 'CH2') {
        const memUsage = parseFloat(app?.memoryReserved || '0');
        if (memUsage > 3) {
            insights.push('💡 High memory allocation detected. Consider reviewing memory requirements to optimize costs.');
        }
    }

    // Error rate insights
    const recentLogs = data.logs?.slice(0, 100) || [];
    const errorLogs = recentLogs.filter((log: any) =>
        log.priority === 'ERROR' || log.message?.toLowerCase().includes('error')
    );
    if (errorLogs.length > 5) {
        insights.push(`⚠️ Detected ${errorLogs.length} errors in recent logs. Consider investigating application stability.`);
    }

    // Deployment frequency insight
    if (data.deploymentHistory?.length > 8) {
        insights.push('🚀 High deployment frequency detected. Consider implementing automated testing to ensure quality.');
    }

    // Scheduler insights
    const disabledSchedulers = data.schedulers?.filter((s: any) => !s.enabled) || [];
    if (disabledSchedulers.length > 0) {
        insights.push(`📅 ${disabledSchedulers.length} scheduler(s) are disabled. Verify if this is intentional.`);
    }

    // Replica optimization (CH2)
    if (data.cloudhubVersion === 'CH2' && data.replicas) {
        const runningReplicas = data.replicas.filter((r: any) => r.state === 'RUNNING' || r.status === 'RUNNING').length;
        const totalReplicas = app?.replicas || 1;
        if (runningReplicas === 1 && totalReplicas === 1) {
            insights.push('🔄 Single replica detected. Consider enabling auto-scaling or adding replicas for high availability.');
        }
    }

    // Version insights
    const muleVersion = app?.muleVersion || app?.currentRuntimeVersion || '';
    if (muleVersion.includes('4.3') || muleVersion.includes('4.2')) {
        insights.push('⬆️ Newer Mule runtime versions available. Consider upgrading for performance improvements and security patches.');
    }

    // Cost optimization
    if (data.costEstimate && data.costEstimate.monthly > 500) {
        insights.push('💰 High monthly cost detected. Review resource allocation and consider reserved capacity for cost savings.');
    }

    // Default insight if none found
    if (insights.length === 0) {
        insights.push('✅ Application health looks good! Continue monitoring for optimal performance.');
    }

    return insights;
}

function matchesHybridApplicationCandidate(app: any, appIdentifier?: string, applicationDomain?: string): boolean {
    if (!app) {
        return false;
    }

    const normalize = (value: any) => value !== undefined && value !== null ? String(value).toLowerCase() : '';
    const candidates = [
        normalize(app.id),
        normalize(app.name),
        normalize(app.domain),
        normalize(app.application?.id),
        normalize(app.application?.name),
        normalize(app.application?.domain),
        normalize(app.artifact?.name)
    ];
    const targets = [normalize(appIdentifier), normalize(applicationDomain)].filter(Boolean);

    if (targets.length === 0) {
        return false;
    }

    return targets.some(target => candidates.includes(target));
}

function extractHybridApplication(payload: any, appIdentifier?: string, applicationDomain?: string): any | undefined {
    const match = (candidate: any) => matchesHybridApplicationCandidate(candidate, appIdentifier, applicationDomain);

    if (!payload) {
        return undefined;
    }

    if (Array.isArray(payload)) {
        return payload.find(match);
    }

    if (payload.data && payload.data !== payload) {
        const nested = extractHybridApplication(payload.data, appIdentifier, applicationDomain);
        if (nested) {
            return nested;
        }
    }

    if (payload.items && payload.items !== payload) {
        const nested = extractHybridApplication(payload.items, appIdentifier, applicationDomain);
        if (nested) {
            return nested;
        }
    }

    if (match(payload)) {
        return payload;
    }

    return undefined;
}

function normalizeHybridApplication(app: any, fallbackDomain: string): any {
    if (!app) {
        return app;
    }

    const normalized = { ...app };
    if (!normalized.domain) {
        normalized.domain = normalized.name || normalized.application?.name || fallbackDomain;
    }
    if (!normalized.name && normalized.domain) {
        normalized.name = normalized.domain;
    }
    if (!normalized.status && normalized.lastReportedStatus) {
        normalized.status = normalized.lastReportedStatus;
    }
    normalized.cloudhubVersion = 'HYBRID';
    return normalized;
}

/**
 * Fetch comprehensive application data from multiple APIs
 */
async function fetchApplicationData(
    context: vscode.ExtensionContext,
    environmentId: string,
    environmentName: string,
    applicationDomain: string,
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID',
    deploymentId?: string,
    metricsRangeMinutes: number = METRIC_LOOKBACK_MINUTES,
    fallbackAppData?: any
): Promise<CommandCenterData> {
    const apiHelper = new ApiHelper(context);
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;

    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);

    // Get all environments for comparison mode
    let allEnvironments: any[] = [];
    try {
        const envData = await accountService.getActiveAccountEnvironments();
        if (envData) {
            const parsed = JSON.parse(envData);
            allEnvironments = parsed.data || [];
        }
    } catch (error) {
        console.error('Error fetching environments:', error);
    }

    // Fetch data in parallel for performance
    const dataPromises: any = {
        application: null,
        deploymentHistory: [],
        schedulers: [],
        logs: [],
        replicas: [],
        networkInfo: null,
        specs: [],
        metrics: null,
        alerts: []
    };

    try {
        if (cloudhubVersion === 'CH1') {
            // CloudHub 1.0 data fetching
            const [appData, deployments, schedulers, logs] = await Promise.allSettled([
                // Application details
                apiHelper.get(`${baseUrl}/cloudhub/api/applications/${applicationDomain}`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }),
                // Deployment history
                apiHelper.get(`${baseUrl}/cloudhub/api/v2/applications/${applicationDomain}/deployments?orderByDate=DESC&limit=10`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }),
                // Schedulers
                apiHelper.get(`${baseUrl}/cloudhub/api/applications/${applicationDomain}/schedules`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }),
                // Recent logs
                apiHelper.get(`${baseUrl}/cloudhub/api/v2/applications/${applicationDomain}/deployments`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }).then(async (deploymentsResp) => {
                    if (deploymentsResp.status === 200 && deploymentsResp.data?.data?.[0]?.deploymentId) {
                        const latestDeploymentId = deploymentsResp.data.data[0].deploymentId;
                        return apiHelper.get(`${baseUrl}/cloudhub/api/v2/applications/${applicationDomain}/deployments/${latestDeploymentId}/logs?limit=100`, {
                            headers: {
                                'X-ANYPNT-ENV-ID': environmentId,
                                'X-ANYPNT-ORG-ID': organizationID,
                            },
                        });
                    }
                    return { status: 404, data: [] };
                })
            ]);

            if (appData.status === 'fulfilled') dataPromises.application = appData.value.data;
            if (deployments.status === 'fulfilled') dataPromises.deploymentHistory = deployments.value.data?.data || [];
            if (schedulers.status === 'fulfilled') dataPromises.schedulers = schedulers.value.data || [];
            if (logs.status === 'fulfilled') dataPromises.logs = logs.value.data?.data || [];

        } else if (cloudhubVersion === 'CH2') {
            // CloudHub 2.0 data fetching
            if (!deploymentId) {
                throw new Error('Deployment ID required for CloudHub 2.0 applications');
            }

            const [appData, specs, replicas, schedulers] = await Promise.allSettled([
                // Application/deployment details
                apiHelper.get(`${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments/${deploymentId}`),
                // Deployment specs
                apiHelper.get(`${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments/${deploymentId}/specs`),
                // Replica status
                apiHelper.get(`${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments/${deploymentId}/replicas`),
                // Schedulers (CH2 only)
                fetchCH2Schedulers(context, baseUrl, organizationID, environmentId, deploymentId)
            ]);

            if (appData.status === 'fulfilled') dataPromises.application = appData.value.data;
            if (specs.status === 'fulfilled') {
                const specsData = Array.isArray(specs.value.data) ? specs.value.data : specs.value.data?.data || [];
                dataPromises.specs = specsData;
                dataPromises.deploymentHistory = specsData.slice(0, 10);
            }
            if (replicas.status === 'fulfilled') {
                dataPromises.replicas = Array.isArray(replicas.value.data) ? replicas.value.data : replicas.value.data?.items || [];
            }
            if (schedulers.status === 'fulfilled') {
                dataPromises.schedulers = schedulers.value || [];
            }
        } else if (cloudhubVersion === 'HYBRID') {
            // Hybrid application data fetching
            const { HYBRID_APPLICATIONS_ENDPOINT, HYBRID_SERVERS_ENDPOINT } = await import('../constants.js');

            console.log(`🔧 Fetching Hybrid app data for: ${applicationDomain}, deploymentId: ${deploymentId}`);

            // Use deploymentId if available (it's actually the app ID), otherwise use applicationDomain
            const appIdentifier = deploymentId ? String(deploymentId) : applicationDomain;

            const [appData, servers, logs] = await Promise.allSettled([
                // Application details - try with ID first, then name
                apiHelper.get(`${HYBRID_APPLICATIONS_ENDPOINT}/${appIdentifier}`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }),
                // Try to fetch all servers and filter later, or get specific server if we have target info
                apiHelper.get(`${HYBRID_SERVERS_ENDPOINT}`, {
                    headers: {
                        'X-ANYPNT-ENV-ID': environmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                }),
                // Application logs - Note: ARM API may not support app-specific logs endpoint
                // We'll handle this gracefully
                Promise.resolve({ status: 404, data: [] })
            ]);

            let hybridApplication: any;

            if (appData.status === 'fulfilled') {
                hybridApplication = extractHybridApplication(appData.value, appIdentifier, applicationDomain);
                if (hybridApplication) {
                    console.log('✅ Hybrid app data fetched successfully');
                } else {
                    console.warn('⚠️ Hybrid app response received but no matching application found');
                }
            } else {
                console.warn('⚠️ Failed to fetch Hybrid app data via direct endpoint:', appData.reason || appData);
            }

            if (!hybridApplication) {
                console.log('🔄 Falling back to Hybrid applications collection lookup');
                try {
                    const fallbackResponse = await apiHelper.get(HYBRID_APPLICATIONS_ENDPOINT, {
                        headers: {
                            'X-ANYPNT-ENV-ID': environmentId,
                            'X-ANYPNT-ORG-ID': organizationID,
                        },
                    });
                    if (fallbackResponse.status === 200) {
                        hybridApplication = extractHybridApplication(fallbackResponse.data, appIdentifier, applicationDomain);
                    }
                } catch (fallbackError: any) {
                    console.warn('⚠️ Unable to retrieve Hybrid applications list for fallback:', fallbackError.message || fallbackError);
                }
            }

            if (!hybridApplication && fallbackAppData) {
                console.log('ℹ️ Using provided Hybrid app data fallback');
                hybridApplication = fallbackAppData;
            }

            if (hybridApplication) {
                dataPromises.application = normalizeHybridApplication(hybridApplication, applicationDomain);

                // Store server/target info for later use
                if (dataPromises.application?.target) {
                    dataPromises.networkInfo = {
                        targetType: dataPromises.application.target.type,
                        targetName: dataPromises.application.target.name,
                        targetId: dataPromises.application.target.id
                    };

                    if (servers.status === 'fulfilled') {
                        const allServers = Array.isArray(servers.value.data) ? servers.value.data : servers.value.data?.data || [];
                        const targetServer = allServers.find((s: any) => s.id === dataPromises.application.target.id);
                        if (targetServer) {
                            dataPromises.replicas = [targetServer];
                            console.log('📡 Found target server:', targetServer.name);
                        }
                    }
                }
            } else {
                console.warn(`⚠️ Unable to resolve Hybrid application details for ${applicationDomain}`);
                dataPromises.application = normalizeHybridApplication({
                    domain: applicationDomain,
                    name: applicationDomain,
                    status: 'UNKNOWN'
                }, applicationDomain);
            }

            if (logs.status === 'fulfilled' && logs.value && logs.value.data) {
                const logsValue: any = logs.value;
                dataPromises.logs = Array.isArray(logsValue.data) ? logsValue.data : logsValue.data?.data || [];
            }

            dataPromises.schedulers = await fetchHybridSchedulers(
                context,
                apiHelper,
                appIdentifier,
                organizationID,
                environmentId,
                dataPromises.application,
                HYBRID_APPLICATIONS_ENDPOINT
            );
        }
    } catch (error: any) {
        console.error('Error fetching application data:', error);
    }

    // Simulate alerts (in production, fetch from Anypoint Monitoring API)
    dataPromises.alerts = generateSimulatedAlerts(dataPromises);

    // Calculate health score with breakdown
    const healthResult = calculateHealthScore(dataPromises);
    const healthScore = healthResult.score;
    const healthBreakdown = healthResult.breakdown;

    // Calculate cost estimate (only for CloudHub, not Hybrid)
    const costEstimate = cloudhubVersion === 'HYBRID' ? { monthly: 0, daily: 0, currency: 'USD', isEstimate: true } : calculateCost(dataPromises.application, cloudhubVersion);

    // Generate AI insights
    const aiInsights = generateAIInsights({ ...dataPromises, cloudhubVersion, costEstimate });

    // Fetch real performance metrics
    const performanceMetrics = await fetchPerformanceMetrics(
        context,
        environmentId,
        organizationID,
        applicationDomain,
        cloudhubVersion,
        {
            deploymentId,
            applicationData: dataPromises.application,
            replicas: dataPromises.replicas
        }
    );

    // Fetch Visualizer metrics if application data is available (CloudHub only, not Hybrid)
    const visualizerMetrics = dataPromises.application && cloudhubVersion !== 'HYBRID' ? await fetchVisualizerMetrics(
        context,
        baseUrl,
        environmentId,
        organizationID,
        applicationDomain,
        dataPromises.application,
        cloudhubVersion as 'CH1' | 'CH2',
        metricsRangeMinutes
    ) : undefined;

    // Parse network topology from application data
    const networkTopology = cloudhubVersion !== 'HYBRID' ? parseNetworkTopology(dataPromises.application, cloudhubVersion as 'CH1' | 'CH2') : {
        externalEndpoints: [],
        vpnConnections: [],
        dependencies: []
    };

    return {
        ...dataPromises,
        healthScore,
        healthBreakdown,
        cloudhubVersion,
        environmentId,
        environmentName,
        accountInfo: {
            userName: activeAccount.userName || 'Unknown',
            organizationName: activeAccount.organizationName || 'Unknown',
            email: activeAccount.userEmail || 'Unknown'
        },
        deploymentId,
        allEnvironments,
        aiInsights,
        performanceMetrics,
        networkTopology,
        visualizerMetrics,
        metricsRangeMinutes
    };
}

/**
 * Fetch real performance metrics from Anypoint Monitoring API
 */
interface MonitoringResourceIdentifier {
    type: string;
    id: string;
}

interface PerformanceMetricOptions {
    deploymentId?: string;
    applicationData?: any;
    replicas?: any[];
}

async function fetchPerformanceMetrics(
    context: vscode.ExtensionContext,
    environmentId: string,
    organizationId: string,
    applicationName: string,
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID',
    options: PerformanceMetricOptions = {}
): Promise<{ cpu: number[]; memory: number[]; timestamps: number[]; source: 'monitoring' | 'observability' | 'simulated'; cpuLabel?: string; memoryLabel?: string }> {
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);

    const resource = determineMonitoringResourceIdentifier(
        cloudhubVersion,
        options.applicationData,
        applicationName,
        options.deploymentId
    );
    const workerId = determineMonitoringWorkerId(cloudhubVersion, options.applicationData, options.replicas);

    if (cloudhubVersion === 'HYBRID') {
        const queryMetricsFirst = await tryFetchMonitoringQueryMetrics(
            apiHelper,
            baseUrl,
            organizationId,
            environmentId,
            pickFirstString(
                options.applicationData?.id,
                options.applicationData?.application?.id,
                options.deploymentId,
                applicationName
            )
        );
        if (queryMetricsFirst) {
            return queryMetricsFirst;
        }
    }

    const monitoringMetrics = await tryFetchMonitoringMetrics(
        apiHelper,
        baseUrl,
        organizationId,
        environmentId,
        resource,
        workerId
    );
    if (monitoringMetrics) {
        return monitoringMetrics;
    }

    if (cloudhubVersion !== 'HYBRID') {
        const queryMetrics = await tryFetchMonitoringQueryMetrics(
            apiHelper,
            baseUrl,
            organizationId,
            environmentId,
            pickFirstString(
                options.applicationData?.id,
                options.applicationData?.application?.id,
                options.deploymentId,
                applicationName
            )
        );
        if (queryMetrics) {
            return queryMetrics;
        }
    }

    try {
        const endTime = Date.now();
        const startTime = endTime - (24 * 60 * 60 * 1000);
        const metricsUrl = `${baseUrl}/observability/api/v1/metrics:search?offset=0&limit=100`;
        const response = await apiHelper.post(metricsUrl, {
            query: {
                metrics: ['app.cpu', 'app.memory'],
                dimensions: {
                    environment: environmentId,
                    application: applicationName
                },
                timeRange: {
                    start: startTime,
                    end: endTime
                }
            }
        });

        if (response.status === 200 && response.data) {
            const cpu: number[] = [];
            const memory: number[] = [];
            const timestamps: number[] = [];
            const data = response.data.data || response.data.results || [];
            data.forEach((point: any) => {
                timestamps.push(point.timestamp || Date.now());
                cpu.push(point.cpu || 0);
                memory.push(point.memory || 0);
            });

            if (cpu.length > 0) {
                console.log('✅ Successfully fetched Observability metrics');
                return {
                    cpu,
                    memory,
                    timestamps,
                    source: 'observability',
                    cpuLabel: 'CPU Usage (%)',
                    memoryLabel: 'Heap Usage (MB)'
                };
            }
        }
    } catch (error: any) {
        console.warn('⚠️ Unable to fetch Observability metrics, using simulated data:', error.message);
    }

    return buildSimulatedPerformanceMetrics();
}

async function tryFetchMonitoringMetrics(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    resource: MonitoringResourceIdentifier | undefined,
    workerId?: string
): Promise<{ cpu: number[]; memory: number[]; timestamps: number[]; source: 'monitoring'; cpuLabel?: string; memoryLabel?: string } | undefined> {
    if (!resource?.id) {
        return undefined;
    }

    try {
        const queryWindow = {
            from: 'now()-1d',
            to: 'now()',
            workerId
        };

        const [cpuResponse, memoryResponse] = await Promise.allSettled([
            apiHelper.get(buildMonitoringMetricsUrl(
                baseUrl,
                organizationId,
                environmentId,
                resource,
                'jvm.cpu.operatingsystem',
                'cpu',
                queryWindow
            )),
            apiHelper.get(buildMonitoringMetricsUrl(
                baseUrl,
                organizationId,
                environmentId,
                resource,
                'jvm.memory',
                'heap_used',
                queryWindow
            ))
        ]);

        const cpuSeries = cpuResponse.status === 'fulfilled'
            ? extractMonitoringTimeseries(cpuResponse.value.data, 'cpu')
            : [];
        const memorySeries = memoryResponse.status === 'fulfilled'
            ? extractMonitoringTimeseries(memoryResponse.value.data, 'heap_used')
            : [];

        if (cpuSeries.length === 0 && memorySeries.length === 0) {
            return undefined;
        }

        const merged = mergeMonitoringTimeseries(cpuSeries, memorySeries);
        if (!merged) {
            return undefined;
        }

        return {
            ...merged,
            source: 'monitoring',
            cpuLabel: 'CPU Usage (%)',
            memoryLabel: 'Heap Usage (MB)'
        };
    } catch (error: any) {
        console.warn('⚠️ Monitoring metrics endpoint unavailable:', error?.message || error);
        return undefined;
    }
}

async function tryFetchMonitoringQueryMetrics(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    applicationId?: string
): Promise<{ cpu: number[]; memory: number[]; timestamps: number[]; source: 'monitoring'; cpuLabel?: string; memoryLabel?: string } | undefined> {
    if (!applicationId) {
        return undefined;
    }

    try {
        const to = new Date();
        const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
            detailed: 'true'
        });
        const url = `${baseUrl}/monitoring/query/api/v1/organizations/${organizationId}/environments/${environmentId}/applications/${encodeURIComponent(applicationId)}?${params.toString()}`;
        console.log(`Command Center: Fetching Monitoring Query metrics for app ${applicationId}`);
        const response = await apiHelper.get(url, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationId
            }
        });
        console.log('Command Center: Monitoring Query response status:', response.status);

        const metricsNode = extractMonitoringQueryMetricsNode(response.data, applicationId);
        if (!metricsNode) {
            console.warn('Command Center: Monitoring query payload missing metrics');
            return undefined;
        }

        const cpuMetric = pickMonitoringQueryMetricSeries(metricsNode, [
            { key: 'cpu-usage', label: 'CPU Usage (%)', transform: convertCpuValue },
            { key: 'cpu', label: 'CPU Usage (%)', transform: convertCpuValue },
            { key: 'system.cpu', label: 'CPU Usage (%)', transform: convertCpuValue },
            { key: 'message-count', label: 'Message Count (avg)', preferredValueKeys: ['avg', 'sum', 'count'], transform: passthroughValue }
        ]);

        const memoryMetric = pickMonitoringQueryMetricSeries(metricsNode, [
            { key: 'memory-usage', label: 'Memory Usage (MB)', transform: convertMemoryValue },
            { key: 'heap-usage', label: 'Heap Usage (MB)', transform: convertMemoryValue },
            { key: 'memory', label: 'Memory Usage (MB)', transform: convertMemoryValue },
            { key: 'response-time', label: 'Response Time (ms)', preferredValueKeys: ['avg', 'sum', 'max', 'min'], transform: passthroughValue },
            { key: 'error-count', label: 'Error Count', preferredValueKeys: ['sum', 'count'], transform: passthroughValue }
        ]);

        if (!cpuMetric.series.length && !memoryMetric.series.length) {
            console.warn('Command Center: Monitoring query metrics did not include supported series');
            return undefined;
        }

        console.log(`Command Center: Monitoring query metrics points -> cpu: ${cpuMetric.series.length}, memory: ${memoryMetric.series.length}`);

        const merged = mergeMonitoringTimeseries(
            cpuMetric.series,
            memoryMetric.series,
            {
                cpu: cpuMetric.transform,
                memory: memoryMetric.transform
            }
        );

        return merged ? {
            ...merged,
            source: 'monitoring',
            cpuLabel: cpuMetric.label,
            memoryLabel: memoryMetric.label
        } : undefined;
    } catch (error: any) {
        console.warn('⚠️ Monitoring query API unavailable:', error?.message || error);
        return undefined;
    }
}

function buildMonitoringMetricsUrl(
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    resource: MonitoringResourceIdentifier,
    metricId: string,
    field: string,
    params: { from: string; to: string; workerId?: string }
): string {
    const query = new URLSearchParams();
    query.set('from', params.from);
    query.set('to', params.to);
    query.set('_', Date.now().toString());
    if (params.workerId) {
        query.set('worker_id', params.workerId);
    }
    const encodedResource = encodeURIComponent(resource.id);
    return `${baseUrl}/monitoring/api/metrics/organizations/${organizationId}/environments/${environmentId}/resources/${resource.type}/${encodedResource}/metrics/${metricId}/fields/${field}?${query.toString()}`;
}

interface MonitoringMetricPoint {
    timestamp: number;
    value: number;
}

function extractMonitoringTimeseries(payload: any, field: string): MonitoringMetricPoint[] {
    if (!payload) {
        return [];
    }

    const rows = Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.data)
            ? payload.data
            : Array.isArray(payload.values)
                ? payload.values
                : Array.isArray(payload)
                    ? payload
                    : [];

    return rows
        .map((row: any) => {
            if (Array.isArray(row)) {
                const timestamp = typeof row[0] === 'number' ? row[0] : Date.parse(row[0]);
                const value = Number(row[1]);
                return { timestamp, value };
            }

            const rawTimestamp = row.timestamp || row.time || row[0];
            const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Date.parse(rawTimestamp);
            const rawValue = row[field] ?? row.value ?? row[1];
            const value = Number(rawValue);
            return { timestamp, value };
        })
        .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
        .sort((a, b) => a.timestamp - b.timestamp);
}

function mergeMonitoringTimeseries(
    cpuSeries: MonitoringMetricPoint[],
    memorySeries: MonitoringMetricPoint[],
    transforms?: { cpu?: (value?: number) => number; memory?: (value?: number) => number }
): { cpu: number[]; memory: number[]; timestamps: number[] } | undefined {
    const timestampSet = new Set<number>();
    cpuSeries.forEach(point => timestampSet.add(point.timestamp));
    memorySeries.forEach(point => timestampSet.add(point.timestamp));
    const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

    if (!timestamps.length) {
        return undefined;
    }

    const cpuTransform = transforms?.cpu || convertCpuValue;
    const memoryTransform = transforms?.memory || convertMemoryValue;

    const cpuValues = timestamps.map(ts => cpuTransform(resolveNearestValue(cpuSeries, ts)));
    const memoryValues = timestamps.map(ts => memoryTransform(resolveNearestValue(memorySeries, ts)));

    return { cpu: cpuValues, memory: memoryValues, timestamps };
}

function convertHistoryEntriesToPoints(records: any[] | undefined, valueKeys: string[]): MonitoringMetricPoint[] {
    if (!records || !records.length) {
        return [];
    }

    return records
        .map((entry: any) => {
            if (Array.isArray(entry)) {
                const ts = typeof entry[0] === 'number' ? entry[0] : Date.parse(entry[0]);
                const value = Number(entry[1]);
                return { timestamp: ts, value };
            }

            const rawTimestamp = entry?.timestamp || entry?.time || entry?.ts || entry?.[0];
            const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Date.parse(rawTimestamp);
            let rawValue: any = undefined;
            for (const key of valueKeys) {
                if (entry && Object.prototype.hasOwnProperty.call(entry, key)) {
                    rawValue = entry[key];
                    break;
                }
            }
            if (rawValue === undefined && typeof entry?.value === 'number') {
                rawValue = entry.value;
            }
            const value = Number(rawValue);
            return { timestamp, value };
        })
        .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

interface MonitoringQueryMetricCandidate {
    key: string;
    label: string;
    preferredValueKeys?: string[];
    transform?: (value?: number) => number;
}

function extractMonitoringQueryMetricsNode(payload: any, applicationId?: string): any {
    if (!payload) {
        return undefined;
    }

    const root = payload?.data && typeof payload.data === 'object'
        ? payload.data
        : payload;

    const appsArray = Array.isArray(root?.applications)
        ? root.applications
        : Array.isArray(root?.applications?.items)
            ? root.applications.items
            : Array.isArray(root?.applications?.data)
                ? root.applications.data
                : [];

    if (appsArray.length) {
        const matched = applicationId
            ? appsArray.find((app: any) => String(app.id) === String(applicationId))
            : appsArray[0];
        if (matched?.metrics) {
            return matched.metrics;
        }
    }

    if (root?.metrics) {
        return root.metrics;
    }

    return undefined;
}

function pickMonitoringQueryMetricSeries(metrics: any, candidates: MonitoringQueryMetricCandidate[]): { series: MonitoringMetricPoint[]; label?: string; transform?: (value?: number) => number } {
    if (!metrics) {
        return { series: [] };
    }

    for (const candidate of candidates) {
        const metricEntry = resolveMetricEntry(metrics, candidate.key);
        const series = convertMetricValuesFromMetric(metricEntry, candidate.preferredValueKeys);
        if (series.length) {
            return {
                series,
                label: candidate.label,
                transform: candidate.transform
            };
        }
    }

    return { series: [] };
}

function resolveMetricEntry(metrics: any, key: string): any {
    if (!metrics || !key) {
        return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(metrics, key)) {
        return metrics[key];
    }

    if (key.includes('.')) {
        const parts = key.split('.');
        let cursor = metrics;
        for (const part of parts) {
            cursor = cursor?.[part];
            if (cursor === undefined || cursor === null) {
                return undefined;
            }
        }
        return cursor;
    }

    return undefined;
}

function convertMetricValuesFromMetric(metric: any, preferredValueKeys: string[] = ['avg', 'value', 'sum', 'min', 'max', 'count']): MonitoringMetricPoint[] {
    if (!metric) {
        return [];
    }

    const valuesArray = Array.isArray(metric?.values)
        ? metric.values
        : Array.isArray(metric)
            ? metric
            : [];

    return convertHistoryEntriesToPoints(valuesArray, preferredValueKeys);
}

function passthroughValue(value?: number): number {
    return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

function resolveNearestValue(series: MonitoringMetricPoint[], timestamp: number): number | undefined {
    if (!series.length) {
        return undefined;
    }
    let closest = series[0];
    let delta = Math.abs(timestamp - closest.timestamp);
    for (const point of series) {
        const currentDelta = Math.abs(timestamp - point.timestamp);
        if (currentDelta < delta) {
            closest = point;
            delta = currentDelta;
        }
    }
    return closest.value;
}

function convertCpuValue(value?: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 0;
    }
    const normalized = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, normalized));
}

function convertMemoryValue(value?: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 0;
    }
    if (value > 1024 * 1024) {
        return value / (1024 * 1024);
    }
    if (value > 1024) {
        return value / 1024;
    }
    return value;
}

function determineMonitoringResourceIdentifier(
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID',
    applicationData: any,
    fallbackName: string,
    deploymentId?: string
): MonitoringResourceIdentifier | undefined {
    const fallback = pickFirstString(fallbackName, applicationData?.domain, applicationData?.name);

    if (cloudhubVersion === 'HYBRID') {
        const serverName = pickFirstString(
            applicationData?.target?.name,
            applicationData?.name,
            applicationData?.artifact?.name,
            fallback
        );
        return serverName ? { type: 'server', id: serverName } : undefined;
    }

    if (cloudhubVersion === 'CH2') {
        const deploymentIdentifier = pickFirstString(
            deploymentId,
            applicationData?.id,
            applicationData?.application?.id,
            applicationData?.application?.name,
            applicationData?.target?.deploymentSettings?.applicationName,
            fallback
        );
        return deploymentIdentifier ? { type: 'deployment', id: deploymentIdentifier } : undefined;
    }

    const applicationIdentifier = pickFirstString(
        applicationData?.domain,
        applicationData?.name,
        fallback
    );
    return applicationIdentifier ? { type: 'application', id: applicationIdentifier } : undefined;
}

function determineMonitoringWorkerId(
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID',
    applicationData?: any,
    replicas?: any[]
): string | undefined {
    const replicaIds = replicas?.flatMap(rep => [rep?.workerId, rep?.id]) || [];
    const candidates = [
        ...replicaIds,
        applicationData?.workers?.[0]?.workerId,
        applicationData?.workers?.[0]?.id,
        applicationData?.application?.workers?.[0]?.id,
        applicationData?.target?.id,
        applicationData?.targetId,
        cloudhubVersion === 'HYBRID' ? applicationData?.target?.serverId : undefined
    ];

    const workerCandidate = pickFirstString(...candidates);
    return workerCandidate || undefined;
}

function pickFirstString(...values: any[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        if ((typeof value === 'number' || typeof value === 'bigint') && !Number.isNaN(Number(value))) {
            return String(value);
        }
    }
    return undefined;
}

function buildSimulatedPerformanceMetrics(): { cpu: number[]; memory: number[]; timestamps: number[]; source: 'simulated'; cpuLabel: string; memoryLabel: string } {
    console.log('📊 Using simulated performance metrics');
    const points = 20;
    const cpu: number[] = [];
    const memory: number[] = [];
    const timestamps: number[] = [];
    const now = Date.now();

    for (let i = 0; i < points; i++) {
        timestamps.push(now - ((points - i) * 60 * 60 * 1000));
        cpu.push(Math.random() * 80 + 10);
        memory.push(Math.random() * 70 + 20);
    }

    return {
        cpu,
        memory,
        timestamps,
        source: 'simulated',
        cpuLabel: 'CPU Usage (%)',
        memoryLabel: 'Heap Usage (MB)'
    };
}

interface VisualizerMetricQuery {
    id: string;
    title: string;
    description?: string;
    measurement: string;
    field: string;
    aggregator?: string;
    fill: '0' | 'none';
    unit?: string;
    groupByTags?: string[];
    scale?: number;
    selectExpression?: string;
    additionalFilters?: string[];
}

const METRIC_LOOKBACK_MINUTES = 30;
const METRIC_RANGE_OPTIONS = [15, 30, 60, 120];

const VISUALIZER_METRIC_QUERIES: VisualizerMetricQuery[] = [
    {
        id: 'workerCpu',
        title: 'Worker CPU Usage',
        description: 'Per-worker operating system CPU load',
        measurement: 'jvm.cpu.operatingsystem',
        field: 'cpu',
        aggregator: 'mean',
        fill: 'none',
        unit: '%',
        groupByTags: ['worker_id'],
        scale: 100
    },
    {
        id: 'heapUsed',
        title: 'Heap Used per Worker',
        description: 'Average heap usage (MB)',
        measurement: 'jvm.memory',
        field: 'heap_used',
        aggregator: 'mean',
        fill: 'none',
        unit: 'MB',
        groupByTags: ['worker_id'],
        scale: 1 / (1024 * 1024)
    },
    {
        id: 'heapTotal',
        title: 'Heap Capacity',
        description: 'Maximum heap allocation (MB)',
        measurement: 'jvm.memory',
        field: 'heap_total',
        aggregator: 'max',
        fill: 'none',
        unit: 'MB',
        scale: 1 / (1024 * 1024)
    },
    {
        id: 'muleMessages',
        title: 'Mule Messages',
        description: 'Total processed messages',
        measurement: 'app_stats',
        field: 'messageCount',
        aggregator: 'sum',
        fill: '0',
        groupByTags: ['app_id']
    },
    {
        id: 'averageResponse',
        title: 'Average Response Time',
        description: 'Inbound response time (ms)',
        measurement: 'app_inbound_metric',
        field: 'response_time.avg',
        aggregator: 'mean',
        fill: 'none',
        unit: 'ms',
        groupByTags: ['app_id']
    },
    {
        id: 'responseTimeApp',
        title: 'Average App Response Time',
        measurement: 'app_stats',
        field: 'responseTime',
        aggregator: 'mean',
        fill: 'none',
        unit: 'ms',
        groupByTags: ['app_id']
    },
    {
        id: 'errorCount',
        title: 'Application Errors',
        measurement: 'app_stats',
        field: 'errorCount',
        aggregator: 'sum',
        fill: '0',
        groupByTags: ['app_id']
    },
    {
        id: 'threadCount',
        title: 'Thread Count',
        measurement: 'jvm.threading',
        field: 'thread_count',
        aggregator: 'mean',
        fill: 'none',
        groupByTags: ['worker_id']
    },
    {
        id: 'inboundResponses',
        title: 'Inbound - Total Requests by Response Type',
        measurement: 'app_inbound_metric',
        field: 'avg_request_count',
        aggregator: 'sum',
        fill: '0',
        groupByTags: ['response_type']
    },
    {
        id: 'inboundAverage',
        title: 'Inbound - Average Response Time',
        measurement: 'app_inbound_metric',
        field: 'response_time.avg',
        aggregator: 'mean',
        fill: 'none',
        unit: 'ms',
        groupByTags: ['app_id']
    },
    {
        id: 'inboundFailed',
        title: 'Inbound Failures',
        description: 'Failed inbound requests',
        measurement: 'app_inbound_metric',
        field: 'avg_request_count',
        aggregator: 'sum',
        fill: '0',
        additionalFilters: [`"response_type" = 'FAILED'`]
    },
    {
        id: 'inboundPercentile',
        title: 'Inbound Response Time p75',
        measurement: 'app_inbound_metric',
        field: 'avg_response_time',
        selectExpression: 'percentile("avg_response_time", 75)',
        fill: 'none',
        unit: 'ms',
        groupByTags: ['app_id']
    },
    {
        id: 'outboundResponses',
        title: 'Outbound - Total Requests by Response Type',
        measurement: 'app_outbound_metric',
        field: 'avg_request_count',
        aggregator: 'sum',
        fill: '0',
        groupByTags: ['response_type']
    },
    {
        id: 'outboundAverage',
        title: 'Outbound - Average Response Time',
        measurement: 'app_outbound_metric',
        field: 'response_time.avg',
        aggregator: 'mean',
        fill: 'none',
        unit: 'ms',
        groupByTags: ['app_id']
    }
];

async function fetchVisualizerMetrics(
    context: vscode.ExtensionContext,
    baseUrl: string,
    environmentId: string,
    organizationId: string,
    applicationName: string,
    applicationData: any,
    cloudhubVersion: 'CH1' | 'CH2',
    rangeMinutes: number
): Promise<VisualizerMetricsData | undefined> {
    const apiHelper = new ApiHelper(context);

    const clusterId = cloudhubVersion === 'CH2'
        ? deriveClusterId(applicationData, cloudhubVersion)
        : undefined;
    const appIdentifier = deriveVisualizerAppId(applicationData, applicationName, cloudhubVersion);

    try {
        const bootResponse = await apiHelper.get(`${baseUrl}/monitoring/api/visualizer/api/bootdata`);
        const dataSources = bootResponse.data?.Settings?.datasources;
        if (!dataSources) {
            return {
                status: 'unavailable',
                rangeMinutes,
                panels: [],
                errorMessage: 'No datasources returned from monitoring boot endpoint.'
            };
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
            return {
                status: 'unavailable',
                rangeMinutes,
                panels: [],
                errorMessage: 'InfluxDB datasource not configured for this account.'
            };
        }

        const datasourceId = Number(influxEntry.id || influxEntry.meta?.datasourceId || influxEntry.meta?.id);
        const databaseRaw = influxEntry.database || influxEntry.jsonData?.database;
        const database = typeof databaseRaw === 'string' ? databaseRaw.replace(/"/g, '') : undefined;

        if (!datasourceId || !database) {
            return {
                status: 'unavailable',
                rangeMinutes,
                panels: [],
                errorMessage: 'Incomplete datasource metadata returned from monitoring API.'
            };
        }

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const condition = buildMetricsCondition(organizationId, environmentId, appIdentifier, clusterId);

        const panels: VisualizerMetricPanel[] = [];
        const queryPromises = VISUALIZER_METRIC_QUERIES.map(async (queryDef) => {
            const influxQuery = buildVisualizerQuery(queryDef, condition, timezone, rangeMinutes);
            const url = buildDatasourceUrl(baseUrl, datasourceId, database, influxQuery);
            logVisualizerCurl(queryDef.id, url, organizationId, environmentId);
            try {
                const response = await apiHelper.get(url);
                const series = parseVisualizerSeries(response.data, queryDef.unit, queryDef.scale);
                if (series.length > 0) {
                    panels.push({
                        id: queryDef.id,
                        title: queryDef.title,
                        description: queryDef.description,
                        unit: queryDef.unit,
                        series,
                        fill: queryDef.fill
                    });
                }
            } catch (error: any) {
                console.error(`Command Center metrics query failed (${queryDef.id}):`, error?.message || error);
            }
        });

        await Promise.all(queryPromises);

        if (panels.length === 0) {
            return {
                status: 'unavailable',
                rangeMinutes,
                panels: [],
                errorMessage: 'No metrics returned. Ensure Anypoint Monitoring Visualizer access is enabled.'
            };
        }

        return {
            status: 'live',
            rangeMinutes,
            lastUpdated: Date.now(),
            datasource: {
                id: datasourceId,
                name: influxEntry.name,
                database
            },
            panels
        };

    } catch (error: any) {
        console.error('Command Center: Unable to fetch Visualizer metrics:', error?.message || error);
        return {
            status: 'error',
            rangeMinutes,
            panels: [],
            errorMessage: error?.response?.data?.message || error?.message || 'Unable to load metrics.'
        };
    }
}

async function fetchCH2Schedulers(
    context: vscode.ExtensionContext,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    deploymentId: string
): Promise<any[]> {
    try {
        const apiHelper = new ApiHelper(context);
        const url = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${deploymentId}/schedulers`;
        const response = await apiHelper.get(url);
        const data = response.data;
        if (Array.isArray(data)) {
            return data;
        }
        if (Array.isArray(data?.items)) {
            return data.items;
        }
        return [];
    } catch (error) {
        console.error('Command Center: Unable to fetch CH2 schedulers', error);
        return [];
    }
}

async function fetchHybridSchedulers(
    context: vscode.ExtensionContext,
    apiHelper: ApiHelper,
    applicationId: string,
    organizationId: string,
    environmentId: string,
    applicationData: any,
    hybridApplicationsEndpoint: string
): Promise<any[]> {
    const headers = {
        'X-ANYPNT-ENV-ID': environmentId,
        'X-ANYPNT-ORG-ID': organizationId
    };

    // Get region-specific ARM base URL
    const armBase = await getArmBase(context);

    const serverArtifactId = applicationData?.serverArtifacts?.[0]?.id;
    const deploymentId = applicationData?.deploymentId || applicationData?.id || applicationId;
    const candidateUrls: string[] = [
        `${hybridApplicationsEndpoint}/${applicationId}/schedules`,
        `${hybridApplicationsEndpoint}/${applicationId}/schedulers`,
        `${armBase}/applications/${applicationId}/schedules`,
        `${armBase}/applications/${applicationId}/schedulers`,
        `${armBase}/environments/${environmentId}/applications/${applicationId}/schedules`,
        `${armBase}/environments/${environmentId}/applications/${applicationId}/schedulers`,
        `${armBase}/environment/${environmentId}/applications/${applicationId}/schedules`,
        `${armBase}/environment/${environmentId}/applications/${applicationId}/schedulers`,
        `${armBase}/organizations/${organizationId}/environments/${environmentId}/applications/${applicationId}/schedules`,
        `${armBase}/organizations/${organizationId}/environments/${environmentId}/applications/${applicationId}/schedulers`,
        `${armBase}/organizations/${organizationId}/environment/${environmentId}/applications/${applicationId}/schedules`,
        `${armBase}/organizations/${organizationId}/environment/${environmentId}/applications/${applicationId}/schedulers`
    ];

    if (deploymentId && deploymentId !== applicationId) {
        candidateUrls.push(`${armBase}/deployments/${deploymentId}/schedules`);
        candidateUrls.push(`${armBase}/deployments/${deploymentId}/schedulers`);
        candidateUrls.push(`${armBase}/environments/${environmentId}/deployments/${deploymentId}/schedules`);
        candidateUrls.push(`${armBase}/environments/${environmentId}/deployments/${deploymentId}/schedulers`);
        candidateUrls.push(`${armBase}/environment/${environmentId}/deployments/${deploymentId}/schedules`);
        candidateUrls.push(`${armBase}/environment/${environmentId}/deployments/${deploymentId}/schedulers`);
    }

    if (serverArtifactId) {
        candidateUrls.push(`${armBase}/serverArtifacts/${serverArtifactId}/schedules`);
        candidateUrls.push(`${armBase}/serverArtifacts/${serverArtifactId}/schedulers`);
    }

    for (const url of candidateUrls) {
        try {
            console.log(`🔍 Hybrid schedulers: calling ${url}`);
            const response = await apiHelper.get(url, { headers });
            if (response.status === 200) {
                const rawEntries = normalizeSchedulerResponse(response.data);
                if (rawEntries.length > 0) {
                    console.log(`✅ Hybrid schedulers fetched (${rawEntries.length}) from ${url}`);
                    return rawEntries.map(normalizeHybridSchedulerEntry);
                }
            }
        } catch (error: any) {
            console.log(`⚠️ Hybrid schedulers endpoint ${url} returned ${error?.response?.status || error?.message}`);
        }
    }

    try {
        console.log('🔍 Hybrid schedulers: attempting include query on application endpoint');
        const includeResponse = await apiHelper.get(`${hybridApplicationsEndpoint}/${applicationId}?include=schedules`, { headers });
        const candidate = includeResponse?.data?.schedules || includeResponse?.data?.data?.schedules;
        if (Array.isArray(candidate) && candidate.length > 0) {
            console.log(`✅ Hybrid schedulers found via include param (${candidate.length})`);
            return candidate.map(normalizeHybridSchedulerEntry);
        }
    } catch (error: any) {
        console.log('⚠️ Hybrid schedulers include call failed:', error?.response?.status || error?.message);
    }

    console.log('ℹ️ No Hybrid schedulers were found across available endpoints.');
    return [];
}

function normalizeSchedulerResponse(payload: any): any[] {
    if (!payload) {
        return [];
    }
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.data)) {
        return payload.data;
    }
    if (Array.isArray(payload?.items)) {
        return payload.items;
    }
    if (Array.isArray(payload?.schedules)) {
        return payload.schedules;
    }
    return [];
}

function normalizeHybridSchedulerEntry(entry: any): any {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }

    const normalized: any = { ...entry };

    normalized.name = entry.name || entry.flowName || entry.flow || entry.jobName || 'Scheduler';
    normalized.flow = entry.flow || entry.flowName;
    normalized.type = entry.type || entry.jobType || entry.schedulerType || 'Scheduler';
    normalized.expression = entry.cronExpression || entry.expression || entry.scheduleExpression;
    normalized.frequency = entry.frequency || entry.intervalValue;
    normalized.timeUnit = entry.timeUnit || entry.intervalUnit;
    normalized.lastRun = entry.lastRun || entry.lastFireTime || entry.lastExecution || entry.lastExecutionTime || entry.lastRunTime;
    normalized.nextRunTime = entry.nextRun || entry.nextFireTime || entry.nextExecution || entry.nextExecutionTime || entry.nextRunTime;
    normalized.status = entry.status || entry.state;

    if (typeof entry.enabled === 'boolean') {
        normalized.enabled = entry.enabled;
    } else if (entry.active !== undefined) {
        normalized.enabled = !!entry.active;
    } else {
        const state = (entry.state || entry.status || '').toString().toUpperCase();
        normalized.enabled = state === 'ENABLED' || state === 'ACTIVE';
    }

    return normalized;
}

function buildDatasourceUrl(baseUrl: string, datasourceId: number, database: string, query: string): string {
    const params = new URLSearchParams();
    params.append('db', `"${database}"`);
    params.append('q', query);
    params.append('epoch', 'ms');
    return `${baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasourceId}/query?${params.toString()}`;
}

function deriveVisualizerAppId(
    applicationData: any,
    fallbackName: string,
    cloudhubVersion: 'CH1' | 'CH2'
): string {
    const sanitizedFallback = sanitizeIdentifier(fallbackName) || fallbackName;

    if (cloudhubVersion === 'CH1') {
        const ch1Candidates = [
            sanitizeIdentifier(applicationData?.fullDomain),
            sanitizeIdentifier(applicationData?.fullDomains?.[0]),
            sanitizeIdentifier(applicationData?.dnsInfo?.fullDomain),
            sanitizeIdentifier(applicationData?.domain && applicationData.domain.includes('.cloudhub.io') ? applicationData.domain : undefined)
        ];

        for (const candidate of ch1Candidates) {
            if (candidate) {
                return candidate;
            }
        }

        const regionSegment = deriveRegionSegment(applicationData);
        if (regionSegment && sanitizedFallback) {
            return `${sanitizedFallback}.${regionSegment}.cloudhub.io`.toLowerCase();
        }
    }

    const ch2Candidates = [
        sanitizeIdentifier(applicationData?.application?.name),
        sanitizeIdentifier(applicationData?.name),
        sanitizeIdentifier(applicationData?.target?.deploymentSettings?.applicationName),
        sanitizeIdentifier(applicationData?.target?.deploymentSettings?.name),
        sanitizeIdentifier(sanitizedFallback)
    ];

    const resolved = ch2Candidates.find(candidate => typeof candidate === 'string' && candidate.length > 0);
    return resolved || (sanitizedFallback ? sanitizedFallback.toLowerCase() : fallbackName);
}

function deriveRegionSegment(app: any): string | undefined {
    const regionCandidates = [
        app?.regionDomain,
        app?.region,
        app?.target?.deploymentSettings?.regionDomain,
        app?.target?.deploymentSettings?.region,
        app?.workers?.[0]?.region
    ];

    for (const candidate of regionCandidates) {
        const normalized = sanitizeRegionSlug(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return undefined;
}

function sanitizeRegionSlug(value?: string): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    let slug = value.trim().toLowerCase();
    if (!slug) {
        return undefined;
    }

    slug = slug.replace(/\.cloudhub\.io$/i, '').replace(/^cloudhub-/, '').replace(/_/g, '-');

    return slug && /[a-z0-9]/.test(slug) ? slug : undefined;
}

function sanitizeIdentifier(value?: string): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toLowerCase() : undefined;
}

function buildMetricsCondition(
    organizationId: string,
    environmentId: string,
    applicationIdentifier: string,
    clusterId?: string
): string {
    const filters = [
        `"org_id" = '${organizationId}'`,
        `"env_id" = '${environmentId}'`,
        `"app_id" = '${applicationIdentifier}'`
    ];

    if (clusterId) {
        filters.push(`"cluster_id" = '${clusterId}'`);
    }

    return `(${filters.join(' AND ')})`;
}

function buildVisualizerQuery(
    queryDef: VisualizerMetricQuery,
    condition: string,
    timezone: string,
    rangeMinutes: number
): string {
    const bucket = '1m';
    const groupTags = queryDef.groupByTags && queryDef.groupByTags.length > 0
        ? `, ${queryDef.groupByTags.map(tag => `"${tag}"`).join(', ')}`
        : '';
    const field = queryDef.field.includes('"') ? queryDef.field : `"${queryDef.field}"`;
    const selectExpression = queryDef.selectExpression || `${queryDef.aggregator || 'mean'}(${field})`;
    const whereClauses = [condition, ...(queryDef.additionalFilters || [])];
    const where = whereClauses.join(' AND ');

    return `SELECT ${selectExpression} FROM "${queryDef.measurement}"
        WHERE ${where} AND time >= now() - ${rangeMinutes}m
        GROUP BY time(${bucket})${groupTags} fill(${queryDef.fill}) tz('${timezone}')`
        .replace(/\s+/g, ' ')
        .trim();
}

function parseVisualizerSeries(response: any, unit?: string, scale: number = 1): VisualizerMetricSeries[] {
    const results = response?.results || [];
    const seriesData = results.flatMap((result: any) => result?.series || []);
    return seriesData.map((series: any) => {
        const columns = series.columns || [];
        const firstValueIndex = columns.findIndex((col: string) => col !== 'time');
        const valueIndex = firstValueIndex >= 0 ? firstValueIndex : 1;
        const label = series?.tags?.response_type || series?.tags?.app_id || series?.name || 'Series';
        const points: MetricPoint[] = (series.values || []).map((row: any[]) => ({
            timestamp: row[0],
            value: Number(row[valueIndex] || 0) * (scale || 1)
        }));
        return {
            label,
            unit,
            points
        };
    });
}

function logVisualizerCurl(metricId: string, url: string, organizationId: string, environmentId: string) {
    const curl = `curl --location '${url}' \
  -H 'Authorization: Bearer <REDACTED>' \
  -H 'X-ANYPNT-ORG-ID: ${organizationId}' \
  -H 'X-ANYPNT-ENV-ID: ${environmentId}'`;
    console.log(`📡 Command Center metrics request (${metricId}):\n${curl}`);
}


function deriveClusterId(app: any, cloudhubVersion: 'CH1' | 'CH2'): string | undefined {
    if (!app) {
        return undefined;
    }

    const regionCandidates = [
        app?.target?.deploymentSettings?.regionDomain,
        app?.target?.deploymentSettings?.region,
        app?.regionDomain,
        app?.region,
        app?.target?.provider
    ];

    for (const candidate of regionCandidates) {
        const normalized = normalizeRegion(candidate);
        if (normalized) {
            return normalized.startsWith('cloudhub-') ? normalized : `cloudhub-${normalized}`;
        }
    }

    return undefined;
}

function normalizeRegion(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }

    let cleaned = value.trim().toLowerCase();
    if (!cleaned) {
        return undefined;
    }

    if (cleaned.startsWith('cloudhub-')) {
        cleaned = cleaned.replace('cloudhub-', '');
    }

    if (!/^[a-z0-9-]+$/.test(cleaned)) {
        return undefined;
    }

    if (!cleaned.includes('-')) {
        return undefined;
    }

    return cleaned;
}

const METRIC_COLORS = [
    'var(--am-info)', 'var(--am-success)', 'var(--am-error)',
    'var(--am-warning)', 'var(--am-text-secondary)', 'var(--am-text-muted)',
    'var(--am-text-link)'
];
const METRIC_COLORS_RAW = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#79c0ff', '#ffa657'];

function renderMetricsTab(
    metrics?: VisualizerMetricsData,
    options?: { active: boolean; selectedRange: number; performanceMetrics?: CommandCenterData['performanceMetrics']; cloudhubVersion?: string }
): string {
    const performanceMetrics = options?.performanceMetrics;
    const hasMonitoringFallback = performanceMetrics && performanceMetrics.source === 'monitoring';
    const hasVisualizerData = metrics?.status === 'live' && metrics.panels.length > 0;

    const infoBanner = hasVisualizerData
        ? `Live metrics from Visualizer \u00b7 Updated ${metrics?.lastUpdated ? new Date(metrics.lastUpdated).toLocaleTimeString() : 'just now'} \u00b7 ${metrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES}m window`
        : hasMonitoringFallback
            ? `Monitoring Query metrics \u00b7 24h window`
            : metrics?.status === 'error'
                ? `${metrics?.errorMessage || 'Unable to load metrics from Visualizer.'}`
                : metrics?.errorMessage || 'Metrics will appear here once Visualizer access is enabled for this org/environment.';

    const statusDot = hasVisualizerData || hasMonitoringFallback
        ? 'cc-dot-ok' : metrics?.status === 'error' ? 'cc-dot-err' : 'cc-dot-warn';

    const selectedRange = options?.selectedRange || metrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES;
    const disableRange = hasMonitoringFallback && !hasVisualizerData;
    const rangeButtons = METRIC_RANGE_OPTIONS.map(option =>
        `<button class="cc-seg-btn${option === selectedRange ? ' cc-seg-active' : ''}" data-range="${option}" onclick="selectMetricsRange(${option})" ${disableRange ? 'disabled' : ''}>${option}m</button>`
    ).join('');

    const visualizerGrid = hasVisualizerData
        ? `<div class="cc-metrics-grid">${metrics?.panels.map((panel, index) => renderMetricPanel(panel, index)).join('')}</div>`
        : '';

    const monitoringFallbackGrid = !hasVisualizerData && hasMonitoringFallback
        ? renderMonitoringPerformancePanels(performanceMetrics!, options?.cloudhubVersion)
        : '';

    const emptyStateHtml = !hasVisualizerData && !hasMonitoringFallback
        ? `<div class="cc-empty">${metrics?.errorMessage || 'No metric panels available for this application in the selected time window.'}</div>`
        : '';

    return `
    <div id="tab-metrics" class="tab-content ${options?.active ? 'active' : ''}">
        <div class="cc-metrics-controls">
            <div class="cc-seg-group" id="metrics-range-group">${rangeButtons}</div>
            <button class="cc-toolbar-btn metrics-refresh-btn" onclick="refreshMetrics()" title="Refresh charts">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 23 10"/></svg>
            </button>
        </div>
        <div class="cc-metrics-banner">
            <span class="cc-dot ${statusDot}"></span>
            <span>${infoBanner}</span>
            ${metrics?.datasource ? `<span class="cc-muted"> \u00b7 DS#${metrics.datasource.id}${metrics.datasource.database ? ` ${metrics.datasource.database}` : ''}</span>` : ''}
        </div>
        ${visualizerGrid || monitoringFallbackGrid || emptyStateHtml}
    </div>`;
}

function renderMonitoringPerformancePanels(perf: CommandCenterData['performanceMetrics'], cloudhubVersion?: string): string {
    if (!perf || !perf.timestamps || perf.timestamps.length === 0) {
        return `<div class="cc-empty">No monitoring data returned for this application.</div>`;
    }

    const cpuCard = renderSimpleTimeseriesCard({
        label: perf.cpuLabel || (cloudhubVersion === 'HYBRID' ? 'Message Count (avg)' : 'CPU Usage (%)'),
        color: METRIC_COLORS_RAW[0],
        values: perf.cpu,
        timestamps: perf.timestamps,
        unit: '',
        formatter: value => value.toFixed(2)
    });

    const memoryCard = renderSimpleTimeseriesCard({
        label: perf.memoryLabel || (cloudhubVersion === 'HYBRID' ? 'Response Time (ms)' : 'Memory Usage (MB)'),
        color: METRIC_COLORS_RAW[1],
        values: perf.memory,
        timestamps: perf.timestamps,
        unit: '',
        formatter: value => value.toFixed(2)
    });

    return `<div class="cc-metrics-grid">${cpuCard}${memoryCard}</div>`;
}

function renderSimpleTimeseriesCard(params: { label: string; color: string; values: number[]; timestamps: number[]; unit?: string; formatter?: (value: number) => string }): string {
    const values = params.values || [];
    const timestamps = params.timestamps || [];
    if (!values.length || !timestamps.length) {
        return `<div class="cc-chart-card"><div class="cc-chart-head"><span class="cc-chart-label">${params.label}</span><span class="cc-chart-value">\u2014</span></div><div class="cc-empty">No data points returned.</div></div>`;
    }

    const latest = values[values.length - 1];
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const formatter = params.formatter || ((val: number) => val.toFixed(1));

    const width = 360;
    const height = 100;
    const padding = { top: 8, bottom: 20, left: 0, right: 0 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = max <= 0 ? 1 : max;

    const pathPoints = values.map((value, index) => {
        const ratioX = values.length > 1 ? index / (values.length - 1) : 0;
        const ratioY = value / maxValue;
        const x = padding.left + ratioX * chartWidth;
        const y = padding.top + (1 - ratioY) * chartHeight;
        return `${x},${y}`;
    });
    const linePath = pathPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');
    const areaPath = `${linePath} L${width},${height - padding.bottom} L0,${height - padding.bottom} Z`;

    return `
    <div class="cc-chart-card">
        <div class="cc-chart-head">
            <div>
                <div class="cc-chart-label">${params.label}</div>
                <div class="cc-chart-sub">Avg ${formatter(avg)}${params.unit || ''} \u00b7 Min ${formatter(min)} \u00b7 Max ${formatter(max)}</div>
            </div>
            <div class="cc-chart-value">${formatter(latest)}<span class="cc-chart-unit">${params.unit || ''}</span></div>
        </div>
        <svg class="cc-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path d="${areaPath}" fill="${params.color}" opacity="0.08"/>
            <path d="${linePath}" fill="none" stroke="${params.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    </div>`;
}

function renderMetricPanel(panel: VisualizerMetricPanel, paletteOffset: number = 0): string {
    const hasData = panel.series.some(series => series.points && series.points.length > 0);
    if (!hasData) {
        return `<div class="cc-chart-card"><div class="cc-chart-head"><span class="cc-chart-label">${panel.title}</span><span class="cc-chart-value">\u2014</span></div><div class="cc-empty">No data returned for this panel.</div></div>`;
    }

    const latestValue = panel.series.length === 1
        ? getLatestValue(panel.series[0])
        : panel.series.reduce((total, series) => total + (getLatestValue(series) || 0), 0);

    const allValues = panel.series.flatMap(series => series.points.map(point => point.value));
    const maxValueRaw = allValues.length > 0 ? Math.max(...allValues) : 0;
    const maxValue = maxValueRaw <= 0 ? 1 : maxValueRaw;
    const width = 360;
    const height = 120;
    const padding = { top: 8, bottom: 20, left: 0, right: 0 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const gridLines = [0.75, 0.5, 0.25].map(ratio => {
        const y = padding.top + (1 - ratio) * chartHeight;
        return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="var(--am-border)" opacity="0.15" stroke-width="1"/>`;
    }).join('');

    const seriesLines = panel.series.map((series, index) => {
        const color = METRIC_COLORS_RAW[(paletteOffset + index) % METRIC_COLORS_RAW.length];
        const points = series.points.map((point, pointIndex) => {
            const ratioX = series.points.length > 1 ? pointIndex / (series.points.length - 1) : 0;
            const ratioY = point.value / maxValue;
            const x = padding.left + ratioX * chartWidth;
            const y = padding.top + (1 - ratioY) * chartHeight;
            return `${x},${y}`;
        }).join(' ');
        const areaPoints = `${points} ${width},${height - padding.bottom} 0,${height - padding.bottom}`;
        const showEvery = Math.max(1, Math.floor(series.points.length / 8));
        const markers = series.points.map((point, pointIndex) => {
            if (!point || (pointIndex % showEvery !== 0 && pointIndex !== series.points.length - 1)) {
                return '';
            }
            const ratioX = series.points.length > 1 ? pointIndex / (series.points.length - 1) : 0;
            const ratioY = point.value / maxValue;
            const x = padding.left + ratioX * chartWidth;
            const y = padding.top + (1 - ratioY) * chartHeight;
            const tooltip = `${formatMetricTime(point.timestamp)} \u00b7 ${formatMetricValue(point.value, panel.unit)}`;
            return `<circle cx="${x}" cy="${y}" r="2.5" fill="${color}" opacity="0.7"><title>${tooltip}</title></circle>`;
        }).join('');
        return `<g>
            <polygon points="${areaPoints}" fill="${color}" opacity="0.06"/>
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${markers}
        </g>`;
    }).join('');

    const legend = panel.series.map((series, index) => {
        const color = METRIC_COLORS_RAW[(paletteOffset + index) % METRIC_COLORS_RAW.length];
        const seriesValue = getLatestValue(series);
        return `<span class="cc-legend-item"><span class="cc-legend-dot" style="background:${color}"></span>${series.label} <span class="cc-legend-val">${formatMetricValue(seriesValue, panel.unit)}</span></span>`;
    }).join('');

    return `
    <div class="cc-chart-card">
        <div class="cc-chart-head">
            <div>
                <div class="cc-chart-label">${panel.title}</div>
                ${panel.description ? `<div class="cc-chart-sub">${panel.description}</div>` : ''}
            </div>
            <div class="cc-chart-value">${formatMetricValue(latestValue, panel.unit)}</div>
        </div>
        <svg class="cc-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${gridLines}
            ${seriesLines}
        </svg>
        <div class="cc-legend">${legend}</div>
    </div>`;
}

function getLatestValue(series: VisualizerMetricSeries): number | undefined {
    if (!series.points || series.points.length === 0) {
        return undefined;
    }
    return series.points[series.points.length - 1]?.value;
}

function formatMetricValue(value?: number, unit?: string): string {
    if (value === undefined || Number.isNaN(value)) {
        return '—';
    }
    const absValue = Math.abs(value);
    let formatted: string;
    if (absValue === 0) {
        formatted = '0';
    } else if (absValue >= 1000) {
        formatted = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    } else if (absValue >= 10) {
        formatted = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    } else {
        formatted = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return unit ? `${formatted} ${unit}` : formatted;
}

function formatMetricTime(timestamp?: number): string {
    if (!timestamp) {
        return '';
    }
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function isSchedulerEnabled(scheduler: any): boolean {
    if (typeof scheduler?.enabled === 'boolean') {
        return scheduler.enabled;
    }
    const status = (scheduler?.status || scheduler?.state || '').toString().toUpperCase();
    return status === 'ENABLED' || status === 'ACTIVE';
}

function formatSchedulerDescription(scheduler: any): string {
    if (scheduler?.expression) {
        return scheduler.expression;
    }
    if (scheduler?.scheduleExpression) {
        return scheduler.scheduleExpression;
    }
    if (scheduler?.cronExpression) {
        return scheduler.cronExpression;
    }
    if (scheduler?.frequency && scheduler?.timeUnit) {
        return `${scheduler.frequency} ${scheduler.timeUnit}`;
    }
    if (scheduler?.intervalSeconds) {
        return `Every ${scheduler.intervalSeconds}s`;
    }
    return scheduler?.description || 'No schedule defined';
}

function formatSchedulerLastRun(scheduler: any): string {
    const lastRun = scheduler?.lastRun || scheduler?.lastExecutionTime || scheduler?.lastRunTime || scheduler?.lastFireTime;
    return lastRun ? new Date(lastRun).toLocaleString() : 'Never run';
}

function formatSchedulerNextRun(scheduler: any): string {
    const nextRun = scheduler?.nextRunTime || scheduler?.nextExecutionTime || scheduler?.nextFireTime;
    return nextRun ? new Date(nextRun).toLocaleString() : 'Unknown';
}

function normalizeStatus(status?: string): string | undefined {
    if (!status) {
        return undefined;
    }
    const upper = status.toString().toUpperCase();
    if (upper === 'STARTED') {
        return 'RUNNING';
    }
    if (upper === 'NOT_RUNNING') {
        return 'STOPPED';
    }
    return upper;
}

/**
 * Parse network topology from application data
 */
function parseNetworkTopology(app: any, cloudhubVersion: 'CH1' | 'CH2'): {
    externalEndpoints: string[];
    vpnConnections: string[];
    dependencies: string[];
} {
    const externalEndpoints: string[] = [];
    const vpnConnections: string[] = [];
    const dependencies: string[] = [];

    // Parse VPN connections (CH1)
    if (cloudhubVersion === 'CH1' && app?.vpnEnabled) {
        vpnConnections.push(app.vpn?.name || 'VPN Connection');
    }

    // Parse properties for external endpoints and dependencies
    const properties = app?.properties || {};
    Object.entries(properties).forEach(([key, value]: [string, any]) => {
        const strValue = String(value);

        // Look for URLs (http/https)
        if (strValue.match(/https?:\/\//)) {
            try {
                const url = new URL(strValue);
                const endpoint = url.hostname;
                if (!externalEndpoints.includes(endpoint)) {
                    externalEndpoints.push(endpoint);
                }
            } catch (e) {
                // Invalid URL, skip
            }
        }

        // Look for database connections
        if (key.toLowerCase().includes('database') || key.toLowerCase().includes('db') ||
            key.toLowerCase().includes('jdbc') || key.toLowerCase().includes('datasource')) {
            if (!dependencies.includes(strValue) && strValue.length < 100) {
                dependencies.push(`DB: ${strValue.substring(0, 50)}`);
            }
        }

        // Look for API endpoints
        if (key.toLowerCase().includes('api') || key.toLowerCase().includes('endpoint') ||
            key.toLowerCase().includes('url') || key.toLowerCase().includes('uri')) {
            if (strValue.match(/\./)) { // Has a domain
                if (!dependencies.includes(strValue) && strValue.length < 100) {
                    dependencies.push(`API: ${strValue.substring(0, 50)}`);
                }
            }
        }
    });

    // Parse static IPs (CH1)
    if (cloudhubVersion === 'CH1' && app?.staticIPsEnabled) {
        dependencies.push('Static IP: ' + (app.staticIPs || ['Enabled']).join(', '));
    }

    // Parse object store (CH1)
    if (cloudhubVersion === 'CH1' && app?.objectStoreV2Enabled) {
        dependencies.push('Object Store V2');
    }

    // Parse CloudHub 2.0 networking
    if (cloudhubVersion === 'CH2') {
        if (app?.target?.deploymentSettings?.clustered) {
            dependencies.push('🔄 Clustered Runtime');
        }
        if (app?.target?.provider?.toLowerCase().includes('rtf')) {
            dependencies.push('⚙️ Runtime Fabric');
        }
        // Add networking info from CH2
        const networkMode = app?.target?.deploymentSettings?.http?.inbound?.publicUrl ? 'Public Endpoint' : 'Private Network';
        if (app?.target?.deploymentSettings?.http?.inbound?.publicUrl) {
            externalEndpoints.push(`Public URL: ${app.target.deploymentSettings.http.inbound.publicUrl}`);
        }
    }

    // Parse logging/monitoring integrations
    if (app?.loggingCustomLog4JEnabled || app?.loggingNgEnabled) {
        dependencies.push('📝 Custom Logging Enabled');
    }

    // Parse persistent queues (CH1)
    if (cloudhubVersion === 'CH1' && app?.persistentQueuesEnabled) {
        dependencies.push('💾 Persistent Queues Enabled');
    }

    // Don't add placeholder data - only show what we actually found
    return {
        externalEndpoints: externalEndpoints.slice(0, 10), // Increase limit
        vpnConnections,
        dependencies: dependencies.slice(0, 10) // Increase limit
    };
}

/**
 * Get actual application running status
 * For CH2, checks replica states; for CH1, uses application status
 */
function getActualStatus(app: any, replicas: any[] | undefined, cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID'): string {
    const baseStatus = normalizeStatus(app?.application?.status || app?.status);

    if (cloudhubVersion === 'CH2' && replicas && replicas.length > 0) {
        // For CloudHub 2.0, check replica states
        // Note: 'APPLIED' deploymentStatus means successfully deployed and running
        const runningReplicas = replicas.filter((r: any) =>
            r.state === 'RUNNING' || r.status === 'RUNNING' || r.deploymentStatus === 'APPLIED'
        ).length;
        const stoppedReplicas = replicas.filter((r: any) =>
            r.state === 'STOPPED' || r.status === 'STOPPED'
        ).length;

        if (runningReplicas === replicas.length) {
            return 'RUNNING';
        } else if (runningReplicas > 0) {
            return `PARTIALLY_RUNNING (${runningReplicas}/${replicas.length})`;
        } else if (stoppedReplicas > 0) {
            return 'STOPPED';
        }
    }

    // For CloudHub 1.0, use application status directly
    // CH1 STARTED status means running
    if (baseStatus) {
        return baseStatus;
    }
    return 'UNKNOWN';
}

/**
 * Generate simulated alerts based on application state
 */
function generateSimulatedAlerts(data: any): any[] {
    const alerts: any[] = [];

    // High error rate alert
    const recentLogs = data.logs?.slice(0, 100) || [];
    const errorLogs = recentLogs.filter((log: any) =>
        log.priority === 'ERROR' || log.message?.toLowerCase().includes('error')
    );
    if (errorLogs.length > 10) {
        alerts.push({
            severity: 'critical',
            message: `High error rate detected: ${errorLogs.length} errors in last 100 logs`,
            timestamp: Date.now()
        });
    } else if (errorLogs.length > 5) {
        alerts.push({
            severity: 'warning',
            message: `Elevated error rate: ${errorLogs.length} errors in recent logs`,
            timestamp: Date.now()
        });
    }

    // Replica health alert (CH2)
    if (data.replicas && data.replicas.length > 0) {
        const unhealthyReplicas = data.replicas.filter((r: any) =>
            r.state !== 'RUNNING' && r.status !== 'RUNNING'
        );
        if (unhealthyReplicas.length > 0) {
            alerts.push({
                severity: 'warning',
                message: `${unhealthyReplicas.length} unhealthy replica(s) detected`,
                timestamp: Date.now()
            });
        }
    }

    // Stopped application alert
    if (data.application?.status === 'STOPPED' || data.application?.status === 'UNDEPLOYED') {
        alerts.push({
            severity: 'info',
            message: 'Application is currently stopped',
            timestamp: Date.now()
        });
    }

    return alerts;
}

/**
 * Show Application Command Center dashboard
 */
export async function showApplicationCommandCenter(
    context: vscode.ExtensionContext,
    preselectedEnvironmentId?: string,
    preselectedEnvironmentName?: string,
    preselectedAppName?: string,
    preselectedAppData?: any
) {
    telemetryService.trackPageView('applicationCommandCenter');
    try {
        const accountService = new AccountService(context);
        const activeAccount = await accountService.getActiveAccount();

        if (!activeAccount) {
            vscode.window.showErrorMessage('No active account found. Please log in first.');
            return;
        }

        let environmentId: string;
        let environmentName: string;

        // Use preselected environment if provided, otherwise prompt
        if (preselectedEnvironmentId && preselectedEnvironmentName) {
            environmentId = preselectedEnvironmentId;
            environmentName = preselectedEnvironmentName;
        } else {
            // Get environments
            let storedEnvironments = await accountService.getActiveAccountEnvironments();
            if (!storedEnvironments) {
                vscode.window.showErrorMessage('No environment information found. Please log in first.');
                return;
            }

            const environments = JSON.parse(storedEnvironments) as {
                data: { id: string; name: string }[];
                total: number;
            };

            if (!environments.data || environments.data.length === 0) {
                vscode.window.showErrorMessage('No environments available.');
                return;
            }

            // Select environment
            const selectedEnvironment = await vscode.window.showQuickPick(
                environments.data.map(env => ({ label: env.name, id: env.id })),
                { placeHolder: 'Select an environment', title: 'Application Command Center' }
            );

            if (!selectedEnvironment) {
                return;
            }

            environmentId = selectedEnvironment.id;
            environmentName = selectedEnvironment.label;
        }

        // Fetch both CH1 and CH2 applications
        const apiHelper = new ApiHelper(context);
        // Use effective organization ID to respect selected business group
        const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
        const baseUrl = await getBaseUrl(context);
        const envHeaders = {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationID
        };

        let allApplications: any[] = [];

        // Fetch CloudHub 1.0 applications
        try {
            const ch1Response = await apiHelper.get(`${baseUrl}/cloudhub/api/applications`, {
                headers: envHeaders,
            });

                if (ch1Response.status === 200) {
                    const ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
                    allApplications.push(...ch1Apps.map(app => ({
                        label: `📦 CH1: ${app.domain} (${app.status})`,
                        domain: app.domain,
                        cloudhubVersion: 'CH1' as const,
                        status: app.status,
                        applicationStatus: app.status, // CH1 uses status directly for application status
                        rawData: app
                    })));
                }
            } catch (error) {
                console.log('CloudHub 1.0 applications not available or error:', error);
            }

        // Fetch CloudHub 2.0 applications
        try {
            console.log(`🚀 Command Center: Fetching CH2 apps for org ${organizationID}, env ${environmentId}`);
            const ch2Response = await apiHelper.get(`${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments`);

            console.log(`🚀 Command Center: CH2 API response status: ${ch2Response.status}`);
            console.log(`🚀 Command Center: CH2 response data type:`, typeof ch2Response.data);
            console.log(`🚀 Command Center: CH2 response keys:`, Object.keys(ch2Response.data || {}));

            if (ch2Response.status === 200) {
                // Handle different response structures (matching the working getCH2Applications function)
                let ch2Apps: any[] = [];

                if (Array.isArray(ch2Response.data)) {
                    ch2Apps = ch2Response.data;
                    console.log(`🚀 Command Center: CH2 apps from direct array (${ch2Apps.length})`);
                } else if (ch2Response.data?.items && Array.isArray(ch2Response.data.items)) {
                    ch2Apps = ch2Response.data.items;
                    console.log(`🚀 Command Center: CH2 apps from items property (${ch2Apps.length})`);
                } else if (ch2Response.data?.data && Array.isArray(ch2Response.data.data)) {
                    ch2Apps = ch2Response.data.data;
                    console.log(`🚀 Command Center: CH2 apps from data property (${ch2Apps.length})`);
                }

                console.log(`🚀 Command Center: Total CH2 apps found: ${ch2Apps.length}`);

                // Fetch spec IDs for CH2 apps
                const appsWithSpecs = await Promise.all(ch2Apps.map(async (app: any) => {
                    let specificationId = app.id;
                    try {
                        const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments/${app.id}/specs`;
                        const specsResponse = await apiHelper.get(specsUrl);
                        if (specsResponse.status === 200 && specsResponse.data) {
                            const specs = Array.isArray(specsResponse.data) ? specsResponse.data : specsResponse.data.data || [];
                            if (specs.length > 0) {
                                specificationId = specs[0].id || specs[0].version || app.id;
                            }
                        }
                    } catch (error) {
                        console.warn(`Could not fetch specs for ${app.name}:`, error);
                    }
                    // Use application status (RUNNING, STOPPED) instead of deployment status (APPLIED)
                    const appStatus = app.application?.status || app.status;
                    return {
                        label: `🚀 CH2: ${app.name} (${appStatus})`,
                        domain: app.name,
                        cloudhubVersion: 'CH2' as const,
                        status: app.status,
                        applicationStatus: appStatus,
                        deploymentId: app.id,
                        specificationId: specificationId,
                        rawData: app
                    };
                }));

                console.log(`🚀 Command Center: Successfully processed ${appsWithSpecs.length} CH2 apps with specs`);
                allApplications.push(...appsWithSpecs);
            }
        } catch (error: any) {
            console.error('❌ Command Center: CloudHub 2.0 applications error:', error);
            console.error('❌ Command Center: Error message:', error.message);
            console.error('❌ Command Center: Error response:', error.response?.status, error.response?.data);

            // Show warning but don't fail - user might only have CH1 apps
            if (error.message?.includes('403') || error.message?.includes('Access denied')) {
                console.log('⚠️  Command Center: Access denied for CloudHub 2.0 (might not have permissions)');
            } else {
                console.log('⚠️  Command Center: CloudHub 2.0 not available or error occurred');
            }
        }

        // Fetch Hybrid applications
        try {
            console.log('🖥 Command Center: Fetching Hybrid apps...');
            const hybridResponse = await apiHelper.get(HYBRID_APPLICATIONS_ENDPOINT, {
                headers: envHeaders
            });

            if (hybridResponse.status === 200) {
                const hybridData = Array.isArray(hybridResponse.data)
                    ? hybridResponse.data
                    : Array.isArray(hybridResponse.data?.data)
                        ? hybridResponse.data.data
                        : [];

                console.log(`🖥 Command Center: Hybrid apps found: ${hybridData.length}`);

                const hybridEntries = hybridData.map((app: any) => {
                    const appName = app.name || app.artifact?.name || app.domain || app.id;
                    const appStatus = normalizeStatus(app.lastReportedStatus || app.desiredStatus || app.status) || 'UNKNOWN';
                    return {
                        label: `🖥 HYBRID: ${appName} (${appStatus})`,
                        domain: appName,
                        cloudhubVersion: 'HYBRID' as const,
                        status: appStatus,
                        applicationStatus: appStatus,
                        deploymentId: app.id,
                        specificationId: undefined,
                        rawData: { ...app, cloudhubVersion: 'HYBRID' }
                    };
                });

                allApplications.push(...hybridEntries);
            }
        } catch (error: any) {
            console.warn('⚠️ Command Center: Unable to fetch Hybrid applications:', error?.message || error);
        }

        console.log(`📊 Command Center: Total applications found: ${allApplications.length}`);
        console.log(`📊 Command Center: Applications breakdown:`, allApplications.map(a => a.label));

        let appInfo: any;

        // Use preselected app if provided, otherwise prompt
        if (preselectedAppName && preselectedAppData) {
            // Find the app in the list or use the preselected data
            appInfo = allApplications.find(app => app.domain === preselectedAppName || app.label === preselectedAppName);

            if (!appInfo) {
                // Create appInfo from preselected data
                // Determine cloudhub version - check explicit marker first, then infer from data structure
                let detectedVersion: 'CH1' | 'CH2' | 'HYBRID' = 'CH1';

                if (preselectedAppData.cloudhubVersion === 'HYBRID' || preselectedAppData.deploymentType === 'HYBRID') {
                    detectedVersion = 'HYBRID';
                } else if (preselectedAppData.cloudhubVersion === 'CH2' ||
                           preselectedAppData.target ||
                           preselectedAppData.deploymentId ||
                           preselectedAppData.replicas !== undefined) {
                    detectedVersion = 'CH2';
                }

                console.log(`🔍 Detected cloudhub version: ${detectedVersion} for app: ${preselectedAppName}`);
                console.log(`🔍 Detection criteria: cloudhubVersion=${preselectedAppData.cloudhubVersion}, target=${!!preselectedAppData.target}, deploymentId=${preselectedAppData.deploymentId}`);

                appInfo = {
                    label: preselectedAppData.name || preselectedAppData.domain || preselectedAppName,
                    domain: preselectedAppData.domain || preselectedAppData.name || preselectedAppName,
                    cloudhubVersion: detectedVersion,
                    deploymentId: preselectedAppData.deploymentId || preselectedAppData.id || preselectedAppData.target?.id || preselectedAppData.targetId,
                    specificationId: preselectedAppData.specificationId,
                    status: preselectedAppData.status || preselectedAppData.application?.status || preselectedAppData.lastReportedStatus,
                    applicationStatus: preselectedAppData.application?.status || preselectedAppData.status || preselectedAppData.lastReportedStatus,
                    rawData: preselectedAppData
                };

                console.log(`🔍 Created appInfo:`, JSON.stringify(appInfo, null, 2));
            }
            console.log(`🎯 Using preselected app: ${preselectedAppName}`, appInfo);
        } else {
            if (allApplications.length === 0) {
                vscode.window.showErrorMessage(
                    `No applications found in environment "${environmentName}". ` +
                    `This could mean: (1) No apps deployed, (2) No permissions, or (3) Wrong environment selected.`
                );
                return;
            }

            // Select application
            const selectedApp = await vscode.window.showQuickPick(
                allApplications.map(app => app.label),
                {
                    placeHolder: 'Select an application',
                    title: 'Application Command Center - Select Application'
                }
            );

            if (!selectedApp) {
                return;
            }

            appInfo = allApplications.find(app => app.label === selectedApp);
            if (!appInfo) {
                return;
            }
        }

        // Show loading message
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Loading Command Center for ${appInfo.domain}...`,
            cancellable: false
        }, async (progress) => {
            let metricsRangeMinutes = METRIC_LOOKBACK_MINUTES;
            let activeTab = 'overview';
            progress.report({ increment: 0, message: 'Fetching application data...' });

            // Fetch comprehensive data
            const data = await fetchApplicationData(
                context,
                environmentId,
                environmentName,
                appInfo.domain,
                appInfo.cloudhubVersion,
                appInfo.deploymentId,
                metricsRangeMinutes,
                appInfo.rawData
            );

            // Add spec ID to data
            if (appInfo.specificationId) {
                data.specificationId = appInfo.specificationId;
            }

            progress.report({ increment: 100, message: 'Rendering dashboard...' });

            // Create webview panel
            const panel = vscode.window.createWebviewPanel(
                'applicationCommandCenter',
                `🎯 Command Center - ${appInfo.domain}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            const renderDashboard = (dashboardData: CommandCenterData) => {
                panel.webview.html = getCommandCenterHtml(panel.webview, context.extensionUri, {
                    ...dashboardData,
                    activeTab,
                    metricsRangeMinutes
                });
            };

            // Set webview content
            renderDashboard(data);

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'refresh':
                        const refreshedData = await fetchApplicationData(
                            context,
                            environmentId,
                            environmentName,
                            appInfo.domain,
                            appInfo.cloudhubVersion,
                            appInfo.deploymentId,
                            metricsRangeMinutes,
                            appInfo.rawData
                        );
                        if (appInfo.specificationId) {
                            refreshedData.specificationId = appInfo.specificationId;
                        }
                        renderDashboard(refreshedData);
                        vscode.window.showInformationMessage('Dashboard refreshed');
                        break;

                    case 'refreshMetrics':
                        if (typeof message.rangeMinutes === 'number') {
                            metricsRangeMinutes = message.rangeMinutes;
                        }
                        const metricsOnlyData = await fetchApplicationData(
                            context,
                            environmentId,
                            environmentName,
                            appInfo.domain,
                            appInfo.cloudhubVersion,
                            appInfo.deploymentId,
                            metricsRangeMinutes,
                            appInfo.rawData
                        );
                        if (appInfo.specificationId) {
                            metricsOnlyData.specificationId = appInfo.specificationId;
                        }
                        renderDashboard(metricsOnlyData);
                        break;

                    case 'updateMetricsRange':
                        if (typeof message.rangeMinutes === 'number' && message.rangeMinutes > 0) {
                            metricsRangeMinutes = message.rangeMinutes;
                        } else {
                            metricsRangeMinutes = METRIC_LOOKBACK_MINUTES;
                        }
                        const rangeUpdatedData = await fetchApplicationData(
                            context,
                            environmentId,
                            environmentName,
                            appInfo.domain,
                            appInfo.cloudhubVersion,
                            appInfo.deploymentId,
                            metricsRangeMinutes,
                            appInfo.rawData
                        );
                        if (appInfo.specificationId) {
                            rangeUpdatedData.specificationId = appInfo.specificationId;
                        }
                        renderDashboard(rangeUpdatedData);
                        break;

                    case 'tabChanged':
                        if (typeof message.tab === 'string') {
                            activeTab = message.tab;
                        }
                        break;

                    case 'restartApp':
                        await handleRestartApplication(context, baseUrl, appInfo, environmentId, organizationID);
                        vscode.window.showInformationMessage(`Restart initiated for ${appInfo.domain}`);
                        // Refresh data after action
                        setTimeout(async () => {
                            const updatedData = await fetchApplicationData(
                                context,
                                environmentId,
                                environmentName,
                                appInfo.domain,
                                appInfo.cloudhubVersion,
                                appInfo.deploymentId,
                                metricsRangeMinutes,
                                appInfo.rawData
                            );
                            renderDashboard(updatedData);
                        }, 2000);
                        break;

                    case 'stopApp':
                        await handleStopApplication(context, baseUrl, appInfo, environmentId, organizationID);
                        vscode.window.showInformationMessage(`Stop initiated for ${appInfo.domain}`);
                        setTimeout(async () => {
                            const updatedData = await fetchApplicationData(
                                context,
                                environmentId,
                                environmentName,
                                appInfo.domain,
                                appInfo.cloudhubVersion,
                                appInfo.deploymentId,
                                metricsRangeMinutes,
                                appInfo.rawData
                            );
                            renderDashboard(updatedData);
                        }, 2000);
                        break;

                    case 'startApp':
                        await handleStartApplication(context, baseUrl, appInfo, environmentId, organizationID);
                        vscode.window.showInformationMessage(`Start initiated for ${appInfo.domain}`);
                        setTimeout(async () => {
                            const updatedData = await fetchApplicationData(
                                context,
                                environmentId,
                                environmentName,
                                appInfo.domain,
                                appInfo.cloudhubVersion,
                                appInfo.deploymentId,
                                metricsRangeMinutes,
                                appInfo.rawData
                            );
                            renderDashboard(updatedData);
                        }, 2000);
                        break;

                    case 'openLogs':
                        // FIX: Pass all required parameters including environment context
                        await showRealTimeLogs(
                            context,
                            environmentId,
                            appInfo.domain,
                            appInfo.cloudhubVersion,
                            appInfo.deploymentId,
                            appInfo.specificationId
                        );
                        break;

                    case 'exportCSV':
                        await handleExportCSV(context, data);
                        break;

                    case 'compareEnvironments':
                        await handleCompareEnvironments(context, appInfo.domain, data.allEnvironments || []);
                        break;

				case 'generateDiagram':
					if (appInfo.cloudhubVersion !== 'CH2') {
						vscode.window.showInformationMessage('Application diagrams are only available for CloudHub 2.0 deployments.');
						break;
					}
					// Import and call the existing application diagram feature with pre-selected deployment
					const { showApplicationDiagram } = await import('./applicationDiagram.js');
					if (!appInfo.deploymentId) {
						vscode.window.showErrorMessage('No deployment information available for this application.');
						break;
					}
					await showApplicationDiagram(context, environmentId, appInfo.deploymentId);
					break;
			}
		});
	});

    } catch (error: any) {
        vscode.window.showErrorMessage(`Error opening Application Command Center: ${error.message}`);
    }
}

/**
 * Handle application restart
 */
async function handleRestartApplication(
    context: vscode.ExtensionContext,
    baseUrl: string,
    appInfo: any,
    environmentId: string,
    organizationID: string
) {
    const apiHelper = new ApiHelper(context);

    if (appInfo.cloudhubVersion === 'CH1') {
        await apiHelper.post(`${baseUrl}/cloudhub/api/applications/${appInfo.domain}/restart`, {}, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
    } else if (appInfo.cloudhubVersion === 'CH2') {
        await apiHelper.post(`${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments/${appInfo.deploymentId}/restart`);
    } else if (appInfo.cloudhubVersion === 'HYBRID') {
        const hybridId = resolveHybridAppIdentifier(appInfo);
        const params = new URLSearchParams();
        params.append('id', hybridId);
        await patchHybridApplication(apiHelper, hybridId, environmentId, organizationID, params, 'application/x-www-form-urlencoded');
    }
}

/**
 * Handle application stop
 */
async function handleStopApplication(
    context: vscode.ExtensionContext,
    baseUrl: string,
    appInfo: any,
    environmentId: string,
    organizationID: string
) {
    const apiHelper = new ApiHelper(context);

    if (appInfo.cloudhubVersion === 'CH1') {
        await apiHelper.post(`${baseUrl}/cloudhub/api/applications/${appInfo.domain}/status`,
            { status: 'STOPPED' },
            {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationID,
                },
            }
        );
    } else if (appInfo.cloudhubVersion === 'HYBRID') {
        const hybridId = resolveHybridAppIdentifier(appInfo);
        await patchHybridApplication(apiHelper, hybridId, environmentId, organizationID,
            { id: hybridId, desiredStatus: 'STOPPED' }, 'application/json');
    }
}

/**
 * Handle application start
 */
async function handleStartApplication(
    context: vscode.ExtensionContext,
    baseUrl: string,
    appInfo: any,
    environmentId: string,
    organizationID: string
) {
    const apiHelper = new ApiHelper(context);

    if (appInfo.cloudhubVersion === 'CH1') {
        await apiHelper.post(`${baseUrl}/cloudhub/api/applications/${appInfo.domain}/status`,
            { status: 'STARTED' },
            {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationID,
                },
            }
        );
    } else if (appInfo.cloudhubVersion === 'HYBRID') {
        const hybridId = resolveHybridAppIdentifier(appInfo);
        await patchHybridApplication(apiHelper, hybridId, environmentId, organizationID,
            { id: hybridId, desiredStatus: 'STARTED' }, 'application/json');
    }
}

async function patchHybridApplication(
    apiHelper: ApiHelper,
    hybridId: string,
    environmentId: string,
    organizationID: string,
    data: any,
    contentType: string
): Promise<void> {
    try {
        await apiHelper.patch(`${HYBRID_APPLICATIONS_ENDPOINT}/${hybridId}`, data, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
                'Content-Type': contentType
            },
        });
    } catch (error: any) {
        console.error('Hybrid action failed:', error?.response?.status, error?.response?.data || error.message);
        throw error;
    }
}

function resolveHybridAppIdentifier(appInfo: any): string {
    return appInfo.deploymentId || appInfo.rawData?.id || appInfo.domain;
}

/**
 * Handle CSV export
 */
async function handleExportCSV(context: vscode.ExtensionContext, data: CommandCenterData) {
    const app = data.application;
    const csv = [
        ['Application Command Center Export'],
        [''],
        ['Application Name', app?.domain || app?.name || 'Unknown'],
        ['Environment', data.environmentName],
        ['CloudHub Version', data.cloudhubVersion],
        ['Status', app?.status || 'Unknown'],
        ['Health Score', data.healthScore.toString()],
        ['Runtime Version', app?.muleVersion || app?.currentRuntimeVersion || 'N/A'],
        [''],
        ['Configuration'],
        ...(data.cloudhubVersion === 'CH1' ? [
            ['Workers', app?.workers?.toString() || 'N/A'],
            ['Worker Type', app?.workerType?.name || app?.workerType || 'N/A'],
            ['Region', app?.region || 'N/A']
        ] : [
            ['Replicas', app?.replicas?.toString() || 'N/A'],
            ['CPU Reserved', app?.cpuReserved || 'N/A'],
            ['Memory Reserved', app?.memoryReserved || 'N/A']
        ]),
        // AI Insights - Disabled for future release
        // [''],
        // ['AI Insights'],
        // ...(data.aiInsights || []).map(insight => [insight])
    ].map(row => row.join(',')).join('\n');

    const fileName = `${app?.domain || app?.name}_command_center_${Date.now()}.csv`;

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { 'CSV Files': ['csv'] }
    });

    if (saveUri) {
        const fs = require('fs');
        fs.writeFileSync(saveUri.fsPath, csv);
        vscode.window.showInformationMessage(`Report exported to ${saveUri.fsPath}`);
    }
}

/**
 * Handle environment comparison
 */
async function handleCompareEnvironments(
    context: vscode.ExtensionContext,
    applicationName: string,
    environments: any[]
) {
    if (environments.length === 0) {
        vscode.window.showInformationMessage('No environments available for comparison');
        return;
    }

    // Use the existing environment comparison command
    vscode.commands.executeCommand('anypoint-monitor.environmentComparison');
}

/**
 * Generate the unified tabbed HTML for the Application Management Center
 * Rivian-inspired instrument-panel design: monochromatic, thin-stroke, theme-aware
 */
function getCommandCenterHtml(webview: vscode.Webview, extensionUri: vscode.Uri, data: CommandCenterData): string {
	const app = data.application;
	const hybridArtifact = data.cloudhubVersion === 'HYBRID' ? (app?.artifact || app?.serverArtifacts?.[0]?.artifact) : undefined;
	const hybridServer = data.cloudhubVersion === 'HYBRID' ? (data.replicas?.[0] || app?.target) : undefined;
	const hybridServerArtifact = data.cloudhubVersion === 'HYBRID' ? app?.serverArtifacts?.[0] : undefined;
	const hybridServerAddresses = Array.isArray(hybridServer?.addresses)
	    ? hybridServer.addresses.map((addr: any) => addr?.ip || addr?.address || '').filter(Boolean).join(', ')
	    : undefined;
	const hybridServerOs = hybridServer?.runtimeInformation?.osInformation;
	const hybridJvmInfo = hybridServer?.runtimeInformation?.jvmInformation;
	const healthClass = data.healthScore >= 80 ? 'cc-ok' : data.healthScore >= 60 ? 'cc-warn' : 'cc-err';
	const activeTab = data.activeTab || 'overview';
	const selectedRange = data.metricsRangeMinutes || data.visualizerMetrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES;
	const supportsApplicationDiagram = (data.cloudhubVersion || '').toUpperCase() === 'CH2';

    const actualStatus = getActualStatus(app, data.replicas, data.cloudhubVersion);
    const statusClass = (actualStatus === 'RUNNING' || actualStatus.includes('RUNNING')) ? 'cc-dot-ok' :
                       (actualStatus === 'STARTING') ? 'cc-dot-warn' : 'cc-dot-err';

	let uptimeText = 'Unknown';
	if (data.cloudhubVersion === 'CH1') {
		const uptimeMs = app?.updateDate ? Date.now() - app.updateDate : app?.lastUpdateTime ? Date.now() - app.lastUpdateTime : 0;
		if (uptimeMs > 0) {
			const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
			const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
			const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
			uptimeText = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
		}
	} else if (data.cloudhubVersion === 'CH2') {
		if (app?.creationDate) {
			const deployMs = Date.now() - new Date(app.creationDate).getTime();
			const deployDays = Math.floor(deployMs / (1000 * 60 * 60 * 24));
			const deployHours = Math.floor((deployMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
			uptimeText = `${deployDays}d ${deployHours}h`;
		}
	} else {
		const uptimeMs = typeof app?.uptime === 'number' ? app.uptime : undefined;
		if (uptimeMs && uptimeMs > 0) {
			const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
			const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
			const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
			uptimeText = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
		}
	}

	const runtimeVersion = data.cloudhubVersion === 'HYBRID'
	    ? (hybridServer?.muleVersion || hybridServer?.gatewayVersion || app?.artifact?.muleVersion || 'Unknown')
	    : (app?.muleVersion || app?.currentRuntimeVersion || app?.target?.deploymentSettings?.runtimeVersion || 'Unknown');

	const region = data.cloudhubVersion === 'HYBRID'
	    ? (hybridServer?.name ? `${hybridServer.name}${hybridServer?.type ? ` (${hybridServer.type})` : ''}` : 'Hybrid Runtime')
	    : (app?.region || app?.target?.deploymentSettings?.region || app?.target?.provider || 'Unknown');

    const cpuData = data.performanceMetrics?.cpu?.slice(-24) || Array.from({ length: 24 }, () => Math.random() * 80 + 10);
    const memoryData = data.performanceMetrics?.memory?.slice(-24) || Array.from({ length: 24 }, () => Math.random() * 70 + 20);

	const cpuMetricLabel = data.performanceMetrics?.cpuLabel || (data.cloudhubVersion === 'HYBRID' ? 'Msg Count' : 'CPU');
	const memoryMetricLabel = data.performanceMetrics?.memoryLabel || (data.cloudhubVersion === 'HYBRID' ? 'Resp Time' : 'Memory');

    const currentCpu = cpuData[cpuData.length - 1].toFixed(1);
    const currentMemory = memoryData[memoryData.length - 1].toFixed(1);

    const healthRingRadius = 52;
    const healthRingCircumference = 2 * Math.PI * healthRingRadius;
    const healthRingOffset = healthRingCircumference - (healthRingCircumference * data.healthScore / 100);

    const boolIcon = (val: boolean | undefined) => val
        ? `<span class="cc-dot cc-dot-ok" style="width:8px;height:8px"></span> On`
        : `<span class="cc-dot cc-dot-off" style="width:8px;height:8px"></span> Off`;

    const kvRow = (label: string, value: string) =>
        `<div class="cc-kv"><span class="cc-kv-label">${label}</span><span class="cc-kv-value">${value}</span></div>`;

    const ccExtraStyles = `
        body { padding: 36px 40px; overflow-x: hidden; }

        .cc-container { max-width: 1200px; margin: 0 auto; animation: cc-fadeIn 0.4s ease-out; }
        @keyframes cc-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes cc-ring { from { stroke-dashoffset: ${healthRingCircumference}; } }

        /* ── Header ──────────────────────────────────────────────────── */
        .cc-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 32px;
        }
        .cc-app-name {
            font-size: 26px;
            font-weight: 300;
            letter-spacing: -0.5px;
            color: var(--am-text-primary);
            margin-bottom: 8px;
        }
        .cc-meta {
            display: flex;
            gap: 8px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--am-text-muted);
        }
        .cc-meta span::after { content: '\\00b7'; margin-left: 6px; }
        .cc-meta span:last-child::after { content: ''; margin: 0; }
        .cc-refresh-btn {
            background: none;
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
            color: var(--am-text-secondary);
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            transition: border-color 0.2s, color 0.2s;
        }
        .cc-refresh-btn:hover { border-color: var(--am-info); color: var(--am-text-primary); }
        .cc-refresh-btn.spinning svg { animation: cc-spin 0.8s linear infinite; }

        /* ── Tabs ────────────────────────────────────────────────────── */
        .cc-tabs {
            display: flex;
            gap: 2px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 3px;
            margin-bottom: 12px;
            overflow-x: auto;
        }
        .cc-tab {
            background: transparent;
            border: none;
            color: var(--am-text-muted);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            padding: 9px 20px;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s ease;
            font-family: inherit;
        }
        .cc-tab:hover { color: var(--am-text-primary); background: var(--am-bg-surface-hover); }
        .cc-tab.active { color: var(--am-text-primary); background: var(--am-bg-secondary); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        /* ── Toolbar ─────────────────────────────────────────────────── */
        .cc-toolbar {
            display: flex;
            gap: 6px;
            padding: 8px 0;
            margin-bottom: 32px;
            border-bottom: 1px solid var(--am-border);
        }
        .cc-toolbar-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: var(--am-radius-sm);
            color: var(--am-text-muted);
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            transition: all 0.15s;
            position: relative;
        }
        .cc-toolbar-btn:hover { color: var(--am-text-primary); border-color: var(--am-border); background: var(--am-bg-surface); }
        .cc-toolbar-btn svg { width: 15px; height: 15px; }
        .cc-toolbar-btn[title]:hover::after {
            content: attr(title);
            position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
            padding: 4px 8px; font-size: 10px; white-space: nowrap;
            background: var(--am-bg-secondary); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm); color: var(--am-text-primary);
            margin-top: 4px; z-index: 10;
        }
        .cc-toolbar-sep { width: 1px; background: var(--am-border); margin: 4px 10px; }

        /* ── Health Ring ─────────────────────────────────────────────── */
        .cc-hero { display: flex; align-items: center; gap: 48px; margin-bottom: 40px; }
        .cc-ring-wrap { position: relative; width: 130px; height: 130px; flex-shrink: 0; }
        .cc-ring-bg { fill: none; stroke: var(--am-border); stroke-width: 3; opacity: 0.4; }
        .cc-ring-fg { fill: none; stroke-width: 3; stroke-linecap: round;
            stroke-dasharray: ${healthRingCircumference};
            stroke-dashoffset: ${healthRingOffset};
            animation: cc-ring 1.5s ease-out;
            transform: rotate(-90deg); transform-origin: center;
        }
        .cc-ring-fg.cc-ok { stroke: var(--am-success); }
        .cc-ring-fg.cc-warn { stroke: var(--am-warning); }
        .cc-ring-fg.cc-err { stroke: var(--am-error); }
        .cc-ring-score {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            font-size: 36px; font-weight: 300; color: var(--am-text-primary);
        }

        /* ── Stat Strip ──────────────────────────────────────────────── */
        .cc-stats { display: flex; flex-wrap: wrap; gap: 36px; flex: 1; }
        .cc-stat {}
        .cc-stat-label {
            font-size: 10px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.8px; color: var(--am-text-muted); margin-bottom: 4px;
        }
        .cc-stat-value {
            font-size: 17px; font-weight: 500; color: var(--am-text-primary);
            display: flex; align-items: center; gap: 6px;
        }

        /* ── Dot indicators ──────────────────────────────────────────── */
        .cc-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .cc-dot-ok { background: var(--am-success); }
        .cc-dot-warn { background: var(--am-warning); }
        .cc-dot-err { background: var(--am-error); }
        .cc-dot-off { background: var(--am-text-muted); opacity: 0.4; }
        .cc-muted { color: var(--am-text-muted); }

        /* ── Key-Value Grid ──────────────────────────────────────────── */
        .cc-kv-section { margin-bottom: 36px; }
        .cc-kv-title {
            font-size: 10px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.8px; color: var(--am-text-muted);
            margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--am-border);
        }
        .cc-kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 40px; }
        .cc-kv {
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--am-border) 40%, transparent);
        }
        .cc-kv-label { font-size: 12px; color: var(--am-text-muted); }
        .cc-kv-value { font-size: 12px; font-weight: 500; color: var(--am-text-primary); text-align: right; word-break: break-all; max-width: 60%; }

        /* ── Health Breakdown (collapsible) ───────────────────────────── */
        .cc-breakdown { margin-top: 28px; }
        .cc-breakdown-toggle {
            background: none; border: none; color: var(--am-text-muted); cursor: pointer;
            font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px;
            display: flex; align-items: center; gap: 6px; padding: 4px 0;
            font-family: inherit;
        }
        .cc-breakdown-toggle:hover { color: var(--am-text-primary); }
        .cc-breakdown-toggle svg { transition: transform 0.2s; }
        .cc-breakdown-toggle.open svg { transform: rotate(90deg); }
        .cc-breakdown-list { display: none; padding-top: 8px; }
        .cc-breakdown-list.open { display: block; }
        .cc-breakdown-item {
            padding: 6px 0; font-size: 12px; color: var(--am-text-secondary);
            display: flex; align-items: center; gap: 8px;
        }

        /* ── Metrics Tab ─────────────────────────────────────────────── */
        .cc-metrics-controls { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
        .cc-seg-group { display: flex; gap: 2px; background: var(--am-bg-surface); border: 1px solid var(--am-border); border-radius: var(--am-radius-md); padding: 2px; }
        .cc-seg-btn {
            background: transparent; border: none; color: var(--am-text-muted);
            font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 6px;
            cursor: pointer; transition: all 0.15s; font-family: inherit;
        }
        .cc-seg-btn:hover { color: var(--am-text-primary); }
        .cc-seg-btn.cc-seg-active { background: var(--am-bg-secondary); color: var(--am-text-primary); }
        .cc-seg-btn:disabled { opacity: 0.3; cursor: default; }
        .cc-metrics-banner {
            display: flex; align-items: center; gap: 8px; font-size: 11px;
            color: var(--am-text-muted); padding: 10px 0; margin-bottom: 20px;
            border-bottom: 1px solid var(--am-border);
        }
        .cc-metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; }
        .cc-chart-card {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 20px;
        }
        .cc-chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
        .cc-chart-label { font-size: 13px; font-weight: 600; color: var(--am-text-primary); }
        .cc-chart-sub { font-size: 11px; color: var(--am-text-muted); margin-top: 2px; }
        .cc-chart-value { font-size: 24px; font-weight: 300; color: var(--am-text-primary); white-space: nowrap; }
        .cc-chart-unit { font-size: 12px; color: var(--am-text-muted); margin-left: 2px; }
        .cc-chart-svg { width: 100%; height: 80px; display: block; margin-top: 8px; }
        .cc-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--am-text-muted); margin-top: 12px; }
        .cc-legend-item { display: flex; align-items: center; gap: 4px; }
        .cc-legend-dot { width: 8px; height: 8px; border-radius: 50%; }
        .cc-legend-val { color: var(--am-text-primary); font-weight: 500; }

        /* ── Scheduler rows ──────────────────────────────────────────── */
        .cc-sched-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 14px 0; border-bottom: 1px solid color-mix(in srgb, var(--am-border) 40%, transparent);
        }
        .cc-sched-row:last-child { border-bottom: none; }
        .cc-sched-name { font-size: 13px; font-weight: 500; color: var(--am-text-primary); }
        .cc-sched-meta { font-size: 11px; color: var(--am-text-muted); }
        .cc-sched-right { text-align: right; }

        /* ── Configuration ───────────────────────────────────────────── */
        .cc-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 48px; }
        @media (max-width: 600px) { .cc-config-grid { grid-template-columns: 1fr; } }

        /* ── Empty state ─────────────────────────────────────────────── */
        .cc-empty {
            padding: 48px; text-align: center; color: var(--am-text-muted); font-size: 13px;
        }

        /* ── Logs CTA ────────────────────────────────────────────────── */
        .cc-cta { text-align: center; padding: 64px 20px; }
        .cc-cta-title { font-size: 17px; font-weight: 500; color: var(--am-text-primary); margin-bottom: 10px; }
        .cc-cta-desc { font-size: 13px; color: var(--am-text-muted); margin-bottom: 24px; }
        .cc-cta-btn {
            display: inline-flex; align-items: center; gap: 8px;
            background: var(--am-btn-bg); color: var(--am-btn-fg);
            border: none; border-radius: var(--am-radius-md);
            padding: 10px 20px; font-size: 13px; font-weight: 600;
            cursor: pointer; transition: background 0.2s;
            font-family: inherit;
        }
        .cc-cta-btn:hover { background: var(--am-btn-hover); }

        /* ── Network rows ────────────────────────────────────────────── */
        .cc-net-section { margin-bottom: 24px; }
        .cc-net-row {
            padding: 8px 0; font-size: 12px; color: var(--am-text-primary);
            border-bottom: 1px solid color-mix(in srgb, var(--am-border) 30%, transparent);
        }
        .cc-net-row:last-child { border-bottom: none; }

        /* ── Confirmation Dialog ──────────────────────────────────────── */
        .cc-overlay {
            position: fixed; inset: 0;
            background: color-mix(in srgb, var(--am-bg-primary) 80%, transparent);
            backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center; z-index: 9999;
        }
        .cc-dialog {
            background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md); padding: 28px; min-width: 340px; max-width: 420px;
        }
        .cc-dialog h3 { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
        .cc-dialog p { font-size: 13px; color: var(--am-text-secondary); margin-bottom: 24px; line-height: 1.6; }
        .cc-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .cc-dialog-btn {
            padding: 7px 16px; border-radius: var(--am-radius-sm);
            border: 1px solid var(--am-border); background: var(--am-bg-surface);
            color: var(--am-text-primary); cursor: pointer; font-size: 12px; font-weight: 600;
            font-family: inherit;
        }
        .cc-dialog-btn:hover { background: var(--am-bg-surface-hover); }
        .cc-dialog-btn-primary { background: var(--am-btn-bg); color: var(--am-btn-fg); border-color: var(--am-btn-bg); }
        .cc-dialog-btn-primary:hover { background: var(--am-btn-hover); }

        /* ── Hybrid info panel ───────────────────────────────────────── */
        .cc-info-panel {
            background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md); padding: 28px; margin: 28px 0;
        }
        .cc-info-panel code {
            background: var(--am-bg-secondary); padding: 1px 5px;
            border-radius: var(--am-radius-sm); font-size: 12px;
        }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 600px) {
            .cc-hero { flex-direction: column; align-items: center; text-align: center; }
            .cc-stats { justify-content: center; }
            .cc-metrics-grid { grid-template-columns: 1fr; }
            .cc-kv-grid { grid-template-columns: 1fr; }
        }

        /* ── Spinning for refresh ────────────────────────────────────── */
        .spinning svg { animation: cc-spin 0.8s linear infinite; }
    `;

    const ccBody = `
    <div class="cc-container">

        <!-- Header -->
        <div class="cc-header">
            <div>
                <div class="cc-app-name">${app?.domain || app?.name || 'Unknown Application'}</div>
                <div class="cc-meta">
                    <span>${data.cloudhubVersion}</span>
                    <span>${data.environmentName}</span>
                    <span>${data.accountInfo.organizationName}</span>
                </div>
            </div>
            <button class="cc-refresh-btn" onclick="refreshData()" title="Refresh">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 23 10"/></svg>
            </button>
        </div>

        <!-- Tabs -->
        <div class="cc-tabs">
            <button class="cc-tab ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview" onclick="switchTab('overview')">Overview</button>
            <button class="cc-tab ${activeTab === 'metrics' ? 'active' : ''}" data-tab="metrics" onclick="switchTab('metrics')">Metrics</button>
            <button class="cc-tab ${activeTab === 'schedulers' ? 'active' : ''}" data-tab="schedulers" onclick="switchTab('schedulers')">Schedulers</button>
            <button class="cc-tab ${activeTab === 'configuration' ? 'active' : ''}" data-tab="configuration" onclick="switchTab('configuration')">Config</button>
            <button class="cc-tab ${activeTab === 'logs' ? 'active' : ''}" data-tab="logs" onclick="switchTab('logs')">Logs</button>
            <button class="cc-tab ${activeTab === 'network' ? 'active' : ''}" data-tab="network" onclick="switchTab('network')">Network</button>
        </div>

        <!-- Toolbar -->
        <div class="cc-toolbar">
            <button class="cc-toolbar-btn" onclick="restartApp()" title="Restart">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 23 10"/></svg>
            </button>
            <button class="cc-toolbar-btn" onclick="stopApp()" title="Stop">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"/></svg>
            </button>
            <button class="cc-toolbar-btn" onclick="startApp()" title="Start">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            ${data.cloudhubVersion !== 'HYBRID' ? `
            <button class="cc-toolbar-btn" onclick="openLogs()" title="View Logs">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </button>
            ` : ''}
            <div class="cc-toolbar-sep"></div>
            <button class="cc-toolbar-btn" onclick="exportCSV()" title="Export Report">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="cc-toolbar-btn" onclick="compareEnvironments()" title="Compare Environments">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></svg>
            </button>
            ${supportsApplicationDiagram ? `
            <button class="cc-toolbar-btn" onclick="generateDiagram()" title="Generate Diagram">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="10.59" y1="7.51" x2="6.5" y2="16.5"/><line x1="13.41" y1="7.51" x2="17.5" y2="16.5"/></svg>
            </button>
            ` : ''}
        </div>

        <!-- Tab: Overview -->
        <div id="tab-overview" class="tab-content ${activeTab === 'overview' ? 'active' : ''}">

            <!-- Health ring + stat strip -->
            <div class="cc-hero">
                <div class="cc-ring-wrap">
                    <svg viewBox="0 0 120 120" width="130" height="130">
                        <circle class="cc-ring-bg" cx="60" cy="60" r="${healthRingRadius}"/>
                        <circle class="cc-ring-fg ${healthClass}" cx="60" cy="60" r="${healthRingRadius}"/>
                    </svg>
                    <div class="cc-ring-score">${data.healthScore}</div>
                </div>
                <div class="cc-stats">
                    <div class="cc-stat">
                        <div class="cc-stat-label">STATUS</div>
                        <div class="cc-stat-value"><span class="cc-dot ${statusClass}"></span> ${actualStatus}</div>
                    </div>
                    <div class="cc-stat">
                        <div class="cc-stat-label">UPTIME</div>
                        <div class="cc-stat-value">${uptimeText}</div>
                    </div>
                    <div class="cc-stat">
                        <div class="cc-stat-label">RUNTIME</div>
                        <div class="cc-stat-value">${runtimeVersion}</div>
                    </div>
                    <div class="cc-stat">
                        <div class="cc-stat-label">REGION</div>
                        <div class="cc-stat-value">${region}</div>
                    </div>
                    <div class="cc-stat">
                        <div class="cc-stat-label">${cpuMetricLabel}</div>
                        <div class="cc-stat-value">${currentCpu}</div>
                    </div>
                    <div class="cc-stat">
                        <div class="cc-stat-label">${memoryMetricLabel}</div>
                        <div class="cc-stat-value">${currentMemory}</div>
                    </div>
                </div>
            </div>

            <!-- Application Details -->
            <div class="cc-kv-section">
                <div class="cc-kv-title">Application Details</div>
                <div class="cc-kv-grid">
                    ${kvRow('Domain', app?.domain || app?.name || 'N/A')}
                    ${app?.fullDomain ? kvRow('Full Domain', app.fullDomain) : ''}
                    ${app?.target?.deploymentSettings?.http?.inbound?.publicUrl ? kvRow('Public URL', app.target.deploymentSettings.http.inbound.publicUrl) : ''}
                    ${app?.filename ? kvRow('Artifact', app.filename) : ''}
                    ${app?.application?.ref ? `
                        ${kvRow('Group ID', app.application.ref.groupId)}
                        ${kvRow('Artifact ID', app.application.ref.artifactId)}
                        ${kvRow('Version', app.application.ref.version)}
                    ` : ''}
                    ${app?.lastUpdateTime || app?.lastModifiedDate ? kvRow('Last Updated', new Date(app.lastUpdateTime || app.lastModifiedDate).toLocaleString()) : ''}
                    ${data.cloudhubVersion === 'HYBRID' ? `
                        ${kvRow('Deployment ID', app?.id || 'N/A')}
                        ${kvRow('Server ID', hybridServer?.id || 'N/A')}
                    ` : ''}
                </div>
            </div>

            ${data.cloudhubVersion === 'HYBRID' ? `
            <!-- Hybrid Artifact -->
            <div class="cc-kv-section">
                <div class="cc-kv-title">Hybrid Artifact</div>
                <div class="cc-kv-grid">
                    ${kvRow('Artifact Name', hybridArtifact?.name || app?.name || 'N/A')}
                    ${kvRow('File Name', hybridArtifact?.fileName || 'N/A')}
                    ${kvRow('File Size', formatBytes(hybridArtifact?.fileSize))}
                    ${kvRow('Checksum', hybridArtifact?.fileChecksum || 'N/A')}
                    ${kvRow('Storage ID', hybridArtifact?.storageId || 'N/A')}
                    ${kvRow('Artifact Status', hybridServerArtifact?.lastReportedStatus || 'N/A')}
                    ${kvRow('Desired Status', hybridServerArtifact?.desiredStatus || app?.desiredStatus || 'N/A')}
                    ${kvRow('Last Updated', formatDateTime(hybridServerArtifact?.timeUpdated || hybridArtifact?.timeUpdated))}
                </div>
            </div>

            <!-- Runtime Server -->
            <div class="cc-kv-section">
                <div class="cc-kv-title">Runtime Server</div>
                <div class="cc-kv-grid">
                    ${kvRow('Server Name', hybridServer?.name || 'N/A')}
                    ${kvRow('Server Type', hybridServer?.serverType || hybridServer?.type || 'N/A')}
                    ${kvRow('Status', hybridServer?.status || 'N/A')}
                    ${kvRow('Mule Version', hybridServer?.muleVersion || 'N/A')}
                    ${kvRow('Agent Version', hybridServer?.agentVersion || 'N/A')}
                    ${kvRow('License Expires', formatDateTime(hybridServer?.licenseExpirationDate))}
                    ${kvRow('Certificate Expires', formatDateTime(hybridServer?.certificateExpirationDate))}
                    ${kvRow('IP Address', hybridServerAddresses || 'N/A')}
                    ${kvRow('Operating System', hybridServerOs ? `${hybridServerOs.name || 'OS'} ${hybridServerOs.version || ''}` : 'N/A')}
                    ${kvRow('Architecture', hybridServerOs?.architecture || 'N/A')}
                    ${kvRow('JVM', hybridJvmInfo?.runtime?.name ? `${hybridJvmInfo.runtime.name} ${hybridJvmInfo.runtime.version || ''}` : 'N/A')}
                </div>
            </div>
            ` : ''}

            <!-- Health Breakdown -->
            ${data.healthBreakdown && data.healthBreakdown.length > 0 ? `
            <div class="cc-breakdown">
                <button class="cc-breakdown-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    Health Score Breakdown
                </button>
                <div class="cc-breakdown-list">
                    ${data.healthBreakdown.map((item: string) => {
                        const stripped = item.replace(/^[\u2705\u274C\u26A0\uFE0F\s]+/, '');
                        const isPass = item.startsWith('\u2705');
                        const dotClass = isPass ? 'cc-dot-ok' : item.startsWith('\u274C') ? 'cc-dot-err' : 'cc-dot-warn';
                        return `<div class="cc-breakdown-item"><span class="cc-dot ${dotClass}"></span>${stripped}</div>`;
                    }).join('')}
                </div>
            </div>
            ` : ''}
        </div>

		${renderMetricsTab(data.visualizerMetrics, {
			active: activeTab === 'metrics',
			selectedRange,
			performanceMetrics: data.performanceMetrics,
			cloudhubVersion: data.cloudhubVersion
		})}

        <!-- Tab: Schedulers -->
        <div id="tab-schedulers" class="tab-content ${activeTab === 'schedulers' ? 'active' : ''}">
            ${data.schedulers && data.schedulers.length > 0 ? data.schedulers.map((scheduler: any) => `
                <div class="cc-sched-row">
                    <div>
                        <div class="cc-sched-name">${scheduler.name || scheduler.flow || scheduler.flowName || 'Unknown Scheduler'}</div>
                        <div class="cc-sched-meta">${scheduler.type || scheduler.schedulerType || 'Scheduler'} \u00b7 ${formatSchedulerDescription(scheduler)}</div>
                    </div>
                    <div class="cc-sched-right">
                        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
                            <span class="cc-dot ${isSchedulerEnabled(scheduler) ? 'cc-dot-ok' : 'cc-dot-off'}"></span>
                            <span style="font-size:11px;color:var(--am-text-muted)">${isSchedulerEnabled(scheduler) ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <div class="cc-sched-meta">${formatSchedulerLastRun(scheduler)}</div>
                    </div>
                </div>
            `).join('') : `
                <div class="cc-empty">
                    ${data.cloudhubVersion === 'HYBRID'
                        ? `Schedulers were not returned by the Hybrid API. Confirm the application uses Quartz schedulers on the target runtime.`
                        : 'No schedulers configured for this application.'}
                </div>
            `}
        </div>

        <!-- Tab: Configuration -->
        <div id="tab-configuration" class="tab-content ${activeTab === 'configuration' ? 'active' : ''}">
            ${data.cloudhubVersion === 'CH1' ? `
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Compute Resources</div>
                    <div class="cc-kv-grid">
                        ${kvRow('Workers', String(app?.workers || 1))}
                        ${kvRow('Worker Type', app?.workerType?.name || app?.workerType || 'Micro')}
                        ${kvRow('vCores', String(app?.workerType?.weight || 'N/A'))}
                        ${kvRow('Region', app?.region || 'Unknown')}
                    </div>
                </div>
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Features</div>
                    <div class="cc-kv-grid">
                        ${kvRow('Persistent Queues', boolIcon(app?.persistentQueues))}
                        ${kvRow('Encrypted Persistent Queues', boolIcon(app?.encryptedPersistentQueues))}
                        ${kvRow('Static IPs', boolIcon(app?.staticIPsEnabled))}
                        ${kvRow('Monitoring Auto-Restart', boolIcon(app?.monitoringAutoRestart))}
                        ${kvRow('Object Store V2', boolIcon(app?.objectStoreV2Enabled))}
                        ${kvRow('Logging NG', boolIcon(app?.loggingNgEnabled))}
                        ${kvRow('Custom Log4J', boolIcon(app?.loggingCustomLog4JEnabled))}
                        ${app?.secureDataGateway ? kvRow('Secure Data Gateway', boolIcon(app.secureDataGateway.connected)) : ''}
                    </div>
                </div>
            ` : `
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Compute Resources</div>
                    <div class="cc-kv-grid">
                        ${kvRow('Replicas', String(app?.target?.replicas || app?.target?.deploymentSettings?.replicas || 1))}
                        ${kvRow('vCores', String(app?.application?.vCores || 'N/A'))}
                        ${kvRow('CPU Reserved', app?.target?.deploymentSettings?.resources?.cpu?.reserved || 'N/A')}
                        ${kvRow('CPU Limit', app?.target?.deploymentSettings?.resources?.cpu?.limit || 'N/A')}
                        ${kvRow('Memory Reserved', app?.target?.deploymentSettings?.resources?.memory?.reserved || 'N/A')}
                        ${kvRow('Memory Limit', app?.target?.deploymentSettings?.resources?.memory?.limit || 'N/A')}
                        ${kvRow('Target', app?.target?.targetId || app?.target?.provider || 'N/A')}
                    </div>
                </div>
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Deployment Settings</div>
                    <div class="cc-kv-grid">
                        ${kvRow('Clustered', boolIcon(app?.target?.deploymentSettings?.clustered))}
                        ${kvRow('Enforce Replicas Across Nodes', boolIcon(app?.target?.deploymentSettings?.enforceDeployingReplicasAcrossNodes))}
                        ${kvRow('Update Strategy', app?.target?.deploymentSettings?.updateStrategy || 'rolling')}
                        ${kvRow('Runtime Release Channel', app?.target?.deploymentSettings?.runtimeReleaseChannel || app?.target?.deploymentSettings?.runtime?.releaseChannel || 'N/A')}
                        ${kvRow('Java Version', app?.target?.deploymentSettings?.runtime?.java || 'N/A')}
                    </div>
                </div>
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Features</div>
                    <div class="cc-kv-grid">
                        ${kvRow('Persistent Object Store', boolIcon(app?.target?.deploymentSettings?.persistentObjectStore))}
                        ${kvRow('Monitoring Scope', app?.target?.deploymentSettings?.anypointMonitoringScope || 'N/A')}
                        ${kvRow('Disable AM Log Forwarding', boolIcon(app?.target?.deploymentSettings?.disableAmLogForwarding))}
                        ${kvRow('Last Mile Security', boolIcon(app?.target?.deploymentSettings?.http?.inbound?.lastMileSecurity))}
                        ${kvRow('Forward SSL Session', boolIcon(app?.target?.deploymentSettings?.http?.inbound?.forwardSslSession))}
                    </div>
                </div>
                ${app?.target?.deploymentSettings?.sidecars ? `
                <div class="cc-kv-section">
                    <div class="cc-kv-title">Sidecars</div>
                    <div class="cc-kv-grid">
                        ${Object.keys(app.target.deploymentSettings.sidecars).map(sidecarName => {
                            const sidecar = app.target.deploymentSettings.sidecars[sidecarName];
                            const res = sidecar.resources;
                            return kvRow(sidecarName, res ? `CPU ${res.cpu?.reserved || '0m'}-${res.cpu?.limit || 'N/A'} / Mem ${res.memory?.reserved || '0Mi'}-${res.memory?.limit || 'N/A'}` : 'N/A');
                        }).join('')}
                    </div>
                </div>
                ` : ''}
            `}
        </div>

        <!-- Tab: Logs -->
        <div id="tab-logs" class="tab-content ${activeTab === 'logs' ? 'active' : ''}">
            ${data.cloudhubVersion === 'HYBRID' ? `
            <div class="cc-cta">
                <div class="cc-cta-title">Hybrid Application Logs</div>
                <div class="cc-cta-desc">Real-time log streaming is not available for Hybrid deployments via the API. Access logs directly on the Mule Runtime server.</div>
                <div class="cc-info-panel" style="text-align:left;max-width:480px;margin:0 auto">
                    <div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--am-text-primary)">Log File Locations</div>
                    <div style="font-size:12px;color:var(--am-text-secondary);line-height:1.8">
                        <div><strong style="color:var(--am-info)">Linux/Mac:</strong> <code>$MULE_HOME/logs/</code></div>
                        <div><strong style="color:var(--am-info)">Windows:</strong> <code>%MULE_HOME%\\logs\\</code></div>
                    </div>
                    <div style="margin-top:12px;font-size:11px;color:var(--am-text-muted)">
                        Use <code>tail -f</code> on Linux/Mac or <code>Get-Content -Wait</code> on Windows to stream logs in real-time.
                    </div>
                </div>
            </div>
            ` : `
            <div class="cc-cta">
                <div class="cc-cta-title">Real-time Logs Viewer</div>
                <div class="cc-cta-desc">View, search, filter, and export application logs in real-time.</div>
                <button class="cc-cta-btn" onclick="openLogs()">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Open Logs Viewer
                </button>
            </div>
            `}
        </div>

        <!-- Tab: Network -->
        <div id="tab-network" class="tab-content ${activeTab === 'network' ? 'active' : ''}">
            ${data.networkTopology && (
                (data.networkTopology.vpnConnections && data.networkTopology.vpnConnections.length > 0) ||
                (data.networkTopology.externalEndpoints && data.networkTopology.externalEndpoints.length > 0) ||
                (data.networkTopology.dependencies && data.networkTopology.dependencies.length > 0)
            ) ? `
                ${data.networkTopology.vpnConnections && data.networkTopology.vpnConnections.length > 0 ? `
                <div class="cc-net-section">
                    <div class="cc-kv-title">VPN Connections</div>
                    ${data.networkTopology.vpnConnections.map((vpn: string) => `<div class="cc-net-row">${vpn}</div>`).join('')}
                </div>
                ` : ''}
                ${data.networkTopology.externalEndpoints && data.networkTopology.externalEndpoints.length > 0 ? `
                <div class="cc-net-section">
                    <div class="cc-kv-title">External Endpoints</div>
                    ${data.networkTopology.externalEndpoints.map((ep: string) => `<div class="cc-net-row">${ep}</div>`).join('')}
                </div>
                ` : ''}
                ${data.networkTopology.dependencies && data.networkTopology.dependencies.length > 0 ? `
                <div class="cc-net-section">
                    <div class="cc-kv-title">Services &amp; Integrations</div>
                    ${data.networkTopology.dependencies.map((dep: string) => `<div class="cc-net-row">${dep}</div>`).join('')}
                </div>
                ` : ''}
            ` : `
            <div class="cc-empty">No network dependencies detected for this application.</div>
            `}
        </div>

    </div>`;

    const ccScripts = `
        const vscode = acquireVsCodeApi();

        function refreshData() {
            const btn = document.querySelector('.cc-refresh-btn');
            if (btn) btn.classList.add('spinning');
            vscode.postMessage({ command: 'refresh' });
            setTimeout(() => { if (btn) btn.classList.remove('spinning'); }, 2000);
        }

        function selectMetricsRange(minutes) {
            document.querySelectorAll('.cc-seg-btn').forEach(b => b.classList.remove('cc-seg-active'));
            const active = document.querySelector('.cc-seg-btn[data-range="' + minutes + '"]');
            if (active) active.classList.add('cc-seg-active');
            vscode.postMessage({ command: 'updateMetricsRange', rangeMinutes: minutes });
        }

        function onMetricsRangeChange(event) {
            selectMetricsRange(parseInt(event.target.value, 10));
        }

        function refreshMetrics() {
            const active = document.querySelector('.cc-seg-btn.cc-seg-active');
            const minutes = active ? parseInt(active.getAttribute('data-range') || '${METRIC_LOOKBACK_MINUTES}', 10) : ${METRIC_LOOKBACK_MINUTES};
            const btn = document.querySelector('.metrics-refresh-btn');
            if (btn) btn.classList.add('spinning');
            vscode.postMessage({ command: 'refreshMetrics', rangeMinutes: minutes });
            setTimeout(() => { if (btn) btn.classList.remove('spinning'); }, 1200);
        }

        let currentTab = '${activeTab}';

        function switchTab(tabName, skipNotify) {
            currentTab = tabName;
            document.querySelectorAll('.tab-content').forEach(function(tab) {
                tab.classList.toggle('active', tab.id === 'tab-' + tabName);
            });
            document.querySelectorAll('.cc-tab').forEach(function(btn) {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
            });
            if (!skipNotify) {
                vscode.postMessage({ command: 'tabChanged', tab: tabName });
            }
        }

        switchTab('${activeTab}', true);

        function showConfirmationDialog(title, message) {
            return new Promise(function(resolve) {
                var overlay = document.createElement('div');
                overlay.className = 'cc-overlay';
                var dialog = document.createElement('div');
                dialog.className = 'cc-dialog';
                var h3 = document.createElement('h3');
                h3.textContent = title;
                dialog.appendChild(h3);
                var p = document.createElement('p');
                p.textContent = message;
                dialog.appendChild(p);
                var actions = document.createElement('div');
                actions.className = 'cc-dialog-actions';
                var cancelBtn = document.createElement('button');
                cancelBtn.className = 'cc-dialog-btn';
                cancelBtn.textContent = 'Cancel';
                var okBtn = document.createElement('button');
                okBtn.className = 'cc-dialog-btn cc-dialog-btn-primary';
                okBtn.textContent = 'Continue';
                actions.appendChild(cancelBtn);
                actions.appendChild(okBtn);
                dialog.appendChild(actions);
                overlay.appendChild(dialog);
                var cleanup = function() { overlay.remove(); };
                cancelBtn.addEventListener('click', function() { cleanup(); resolve(false); });
                okBtn.addEventListener('click', function() { cleanup(); resolve(true); });
                overlay.addEventListener('click', function(e) { if (e.target === overlay) { cleanup(); resolve(false); } });
                document.addEventListener('keydown', function handler(e) {
                    if (e.key === 'Escape') { document.removeEventListener('keydown', handler); cleanup(); resolve(false); }
                }, { once: true });
                document.body.appendChild(overlay);
            });
        }

        async function restartApp() {
            if (await showConfirmationDialog('Restart Application', 'Are you sure you want to restart this application?')) {
                vscode.postMessage({ command: 'restartApp' });
            }
        }

        async function stopApp() {
            if (await showConfirmationDialog('Stop Application', 'Stopping will terminate the application on the target runtime. Continue?')) {
                vscode.postMessage({ command: 'stopApp' });
            }
        }

        async function startApp() {
            if (await showConfirmationDialog('Start Application', 'Start this application on the selected runtime?')) {
                vscode.postMessage({ command: 'startApp' });
            }
        }

        function openLogs() { vscode.postMessage({ command: 'openLogs' }); }
        function exportCSV() { vscode.postMessage({ command: 'exportCSV' }); }
        function compareEnvironments() { vscode.postMessage({ command: 'compareEnvironments' }); }
        function generateDiagram() { vscode.postMessage({ command: 'generateDiagram' }); }
    `;

    return wrapWebviewHtml({
        title: 'Application Command Center',
        body: ccBody,
        scripts: ccScripts,
        extraStyles: ccExtraStyles
    });
}
