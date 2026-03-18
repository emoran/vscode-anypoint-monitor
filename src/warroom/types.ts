// War Room Mode - Type Definitions

export interface WarRoomConfig {
    environment: string;
    environmentId: string;
    organizationId: string;
    applications: Array<{ name: string; id: string; deploymentId?: string; specificationId?: string }>;
    timeWindow: { start: Date; end: Date };
    severity: 'SEV1' | 'SEV2' | 'SEV3';
    autoExpand: boolean;
    outputFormat: 'markdown';
}

export interface DependencyMap {
    generatedAt: string;
    environment: string;
    apps: Array<{
        name: string;
        id: string;
        endpoints: string[];
    }>;
    dependencies: DependencyEntry[];
}

export interface DependencyEntry {
    sourceApp: string;
    targetApp: string;
    targetUrl: string;
    discoveryMethod: 'property_file' | 'mule_config' | 'api_autodiscovery' | 'api_contract' | 'naming_convention' | 'manual';
    confidence: 'high' | 'medium' | 'low';
    isExternal: boolean;
}

export interface ManualDependencyFile {
    dependencies: Array<{
        sourceApp: string;
        targetApp: string;
        note?: string;
    }>;
}

export interface BlastRadius {
    seedApps: string[];
    upstream: Array<{ app: string; hops: number }>;
    downstream: Array<{ app: string; hops: number }>;
    allAffected: string[];
}

export interface LogGroup {
    pattern: string;
    level: 'ERROR' | 'WARN';
    count: number;
    firstSeen: string;
    lastSeen: string;
    sampleMessage: string;
    appName: string;
}

export interface DeploymentRecord {
    appName: string;
    deploymentId: string;
    version: string;
    timestamp: string;
    status: string;
    triggeredBy: string;
    suspicious: boolean;
    suspiciousReason?: string;
}

export interface MetricSnapshot {
    cpu: number | null;
    memory: number | null;
    messageCount: number | null;
    responseTime: number | null;
    timestamp: string;
}

export interface Anomaly {
    metric: string;
    current: number;
    baseline: number;
    deviation: number;
    severity: 'high' | 'medium' | 'low';
    description: string;
}

export interface AppStatus {
    name: string;
    status: string;
    workerCount: number | null;
    lastRestart: string | null;
    region: string | null;
    runtimeVersion: string | null;
}

export interface AppWarRoomData {
    logs: {
        groups: LogGroup[];
        totalEntries: number;
        errors: number;
        warnings: number;
    };
    deployments: DeploymentRecord[];
    metrics: {
        current: MetricSnapshot;
        baseline: MetricSnapshot;
        anomalies: Anomaly[];
    };
    status: AppStatus;
}

export interface CollectionError {
    collector: string;
    app: string;
    error: string;
}

export interface WarRoomData {
    config: WarRoomConfig;
    blastRadius: BlastRadius;
    apps: Map<string, AppWarRoomData>;
    collectionErrors: CollectionError[];
    collectionTime: number;
}

export interface TimelineEvent {
    timestamp: string;
    type: 'deployment' | 'error_spike' | 'metric_anomaly' | 'status_change' | 'warning_spike';
    app: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    data?: Record<string, unknown>;
}

export interface CorrelationResult {
    probableCause: string;
    confidence: 'high' | 'medium' | 'low';
    evidence: string[];
    category: 'recent_deployment' | 'resource_exhaustion' | 'downstream_failure' | 'connectivity_failure' | 'shared_dependency' | 'unknown';
}

export interface WarRoomReport {
    config: WarRoomConfig;
    blastRadius: BlastRadius;
    timeline: TimelineEvent[];
    correlations: CorrelationResult[];
    apps: Map<string, AppWarRoomData>;
    collectionErrors: CollectionError[];
    collectionTime: number;
    generatedAt: string;
}
