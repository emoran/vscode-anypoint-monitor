import * as vscode from 'vscode';
import {
    WarRoomConfig,
    WarRoomData,
    BlastRadius,
    AppWarRoomData,
    CollectionError
} from './types';
import { loadDependencyMap, isDependencyMapStale, buildDependencyMap } from './dependencyMapper';
import { calculateBlastRadius } from './blastRadius';
import { collectLogs } from './collectors/logCollector';
import { collectDeployments } from './collectors/deployCollector';
import { collectMetrics } from './collectors/metricsCollector';
import { collectStatus } from './collectors/statusCollector';
import { buildTimeline, analyzeCorrelations } from './correlationEngine';
import { generateReport } from './reportGenerator';

const COLLECTOR_BATCH_SIZE = 3;
const COLLECTOR_BATCH_DELAY = 200;

// Progress weight distribution (must sum to 100)
const PROGRESS_BLAST_RADIUS = 10;
const PROGRESS_COLLECTION = 75;
const PROGRESS_CORRELATION = 5;
const PROGRESS_REPORT = 10;

function elapsed(startTime: number): string {
    return `${((Date.now() - startTime) / 1000).toFixed(0)}s`;
}

export async function runWarRoom(
    context: vscode.ExtensionContext,
    config: WarRoomConfig
): Promise<void> {
    // Resolve blast radius BEFORE showing the progress bar.
    // This avoids the dependency-map prompt being hidden behind the notification.
    let blastRadius: BlastRadius;

    if (config.autoExpand) {
        blastRadius = await resolveBlastRadius(context, config);
    } else {
        blastRadius = {
            seedApps: config.applications.map(a => a.name),
            upstream: [],
            downstream: [],
            allAffected: config.applications.map(a => a.name)
        };
    }

    // Now run the data collection + analysis with a visible progress bar
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'War Room',
        cancellable: true
    }, async (progress, token) => {
        const startTime = Date.now();
        const allErrors: CollectionError[] = [];

        // ── Step 1: Blast radius (already resolved, just report) ────────
        const totalApps = blastRadius.allAffected.length;
        const upCount = blastRadius.upstream.length;
        const downCount = blastRadius.downstream.length;
        progress.report({
            increment: PROGRESS_BLAST_RADIUS,
            message: `Blast radius: ${totalApps} apps (${config.applications.length} seed, ${upCount} upstream, ${downCount} downstream)`
        });

        if (token.isCancellationRequested) { return; }

        // Build app lookup from config + blast radius
        const appLookup = buildAppLookup(config, blastRadius);

        // ── Step 2: Collect data in parallel ────────────────────────────
        const appsData = new Map<string, AppWarRoomData>();
        const appNames = blastRadius.allAffected;
        const totalBatches = Math.ceil(appNames.length / COLLECTOR_BATCH_SIZE);
        const incrementPerBatch = PROGRESS_COLLECTION / Math.max(totalBatches, 1);

        for (let i = 0; i < appNames.length; i += COLLECTOR_BATCH_SIZE) {
            if (token.isCancellationRequested) { return; }

            const batch = appNames.slice(i, i + COLLECTOR_BATCH_SIZE);
            const batchNum = Math.floor(i / COLLECTOR_BATCH_SIZE) + 1;
            const completedApps = i;

            progress.report({
                increment: batchNum === 1 ? 0 : incrementPerBatch,
                message: `[${elapsed(startTime)}] Collecting logs, metrics, deployments... (${completedApps}/${totalApps} apps) - ${batch.join(', ')}`
            });

            const batchResults = await Promise.allSettled(
                batch.map(appName => collectAppData(
                    context, appName, appLookup, config, allErrors
                ))
            );

            for (let j = 0; j < batch.length; j++) {
                const result = batchResults[j];
                if (result.status === 'fulfilled') {
                    appsData.set(batch[j], result.value);
                } else {
                    allErrors.push({
                        collector: 'all',
                        app: batch[j],
                        error: result.reason?.message || 'Complete collection failure'
                    });
                    appsData.set(batch[j], getEmptyAppData(batch[j]));
                }
            }

            // Report after batch completes
            progress.report({
                increment: incrementPerBatch,
                message: `[${elapsed(startTime)}] Collected data for ${Math.min(i + COLLECTOR_BATCH_SIZE, totalApps)}/${totalApps} apps`
            });

            if (i + COLLECTOR_BATCH_SIZE < appNames.length) {
                await new Promise(resolve => setTimeout(resolve, COLLECTOR_BATCH_DELAY));
            }
        }

        if (token.isCancellationRequested) { return; }

        const collectionTime = Date.now() - startTime;

        // ── Step 3: Analyze correlations ────────────────────────────────
        progress.report({
            increment: PROGRESS_CORRELATION,
            message: `[${elapsed(startTime)}] Analyzing correlations and building timeline...`
        });

        const warRoomData: WarRoomData = {
            config,
            blastRadius,
            apps: appsData,
            collectionErrors: allErrors,
            collectionTime
        };

        const timeline = buildTimeline(warRoomData);
        const correlations = analyzeCorrelations(warRoomData, timeline);

        if (token.isCancellationRequested) { return; }

        // ── Step 4: Generate report ─────────────────────────────────────
        progress.report({
            increment: PROGRESS_REPORT,
            message: `[${elapsed(startTime)}] Generating markdown report...`
        });

        await generateReport(warRoomData, timeline, correlations);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        vscode.window.showInformationMessage(
            `War Room report generated in ${totalTime}s. Analyzed ${totalApps} apps, ${timeline.length} events, ${allErrors.length} collection errors.`
        );
    });
}

/**
 * Resolve blast radius OUTSIDE of the progress bar so that any user prompts
 * are not hidden behind the notification.
 *
 * Strategy:
 * 1. Auto-build the dependency map silently (with its own progress bar)
 * 2. Use graph-based expansion (2-hop BFS) if deps found
 * 3. Fall back to name-prefix matching when graph finds no connections
 * 4. Always enrich the lookup with real app IDs from the environment
 */
async function resolveBlastRadius(
    context: vscode.ExtensionContext,
    config: WarRoomConfig
): Promise<BlastRadius> {
    const seedNames = config.applications.map(a => a.name);

    // ── Step 1: Ensure we have a dependency map ────────────────────────
    let depMap = loadDependencyMap();

    if (!depMap || isDependencyMapStale(depMap)) {
        // Auto-build silently with a progress bar (no prompt)
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'War Room — Building Dependency Map',
                cancellable: false
            }, async (progress) => {
                depMap = await buildDependencyMap(context, config.environmentId, progress);
            });
        } catch (err: any) {
            console.warn('War Room: Failed to build dependency map:', err.message);
            // Continue without dep map — fall through to prefix matching
        }
    }

    // ── Step 2: Try graph-based expansion ──────────────────────────────
    if (depMap) {
        const blastRadius = calculateBlastRadius(seedNames, depMap);

        // If the graph found upstream or downstream apps, use it
        if (blastRadius.upstream.length > 0 || blastRadius.downstream.length > 0) {
            return blastRadius;
        }
    }

    // ── Step 3: Fallback — name-prefix matching ────────────────────────
    // Extract common prefixes from seed apps (e.g., "meraki-ccw" from "meraki-ccw-sfdc-papi-prod")
    const prefixes = extractCommonPrefixes(seedNames);

    // Get all app names from the dep map (which fetched all deployed apps)
    const allAppNames = depMap
        ? depMap.apps.map(a => a.name)
        : [];

    const related: Array<{ app: string; hops: number }> = [];
    for (const appName of allAppNames) {
        if (seedNames.includes(appName)) { continue; }
        if (prefixes.some(prefix => appName.startsWith(prefix))) {
            related.push({ app: appName, hops: 1 });
        }
    }

    if (related.length > 0) {
        return {
            seedApps: seedNames,
            upstream: [], // Can't determine direction from prefix matching
            downstream: related, // Show as "downstream" (related apps)
            allAffected: [...seedNames, ...related.map(r => r.app)]
        };
    }

    // No expansion possible
    return {
        seedApps: seedNames,
        upstream: [],
        downstream: [],
        allAffected: seedNames
    };
}

/**
 * Extract name prefixes for matching related apps.
 * "meraki-ccw-sfdc-papi-prod" → tries "meraki-ccw-sfdc-papi", "meraki-ccw-sfdc", "meraki-ccw"
 * Returns the shortest prefix that is at least 2 segments and shared by multiple seeds (or just the
 * individual prefixes when there's only one seed app).
 */
function extractCommonPrefixes(seedNames: string[]): string[] {
    const prefixes: string[] = [];

    for (const name of seedNames) {
        const parts = name.split('-');
        // Try prefixes from 2 segments up to (n-1) segments
        // e.g., for "meraki-ccw-sfdc-papi-prod": "meraki-ccw", "meraki-ccw-sfdc", "meraki-ccw-sfdc-papi"
        for (let len = Math.min(parts.length - 1, 3); len >= 2; len--) {
            const prefix = parts.slice(0, len).join('-');
            if (prefix.length >= 4) {
                prefixes.push(prefix + '-');
                break; // Use shortest meaningful prefix for this seed
            }
        }
    }

    return [...new Set(prefixes)];
}

interface AppLookupEntry {
    name: string;
    id: string;
    deploymentId?: string;
    specificationId?: string;
}

function buildAppLookup(
    config: WarRoomConfig,
    blastRadius: BlastRadius
): Map<string, AppLookupEntry> {
    const lookup = new Map<string, AppLookupEntry>();

    // Seed apps come from config with known IDs
    for (const app of config.applications) {
        lookup.set(app.name, {
            name: app.name,
            id: app.id,
            deploymentId: app.deploymentId,
            specificationId: app.specificationId
        });
    }

    // Expanded apps: try to get real IDs from the dependency map
    const depMap = loadDependencyMap();
    const depAppIndex = new Map<string, { id: string; deploymentId?: string }>();
    if (depMap) {
        for (const app of depMap.apps) {
            depAppIndex.set(app.name, { id: app.id });
        }
    }

    for (const name of blastRadius.allAffected) {
        if (!lookup.has(name)) {
            const depInfo = depAppIndex.get(name);
            lookup.set(name, {
                name,
                id: depInfo?.id || name,
                deploymentId: depInfo?.id  // For CH2 apps, the dep map id IS the deploymentId
            });
        }
    }

    return lookup;
}

async function collectAppData(
    context: vscode.ExtensionContext,
    appName: string,
    appLookup: Map<string, AppLookupEntry>,
    config: WarRoomConfig,
    allErrors: CollectionError[]
): Promise<AppWarRoomData> {
    const entry = appLookup.get(appName) || { name: appName, id: appName };

    // Run all collectors in parallel with Promise.allSettled
    const [logsResult, deployResult, metricsResult, statusResult] = await Promise.allSettled([
        collectLogs(
            context, appName, entry.id, config.organizationId,
            config.environmentId, config.timeWindow, entry.deploymentId, entry.specificationId
        ),
        collectDeployments(
            context, appName, entry.id, config.organizationId,
            config.environmentId, config.timeWindow.start, entry.deploymentId
        ),
        collectMetrics(
            context, appName, entry.id, config.organizationId,
            config.environmentId, config.timeWindow
        ),
        collectStatus(
            context, appName, entry.id, config.organizationId,
            config.environmentId, entry.deploymentId
        )
    ]);

    // Extract results and collect errors
    let logs = { groups: [] as any[], totalEntries: 0, errors: 0, warnings: 0 };
    let deployments: any[] = [];
    let metrics = {
        current: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
        baseline: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
        anomalies: [] as any[]
    };
    let status = { name: appName, status: 'UNKNOWN', workerCount: null, lastRestart: null, region: null, runtimeVersion: null };

    if (logsResult.status === 'fulfilled') {
        logs = logsResult.value.result;
        allErrors.push(...logsResult.value.errors);
    } else {
        allErrors.push({ collector: 'logs', app: appName, error: logsResult.reason?.message || 'Failed' });
    }

    if (deployResult.status === 'fulfilled') {
        deployments = deployResult.value.result;
        allErrors.push(...deployResult.value.errors);
    } else {
        allErrors.push({ collector: 'deployments', app: appName, error: deployResult.reason?.message || 'Failed' });
    }

    if (metricsResult.status === 'fulfilled') {
        metrics = metricsResult.value.result;
        allErrors.push(...metricsResult.value.errors);
    } else {
        allErrors.push({ collector: 'metrics', app: appName, error: metricsResult.reason?.message || 'Failed' });
    }

    if (statusResult.status === 'fulfilled') {
        status = statusResult.value.result;
        allErrors.push(...statusResult.value.errors);
    } else {
        allErrors.push({ collector: 'status', app: appName, error: statusResult.reason?.message || 'Failed' });
    }

    return { logs, deployments, metrics, status } as AppWarRoomData;
}

function getEmptyAppData(appName: string): AppWarRoomData {
    return {
        logs: { groups: [], totalEntries: 0, errors: 0, warnings: 0 },
        deployments: [],
        metrics: {
            current: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
            baseline: { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' },
            anomalies: []
        },
        status: { name: appName, status: 'UNKNOWN', workerCount: null, lastRestart: null, region: null, runtimeVersion: null }
    };
}
