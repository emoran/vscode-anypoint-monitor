import * as assert from 'assert';
import { calculateBlastRadius } from '../../warroom/blastRadius';
import {
    createDependencyMap,
    createEmptyDependencyMap,
    createDisconnectedDependencyMap,
    createCircularDependencyMap,
    createDeepChainDependencyMap
} from '../mocks/warRoomMocks';

suite('BlastRadius Test Suite', () => {

    suite('calculateBlastRadius', () => {

        test('should return seed apps in allAffected when no connections', () => {
            const depMap = createDisconnectedDependencyMap();
            const result = calculateBlastRadius(['app-a'], depMap);

            assert.deepStrictEqual(result.seedApps, ['app-a']);
            assert.strictEqual(result.upstream.length, 0);
            assert.strictEqual(result.downstream.length, 0);
            assert.deepStrictEqual(result.allAffected, ['app-a']);
        });

        test('should find direct downstream dependencies (1-hop)', () => {
            const depMap = createDependencyMap();
            // order-api calls payment-sapi and inventory-sapi
            const result = calculateBlastRadius(['order-api'], depMap);

            const downstreamNames = result.downstream.map(d => d.app).sort();
            assert.ok(downstreamNames.includes('payment-sapi'), 'payment-sapi should be downstream');
            assert.ok(downstreamNames.includes('inventory-sapi'), 'inventory-sapi should be downstream');

            // Verify hops
            const paymentEntry = result.downstream.find(d => d.app === 'payment-sapi');
            assert.strictEqual(paymentEntry?.hops, 1);
        });

        test('should find 2-hop downstream dependencies', () => {
            const depMap = createDependencyMap();
            // order-api -> payment-sapi -> notification-api (2 hops)
            const result = calculateBlastRadius(['order-api'], depMap);

            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(downstreamNames.includes('notification-api'), 'notification-api should be 2-hop downstream');

            const notifyEntry = result.downstream.find(d => d.app === 'notification-api');
            assert.strictEqual(notifyEntry?.hops, 2);
        });

        test('should NOT find dependencies beyond 2 hops', () => {
            const depMap = createDependencyMap();
            // order-api -> payment-sapi -> notification-api -> logging-sapi (3 hops — too far)
            const result = calculateBlastRadius(['order-api'], depMap);

            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(!downstreamNames.includes('logging-sapi'), 'logging-sapi should be beyond 2-hop limit');
        });

        test('should find upstream dependencies', () => {
            const depMap = createDependencyMap();
            // auth-service calls order-api, so auth-service is upstream of order-api
            const result = calculateBlastRadius(['order-api'], depMap);

            const upstreamNames = result.upstream.map(d => d.app);
            assert.ok(upstreamNames.includes('auth-service'), 'auth-service should be upstream');

            const authEntry = result.upstream.find(d => d.app === 'auth-service');
            assert.strictEqual(authEntry?.hops, 1);
        });

        test('should combine upstream, downstream, and seeds in allAffected', () => {
            const depMap = createDependencyMap();
            const result = calculateBlastRadius(['order-api'], depMap);

            assert.ok(result.allAffected.includes('order-api'), 'seed app should be in allAffected');
            // All upstream and downstream should be in allAffected
            for (const u of result.upstream) {
                assert.ok(result.allAffected.includes(u.app), `upstream ${u.app} should be in allAffected`);
            }
            for (const d of result.downstream) {
                assert.ok(result.allAffected.includes(d.app), `downstream ${d.app} should be in allAffected`);
            }
        });

        test('should handle multiple seed apps', () => {
            const depMap = createDependencyMap();
            const result = calculateBlastRadius(['order-api', 'payment-sapi'], depMap);

            // Both seeds should be in allAffected
            assert.ok(result.allAffected.includes('order-api'));
            assert.ok(result.allAffected.includes('payment-sapi'));

            // Seeds should NOT appear in upstream or downstream
            const upstreamNames = result.upstream.map(d => d.app);
            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(!upstreamNames.includes('order-api'));
            assert.ok(!upstreamNames.includes('payment-sapi'));
            assert.ok(!downstreamNames.includes('order-api'));
            assert.ok(!downstreamNames.includes('payment-sapi'));
        });

        test('should handle circular dependencies without infinite loop', () => {
            const depMap = createCircularDependencyMap();
            // A -> B -> C -> A (cycle)
            const result = calculateBlastRadius(['app-a'], depMap);

            // Should terminate and return results
            assert.deepStrictEqual(result.seedApps, ['app-a']);
            // B and C should be discovered
            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(downstreamNames.includes('app-b'));
            assert.ok(downstreamNames.includes('app-c'));
        });

        test('should respect MAX_HOPS=2 on deep chains', () => {
            const depMap = createDeepChainDependencyMap();
            // A -> B -> C -> D -> E
            const result = calculateBlastRadius(['app-a'], depMap);

            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(downstreamNames.includes('app-b'), 'app-b at 1 hop should be found');
            assert.ok(downstreamNames.includes('app-c'), 'app-c at 2 hops should be found');
            assert.ok(!downstreamNames.includes('app-d'), 'app-d at 3 hops should NOT be found');
            assert.ok(!downstreamNames.includes('app-e'), 'app-e at 4 hops should NOT be found');
        });

        test('should sort results by hops ascending', () => {
            const depMap = createDependencyMap();
            const result = calculateBlastRadius(['order-api'], depMap);

            // Downstream should be sorted by hops
            for (let i = 1; i < result.downstream.length; i++) {
                assert.ok(
                    result.downstream[i].hops >= result.downstream[i - 1].hops,
                    'downstream should be sorted by hops ascending'
                );
            }

            // Upstream should be sorted by hops
            for (let i = 1; i < result.upstream.length; i++) {
                assert.ok(
                    result.upstream[i].hops >= result.upstream[i - 1].hops,
                    'upstream should be sorted by hops ascending'
                );
            }
        });

        test('should handle empty dependency map', () => {
            const depMap = createEmptyDependencyMap();
            const result = calculateBlastRadius(['order-api'], depMap);

            assert.deepStrictEqual(result.seedApps, ['order-api']);
            assert.strictEqual(result.upstream.length, 0);
            assert.strictEqual(result.downstream.length, 0);
            assert.deepStrictEqual(result.allAffected, ['order-api']);
        });

        test('should handle seed app not in dependency map', () => {
            const depMap = createDependencyMap();
            const result = calculateBlastRadius(['nonexistent-app'], depMap);

            assert.deepStrictEqual(result.seedApps, ['nonexistent-app']);
            assert.strictEqual(result.upstream.length, 0);
            assert.strictEqual(result.downstream.length, 0);
            assert.deepStrictEqual(result.allAffected, ['nonexistent-app']);
        });

        test('should skip external dependencies', () => {
            const depMap = createDependencyMap({
                dependencies: [
                    ...createDependencyMap().dependencies,
                    {
                        sourceApp: 'order-api',
                        targetApp: 'external-service.example.com',
                        targetUrl: 'https://external-service.example.com',
                        discoveryMethod: 'property_file',
                        confidence: 'medium',
                        isExternal: true
                    }
                ]
            });

            const result = calculateBlastRadius(['order-api'], depMap);
            const downstreamNames = result.downstream.map(d => d.app);
            assert.ok(!downstreamNames.includes('external-service.example.com'), 'external deps should be excluded');
        });

        test('should produce unique allAffected entries', () => {
            const depMap = createDependencyMap();
            const result = calculateBlastRadius(['order-api'], depMap);

            const uniqueAffected = [...new Set(result.allAffected)];
            assert.strictEqual(result.allAffected.length, uniqueAffected.length, 'allAffected should have no duplicates');
        });

        test('should record shortest hop distance when multiple paths exist', () => {
            // Create a diamond: seed -> A (1 hop), seed -> B -> A (2 hops)
            // A should be recorded at 1 hop, not 2
            const depMap: typeof createDependencyMap extends () => infer T ? T : never = {
                generatedAt: '2026-02-27T10:00:00Z',
                environment: 'Production',
                apps: [
                    { name: 'seed', id: 'id-seed', endpoints: [] },
                    { name: 'app-a', id: 'id-a', endpoints: [] },
                    { name: 'app-b', id: 'id-b', endpoints: [] }
                ],
                dependencies: [
                    { sourceApp: 'seed', targetApp: 'app-a', targetUrl: '', discoveryMethod: 'property_file', confidence: 'high', isExternal: false },
                    { sourceApp: 'seed', targetApp: 'app-b', targetUrl: '', discoveryMethod: 'property_file', confidence: 'high', isExternal: false },
                    { sourceApp: 'app-b', targetApp: 'app-a', targetUrl: '', discoveryMethod: 'property_file', confidence: 'high', isExternal: false }
                ]
            };

            const result = calculateBlastRadius(['seed'], depMap);
            const appAEntry = result.downstream.find(d => d.app === 'app-a');
            assert.strictEqual(appAEntry?.hops, 1, 'app-a should be recorded at shortest distance (1 hop)');
        });
    });
});
