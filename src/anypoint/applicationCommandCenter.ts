import * as vscode from 'vscode';
import { BASE_URL, ARM_BASE, HYBRID_APPLICATIONS_ENDPOINT, getBaseUrl, getArmBase, getHybridApplicationsEndpoint } from '../constants';
import { ApiHelper } from '../controllers/apiHelper';
import { AccountService } from '../controllers/accountService';
import { showRealTimeLogs } from './realTimeLogs';

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

    const organizationID = activeAccount.organizationId;

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

const METRIC_COLORS = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#79c0ff', '#ffa657'];

function renderMetricsTab(
    metrics?: VisualizerMetricsData,
    options?: { active: boolean; selectedRange: number; performanceMetrics?: CommandCenterData['performanceMetrics']; cloudhubVersion?: string }
): string {
    const performanceMetrics = options?.performanceMetrics;
    const hasMonitoringFallback = performanceMetrics && performanceMetrics.source === 'monitoring';
    const hasVisualizerData = metrics?.status === 'live' && metrics.panels.length > 0;

    const infoBanner = hasVisualizerData
        ? `🟢 Live metrics from Visualizer • Last updated ${metrics?.lastUpdated ? new Date(metrics.lastUpdated).toLocaleString() : 'just now'} • Window ${metrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES}m`
        : hasMonitoringFallback
            ? `🟢 Monitoring Query metrics for Hybrid deployments • Window last 24h`
            : metrics?.status === 'error'
                ? `🚫 ${metrics?.errorMessage || 'Unable to load metrics from Visualizer.'}`
                : metrics?.errorMessage || 'Metrics will appear here once Visualizer access is enabled for this org/environment.';

    const statusClass = hasVisualizerData
        ? 'success'
        : hasMonitoringFallback
            ? 'success'
            : metrics?.status === 'error'
                ? 'error'
                : 'warning';

    const selectedRange = options?.selectedRange || metrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES;
    const rangeOptions = METRIC_RANGE_OPTIONS.map(option => `
        <option value="${option}" ${option === selectedRange ? 'selected' : ''}>Last ${option} min</option>
    `).join('');

    const visualizerGrid = hasVisualizerData
        ? `<div class="metrics-grid">
                ${metrics?.panels.map((panel, index) => renderMetricPanel(panel, index)).join('')}
           </div>`
        : '';

    const monitoringFallbackGrid = !hasVisualizerData && hasMonitoringFallback
        ? renderMonitoringPerformancePanels(performanceMetrics!, options?.cloudhubVersion)
        : '';

    const emptyState = !hasVisualizerData && !hasMonitoringFallback
        ? `<div class="metrics-empty">
                <p>${metrics?.errorMessage || 'No metric panels available for this application in the selected time window.'}</p>
           </div>`
        : '';

    return `
    <div id="tab-metrics" class="tab-content ${options?.active ? 'active' : ''}">
        <div class="card">
            <h2 class="section-title">
                <span class="section-icon">📈</span>
                <span>Metrics</span>
            </h2>
            <div class="metrics-controls">
                <div class="metrics-filter">
                    <label for="metrics-range-select">Time range</label>
                    <select id="metrics-range-select" onchange="onMetricsRangeChange(event)" ${hasMonitoringFallback && !hasVisualizerData ? 'disabled' : ''}>
                        ${rangeOptions}
                    </select>
                </div>
                <button class="metrics-refresh-btn" onclick="refreshMetrics()">
                    <span class="icon">🔄</span>
                    <span>Refresh Charts</span>
                </button>
            </div>
            <div class="metrics-status metrics-status-${statusClass}">
                <div>${infoBanner}</div>
                ${metrics?.datasource ? `<div>Datasource #${metrics.datasource.id}${metrics.datasource.name ? ` • ${metrics.datasource.name}` : ''}${metrics.datasource.database ? ` • ${metrics.datasource.database}` : ''}</div>` : ''}
                ${hasMonitoringFallback ? `<div>Source: Monitoring Query API</div>` : ''}
            </div>
            ${visualizerGrid || monitoringFallbackGrid || emptyState}
        </div>
    </div>`;
}

function renderMonitoringPerformancePanels(perf: CommandCenterData['performanceMetrics'], cloudhubVersion?: string): string {
    if (!perf || !perf.timestamps || perf.timestamps.length === 0) {
        return `<div class="metrics-empty"><p>No monitoring data returned for this application.</p></div>`;
    }

    const cpuCard = renderSimpleTimeseriesCard({
        label: perf.cpuLabel || (cloudhubVersion === 'HYBRID' ? 'Message Count (avg)' : 'CPU Usage (%)'),
        color: '#58a6ff',
        values: perf.cpu,
        timestamps: perf.timestamps,
        unit: '',
        formatter: value => value.toFixed(2)
    });

    const memoryCard = renderSimpleTimeseriesCard({
        label: perf.memoryLabel || (cloudhubVersion === 'HYBRID' ? 'Response Time (ms)' : 'Memory Usage (MB)'),
        color: '#3fb950',
        values: perf.memory,
        timestamps: perf.timestamps,
        unit: '',
        formatter: value => value.toFixed(2)
    });

    return `<div class="metrics-grid">
        ${cpuCard}
        ${memoryCard}
    </div>`;
}

function renderSimpleTimeseriesCard(params: { label: string; color: string; values: number[]; timestamps: number[]; unit?: string; formatter?: (value: number) => string }): string {
    const values = params.values || [];
    const timestamps = params.timestamps || [];
    if (!values.length || !timestamps.length) {
        return `<div class="metrics-card"><div class="metrics-header"><div><div class="metrics-title">${params.label}</div></div><div class="metrics-value">—</div></div><div class="metrics-empty"><p>No data points returned.</p></div></div>`;
    }

    const latest = values[values.length - 1];
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const formatter = params.formatter || ((val: number) => val.toFixed(1));

    const width = 320;
    const height = 120;
    const padding = { top: 10, bottom: 30, left: 20, right: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = max <= 0 ? 1 : max;
    const path = values.map((value, index) => {
        const ratioX = values.length > 1 ? index / (values.length - 1) : 0;
        const ratioY = value / maxValue;
        const x = padding.left + ratioX * chartWidth;
        const y = padding.top + (1 - ratioY) * chartHeight;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const dotX = padding.left + ((values.length - 1) / Math.max(values.length - 1, 1)) * chartWidth;
    const dotY = padding.top + (1 - (latest / maxValue)) * chartHeight;

    return `
    <div class="metrics-card">
        <div class="metrics-header">
            <div>
                <div class="metrics-title">${params.label}</div>
                <div class="metrics-subtitle">Latest ${formatter(latest)}${params.unit || ''} • Avg ${formatter(avg)}</div>
            </div>
            <div class="metrics-value">${formatter(latest)}${params.unit || ''}</div>
        </div>
        <div class="metrics-chart">
            <svg width="${width}" height="${height}">
                <path d="${path}" fill="none" stroke="${params.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <circle cx="${dotX}" cy="${dotY}" r="4" fill="${params.color}"></circle>
                <text x="${dotX}" y="${dotY - 8}" fill="${params.color}" font-size="10" text-anchor="end">${formatter(latest)}${params.unit || ''}</text>
            </svg>
        </div>
        <div class="metrics-footer">
            <span>Min ${formatter(min)}</span>
            <span>Max ${formatter(max)}</span>
            <span>Samples ${values.length}</span>
        </div>
    </div>`;
}

function renderMetricPanel(panel: VisualizerMetricPanel, paletteOffset: number = 0): string {
    const hasData = panel.series.some(series => series.points && series.points.length > 0);
    if (!hasData) {
        return `
        <div class="metrics-card">
            <div class="metrics-header">
                <div>
                    <div class="metrics-title">${panel.title}</div>
                    ${panel.description ? `<div class="metrics-subtitle">${panel.description}</div>` : ''}
                </div>
                <div class="metrics-value">—</div>
            </div>
            <div class="metrics-empty">
                <p>No data returned for this panel.</p>
            </div>
        </div>`;
    }

    const latestValue = panel.series.length === 1
        ? getLatestValue(panel.series[0])
        : panel.series.reduce((total, series) => total + (getLatestValue(series) || 0), 0);

    const allValues = panel.series.flatMap(series => series.points.map(point => point.value));
    const maxValueRaw = allValues.length > 0 ? Math.max(...allValues) : 0;
    const maxValue = maxValueRaw <= 0 ? 1 : maxValueRaw;
    const width = 320;
    const height = 160;
    const padding = { top: 10, bottom: 24, left: 20, right: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const gridLines = [0.75, 0.5, 0.25].map(ratio => {
        const y = padding.top + (1 - ratio) * chartHeight;
        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4 4" />`;
    }).join('');

    const seriesLines = panel.series.map((series, index) => {
        const color = METRIC_COLORS[(paletteOffset + index) % METRIC_COLORS.length];
        const showEvery = Math.max(1, Math.floor(series.points.length / 12));
        const points = series.points.map((point, pointIndex) => {
            const ratioX = series.points.length > 1 ? pointIndex / (series.points.length - 1) : 0;
            const ratioY = point.value / maxValue;
            const x = padding.left + ratioX * chartWidth;
            const y = padding.top + (1 - ratioY) * chartHeight;
            return `${x},${y}`;
        }).join(' ');
        const markers = series.points.map((point, pointIndex) => {
            if (!point || (pointIndex % showEvery !== 0 && pointIndex !== series.points.length - 1)) {
                return '';
            }
            const ratioX = series.points.length > 1 ? pointIndex / (series.points.length - 1) : 0;
            const ratioY = point.value / maxValue;
            const x = padding.left + ratioX * chartWidth;
            const y = padding.top + (1 - ratioY) * chartHeight;
            const tooltip = `${formatMetricTime(point.timestamp)} • ${formatMetricValue(point.value, panel.unit)}`;
            return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" opacity="0.85"><title>${tooltip}</title></circle>`;
        }).join('');
        return `<g>
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" style="filter: drop-shadow(0 0 4px ${color}80);" />
            ${markers}
        </g>`;
    }).join('');

    const legend = panel.series.map((series, index) => {
        const color = METRIC_COLORS[(paletteOffset + index) % METRIC_COLORS.length];
        const seriesValue = getLatestValue(series);
        return `<div class="legend-item">
            <span class="legend-dot" style="background:${color}"></span>
            <span>${series.label}</span>
            <span class="legend-value">${formatMetricValue(seriesValue, panel.unit)}</span>
        </div>`;
    }).join('');

    return `
    <div class="metrics-card">
        <div class="metrics-header">
            <div>
                <div class="metrics-title">${panel.title}</div>
                ${panel.description ? `<div class="metrics-subtitle">${panel.description}</div>` : ''}
            </div>
            <div class="metrics-value">${formatMetricValue(latestValue, panel.unit)}</div>
        </div>
        <div class="metrics-chart">
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="metrics-chart-svg">
                ${gridLines}
                ${seriesLines}
            </svg>
        </div>
        <div class="metrics-legend">
            ${legend}
        </div>
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
        const organizationID = activeAccount.organizationId;
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
                // Check if it's a Hybrid app by looking for cloudhubVersion or deploymentType
                const isHybrid = preselectedAppData.cloudhubVersion === 'HYBRID' ||
                                 preselectedAppData.deploymentType === 'HYBRID';

                appInfo = {
                    label: preselectedAppData.name || preselectedAppData.domain || preselectedAppName,
                    domain: preselectedAppData.domain || preselectedAppData.name || preselectedAppName,
                    cloudhubVersion: isHybrid ? 'HYBRID' as const : (preselectedAppData.target ? 'CH2' as const : 'CH1' as const),
                    deploymentId: preselectedAppData.id || preselectedAppData.target?.id || preselectedAppData.targetId,
                    specificationId: preselectedAppData.specificationId,
                    status: preselectedAppData.status || preselectedAppData.lastReportedStatus,
                    applicationStatus: preselectedAppData.status || preselectedAppData.lastReportedStatus,
                    rawData: preselectedAppData
                };
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
	const healthColor = data.healthScore >= 80 ? '#3fb950' : data.healthScore >= 60 ? '#d29922' : '#f85149';
	const activeTab = data.activeTab || 'overview';
	const selectedRange = data.metricsRangeMinutes || data.visualizerMetrics?.rangeMinutes || METRIC_LOOKBACK_MINUTES;
	// Only CH2 supports application diagrams (not CH1 or HYBRID)
	const supportsApplicationDiagram = (data.cloudhubVersion || '').toUpperCase() === 'CH2';

    // Get MuleSoft logo URI
	const logoPath = vscode.Uri.joinPath(extensionUri, 'mulelogo.png');
	const logoSrc = webview.asWebviewUri(logoPath);

    // Get actual running status (checks replicas for CH2)
    const actualStatus = getActualStatus(app, data.replicas, data.cloudhubVersion);
    const statusColor = (actualStatus === 'RUNNING' || actualStatus.includes('RUNNING')) ? '#3fb950' :
                       (actualStatus === 'STARTING') ? '#d29922' : '#f85149';

    // Calculate uptime - use different fields based on CloudHub version
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
			uptimeText = `${deployDays}d ${deployHours}h since deployment`;
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

    // Prepare performance chart data
    const cpuData = data.performanceMetrics?.cpu?.slice(-24) || Array.from({ length: 24 }, () => Math.random() * 80 + 10);
    const memoryData = data.performanceMetrics?.memory?.slice(-24) || Array.from({ length: 24 }, () => Math.random() * 70 + 20);
    const timestamps = data.performanceMetrics?.timestamps?.slice(-24) || Array.from({ length: 24 }, (_, i) => Date.now() - (24 - i) * 60 * 60 * 1000);

    const isRealData = data.performanceMetrics?.source && data.performanceMetrics.source !== 'simulated';
	const metricsSource = data.performanceMetrics?.source === 'monitoring'
	    ? (data.cloudhubVersion === 'HYBRID'
	        ? '📊 Data source: Monitoring Query API'
	        : '📊 Data source: Runtime Manager metrics API')
	    : data.performanceMetrics?.source === 'observability'
	        ? '📊 Data source: Anypoint Observability API'
	        : '⚠️ Simulated data - Requires Anypoint Monitoring access to display live charts';

	const cpuMetricLabel = data.performanceMetrics?.cpuLabel || (data.cloudhubVersion === 'HYBRID' ? 'Message Count (avg)' : 'CPU Usage (%)');
	const memoryMetricLabel = data.performanceMetrics?.memoryLabel || (data.cloudhubVersion === 'HYBRID' ? 'Response Time (ms)' : 'Memory Usage (MB)');

    // Calculate current values
    const currentCpu = cpuData[cpuData.length - 1].toFixed(1);
    const currentMemory = memoryData[memoryData.length - 1].toFixed(1);
    const avgCpu = (cpuData.reduce((a, b) => a + b, 0) / cpuData.length).toFixed(1);
    const avgMemory = (memoryData.reduce((a, b) => a + b, 0) / memoryData.length).toFixed(1);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Command Center</title>
    <style>
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
            padding: 24px;
            overflow-x: hidden;
        }

        /* Removed animated background - was distracting */

        .container {
            max-width: 1400px;
            margin: 0 auto;
            animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Header */
        .header {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideDown 0.6s ease-out;
            position: relative;
            overflow: hidden;
        }

        .header::before {
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

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        }

        .app-title {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .app-icon {
            width: 48px;
            height: 48px;
            object-fit: contain;
        }

        .app-info h1 {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 8px;
            color: var(--text-primary);
        }

        .app-meta {
            display: flex;
            gap: 16px;
            font-size: 14px;
            color: var(--text-secondary);
        }

        .meta-badge {
            background: var(--surface-primary);
            padding: 6px 12px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
            border: 1px solid var(--border-primary);
        }

        .refresh-btn {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            color: var(--text-primary);
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .refresh-btn:hover {
            background: var(--surface-secondary);
            border-color: var(--accent-blue);
            transform: translateY(-2px);
        }

        .refresh-btn:active {
            transform: translateY(0);
        }

        .refresh-btn.spinning .icon {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Health Score Section */
        .health-section {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideUp 0.6s ease-out 0.1s both;
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .health-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 32px;
            align-items: center;
        }

        .health-score-circle {
            position: relative;
            width: 180px;
            height: 180px;
        }

        .score-ring {
            transform: rotate(-90deg);
        }

        .score-ring-bg {
            fill: none;
            stroke: var(--surface-secondary);
            stroke-width: 12;
        }

        .score-ring-progress {
            fill: none;
            stroke: ${healthColor};
            stroke-width: 12;
            stroke-linecap: round;
            stroke-dasharray: 440;
            stroke-dashoffset: ${440 - (440 * data.healthScore / 100)};
            animation: scoreProgress 2s ease-out;
            filter: drop-shadow(0 0 8px ${healthColor});
        }

        @keyframes scoreProgress {
            from { stroke-dashoffset: 440; }
        }

        .score-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
        }

        .score-number {
            font-size: 48px;
            font-weight: 700;
            color: ${healthColor};
            animation: countUp 2s ease-out;
        }

        .score-label {
            font-size: 14px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .health-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
        }

        .stat-card {
            background: var(--surface-primary);
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--border-primary);
            transition: all 0.3s ease;
        }

        .stat-card:hover {
            background: var(--surface-secondary);
            transform: translateY(-4px);
            border-color: var(--accent-blue);
        }

        .stat-label {
            font-size: 12px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${statusColor};
            box-shadow: 0 0 12px ${statusColor};
        }

        /* Tab Navigation */
        .tabs {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 8px;
            margin-bottom: 24px;
            display: flex;
            gap: 8px;
            overflow-x: auto;
            flex-wrap: wrap;
        }

        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
        }

        .tab-btn:hover {
            background: var(--surface-secondary);
            color: var(--text-primary);
        }

        .tab-btn.active {
            background: var(--accent-blue);
            color: white;
            font-weight: 600;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
            animation: fadeIn 0.3s ease-out;
        }

        /* Metrics */
        .metrics-status {
            margin-bottom: 16px;
            padding: 14px 16px;
            border-radius: 10px;
            border: 1px solid var(--border-primary);
            background: rgba(255, 255, 255, 0.02);
            font-size: 13px;
            line-height: 1.4;
        }

        .metrics-status-success {
            border-color: var(--success);
            background: rgba(63, 185, 80, 0.08);
        }

        .metrics-status-warning {
            border-color: var(--warning);
            background: rgba(210, 153, 34, 0.08);
        }

        .metrics-status-error {
            border-color: var(--accent-red);
            background: rgba(248, 81, 73, 0.08);
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 16px;
        }

        .metrics-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }

        .metrics-filter {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .metrics-filter label {
            font-size: 12px;
            color: var(--text-secondary);
        }

        .metrics-filter select {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            color: var(--text-primary);
            padding: 6px 12px;
            min-width: 140px;
        }

        .metrics-refresh-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--accent-blue);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: 600;
            transition: opacity 0.2s ease;
        }

        .metrics-refresh-btn .icon {
            display: inline-block;
        }

        .metrics-refresh-btn.spinning {
            opacity: 0.7;
        }

        .metrics-refresh-btn.spinning .icon {
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .metrics-card {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .metrics-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
        }

        .metrics-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .metrics-subtitle {
            font-size: 12px;
            color: var(--text-secondary);
        }

        .metrics-value {
            font-size: 28px;
            font-weight: 700;
            color: var(--text-primary);
        }

        .metrics-chart {
            height: 160px;
        }

        .metrics-chart-svg {
            width: 100%;
            height: 100%;
        }

        .metrics-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }

        .legend-value {
            color: var(--text-primary);
            font-weight: 600;
        }

        .metrics-empty {
            padding: 24px;
            text-align: center;
            color: var(--text-secondary);
            border: 1px dashed var(--border-muted);
            border-radius: 10px;
        }

        .metrics-footer {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--text-secondary);
            border-top: 1px solid var(--border-muted);
            padding-top: 8px;
        }

        .confirm-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .confirm-dialog {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            min-width: 320px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .confirm-dialog h3 {
            margin: 0 0 12px;
            color: var(--text-primary);
            font-size: 16px;
        }

        .confirm-dialog p {
            margin: 0 0 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }

        .confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }

        .confirm-btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: 1px solid var(--border-primary);
            background: var(--surface-secondary);
            color: var(--text-primary);
            cursor: pointer;
        }

        .confirm-btn-primary {
            background: var(--accent-blue);
            border-color: var(--accent-blue);
            color: #fff;
        }

        /* Section Title */
        .section-title {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--text-primary);
        }

        .section-icon {
            font-size: 24px;
        }

        /* Quick Actions */
        .quick-actions {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideUp 0.6s ease-out 0.2s both;
        }

        .action-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }

        .action-btn {
            background: var(--surface-primary);
            border: 1px solid var(--border-primary);
            color: var(--text-primary);
            padding: 14px 18px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            position: relative;
            overflow: hidden;
        }

        .action-btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: var(--accent-blue);
            opacity: 0.1;
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }

        .action-btn:hover::before {
            width: 300px;
            height: 300px;
        }

        .action-btn:hover {
            transform: translateY(-4px);
            border-color: var(--accent-blue);
            box-shadow: 0 4px 12px rgba(88, 166, 255, 0.2);
        }

        .action-btn:active {
            transform: translateY(-2px);
        }

        .action-btn span {
            position: relative;
            z-index: 1;
        }

        .action-icon {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: white;
        }

        .action-icon svg {
            stroke-width: 2.2;
        }

        .gradient-blue { background: linear-gradient(135deg, #58a6ff, #1f6feb); }
        .gradient-red { background: linear-gradient(135deg, #f85149, #cf3430); }
        .gradient-green { background: linear-gradient(135deg, #2ea043, #0e8a34); }
        .gradient-purple { background: linear-gradient(135deg, #a371f7, #7c3aed); }
        .gradient-gold { background: linear-gradient(135deg, #f2cc60, #f09d24); }
        .gradient-teal { background: linear-gradient(135deg, #3fb950, #0ca678); }
        .gradient-orange { background: linear-gradient(135deg, #ff9f43, #f76707); }

        /* Alerts Section */
        .alerts-section {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideUp 0.6s ease-out 0.25s both;
        }

        .alert-item {
            background: var(--surface-primary);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            border-left: 4px solid var(--warning);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .alert-item.critical {
            border-left-color: var(--error);
        }

        .alert-item.info {
            border-left-color: var(--accent-blue);
        }

        .alert-item:hover {
            background: var(--surface-secondary);
            transform: translateX(8px);
        }

        .alert-icon {
            font-size: 24px;
        }

        .alert-content {
            flex: 1;
        }

        .alert-message {
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--text-primary);
        }

        .alert-time {
            font-size: 12px;
            color: var(--text-secondary);
        }

        /* Cost Tracking Section */
        .cost-section {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideUp 0.6s ease-out 0.3s both;
        }

        .cost-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }

        .cost-card {
            background: linear-gradient(135deg, var(--surface-primary) 0%, var(--surface-secondary) 100%);
            padding: 24px;
            border-radius: 8px;
            border: 1px solid var(--border-primary);
            text-align: center;
            transition: all 0.3s ease;
        }

        .cost-card:hover {
            transform: scale(1.05);
            border-color: var(--success);
        }

        .cost-amount {
            font-size: 36px;
            font-weight: 700;
            color: var(--success);
            margin: 12px 0;
        }

        .cost-label {
            font-size: 14px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* AI Insights Section */
        .insights-section {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            animation: slideUp 0.6s ease-out 0.35s both;
        }

        .insight-item {
            background: var(--surface-primary);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            border-left: 4px solid var(--accent-blue);
            transition: all 0.3s ease;
            animation: slideInLeft 0.5s ease-out;
        }

        @keyframes slideInLeft {
            from { opacity: 0; transform: translateX(-20px); }
            to { opacity: 1; transform: translateX(0); }
        }

        .insight-item:hover {
            background: var(--surface-secondary);
            transform: translateX(4px);
        }

        /* Performance Chart */
        .chart-container {
            background: var(--surface-primary);
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--border-primary);
            margin-top: 20px;
        }

        .sparkline {
            width: 100%;
            height: 60px;
        }

        .sparkline-path {
            fill: none;
            stroke: var(--accent-blue);
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            animation: drawLine 2s ease-out;
        }

        @keyframes drawLine {
            from { stroke-dasharray: 1000; stroke-dashoffset: 1000; }
            to { stroke-dasharray: 1000; stroke-dashoffset: 0; }
        }

        /* Grid Layout */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 24px;
            margin-bottom: 24px;
        }

        .card {
            background: var(--background-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 32px;
            animation: slideUp 0.6s ease-out 0.4s both;
            transition: all 0.3s ease;
        }

        .card:hover {
            transform: translateY(-4px);
            border-color: var(--accent-blue);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }

        .card-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--text-primary);
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid var(--border-muted);
        }

        .info-row:last-child {
            border-bottom: none;
        }

        .info-label {
            color: var(--text-secondary);
            font-size: 14px;
        }

        .info-value {
            color: var(--text-primary);
            font-weight: 600;
            font-size: 14px;
        }

        /* Deployment History */
        .deployment-item {
            background: var(--surface-primary);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            border-left: 4px solid var(--success);
            transition: all 0.3s ease;
        }

        .deployment-item:hover {
            background: var(--surface-secondary);
            transform: translateX(8px);
        }

        .deployment-version {
            font-weight: 700;
            font-size: 16px;
            margin-bottom: 4px;
            color: var(--text-primary);
        }

        .deployment-meta {
            font-size: 13px;
            color: var(--text-secondary);
        }

        /* Schedulers */
        .scheduler-item {
            background: var(--surface-primary);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            transition: all 0.3s ease;
        }

        .scheduler-item:hover {
            background: var(--surface-secondary);
            transform: scale(1.02);
        }

        .scheduler-name {
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
        }

        .scheduler-status {
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--success);
            color: var(--background-primary);
            font-weight: 600;
        }

        /* Replicas (CH2) */
        .replica-item {
            background: var(--surface-primary);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
        }

        .replica-item:hover {
            background: var(--surface-secondary);
        }

        .replica-name {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
        }

        .replica-state {
            font-size: 12px;
            padding: 4px 12px;
            border-radius: 4px;
            background: var(--success);
            color: var(--background-primary);
            font-weight: 600;
        }

        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        /* Network Topology */
        .topology-container {
            background: var(--surface-primary);
            padding: 30px;
            border-radius: 8px;
            border: 1px solid var(--border-primary);
            text-align: center;
        }

        .topology-node {
            display: inline-block;
            background: var(--surface-secondary);
            border: 2px solid var(--accent-blue);
            border-radius: 50%;
            width: 80px;
            height: 80px;
            line-height: 76px;
            margin: 10px;
            font-size: 32px;
            animation: nodeFloat 3s ease-in-out infinite;
        }

        @keyframes nodeFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }

        .topology-line {
            display: inline-block;
            width: 40px;
            height: 2px;
            background: var(--border-primary);
            vertical-align: middle;
            position: relative;
        }

        .topology-line::after {
            content: '→';
            position: absolute;
            right: -10px;
            top: -10px;
            color: var(--accent-blue);
        }

        /* Responsive */
        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
            }

            .health-grid {
                grid-template-columns: 1fr;
                text-align: center;
            }

            .health-score-circle {
                margin: 0 auto;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="header-top">
                <div class="app-title">
                    <img src="${logoSrc}" alt="MuleSoft" class="app-icon" />
                    <div class="app-info">
                        <h1>${app?.domain || app?.name || 'Unknown Application'}</h1>
                        <div class="app-meta">
                            <div class="meta-badge">
                                <span>${data.cloudhubVersion}</span>
                            </div>
                            <div class="meta-badge">
                                <span>📍 ${data.environmentName}</span>
                            </div>
                            <div class="meta-badge">
                                <span>🏢 ${data.accountInfo.organizationName}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button class="refresh-btn" onclick="refreshData()">
                    <span class="icon">🔄</span>
                    <span>Refresh</span>
                </button>
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tabs">
            <button class="tab-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview" onclick="switchTab('overview')">
                <span>📊</span>
                <span>Overview</span>
            </button>
            <button class="tab-btn ${activeTab === 'metrics' ? 'active' : ''}" data-tab="metrics" onclick="switchTab('metrics')">
                <span>📈</span>
                <span>Metrics</span>
            </button>
            <button class="tab-btn ${activeTab === 'schedulers' ? 'active' : ''}" data-tab="schedulers" onclick="switchTab('schedulers')">
                <span>⏰</span>
                <span>Schedulers</span>
            </button>
            <button class="tab-btn ${activeTab === 'configuration' ? 'active' : ''}" data-tab="configuration" onclick="switchTab('configuration')">
                <span>⚙️</span>
                <span>Configuration</span>
            </button>
            <button class="tab-btn ${activeTab === 'logs' ? 'active' : ''}" data-tab="logs" onclick="switchTab('logs')">
                <span>📋</span>
                <span>Real-time Logs</span>
            </button>
            <button class="tab-btn ${activeTab === 'network' ? 'active' : ''}" data-tab="network" onclick="switchTab('network')">
                <span>🔗</span>
                <span>Network</span>
            </button>
            <!-- AI Insights Tab - Disabled for future release
            <button class="tab-btn ${activeTab === 'insights' ? 'active' : ''}" data-tab="insights" onclick="switchTab('insights')">
                <span>🧠</span>
                <span>AI Insights</span>
            </button>
            -->
        </div>

        <!-- Quick Actions -->
        <div class="quick-actions">
            <h2 class="section-title">
                <span class="section-icon">⚡</span>
                <span>Quick Actions</span>
            </h2>
            <div class="action-buttons">
                <button class="action-btn" onclick="restartApp()">
                    <span class="action-icon gradient-blue">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15A9 9 0 1 1 23 10"></path>
                        </svg>
                    </span>
                    <span>Restart</span>
                </button>
                <button class="action-btn" onclick="stopApp()">
                    <span class="action-icon gradient-red">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
                        </svg>
                    </span>
                    <span>Stop</span>
                </button>
                <button class="action-btn" onclick="startApp()">
                    <span class="action-icon gradient-green">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </span>
                    <span>Start</span>
                </button>
                ${data.cloudhubVersion !== 'HYBRID' ? `
                <button class="action-btn" onclick="openLogs()">
                    <span class="action-icon gradient-purple">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15V5a2 2 0 0 0-2-2H7l-4 4v13a2 2 0 0 0 2 2h12"></path>
                            <line x1="3" y1="9" x2="21" y2="9"></line>
                        </svg>
                    </span>
                    <span>View Logs</span>
                </button>
                ` : ''}
                <button class="action-btn" onclick="exportCSV()">
                    <span class="action-icon gradient-gold">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </span>
                    <span>Export Report</span>
                </button>
				<button class="action-btn" onclick="compareEnvironments()">
                    <span class="action-icon gradient-teal">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="17 11 21 7 17 3"></polyline>
                            <line x1="21" y1="7" x2="9" y2="7"></line>
                            <polyline points="7 21 3 17 7 13"></polyline>
                            <line x1="15" y1="17" x2="3" y2="17"></line>
                        </svg>
                    </span>
                    <span>Compare Envs</span>
                </button>
				${supportsApplicationDiagram ? `
				<button class="action-btn" onclick="generateDiagram()">
                    <span class="action-icon gradient-orange">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="5" r="3"></circle>
                            <circle cx="5" cy="19" r="3"></circle>
                            <circle cx="19" cy="19" r="3"></circle>
                            <line x1="10.59" y1="7.51" x2="6.5" y2="16.5"></line>
                            <line x1="13.41" y1="7.51" x2="17.5" y2="16.5"></line>
                        </svg>
                    </span>
                    <span>Generate Diagram</span>
                </button>
				` : ''}
            </div>
        </div>

        <!-- Tab: Overview -->
        <div id="tab-overview" class="tab-content ${activeTab === 'overview' ? 'active' : ''}">

        <!-- Health Score Section -->
        <div class="health-section">
            <h2 class="section-title">
                <span class="section-icon">💚</span>
                <span>Health Overview</span>
            </h2>
            <div class="health-grid">
                <div class="health-score-circle">
                    <svg class="score-ring" viewBox="0 0 160 160">
                        <circle class="score-ring-bg" cx="80" cy="80" r="70"></circle>
                        <circle class="score-ring-progress" cx="80" cy="80" r="70"></circle>
                    </svg>
                    <div class="score-text">
                        <div class="score-number">${data.healthScore}</div>
                        <div class="score-label">Health Score</div>
                    </div>
                </div>
                <div class="health-stats">
                    <div class="stat-card">
                        <div class="stat-label">Status</div>
                        <div class="stat-value">
                            <span class="status-dot"></span>
                            <span>${actualStatus}</span>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Uptime</div>
                        <div class="stat-value">${uptimeText}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Runtime Version</div>
                        <div class="stat-value">${runtimeVersion}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Region</div>
                        <div class="stat-value">${region}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">${cpuMetricLabel} (current)</div>
                        <div class="stat-value">${currentCpu}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">${memoryMetricLabel} (current)</div>
                        <div class="stat-value">${currentMemory}</div>
                    </div>
                </div>
            </div>

            <!-- Application Details Section -->
            <div style="margin-top: 24px; background: var(--surface-primary); border-radius: 8px; border: 1px solid var(--border-primary); padding: 20px;">
                <h3 style="margin-bottom: 16px; color: var(--text-primary); font-size: 14px; font-weight: 600;">📋 Application Details</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px;">
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Domain</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app?.domain || app?.name || 'N/A'}</span>
                    </div>
                    ${app?.fullDomain ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Full Domain</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app.fullDomain}</span>
                    </div>
                    ` : ''}
                    ${app?.target?.deploymentSettings?.http?.inbound?.publicUrl ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Public URL</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px; word-break: break-all;">${app.target.deploymentSettings.http.inbound.publicUrl}</span>
                    </div>
                    ` : ''}
                    ${app?.filename ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Artifact Filename</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app.filename}</span>
                    </div>
                    ` : ''}
                    ${app?.application?.ref ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Group ID</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px; word-break: break-all;">${app.application.ref.groupId}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Artifact ID</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app.application.ref.artifactId}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Version</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app.application.ref.version}</span>
                    </div>
                    ` : ''}
                    ${app?.lastUpdateTime || app?.lastModifiedDate ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Last Updated</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${new Date(app.lastUpdateTime || app.lastModifiedDate).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    ${data.cloudhubVersion === 'HYBRID' ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Deployment ID</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${app?.id || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Server ID</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.id || 'N/A'}</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            ${data.cloudhubVersion === 'HYBRID' ? `
            <div style="margin-top: 16px; background: var(--surface-primary); border-radius: 8px; border: 1px solid var(--border-primary); padding: 20px;">
                <h3 style="margin-bottom: 16px; color: var(--text-primary); font-size: 14px; font-weight: 600;">📦 Hybrid Artifact</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px;">
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Artifact Name</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridArtifact?.name || app?.name || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">File Name</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px; word-break: break-all;">${hybridArtifact?.fileName || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">File Size</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${formatBytes(hybridArtifact?.fileSize)}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Checksum</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px; word-break: break-all;">${hybridArtifact?.fileChecksum || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Storage ID</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridArtifact?.storageId || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Artifact Status</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServerArtifact?.lastReportedStatus || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Desired Status</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServerArtifact?.desiredStatus || app?.desiredStatus || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Last Updated</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${formatDateTime(hybridServerArtifact?.timeUpdated || hybridArtifact?.timeUpdated)}</span>
                    </div>
                </div>
            </div>

            <div style="margin-top: 16px; background: var(--surface-primary); border-radius: 8px; border: 1px solid var(--border-primary); padding: 20px;">
                <h3 style="margin-bottom: 16px; color: var(--text-primary); font-size: 14px; font-weight: 600;">🖥️ Runtime Server</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px;">
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Server Name</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.name || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Server Type</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.serverType || hybridServer?.type || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Status</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.status || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Mule Version</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.muleVersion || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Agent Version</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServer?.agentVersion || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">License Expires</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${formatDateTime(hybridServer?.licenseExpirationDate)}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Certificate Expires</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${formatDateTime(hybridServer?.certificateExpirationDate)}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">IP Address</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px; word-break: break-all;">${hybridServerAddresses || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Operating System</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServerOs ? `${hybridServerOs.name || 'OS'} ${hybridServerOs.version || ''}` : 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">Architecture</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridServerOs?.architecture || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span style="color: var(--text-secondary); font-size: 13px;">JVM</span>
                        <span style="color: var(--text-primary); font-weight: 500; font-size: 13px;">${hybridJvmInfo?.runtime?.name ? `${hybridJvmInfo.runtime.name} ${hybridJvmInfo.runtime.version || ''}` : 'N/A'}</span>
                    </div>
                </div>
            </div>
            ` : ''}

            <!-- Health Score Breakdown -->
            ${data.healthBreakdown && data.healthBreakdown.length > 0 ? `
            <div style="margin-top: 20px; padding: 20px; background: var(--surface-primary); border-radius: 8px; border: 1px solid var(--border-primary);">
                <h4 style="margin-bottom: 12px; color: var(--text-primary); font-size: 14px;">📊 Health Score Breakdown</h4>
                <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
                    Starting from 100 points, deductions are made based on application health factors:
                </p>
                ${data.healthBreakdown.map((item: string) => `
                    <div style="padding: 6px 0; font-size: 13px; color: var(--text-primary); border-bottom: 1px solid var(--border-muted);">
                        ${item}
                    </div>
                `).join('')}
            </div>
            ` : ''}

            <!-- Performance Chart intentionally hidden to reduce noise -->
        </div>
        </div>
        <!-- End Tab: Overview -->

		${renderMetricsTab(data.visualizerMetrics, {
			active: activeTab === 'metrics',
			selectedRange,
			performanceMetrics: data.performanceMetrics,
			cloudhubVersion: data.cloudhubVersion
		})}

        <!-- Tab: Schedulers -->
        <div id="tab-schedulers" class="tab-content ${activeTab === 'schedulers' ? 'active' : ''}">
            <div class="card">
                <h2 class="section-title">
                    <span class="section-icon">⏰</span>
                    <span>Schedulers (${data.schedulers?.length || 0})</span>
                </h2>
                ${data.schedulers && data.schedulers.length > 0 ? data.schedulers.map((scheduler: any) => `
                    <div class="scheduler-item" style="background: var(--surface-primary); padding: 16px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-primary);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-size: 16px; font-weight: 600; color: var(--text-primary);">${scheduler.name || scheduler.flow || scheduler.flowName || 'Unknown Scheduler'}</div>
                            <div style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${isSchedulerEnabled(scheduler) ? 'background: var(--success); color: white;' : 'background: var(--surface-secondary); color: var(--text-muted);'}">${isSchedulerEnabled(scheduler) ? 'Enabled' : 'Disabled'}</div>
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">
                            ${scheduler.type || scheduler.schedulerType || 'Scheduler'} • ${formatSchedulerDescription(scheduler)}
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            Last run: ${formatSchedulerLastRun(scheduler)}
                        </div>
                        ${scheduler.nextRunTime || scheduler.nextExecutionTime ? `
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                            Next run: ${formatSchedulerNextRun(scheduler)}
                        </div>
                        ` : ''}
                    </div>
                `).join('') : `
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary); line-height: 1.6;">
                        ${data.cloudhubVersion === 'HYBRID'
                            ? `Schedulers were not returned by the Hybrid API. Confirm the application uses <strong>Quartz schedulers</strong> on the target runtime and that the <a style="color: var(--accent-blue);" href="https://help.salesforce.com/s/articleView?id=001115435&type=1" target="_blank">Anypoint Runtime Manager schedulers feature</a> is enabled.`
                            : 'No schedulers configured for this application.'}
                    </div>
                `}
            </div>
        </div>

        <!-- Tab: Configuration -->
        <div id="tab-configuration" class="tab-content ${activeTab === 'configuration' ? 'active' : ''}">
            <div class="card">
                <h2 class="section-title">
                    <span class="section-icon">⚙️</span>
                    <span>Configuration</span>
                </h2>

                ${data.cloudhubVersion === 'CH1' ? `
                    <!-- CloudHub 1.0 Configuration -->
                    <h3 style="margin: 16px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">💼 Compute Resources</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Workers</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.workers || 1}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Worker Type</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.workerType?.name || app?.workerType || 'Micro'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">vCores</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.workerType?.weight || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Region</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.region || 'Unknown'}</span>
                    </div>

                    <h3 style="margin: 24px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">🔧 Features & Settings</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Persistent Queues</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.persistentQueues ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Encrypted Persistent Queues</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.encryptedPersistentQueues ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Static IPs</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.staticIPsEnabled ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Monitoring Auto-Restart</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.monitoringAutoRestart ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Object Store V2</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.objectStoreV2Enabled ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>

                    <h3 style="margin: 24px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">📊 Logging & Monitoring</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Logging NG</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.loggingNgEnabled ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Custom Log4J</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.loggingCustomLog4JEnabled ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    ${app?.secureDataGateway ? `
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Secure Data Gateway</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app.secureDataGateway.connected ? '✅ Connected' : '❌ Disconnected'}</span>
                    </div>
                    ` : ''}
                ` : `
                    <!-- CloudHub 2.0 Configuration -->
                    <h3 style="margin: 16px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">💼 Compute Resources</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Replicas</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.replicas || app?.target?.deploymentSettings?.replicas || 1}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">vCores</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.application?.vCores || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">CPU Reserved</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.resources?.cpu?.reserved || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">CPU Limit</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.resources?.cpu?.limit || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Memory Reserved</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.resources?.memory?.reserved || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Memory Limit</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.resources?.memory?.limit || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Target</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.targetId || app?.target?.provider || 'N/A'}</span>
                    </div>

                    <h3 style="margin: 24px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">🔧 Deployment Settings</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Clustered</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.clustered ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Enforce Replicas Across Nodes</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.enforceDeployingReplicasAcrossNodes ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Update Strategy</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.updateStrategy || 'rolling'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Runtime Release Channel</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.runtimeReleaseChannel || app?.target?.deploymentSettings?.runtime?.releaseChannel || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Java Version</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.runtime?.java || 'N/A'}</span>
                    </div>

                    <h3 style="margin: 24px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">📊 Features & Services</h3>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Persistent Object Store</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.persistentObjectStore ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Anypoint Monitoring Scope</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.anypointMonitoringScope || 'N/A'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Disable AM Log Forwarding</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.disableAmLogForwarding ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Last Mile Security</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.http?.inbound?.lastMileSecurity ? '✅ Enabled' : '❌ Disabled'}</span>
                    </div>
                    <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-muted);">
                        <span style="color: var(--text-secondary);">Forward SSL Session</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${app?.target?.deploymentSettings?.http?.inbound?.forwardSslSession ? '✅ Yes' : '❌ No'}</span>
                    </div>

                    ${app?.target?.deploymentSettings?.sidecars ? `
                    <h3 style="margin: 24px 0 12px; color: var(--text-primary); font-size: 14px; font-weight: 600;">🔌 Sidecars</h3>
                    ${Object.keys(app.target.deploymentSettings.sidecars).map(sidecarName => {
                        const sidecar = app.target.deploymentSettings.sidecars[sidecarName];
                        return `
                        <div style="background: var(--surface-secondary); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
                            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">${sidecarName}</div>
                            ${sidecar.resources ? `
                            <div style="font-size: 12px; color: var(--text-secondary);">
                                CPU: ${sidecar.resources.cpu?.reserved || '0m'} - ${sidecar.resources.cpu?.limit || 'unlimited'} |
                                Memory: ${sidecar.resources.memory?.reserved || '0Mi'} - ${sidecar.resources.memory?.limit || 'unlimited'}
                            </div>
                            ` : ''}
                        </div>
                        `;
                    }).join('')}
                    ` : ''}
                `}
            </div>
        </div>

        <!-- Tab: Logs -->
        <div id="tab-logs" class="tab-content ${activeTab === 'logs' ? 'active' : ''}">
            <div class="card">
                <h2 class="section-title">
                    <span class="section-icon">📋</span>
                    <span>Application Logs</span>
                </h2>
                ${data.cloudhubVersion === 'HYBRID' ? `
                <div style="padding: 40px 20px;">
                    <div style="background: rgba(88, 166, 255, 0.1); border: 1px solid var(--accent-blue); border-radius: 12px; padding: 32px;">
                        <div style="text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                            <h3 style="color: var(--text-primary); margin-bottom: 16px; font-size: 20px;">Hybrid Application Logs</h3>
                            <p style="color: var(--text-secondary); line-height: 1.6; max-width: 600px; margin: 0 auto 24px;">
                                Real-time log streaming is not available for Hybrid deployments through the Anypoint API.
                                Logs for Hybrid applications need to be accessed directly on the Mule Runtime server where the application is deployed.
                            </p>
                            <div style="background: var(--surface-primary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 20px; margin: 0 auto; max-width: 500px; text-align: left;">
                                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <span>📁</span>
                                    <span>Log File Locations:</span>
                                </div>
                                <div style="color: var(--text-secondary); font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.8;">
                                    <div style="margin-bottom: 8px;">
                                        <strong style="color: var(--accent-blue);">Linux/Mac:</strong><br/>
                                        <code style="color: var(--text-primary);">$MULE_HOME/logs/</code>
                                    </div>
                                    <div>
                                        <strong style="color: var(--accent-blue);">Windows:</strong><br/>
                                        <code style="color: var(--text-primary);">%MULE_HOME%\\logs\\</code>
                                    </div>
                                </div>
                            </div>
                            <div style="margin-top: 24px; padding: 16px; background: rgba(210, 153, 34, 0.1); border: 1px solid var(--warning); border-radius: 8px; max-width: 600px; margin-left: auto; margin-right: auto;">
                                <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                                    <strong style="color: var(--warning);">💡 Tip:</strong> Use tools like <code style="background: var(--surface-secondary); padding: 2px 6px; border-radius: 4px;">tail -f</code>
                                    on Linux/Mac or PowerShell's <code style="background: var(--surface-secondary); padding: 2px 6px; border-radius: 4px;">Get-Content -Wait</code>
                                    on Windows to view logs in real-time from the server.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : `
                <div style="text-align: center; padding: 60px 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">📋</div>
                    <h3 style="color: var(--text-primary); margin-bottom: 12px;">Open Real-time Logs Viewer</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 24px;">View, search, filter, and export application logs in real-time.</p>
                    <button class="action-btn" onclick="openLogs()" style="display: inline-flex; max-width: 300px;">
                        <span>📋</span>
                        <span>Open Logs Viewer</span>
                    </button>
                </div>
                `}
            </div>
        </div>

        <!-- Tab: Network -->
        <div id="tab-network" class="tab-content ${activeTab === 'network' ? 'active' : ''}">
            ${data.networkTopology && (
                (data.networkTopology.vpnConnections && data.networkTopology.vpnConnections.length > 0) ||
                (data.networkTopology.externalEndpoints && data.networkTopology.externalEndpoints.length > 0) ||
                (data.networkTopology.dependencies && data.networkTopology.dependencies.length > 0)
            ) ? `
            <div class="card">
                <h2 class="section-title">
                    <span class="section-icon">🔗</span>
                    <span>Network & Dependencies</span>
                </h2>
                <div style="margin-bottom: 16px; padding: 12px; background: var(--surface-accent); border-radius: 6px; border: 1px solid var(--border-primary);">
                    <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.6;">
                        📋 <strong>Data Source:</strong> Parsed from application configuration, properties, deployment settings, and platform features.
                    </div>
                </div>

                ${data.networkTopology.vpnConnections && data.networkTopology.vpnConnections.length > 0 ? `
                <div style="margin-bottom: 16px;">
                    <h4 style="color: var(--text-primary); font-size: 14px; margin-bottom: 8px;">🔒 VPN Connections</h4>
                    ${data.networkTopology.vpnConnections.map((vpn: string) => `
                        <div style="background: var(--surface-primary); padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 13px;">
                            ${vpn}
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                ${data.networkTopology.externalEndpoints && data.networkTopology.externalEndpoints.length > 0 ? `
                <div style="margin-bottom: 16px;">
                    <h4 style="color: var(--text-primary); font-size: 14px; margin-bottom: 8px;">🌍 External Endpoints</h4>
                    ${data.networkTopology.externalEndpoints.map((endpoint: string) => `
                        <div style="background: var(--surface-primary); padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 13px;">
                            ${endpoint}
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                ${data.networkTopology.dependencies && data.networkTopology.dependencies.length > 0 ? `
                <div>
                    <h4 style="color: var(--text-primary); font-size: 14px; margin-bottom: 8px;">📦 Services & Integrations</h4>
                    ${data.networkTopology.dependencies.map((dep: string) => `
                        <div style="background: var(--surface-primary); padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 13px;">
                            ${dep}
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
            ` : `
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                No network dependencies detected for this application.
            </div>
            `}
        </div>

        <!-- Tab: Insights - Disabled for future release
        <div id="tab-insights" class="tab-content ${activeTab === 'insights' ? 'active' : ''}">
            <div class="card">
                <h2 class="section-title">
                    <span class="section-icon">🧠</span>
                    <span>AI Insights (from Log Analysis)</span>
                </h2>
                <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">
                    Analyzed ${data.logs?.length || 0} recent log entries to identify patterns and potential issues.
                </p>
                ${(data.aiInsights || []).length > 0 ? (data.aiInsights || []).map((insight: string, index: number) => `
                    <div class="insight-item" style="background: var(--surface-primary); padding: 16px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid var(--accent-blue); animation-delay: ${index * 0.1}s">
                        ${insight}
                    </div>
                `).join('') : `
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        ✅ No issues detected in recent logs. Application appears healthy.
                    </div>
                `}
            </div>
        </div>
        -->

    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function refreshData() {
            const btn = document.querySelector('.refresh-btn');
            btn.classList.add('spinning');
            vscode.postMessage({ command: 'refresh' });

            setTimeout(() => {
                btn.classList.remove('spinning');
            }, 2000);
        }

        function onMetricsRangeChange(event) {
            const value = parseInt(event.target.value, 10);
            vscode.postMessage({ command: 'updateMetricsRange', rangeMinutes: value });
        }

        function refreshMetrics() {
            const rangeSelect = document.getElementById('metrics-range-select');
            const minutes = parseInt(rangeSelect?.value || '${METRIC_LOOKBACK_MINUTES}', 10);
            const btn = document.querySelector('.metrics-refresh-btn');
            btn?.classList.add('spinning');
            vscode.postMessage({ command: 'refreshMetrics', rangeMinutes: minutes });
            setTimeout(() => btn?.classList.remove('spinning'), 1200);
        }

        let currentTab = '${activeTab}';

        function switchTab(tabName, skipNotify = false) {
            currentTab = tabName;

            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.toggle('active', tab.id === 'tab-' + tabName);
            });

            document.querySelectorAll('.tab-btn').forEach(btn => {
                const btnTab = btn.getAttribute('data-tab');
                btn.classList.toggle('active', btnTab === tabName);
            });

            if (!skipNotify) {
                vscode.postMessage({ command: 'tabChanged', tab: tabName });
            }
        }

        switchTab('${activeTab}', true);

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

        function showConfirmationDialog(title, message) {
            return new Promise(resolve => {
                const overlay = document.createElement('div');
                overlay.className = 'confirm-overlay';

                const dialog = document.createElement('div');
                dialog.className = 'confirm-dialog';

                const titleEl = document.createElement('h3');
                titleEl.textContent = title;
                dialog.appendChild(titleEl);

                const messageEl = document.createElement('p');
                messageEl.textContent = message;
                dialog.appendChild(messageEl);

                const actions = document.createElement('div');
                actions.className = 'confirm-actions';

                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'confirm-btn';
                cancelBtn.textContent = 'Cancel';

                const okBtn = document.createElement('button');
                okBtn.className = 'confirm-btn confirm-btn-primary';
                okBtn.textContent = 'Continue';

                actions.appendChild(cancelBtn);
                actions.appendChild(okBtn);
                dialog.appendChild(actions);
                overlay.appendChild(dialog);

                const cleanup = () => overlay.remove();

                cancelBtn.addEventListener('click', () => {
                    cleanup();
                    resolve(false);
                });

                okBtn.addEventListener('click', () => {
                    cleanup();
                    resolve(true);
                });

                overlay.addEventListener('click', (event) => {
                    if (event.target === overlay) {
                        cleanup();
                        resolve(false);
                    }
                });

                document.addEventListener('keydown', function handler(event) {
                    if (event.key === 'Escape') {
                        document.removeEventListener('keydown', handler);
                        cleanup();
                        resolve(false);
                    }
                }, { once: true });

                document.body.appendChild(overlay);
            });
        }

        function openLogs() {
            vscode.postMessage({ command: 'openLogs' });
        }

        function exportCSV() {
            vscode.postMessage({ command: 'exportCSV' });
        }

        function compareEnvironments() {
            vscode.postMessage({ command: 'compareEnvironments' });
        }

        function generateDiagram() {
            vscode.postMessage({ command: 'generateDiagram' });
        }

    </script>
</body>
</html>`;
}
