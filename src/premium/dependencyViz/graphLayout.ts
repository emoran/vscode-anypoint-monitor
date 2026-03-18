import { DependencyEntry } from '../../warroom/types';

export type ConnectionHealth = 'healthy' | 'degraded' | 'failing' | 'nodata';

export interface AppMetrics {
    requestsPerMin: number;
    errorRate: number;
    avgResponseTimeMs: number;
    failedRequests: number;
    totalRequests: number;
}

export interface TracedNode {
    id: string;
    name: string;
    type: 'CH1' | 'CH2' | 'HYBRID' | 'EXTERNAL';
    status: string;
    health: ConnectionHealth;
    metrics?: AppMetrics;
    cpu?: number;
    memory?: number;
    vCores?: number;
    isSeed: boolean;
    deploymentId?: string;
    publicUrl?: string;
}

export interface TracedEdge {
    source: string;
    target: string;
    discoveryMethod: string;
    discoveryLabel: string;
    confidence: 'high' | 'medium' | 'low';
    health: ConnectionHealth;
    apiName?: string;
    contractId?: string;
    targetUrl?: string;
}

export interface TracerGraphData {
    seedApp: string;
    nodes: TracedNode[];
    edges: TracedEdge[];
    environmentName: string;
    lastRefreshed: string;
    summary: {
        totalConnections: number;
        healthy: number;
        degraded: number;
        failing: number;
        nodata: number;
        totalRequestsPerMin: number;
    };
}

const DISCOVERY_LABELS: Record<string, string> = {
    'api_contract': 'API Contract',
    'api_autodiscovery': 'API Autodiscovery',
    'property_file': 'Runtime Property',
    'mule_config': 'Mule Config',
    'naming_convention': 'Naming Convention',
    'manual': 'Manual',
};

export function getDiscoveryLabel(method: string): string {
    return DISCOVERY_LABELS[method] || method;
}

export function classifyHealth(metrics?: AppMetrics): ConnectionHealth {
    if (!metrics || metrics.totalRequests === 0) { return 'nodata'; }
    const errorRate = metrics.errorRate;
    const responseTime = metrics.avgResponseTimeMs;
    if (errorRate > 15 || responseTime > 5000) { return 'failing'; }
    if (errorRate > 5 || responseTime > 2000) { return 'degraded'; }
    return 'healthy';
}

export function classifyAppHealth(
    status: string,
    metrics?: AppMetrics,
    cpu?: number,
    memory?: number
): ConnectionHealth {
    const upper = (status || '').toUpperCase();
    if (upper === 'STOPPED' || upper === 'FAILED' || upper === 'UNDEPLOYED') {
        return 'failing';
    }
    if (cpu !== undefined && cpu > 90) { return 'failing'; }
    if (memory !== undefined && memory > 90) { return 'failing'; }
    if (cpu !== undefined && cpu > 75) { return 'degraded'; }
    if (memory !== undefined && memory > 75) { return 'degraded'; }
    if (metrics) { return classifyHealth(metrics); }
    if (upper === 'STARTED' || upper === 'RUNNING' || upper === 'APPLIED') {
        return 'healthy';
    }
    return 'nodata';
}

export function buildTracerGraph(
    seedAppName: string,
    nodes: TracedNode[],
    deps: DependencyEntry[],
    metricsMap: Map<string, AppMetrics>
): TracerGraphData {
    const nodeMap = new Map<string, TracedNode>();
    for (const n of nodes) { nodeMap.set(n.id, n); }

    // Apply metrics to nodes
    for (const [appName, metrics] of metricsMap) {
        const node = nodeMap.get(appName);
        if (node) {
            node.metrics = metrics;
            node.health = classifyAppHealth(node.status, metrics, node.cpu, node.memory);
        }
    }

    // Build edges from dependency entries
    const edges: TracedEdge[] = [];
    for (const dep of deps) {
        if (!nodeMap.has(dep.sourceApp) && !nodeMap.has(dep.targetApp)) { continue; }
        const sourceMetrics = metricsMap.get(dep.sourceApp);
        edges.push({
            source: dep.sourceApp,
            target: dep.targetApp,
            discoveryMethod: dep.discoveryMethod,
            discoveryLabel: getDiscoveryLabel(dep.discoveryMethod),
            confidence: dep.confidence,
            health: classifyHealth(sourceMetrics),
            targetUrl: dep.targetUrl,
        });
    }

    // Summary
    const connHealth = edges.map(e => e.health);
    const seedMetrics = metricsMap.get(seedAppName);
    const totalReqPerMin = nodes.reduce((s, n) => s + (n.metrics?.requestsPerMin || 0), 0);

    return {
        seedApp: seedAppName,
        nodes: Array.from(nodeMap.values()),
        edges,
        environmentName: '',
        lastRefreshed: new Date().toISOString(),
        summary: {
            totalConnections: edges.length,
            healthy: connHealth.filter(h => h === 'healthy').length,
            degraded: connHealth.filter(h => h === 'degraded').length,
            failing: connHealth.filter(h => h === 'failing').length,
            nodata: connHealth.filter(h => h === 'nodata').length,
            totalRequestsPerMin: Math.round(totalReqPerMin),
        },
    };
}
