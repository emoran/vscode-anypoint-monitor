import {
    DependencyMap,
    DependencyEntry,
    BlastRadius,
    WarRoomData,
    WarRoomConfig,
    AppWarRoomData,
    TimelineEvent,
    LogGroup,
    DeploymentRecord,
    MetricSnapshot,
    Anomaly,
    AppStatus
} from '../../warroom/types';

// ── Dependency Maps ──────────────────────────────────────────────────────

export function createDependencyMap(overrides?: Partial<DependencyMap>): DependencyMap {
    return {
        generatedAt: '2026-02-27T10:00:00Z',
        environment: 'Production',
        apps: [
            { name: 'order-api', id: 'id-order', endpoints: ['order-api.cloudhub.io'] },
            { name: 'payment-sapi', id: 'id-payment', endpoints: ['payment-sapi.cloudhub.io'] },
            { name: 'inventory-sapi', id: 'id-inventory', endpoints: ['inventory-sapi.cloudhub.io'] },
            { name: 'notification-api', id: 'id-notify', endpoints: ['notification-api.cloudhub.io'] },
            { name: 'auth-service', id: 'id-auth', endpoints: ['auth-service.cloudhub.io'] },
            { name: 'logging-sapi', id: 'id-logging', endpoints: ['logging-sapi.cloudhub.io'] }
        ],
        dependencies: [
            // order-api -> payment-sapi (order calls payment)
            makeDep('order-api', 'payment-sapi'),
            // order-api -> inventory-sapi
            makeDep('order-api', 'inventory-sapi'),
            // payment-sapi -> notification-api
            makeDep('payment-sapi', 'notification-api'),
            // notification-api -> logging-sapi
            makeDep('notification-api', 'logging-sapi'),
            // auth-service -> order-api (auth calls order for validation)
            makeDep('auth-service', 'order-api')
        ],
        ...overrides
    };
}

function makeDep(source: string, target: string, external = false): DependencyEntry {
    return {
        sourceApp: source,
        targetApp: target,
        targetUrl: `https://${target}.cloudhub.io`,
        discoveryMethod: 'property_file',
        confidence: 'high',
        isExternal: external
    };
}

export function createEmptyDependencyMap(): DependencyMap {
    return {
        generatedAt: '2026-02-27T10:00:00Z',
        environment: 'Production',
        apps: [],
        dependencies: []
    };
}

export function createDisconnectedDependencyMap(): DependencyMap {
    return {
        generatedAt: '2026-02-27T10:00:00Z',
        environment: 'Production',
        apps: [
            { name: 'app-a', id: 'id-a', endpoints: [] },
            { name: 'app-b', id: 'id-b', endpoints: [] },
            { name: 'app-c', id: 'id-c', endpoints: [] }
        ],
        dependencies: [] // No connections
    };
}

// Circular: A -> B -> C -> A
export function createCircularDependencyMap(): DependencyMap {
    return {
        generatedAt: '2026-02-27T10:00:00Z',
        environment: 'Production',
        apps: [
            { name: 'app-a', id: 'id-a', endpoints: [] },
            { name: 'app-b', id: 'id-b', endpoints: [] },
            { name: 'app-c', id: 'id-c', endpoints: [] }
        ],
        dependencies: [
            makeDep('app-a', 'app-b'),
            makeDep('app-b', 'app-c'),
            makeDep('app-c', 'app-a')
        ]
    };
}

// Deep chain: A -> B -> C -> D -> E (4 hops)
export function createDeepChainDependencyMap(): DependencyMap {
    return {
        generatedAt: '2026-02-27T10:00:00Z',
        environment: 'Production',
        apps: [
            { name: 'app-a', id: 'id-a', endpoints: [] },
            { name: 'app-b', id: 'id-b', endpoints: [] },
            { name: 'app-c', id: 'id-c', endpoints: [] },
            { name: 'app-d', id: 'id-d', endpoints: [] },
            { name: 'app-e', id: 'id-e', endpoints: [] }
        ],
        dependencies: [
            makeDep('app-a', 'app-b'),
            makeDep('app-b', 'app-c'),
            makeDep('app-c', 'app-d'),
            makeDep('app-d', 'app-e')
        ]
    };
}

// ── War Room Data Helpers ────────────────────────────────────────────────

export function createWarRoomConfig(overrides?: Partial<WarRoomConfig>): WarRoomConfig {
    return {
        environment: 'Production',
        environmentId: 'env-123',
        organizationId: 'org-456',
        applications: [{ name: 'order-api', id: 'id-order' }],
        timeWindow: {
            start: new Date('2026-02-27T09:00:00Z'),
            end: new Date('2026-02-27T09:30:00Z')
        },
        severity: 'SEV2',
        autoExpand: true,
        outputFormat: 'markdown',
        ...overrides
    };
}

export function createAppWarRoomData(overrides?: Partial<AppWarRoomData>): AppWarRoomData {
    return {
        logs: { groups: [], totalEntries: 0, errors: 0, warnings: 0 },
        deployments: [],
        metrics: {
            current: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
            baseline: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
            anomalies: []
        },
        status: { name: 'test-app', status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' },
        ...overrides
    };
}

export function createLogGroup(overrides?: Partial<LogGroup>): LogGroup {
    return {
        pattern: 'NullPointerException in OrderProcessor',
        level: 'ERROR',
        count: 5,
        firstSeen: '2026-02-27T09:15:00Z',
        lastSeen: '2026-02-27T09:25:00Z',
        sampleMessage: 'java.lang.NullPointerException: Cannot invoke method on null reference',
        appName: 'order-api',
        ...overrides
    };
}

export function createDeploymentRecord(overrides?: Partial<DeploymentRecord>): DeploymentRecord {
    return {
        appName: 'order-api',
        deploymentId: 'dep-001',
        version: '2.1.0',
        timestamp: '2026-02-27T09:05:00Z',
        status: 'APPLIED',
        triggeredBy: 'john.doe',
        suspicious: true,
        suspiciousReason: 'Deployed 10 minutes before errors started',
        ...overrides
    };
}

export function createAnomaly(overrides?: Partial<Anomaly>): Anomaly {
    return {
        metric: 'CPU',
        current: 92,
        baseline: 45,
        deviation: 104,
        severity: 'high',
        description: 'CPU usage at 92% (baseline 45%)',
        ...overrides
    };
}

export function createWarRoomData(overrides?: Partial<WarRoomData>): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();
    apps.set('order-api', createAppWarRoomData({ status: { name: 'order-api', status: 'RUNNING', workerCount: 2, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' } }));

    return {
        config: createWarRoomConfig(),
        blastRadius: {
            seedApps: ['order-api'],
            upstream: [],
            downstream: [],
            allAffected: ['order-api']
        },
        apps,
        collectionErrors: [],
        collectionTime: 5000,
        ...overrides
    };
}

// ── Scenario Builders ────────────────────────────────────────────────────

/**
 * Build a WarRoomData scenario where a deployment happened right before errors started.
 */
export function createDeploymentCorrelationScenario(): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();

    apps.set('order-api', createAppWarRoomData({
        logs: {
            groups: [
                createLogGroup({ count: 15, firstSeen: '2026-02-27T09:15:00Z' })
            ],
            totalEntries: 100,
            errors: 15,
            warnings: 5
        },
        deployments: [
            createDeploymentRecord({
                timestamp: '2026-02-27T09:05:00Z',
                suspicious: true
            })
        ],
        status: { name: 'order-api', status: 'RUNNING', workerCount: 2, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
    }));

    return {
        config: createWarRoomConfig(),
        blastRadius: {
            seedApps: ['order-api'],
            upstream: [],
            downstream: [],
            allAffected: ['order-api']
        },
        apps,
        collectionErrors: [],
        collectionTime: 5000
    };
}

/**
 * Build a WarRoomData scenario with high CPU and memory.
 */
export function createResourceExhaustionScenario(): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();

    apps.set('order-api', createAppWarRoomData({
        logs: {
            groups: [
                createLogGroup({ pattern: 'OutOfMemoryError', count: 3 })
            ],
            totalEntries: 50,
            errors: 3,
            warnings: 10
        },
        metrics: {
            current: { cpu: 95, memory: 92, messageCount: 1000, responseTime: 5000, timestamp: '2026-02-27T09:25:00Z' },
            baseline: { cpu: 40, memory: 50, messageCount: 500, responseTime: 200, timestamp: '2026-02-27T08:25:00Z' },
            anomalies: [
                createAnomaly({ metric: 'CPU', current: 95, baseline: 40, severity: 'high' }),
                createAnomaly({ metric: 'Memory', current: 92, baseline: 50, severity: 'high' })
            ]
        },
        status: { name: 'order-api', status: 'RUNNING', workerCount: 2, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
    }));

    return {
        config: createWarRoomConfig(),
        blastRadius: {
            seedApps: ['order-api'],
            upstream: [],
            downstream: [],
            allAffected: ['order-api']
        },
        apps,
        collectionErrors: [],
        collectionTime: 5000
    };
}

/**
 * Build a scenario with multiple apps failing simultaneously.
 */
export function createSharedDependencyScenario(): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();
    const failingApps = ['order-api', 'payment-sapi', 'inventory-sapi'];

    for (const name of failingApps) {
        apps.set(name, createAppWarRoomData({
            logs: {
                groups: [
                    createLogGroup({ appName: name, pattern: 'Connection timeout to database', count: 10 })
                ],
                totalEntries: 50,
                errors: 10,
                warnings: 5
            },
            status: { name, status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
        }));
    }

    return {
        config: createWarRoomConfig({ applications: failingApps.map(name => ({ name, id: `id-${name}` })) }),
        blastRadius: {
            seedApps: failingApps,
            upstream: [],
            downstream: [],
            allAffected: failingApps
        },
        apps,
        collectionErrors: [],
        collectionTime: 5000
    };
}

/**
 * Build a scenario where downstream apps fail before seed apps.
 */
export function createDownstreamFailureScenario(): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();

    // Seed app: errors started later
    apps.set('order-api', createAppWarRoomData({
        logs: {
            groups: [
                createLogGroup({
                    appName: 'order-api',
                    pattern: 'Connection refused to payment-sapi',
                    count: 20,
                    firstSeen: '2026-02-27T09:20:00Z'
                })
            ],
            totalEntries: 100,
            errors: 20,
            warnings: 5
        },
        status: { name: 'order-api', status: 'RUNNING', workerCount: 2, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
    }));

    // Downstream app: errors started earlier
    apps.set('payment-sapi', createAppWarRoomData({
        logs: {
            groups: [
                createLogGroup({
                    appName: 'payment-sapi',
                    pattern: 'Database connection pool exhausted',
                    count: 50,
                    firstSeen: '2026-02-27T09:10:00Z'
                })
            ],
            totalEntries: 200,
            errors: 50,
            warnings: 10
        },
        status: { name: 'payment-sapi', status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
    }));

    return {
        config: createWarRoomConfig(),
        blastRadius: {
            seedApps: ['order-api'],
            upstream: [],
            downstream: [{ app: 'payment-sapi', hops: 1 }],
            allAffected: ['order-api', 'payment-sapi']
        },
        apps,
        collectionErrors: [],
        collectionTime: 5000
    };
}

/**
 * Build a scenario with no errors — healthy state.
 */
export function createHealthyScenario(): WarRoomData {
    const apps = new Map<string, AppWarRoomData>();

    apps.set('order-api', createAppWarRoomData({
        status: { name: 'order-api', status: 'RUNNING', workerCount: 2, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' },
        metrics: {
            current: { cpu: 30, memory: 40, messageCount: 500, responseTime: 100, timestamp: '2026-02-27T09:25:00Z' },
            baseline: { cpu: 28, memory: 38, messageCount: 480, responseTime: 95, timestamp: '2026-02-27T08:25:00Z' },
            anomalies: []
        }
    }));

    return {
        config: createWarRoomConfig(),
        blastRadius: {
            seedApps: ['order-api'],
            upstream: [],
            downstream: [],
            allAffected: ['order-api']
        },
        apps,
        collectionErrors: [],
        collectionTime: 3000
    };
}
