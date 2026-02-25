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

export async function runWarRoom(
    context: vscode.ExtensionContext,
    config: WarRoomConfig
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'War Room',
        cancellable: true
    }, async (progress, token) => {
        const startTime = Date.now();
        const allErrors: CollectionError[] = [];

        // Step 1: Build blast radius
        progress.report({ message: 'Building blast radius...' });

        if (token.isCancellationRequested) { return; }

        let blastRadius: BlastRadius;

        if (config.autoExpand) {
            blastRadius = await resolveBlastRadius(context, config, progress, token);
        } else {
            blastRadius = {
                seedApps: config.applications.map(a => a.name),
                upstream: [],
                downstream: [],
                allAffected: config.applications.map(a => a.name)
            };
        }

        if (token.isCancellationRequested) { return; }

        // Build app lookup from config + blast radius
        const appLookup = buildAppLookup(config, blastRadius);
        const totalApps = blastRadius.allAffected.length;

        // Step 2: Collect data in parallel for all apps
        progress.report({ message: `Collecting data for ${totalApps} applications...` });

        const appsData = new Map<string, AppWarRoomData>();

        // Process apps in batches
        const appNames = blastRadius.allAffected;
        for (let i = 0; i < appNames.length; i += COLLECTOR_BATCH_SIZE) {
            if (token.isCancellationRequested) { return; }

            const batch = appNames.slice(i, i + COLLECTOR_BATCH_SIZE);
            const batchNum = Math.floor(i / COLLECTOR_BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(appNames.length / COLLECTOR_BATCH_SIZE);

            progress.report({
                message: `Collecting data (batch ${batchNum}/${totalBatches}): ${batch.join(', ')}...`
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
                    // Set empty data for failed apps
                    appsData.set(batch[j], getEmptyAppData(batch[j]));
                }
            }

            if (i + COLLECTOR_BATCH_SIZE < appNames.length) {
                await new Promise(resolve => setTimeout(resolve, COLLECTOR_BATCH_DELAY));
            }
        }

        if (token.isCancellationRequested) { return; }

        const collectionTime = Date.now() - startTime;

        // Step 3: Analyze correlations
        progress.report({ message: 'Analyzing correlations...' });

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

        // Step 4: Generate report
        progress.report({ message: 'Generating report...' });

        await generateReport(warRoomData, timeline, correlations);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        vscode.window.showInformationMessage(
            `War Room report generated in ${totalTime}s. Analyzed ${totalApps} apps with ${allErrors.length} collection errors.`
        );
    });
}

async function resolveBlastRadius(
    context: vscode.ExtensionContext,
    config: WarRoomConfig,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<BlastRadius> {
    let depMap = loadDependencyMap();

    if (!depMap || isDependencyMapStale(depMap)) {
        const action = depMap
            ? await vscode.window.showWarningMessage(
                'Dependency map is stale (>24hrs). Refresh now?',
                'Refresh', 'Use Stale', 'Skip Expansion'
            )
            : await vscode.window.showWarningMessage(
                'No dependency map found. Build one now? (This scans all deployed apps)',
                'Build Now', 'Skip Expansion'
            );

        if (action === 'Refresh' || action === 'Build Now') {
            progress.report({ message: 'Building dependency map...' });
            depMap = await buildDependencyMap(context, config.environmentId, progress);
        } else if (action === 'Skip Expansion' || !action) {
            return {
                seedApps: config.applications.map(a => a.name),
                upstream: [],
                downstream: [],
                allAffected: config.applications.map(a => a.name)
            };
        }
        // 'Use Stale' falls through with existing depMap
    }

    if (depMap) {
        const seedApps = config.applications.map(a => a.name);
        return calculateBlastRadius(seedApps, depMap);
    }

    return {
        seedApps: config.applications.map(a => a.name),
        upstream: [],
        downstream: [],
        allAffected: config.applications.map(a => a.name)
    };
}

interface AppLookupEntry {
    name: string;
    id: string;
    deploymentId?: string;
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
            deploymentId: app.deploymentId
        });
    }

    // Expanded apps may only have names; use name as ID
    for (const name of blastRadius.allAffected) {
        if (!lookup.has(name)) {
            lookup.set(name, { name, id: name });
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
            config.environmentId, config.timeWindow, entry.deploymentId
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
