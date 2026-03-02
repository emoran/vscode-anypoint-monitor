import * as assert from 'assert';
import { buildTimeline, analyzeCorrelations } from '../../warroom/correlationEngine';
import {
    createWarRoomData,
    createAppWarRoomData,
    createLogGroup,
    createDeploymentRecord,
    createAnomaly,
    createDeploymentCorrelationScenario,
    createResourceExhaustionScenario,
    createSharedDependencyScenario,
    createDownstreamFailureScenario,
    createConnectivityFailureScenario,
    createConnectivityFailureNoTargetErrorsScenario,
    createHealthyScenario
} from '../mocks/warRoomMocks';

suite('CorrelationEngine Test Suite', () => {

    suite('buildTimeline', () => {

        test('should return empty timeline for empty app data', () => {
            const data = createWarRoomData();
            // Default data has an empty app
            const timeline = buildTimeline(data);
            assert.strictEqual(timeline.length, 0);
        });

        test('should create deployment events', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ timestamp: '2026-02-27T09:05:00Z', version: '2.1.0', triggeredBy: 'john' })
                ]
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const deployEvents = timeline.filter(e => e.type === 'deployment');
            assert.strictEqual(deployEvents.length, 1);
            assert.strictEqual(deployEvents[0].app, 'order-api');
            assert.ok(deployEvents[0].description.includes('v2.1.0'));
            assert.ok(deployEvents[0].description.includes('john'));
        });

        test('should mark suspicious deployments as critical', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ suspicious: true })
                ]
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const deployEvents = timeline.filter(e => e.type === 'deployment');
            assert.strictEqual(deployEvents[0].severity, 'critical');
            assert.ok(deployEvents[0].description.includes('[SUSPICIOUS]'));
        });

        test('should mark non-suspicious deployments as info', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ suspicious: false })
                ]
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const deployEvents = timeline.filter(e => e.type === 'deployment');
            assert.strictEqual(deployEvents[0].severity, 'info');
        });

        test('should create error_spike events for errors with count >= 2', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ level: 'ERROR', count: 5, pattern: 'NullPointerException' })
                    ],
                    totalEntries: 50,
                    errors: 5,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const errorEvents = timeline.filter(e => e.type === 'error_spike');
            assert.strictEqual(errorEvents.length, 1);
            assert.ok(errorEvents[0].description.includes('5x'));
            assert.ok(errorEvents[0].description.includes('NullPointerException'));
        });

        test('should NOT create error_spike for count < 2', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ level: 'ERROR', count: 1 })
                    ],
                    totalEntries: 10,
                    errors: 1,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const errorEvents = timeline.filter(e => e.type === 'error_spike');
            assert.strictEqual(errorEvents.length, 0);
        });

        test('should mark high-count errors as critical (>= 20)', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ level: 'ERROR', count: 25 })
                    ],
                    totalEntries: 100,
                    errors: 25,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const errorEvents = timeline.filter(e => e.type === 'error_spike');
            assert.strictEqual(errorEvents[0].severity, 'critical');
        });

        test('should create warning_spike events for warnings with count >= 10', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ level: 'WARN', count: 15, pattern: 'Slow response' })
                    ],
                    totalEntries: 50,
                    errors: 0,
                    warnings: 15
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const warningEvents = timeline.filter(e => e.type === 'warning_spike');
            assert.strictEqual(warningEvents.length, 1);
            assert.strictEqual(warningEvents[0].severity, 'warning');
        });

        test('should NOT create warning_spike for count < 10', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ level: 'WARN', count: 5 })
                    ],
                    totalEntries: 20,
                    errors: 0,
                    warnings: 5
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const warningEvents = timeline.filter(e => e.type === 'warning_spike');
            assert.strictEqual(warningEvents.length, 0);
        });

        test('should create metric_anomaly events', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                metrics: {
                    current: { cpu: 95, memory: 92, messageCount: null, responseTime: null, timestamp: '2026-02-27T09:25:00Z' },
                    baseline: { cpu: 40, memory: 50, messageCount: null, responseTime: null, timestamp: '' },
                    anomalies: [
                        createAnomaly({ metric: 'CPU', description: 'CPU at 95%' })
                    ]
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const anomalyEvents = timeline.filter(e => e.type === 'metric_anomaly');
            assert.strictEqual(anomalyEvents.length, 1);
            assert.ok(anomalyEvents[0].description.includes('CPU at 95%'));
        });

        test('should create status_change events for non-running apps', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                status: { name: 'order-api', status: 'STOPPED', workerCount: 0, lastRestart: '2026-02-27T09:00:00Z', region: 'us-east-1', runtimeVersion: '4.6.0' }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const statusEvents = timeline.filter(e => e.type === 'status_change');
            assert.strictEqual(statusEvents.length, 1);
            assert.strictEqual(statusEvents[0].severity, 'critical');
            assert.ok(statusEvents[0].description.includes('STOPPED'));
        });

        test('should NOT create status_change for healthy statuses', () => {
            const healthyStatuses = ['STARTED', 'RUNNING', 'DEPLOYED', 'APPLIED'];

            for (const status of healthyStatuses) {
                const apps = new Map();
                apps.set('order-api', createAppWarRoomData({
                    status: { name: 'order-api', status, workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
                }));

                const data = createWarRoomData({ apps });
                const timeline = buildTimeline(data);

                const statusEvents = timeline.filter(e => e.type === 'status_change');
                assert.strictEqual(statusEvents.length, 0, `${status} should not generate a status_change event`);
            }
        });

        test('should sort events chronologically', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ timestamp: '2026-02-27T09:30:00Z' }),
                    createDeploymentRecord({ timestamp: '2026-02-27T09:00:00Z', deploymentId: 'dep-002' })
                ],
                logs: {
                    groups: [
                        createLogGroup({ level: 'ERROR', count: 5, firstSeen: '2026-02-27T09:15:00Z' })
                    ],
                    totalEntries: 50,
                    errors: 5,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            for (let i = 1; i < timeline.length; i++) {
                const prevTime = new Date(timeline[i - 1].timestamp).getTime();
                const currTime = new Date(timeline[i].timestamp).getTime();
                if (!isNaN(prevTime) && !isNaN(currTime)) {
                    assert.ok(currTime >= prevTime, 'timeline should be sorted chronologically');
                }
            }
        });

        test('should handle events with invalid timestamps gracefully', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ timestamp: 'invalid-date' }),
                    createDeploymentRecord({ timestamp: '2026-02-27T09:00:00Z', deploymentId: 'dep-002' })
                ]
            }));

            const data = createWarRoomData({ apps });
            // Should not throw
            const timeline = buildTimeline(data);
            assert.ok(timeline.length >= 1);
        });

        test('should skip deployments with timestamp "unknown"', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [
                    createDeploymentRecord({ timestamp: 'unknown' })
                ]
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const deployEvents = timeline.filter(e => e.type === 'deployment');
            assert.strictEqual(deployEvents.length, 0, 'unknown timestamp deployments should be skipped');
        });

        test('should include events from multiple apps', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                deployments: [createDeploymentRecord({ appName: 'order-api' })]
            }));
            apps.set('payment-sapi', createAppWarRoomData({
                deployments: [createDeploymentRecord({ appName: 'payment-sapi', deploymentId: 'dep-pay' })]
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);

            const appsInTimeline = new Set(timeline.map(e => e.app));
            assert.ok(appsInTimeline.has('order-api'));
            assert.ok(appsInTimeline.has('payment-sapi'));
        });
    });

    suite('analyzeCorrelations', () => {

        test('should detect deployment correlation', () => {
            const data = createDeploymentCorrelationScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const deployCorrelation = correlations.find(c => c.category === 'recent_deployment');
            assert.ok(deployCorrelation, 'should detect recent_deployment correlation');
            assert.ok(deployCorrelation.confidence === 'high' || deployCorrelation.confidence === 'medium');
            assert.ok(deployCorrelation.evidence.length > 0);
        });

        test('should detect resource exhaustion', () => {
            const data = createResourceExhaustionScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const resourceCorrelation = correlations.find(c => c.category === 'resource_exhaustion');
            assert.ok(resourceCorrelation, 'should detect resource_exhaustion correlation');
            assert.ok(resourceCorrelation.evidence.some(e => e.includes('CPU')));
            assert.ok(resourceCorrelation.evidence.some(e => e.includes('Memory')));
        });

        test('should detect shared dependency failure when >= 3 apps fail', () => {
            const data = createSharedDependencyScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const sharedCorrelation = correlations.find(c => c.category === 'shared_dependency');
            assert.ok(sharedCorrelation, 'should detect shared_dependency correlation');
            assert.ok(sharedCorrelation.probableCause.includes('3 apps'));
        });

        test('should detect downstream failure', () => {
            const data = createDownstreamFailureScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const downstreamCorrelation = correlations.find(c => c.category === 'downstream_failure');
            assert.ok(downstreamCorrelation, 'should detect downstream_failure correlation');
            assert.ok(downstreamCorrelation.evidence.some(e => e.includes('payment-sapi')));
        });

        test('should detect downstream failure with high confidence when downstream errors start first', () => {
            const data = createDownstreamFailureScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const downstreamCorrelation = correlations.find(c => c.category === 'downstream_failure');
            assert.ok(downstreamCorrelation);
            assert.strictEqual(downstreamCorrelation.confidence, 'high');
            assert.ok(downstreamCorrelation.evidence.some(e => e.includes('before upstream')));
        });

        test('should return "unknown" correlation when no patterns detected', () => {
            const data = createHealthyScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            assert.strictEqual(correlations.length, 1);
            assert.strictEqual(correlations[0].category, 'unknown');
            assert.strictEqual(correlations[0].confidence, 'low');
        });

        test('should sort correlations by confidence (high first)', () => {
            // Use a scenario that triggers multiple correlations
            const data = createDeploymentCorrelationScenario();
            // Add resource exhaustion too
            const appData = data.apps.get('order-api')!;
            appData.metrics.anomalies = [
                createAnomaly({ metric: 'CPU', current: 95, baseline: 40, severity: 'high' }),
                createAnomaly({ metric: 'Memory', current: 92, baseline: 50, severity: 'high' })
            ];

            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
            for (let i = 1; i < correlations.length; i++) {
                const prev = confidenceOrder[correlations[i - 1].confidence] || 3;
                const curr = confidenceOrder[correlations[i].confidence] || 3;
                assert.ok(curr >= prev, 'correlations should be sorted by confidence descending');
            }
        });

        test('should not detect resource exhaustion for medium-severity anomalies', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                metrics: {
                    current: { cpu: 70, memory: 65, messageCount: null, responseTime: null, timestamp: '2026-02-27T09:25:00Z' },
                    baseline: { cpu: 40, memory: 50, messageCount: null, responseTime: null, timestamp: '' },
                    anomalies: [
                        createAnomaly({ metric: 'CPU', current: 70, baseline: 40, severity: 'medium' }),
                        createAnomaly({ metric: 'Memory', current: 65, baseline: 50, severity: 'medium' })
                    ]
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const resourceCorrelation = correlations.find(c => c.category === 'resource_exhaustion');
            assert.ok(!resourceCorrelation, 'should not detect resource_exhaustion for medium severity');
        });

        test('should detect high-confidence deployment correlation when app has errors after deploy', () => {
            const data = createDeploymentCorrelationScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const deployCorrelation = correlations.find(c => c.category === 'recent_deployment');
            assert.ok(deployCorrelation);
            assert.strictEqual(deployCorrelation.confidence, 'high');
            assert.ok(deployCorrelation.evidence.some(e => e.includes('errors after deployment')));
        });

        test('should detect connectivity failure when error messages reference another app by hostname', () => {
            const data = createConnectivityFailureScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(connCorrelation, 'should detect connectivity_failure correlation');
            assert.ok(connCorrelation.evidence.some(e => e.includes('payment-sapi')));
            assert.ok(connCorrelation.evidence.some(e => e.includes('inventory-sapi')));
        });

        test('should detect connectivity failure with high confidence when referenced app also has errors', () => {
            const data = createConnectivityFailureScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(connCorrelation);
            assert.strictEqual(connCorrelation.confidence, 'high');
            assert.ok(connCorrelation.evidence.some(e => e.includes('also showing errors')));
        });

        test('should detect connectivity failure with medium confidence when referenced app has no errors', () => {
            const data = createConnectivityFailureNoTargetErrorsScenario();
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(connCorrelation, 'should detect connectivity_failure correlation');
            assert.strictEqual(connCorrelation.confidence, 'medium');
        });

        test('should NOT detect connectivity failure when no error messages reference other apps', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({
                            pattern: 'NullPointerException in OrderProcessor',
                            sampleMessage: 'java.lang.NullPointerException in OrderProcessor.process()',
                            count: 10
                        })
                    ],
                    totalEntries: 50,
                    errors: 10,
                    warnings: 0
                }
            }));
            apps.set('payment-sapi', createAppWarRoomData({
                status: { name: 'payment-sapi', status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
            }));

            const data = createWarRoomData({
                apps,
                blastRadius: {
                    seedApps: ['order-api'],
                    upstream: [],
                    downstream: [{ app: 'payment-sapi', hops: 1 }],
                    allAffected: ['order-api', 'payment-sapi']
                }
            });
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(!connCorrelation, 'should NOT detect connectivity_failure when no app references found');
        });

        test('should NOT match an app referencing itself in error messages', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({
                            pattern: 'Error in order-api processing pipeline',
                            sampleMessage: 'Error in order-api processing pipeline: timeout',
                            count: 10
                        })
                    ],
                    totalEntries: 50,
                    errors: 10,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({ apps });
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(!connCorrelation, 'should NOT detect connectivity_failure for self-references');
        });

        test('should detect connectivity failure via .anypointdns.net hostnames', () => {
            const apps = new Map();
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({
                            appName: 'order-api',
                            pattern: 'Connection refused: https://payment-sapi.anypointdns.net/api/payments',
                            sampleMessage: 'Connection refused: https://payment-sapi.anypointdns.net/api/payments',
                            count: 10,
                            firstSeen: '2026-02-27T09:15:00Z'
                        })
                    ],
                    totalEntries: 50,
                    errors: 10,
                    warnings: 0
                }
            }));
            apps.set('payment-sapi', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({ appName: 'payment-sapi', count: 5 })
                    ],
                    totalEntries: 30,
                    errors: 5,
                    warnings: 0
                },
                status: { name: 'payment-sapi', status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
            }));

            const data = createWarRoomData({
                apps,
                blastRadius: {
                    seedApps: ['order-api'],
                    upstream: [],
                    downstream: [{ app: 'payment-sapi', hops: 1 }],
                    allAffected: ['order-api', 'payment-sapi']
                }
            });
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(connCorrelation, 'should detect connectivity via .anypointdns.net');
            assert.ok(connCorrelation.evidence.some(e => e.includes('payment-sapi')));
        });

        test('should skip short app names (< 5 chars) to avoid false positives', () => {
            const apps = new Map();
            apps.set('api', createAppWarRoomData({
                logs: { groups: [], totalEntries: 0, errors: 0, warnings: 0 },
                status: { name: 'api', status: 'RUNNING', workerCount: 1, lastRestart: null, region: 'us-east-1', runtimeVersion: '4.6.0' }
            }));
            apps.set('order-api', createAppWarRoomData({
                logs: {
                    groups: [
                        createLogGroup({
                            // Contains "api" but should not match the short app name "api"
                            pattern: 'Error calling downstream api endpoint',
                            sampleMessage: 'Error calling downstream api endpoint: timeout',
                            count: 10
                        })
                    ],
                    totalEntries: 50,
                    errors: 10,
                    warnings: 0
                }
            }));

            const data = createWarRoomData({
                apps,
                blastRadius: {
                    seedApps: ['order-api'],
                    upstream: [],
                    downstream: [{ app: 'api', hops: 1 }],
                    allAffected: ['order-api', 'api']
                }
            });
            const timeline = buildTimeline(data);
            const correlations = analyzeCorrelations(data, timeline);

            const connCorrelation = correlations.find(c => c.category === 'connectivity_failure');
            assert.ok(!connCorrelation, 'should NOT match short app names to avoid false positives');
        });
    });
});
