import * as vscode from 'vscode';
import axios from 'axios';
import JSZip from 'jszip';
import { AccountService } from '../../controllers/accountService';
import { ApiHelper } from '../../controllers/apiHelper';
import { getBaseUrl } from '../../constants';
import { DependencyEntry } from '../../warroom/types';
import {
    fetchAllDeployedApps,
    extractEndpoints,
    discoverDependencies,
    discoverApiContracts,
    discoverApiManagerDependencies,
    AppInfo,
} from '../../warroom/dependencyMapper';
import {
    TracedNode,
    TracerGraphData,
    AppMetrics,
    buildTracerGraph,
    classifyAppHealth,
} from './graphLayout';
import { showConnectionTracerPanel } from './dependencyVizPanel';
import { telemetryService } from '../../services/telemetryService';

const DATASOURCE_CACHE_TTL = 300000;
const METRICS_REFRESH_INTERVAL = 30000;

interface CachedDatasource {
    id: number;
    database: string;
    baseUrl: string;
    fetchedAt: number;
}

let cachedDatasource: CachedDatasource | undefined;

let outputChannel: vscode.OutputChannel | undefined;
function log(msg: string): void {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Live Connection Tracer');
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
    outputChannel.show(true);
}

interface TracerState {
    panel: vscode.WebviewPanel | undefined;
    refreshTimer: ReturnType<typeof setInterval> | undefined;
    seedAppName: string;
    environmentId: string;
    environmentName: string;
    organizationId: string;
    allApps: AppInfo[];
    endpointMap: Map<string, string>;
    deps: DependencyEntry[];
    connectedAppNames: Set<string>;
}

let tracerState: TracerState | undefined;

export async function showDependencyVisualizer(context: vscode.ExtensionContext): Promise<void> {
    telemetryService.trackPageView('liveConnectionTracer');

    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showWarningMessage('Please log in first.');
        return;
    }

    let envJson = await accountService.getActiveAccountEnvironments();
    if (!envJson) {
        envJson = await context.secrets.get('anypoint.environments') || null;
    }
    if (!envJson) {
        vscode.window.showErrorMessage('No environments found. Please log in first.');
        return;
    }

    const parsed = JSON.parse(envJson);
    const environments = parsed.data || parsed || [];
    const envItems: Array<vscode.QuickPickItem & { id: string }> = environments.map((e: any) => ({
        label: e.name,
        description: e.type || '',
        id: e.id
    }));

    const selectedEnv = await vscode.window.showQuickPick(envItems, {
        placeHolder: 'Select environment to trace connections'
    });
    if (!selectedEnv) { return; }

    const environmentId = selectedEnv.id;
    const environmentName = selectedEnv.label;
    const organizationId = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);
    const accessToken = await accountService.getActiveAccountAccessToken() || '';

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Live Connection Tracer',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Fetching applications...' });

        const allApps = await fetchAllDeployedApps(apiHelper, baseUrl, organizationId, environmentId);
        if (allApps.length === 0) {
            vscode.window.showWarningMessage('No applications found in this environment.');
            return;
        }

        const appItems: Array<vscode.QuickPickItem & { appName: string }> = allApps.map(a => {
            const raw = a.rawData || {};
            const status = raw.status || raw.application?.status || 'UNKNOWN';
            const appType = raw.fullDomain ? 'CH1' : 'CH2';
            return {
                label: a.name,
                description: `${appType} · ${status}`,
                appName: a.name
            };
        });

        appItems.sort((a, b) => a.label.localeCompare(b.label));

        const selectedApp = await vscode.window.showQuickPick(appItems, {
            placeHolder: 'Select an application to trace its connections'
        });
        if (!selectedApp) { return; }

        const seedAppName = selectedApp.appName;

        progress.report({ message: 'Building endpoint map...' });

        const endpointMap = new Map<string, string>();
        for (const app of allApps) {
            const eps = extractEndpoints(app);
            for (const ep of eps) {
                endpointMap.set(ep, app.name);
                try {
                    const hostname = new URL(ep).hostname;
                    if (hostname) { endpointMap.set(hostname, app.name); }
                } catch {
                    // Bare hostname endpoint — add directly and also add first segment
                    if (ep.includes('.')) { endpointMap.set(ep, app.name); }
                }
            }
            // Also map the app name itself as a potential endpoint prefix
            endpointMap.set(app.name, app.name);
            endpointMap.set(`${app.name}.cloudhub.io`, app.name);
        }

        progress.report({ message: 'Discovering connections (API contracts)...' });

        const allDeps: DependencyEntry[] = [];

        const [contractDeps, autodiscoveryDeps] = await Promise.allSettled([
            discoverApiContracts(apiHelper, baseUrl, organizationId, environmentId, allApps),
            discoverApiManagerDependencies(apiHelper, baseUrl, organizationId, environmentId, allApps, endpointMap),
        ]);

        if (contractDeps.status === 'fulfilled') { allDeps.push(...contractDeps.value); }
        if (autodiscoveryDeps.status === 'fulfilled') { allDeps.push(...autodiscoveryDeps.value); }

        progress.report({ message: 'Enriching seed app properties...' });

        const seedApp = allApps.find(a => a.name === seedAppName);
        if (seedApp) {
            await enrichAppProperties(seedApp, apiHelper, baseUrl, organizationId, environmentId);
            log(`Seed app "${seedAppName}": ${Object.keys(seedApp.properties || {}).length} properties after enrichment`);

            progress.report({ message: 'Scanning runtime properties...' });

            const propDeps = await discoverDependencies(
                apiHelper, baseUrl, seedApp, organizationId, environmentId, endpointMap
            );
            log(`Property scan found ${propDeps.length} dependencies`);
            allDeps.push(...propDeps);
        }

        const seedDeps = allDeps.filter(
            d => d.sourceApp === seedAppName || d.targetApp === seedAppName
        );
        log(`Total: ${allDeps.length} deps, ${seedDeps.length} involving seed "${seedAppName}"`);

        // Deduplicate
        const seen = new Set<string>();
        const uniqueDeps = seedDeps.filter(dep => {
            const key = `${dep.sourceApp}->${dep.targetApp}:${dep.discoveryMethod}`;
            if (seen.has(key)) { return false; }
            seen.add(key);
            return true;
        });

        // Identify all connected apps
        const connectedAppNames = new Set<string>([seedAppName]);
        for (const dep of uniqueDeps) {
            connectedAppNames.add(dep.sourceApp);
            connectedAppNames.add(dep.targetApp);
        }

        // Also discover property-based deps for each connected app (1-hop)
        const neighborApps = allApps.filter(a => connectedAppNames.has(a.name) && a.name !== seedAppName);
        for (const neighbor of neighborApps) {
            const neighborDeps = await discoverDependencies(
                apiHelper, baseUrl, neighbor, organizationId, environmentId, endpointMap
            );
            for (const dep of neighborDeps) {
                if (connectedAppNames.has(dep.sourceApp) && connectedAppNames.has(dep.targetApp)) {
                    const key = `${dep.sourceApp}->${dep.targetApp}:${dep.discoveryMethod}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueDeps.push(dep);
                    }
                }
            }
        }

        progress.report({ message: 'Building graph nodes...' });

        const tracedNodes: TracedNode[] = [];
        for (const appName of connectedAppNames) {
            const app = allApps.find(a => a.name === appName);
            const raw = app?.rawData || {};
            const isCH1 = !!raw.fullDomain;
            const status = raw.status || raw.application?.status || 'UNKNOWN';
            const target = raw.target || {};
            const publicUrl = target.deploymentSettings?.http?.inbound?.publicUrl || raw.fullDomain || '';

            tracedNodes.push({
                id: appName,
                name: appName,
                type: isCH1 ? 'CH1' : 'CH2',
                status: status.toUpperCase(),
                health: classifyAppHealth(status),
                isSeed: appName === seedAppName,
                deploymentId: raw.id || '',
                publicUrl,
            });
        }

        // Add external nodes from deps
        for (const dep of uniqueDeps) {
            if (dep.isExternal && !connectedAppNames.has(dep.targetApp)) {
                tracedNodes.push({
                    id: dep.targetApp,
                    name: dep.targetApp,
                    type: 'EXTERNAL',
                    status: 'N/A',
                    health: 'nodata',
                    isSeed: false,
                });
                connectedAppNames.add(dep.targetApp);
            }
        }

        progress.report({ message: 'Fetching live metrics...' });

        const metricsMap = await fetchMetricsForApps(
            tracedNodes.filter(n => n.type !== 'EXTERNAL').map(n => n.name),
            baseUrl, accessToken, organizationId, environmentId
        );

        progress.report({ message: 'Rendering connection graph...' });

        const graphData = buildTracerGraph(seedAppName, tracedNodes, uniqueDeps, metricsMap);
        graphData.environmentName = environmentName;

        // Store state for refresh
        tracerState = {
            panel: undefined,
            refreshTimer: undefined,
            seedAppName,
            environmentId,
            environmentName,
            organizationId,
            allApps,
            endpointMap,
            deps: uniqueDeps,
            connectedAppNames,
        };

        const panel = showConnectionTracerPanel(context, graphData);
        tracerState.panel = panel;

        // Set up 30s live metric refresh
        tracerState.refreshTimer = setInterval(async () => {
            if (!tracerState?.panel) {
                clearTracerRefresh();
                return;
            }
            try {
                const freshToken = await accountService.getActiveAccountAccessToken() || '';
                const freshMetrics = await fetchMetricsForApps(
                    tracedNodes.filter(n => n.type !== 'EXTERNAL').map(n => n.name),
                    baseUrl, freshToken, organizationId, environmentId
                );
                const refreshedGraph = buildTracerGraph(seedAppName, tracedNodes, uniqueDeps, freshMetrics);
                refreshedGraph.environmentName = environmentName;
                tracerState.panel?.webview.postMessage({
                    command: 'updateMetrics',
                    graphData: refreshedGraph
                });
            } catch (err: any) {
                log(`Metric refresh failed: ${err.message}`);
            }
        }, METRICS_REFRESH_INTERVAL);

        panel.onDidDispose(() => {
            clearTracerRefresh();
            if (tracerState) { tracerState.panel = undefined; }
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'retrace':
                    if (message.appName) {
                        clearTracerRefresh();
                        panel.dispose();
                        await retraceFromApp(context, message.appName);
                    }
                    break;
                case 'openCommandCenter':
                    vscode.commands.executeCommand('anypoint-monitor.applicationCommandCenter');
                    break;
                case 'openLogs':
                    vscode.commands.executeCommand('anypoint-monitor.realTimeLogs');
                    break;
                case 'pickApp':
                    clearTracerRefresh();
                    panel.dispose();
                    await showDependencyVisualizer(context);
                    break;
            }
        });
    });
}

function clearTracerRefresh(): void {
    if (tracerState?.refreshTimer) {
        clearInterval(tracerState.refreshTimer);
        tracerState.refreshTimer = undefined;
    }
}

async function retraceFromApp(context: vscode.ExtensionContext, appName: string): Promise<void> {
    if (!tracerState) { return; }

    const accountService = new AccountService(context);
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);
    const accessToken = await accountService.getActiveAccountAccessToken() || '';

    const { allApps, endpointMap, environmentId, environmentName, organizationId } = tracerState;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Tracing connections',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: `Tracing from ${appName}...` });

        const allDeps: DependencyEntry[] = [];

        const [contractDeps, autodiscoveryDeps] = await Promise.allSettled([
            discoverApiContracts(apiHelper, baseUrl, organizationId, environmentId, allApps),
            discoverApiManagerDependencies(apiHelper, baseUrl, organizationId, environmentId, allApps, endpointMap),
        ]);

        if (contractDeps.status === 'fulfilled') { allDeps.push(...contractDeps.value); }
        if (autodiscoveryDeps.status === 'fulfilled') { allDeps.push(...autodiscoveryDeps.value); }

        const seedApp = allApps.find(a => a.name === appName);
        if (seedApp) {
            await enrichAppProperties(seedApp, apiHelper, baseUrl, organizationId, environmentId);
            const propDeps = await discoverDependencies(
                apiHelper, baseUrl, seedApp, organizationId, environmentId, endpointMap
            );
            allDeps.push(...propDeps);
        }

        const seedDeps = allDeps.filter(d => d.sourceApp === appName || d.targetApp === appName);
        const seen = new Set<string>();
        const uniqueDeps = seedDeps.filter(dep => {
            const key = `${dep.sourceApp}->${dep.targetApp}:${dep.discoveryMethod}`;
            if (seen.has(key)) { return false; }
            seen.add(key);
            return true;
        });

        const connectedAppNames = new Set<string>([appName]);
        for (const dep of uniqueDeps) {
            connectedAppNames.add(dep.sourceApp);
            connectedAppNames.add(dep.targetApp);
        }

        const tracedNodes: TracedNode[] = [];
        for (const name of connectedAppNames) {
            const app = allApps.find(a => a.name === name);
            const raw = app?.rawData || {};
            const isCH1 = !!raw.fullDomain;
            const status = raw.status || raw.application?.status || 'UNKNOWN';
            const target = raw.target || {};
            const publicUrl = target.deploymentSettings?.http?.inbound?.publicUrl || raw.fullDomain || '';
            const isExt = !app;

            tracedNodes.push({
                id: name,
                name,
                type: isExt ? 'EXTERNAL' : (isCH1 ? 'CH1' : 'CH2'),
                status: isExt ? 'N/A' : status.toUpperCase(),
                health: isExt ? 'nodata' : classifyAppHealth(status),
                isSeed: name === appName,
                deploymentId: raw.id || '',
                publicUrl,
            });
        }

        progress.report({ message: 'Fetching live metrics...' });

        const metricsMap = await fetchMetricsForApps(
            tracedNodes.filter(n => n.type !== 'EXTERNAL').map(n => n.name),
            baseUrl, accessToken, organizationId, environmentId
        );

        const graphData = buildTracerGraph(appName, tracedNodes, uniqueDeps, metricsMap);
        graphData.environmentName = environmentName;

        tracerState!.seedAppName = appName;
        tracerState!.deps = uniqueDeps;
        tracerState!.connectedAppNames = connectedAppNames;

        const panel = showConnectionTracerPanel(context, graphData);
        tracerState!.panel = panel;

        tracerState!.refreshTimer = setInterval(async () => {
            if (!tracerState?.panel) {
                clearTracerRefresh();
                return;
            }
            try {
                const freshToken = await accountService.getActiveAccountAccessToken() || '';
                const freshMetrics = await fetchMetricsForApps(
                    tracedNodes.filter(n => n.type !== 'EXTERNAL').map(n => n.name),
                    baseUrl, freshToken, organizationId, environmentId
                );
                const refreshedGraph = buildTracerGraph(appName, tracedNodes, uniqueDeps, freshMetrics);
                refreshedGraph.environmentName = environmentName;
                tracerState?.panel?.webview.postMessage({
                    command: 'updateMetrics',
                    graphData: refreshedGraph
                });
            } catch (err: any) {
                log(`Metric refresh failed: ${err.message}`);
            }
        }, METRICS_REFRESH_INTERVAL);

        panel.onDidDispose(() => {
            clearTracerRefresh();
            if (tracerState) { tracerState.panel = undefined; }
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'retrace':
                    if (message.appName) {
                        clearTracerRefresh();
                        panel.dispose();
                        await retraceFromApp(context, message.appName);
                    }
                    break;
                case 'openCommandCenter':
                    vscode.commands.executeCommand('anypoint-monitor.applicationCommandCenter');
                    break;
                case 'openLogs':
                    vscode.commands.executeCommand('anypoint-monitor.realTimeLogs');
                    break;
                case 'pickApp':
                    clearTracerRefresh();
                    panel.dispose();
                    await showDependencyVisualizer(context);
                    break;
            }
        });
    });
}

async function enrichAppProperties(
    app: AppInfo,
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string
): Promise<void> {
    const isCH1 = !!app.rawData?.fullDomain;
    const merged: Record<string, string> = { ...(app.properties || {}) };

    // Step 1: Fetch API-level properties (Runtime Manager overrides)
    if (isCH1) {
        try {
            const resp = await apiHelper.get(
                `${baseUrl}/cloudhub/api/applications/${app.name}`,
                { headers: { 'X-ANYPNT-ENV-ID': environmentId, 'X-ANYPNT-ORG-ID': organizationId }, timeout: 10000 }
            );
            if (resp.status === 200 && resp.data) {
                const detail = resp.data;
                if (detail.properties && typeof detail.properties === 'object') {
                    for (const [k, v] of Object.entries(detail.properties)) {
                        if (typeof v === 'string') { merged[k] = v; }
                    }
                }
                app.rawData = { ...app.rawData, ...detail };
            }
        } catch (e: any) {
            log(`CH1 detail fetch failed for ${app.name}: ${e.message}`);
        }
    } else {
        const deploymentId = app.deploymentId || app.rawData?.id;
        if (deploymentId) {
            try {
                const resp = await apiHelper.get(
                    `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${deploymentId}`,
                    { timeout: 10000 }
                );
                if (resp.status === 200 && resp.data) {
                    const detail = resp.data;
                    const ch2Props = detail.application?.configuration?.mule?.['mule.agent.application.properties.service']?.properties
                        || detail.application?.configuration?.properties
                        || {};
                    for (const [k, v] of Object.entries(ch2Props)) {
                        if (typeof v === 'string') { merged[k] = v; }
                    }
                    app.rawData = { ...app.rawData, ...detail };
                }
            } catch (e: any) {
                log(`CH2 detail fetch failed for ${app.name}: ${e.message}`);
            }
        }
    }

    // Step 2: Download JAR and extract .properties files for full connection data
    const jarProps = await extractPropertiesFromJar(app, apiHelper, baseUrl, organizationId, environmentId);
    for (const [k, v] of Object.entries(jarProps)) {
        if (!merged[k]) { merged[k] = v; }
    }

    app.properties = merged;
    log(`enrichAppProperties for "${app.name}" (${isCH1 ? 'CH1' : 'CH2'}): ${Object.keys(merged).length} total properties`);
}

async function extractPropertiesFromJar(
    app: AppInfo,
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string
): Promise<Record<string, string>> {
    const props: Record<string, string> = {};
    const isCH1 = !!app.rawData?.fullDomain;

    try {
        let jarData: ArrayBuffer | undefined;

        if (isCH1) {
            const domain = app.rawData?.domain || app.name;
            const encodedDomain = encodeURIComponent(domain);
            // CH1 API returns "filename" (lowercase n)
            const fileName = app.rawData?.filename || app.rawData?.fileName;
            log(`CH1 filename for "${app.name}": ${fileName}`);

            // Strategy 1: CloudHub download endpoint (the correct CH1 pattern)
            // /cloudhub/api/organizations/{orgId}/environments/{envId}/applications/{domain}/download/{fileName}
            if (fileName && typeof fileName === 'string') {
                const downloadUrl = `${baseUrl}/cloudhub/api/organizations/${organizationId}/environments/${environmentId}/applications/${encodedDomain}/download/${encodeURIComponent(fileName)}`;
                log(`Trying CH1 direct download for "${app.name}": ${downloadUrl}`);
                jarData = await tryDownloadJar(apiHelper, downloadUrl, environmentId, organizationId);
                if (jarData) {
                    log(`CH1 JAR downloaded for "${app.name}" via direct download (${(jarData as any).byteLength || 0} bytes)`);
                }
            }

            // Strategy 2: Fallback URL patterns
            if (!jarData) {
                const candidateUrls = [
                    `${baseUrl}/cloudhub/api/organizations/${organizationId}/environments/${environmentId}/applications/${encodedDomain}/download`,
                    `${baseUrl}/cloudhub/api/v2/applications/${encodedDomain}/artifact`,
                    `${baseUrl}/cloudhub/api/applications/${encodedDomain}/artifact`,
                ];

                for (const artifactUrl of candidateUrls) {
                    log(`Trying CH1 JAR download for "${app.name}": ${artifactUrl}`);
                    jarData = await tryDownloadJar(apiHelper, artifactUrl, environmentId, organizationId);
                    if (jarData) {
                        log(`CH1 JAR downloaded for "${app.name}" (${(jarData as any).byteLength || 0} bytes) from ${artifactUrl}`);
                        break;
                    }
                }
            }

            // Strategy 3: Try Exchange/GraphQL if fileName has coordinates
            if (!jarData && fileName && typeof fileName === 'string') {
                const coords = parseFileNameCoordinates(fileName, organizationId);
                if (coords) {
                    log(`CH1 Exchange coordinates from fileName "${fileName}": ${coords.groupId}/${coords.artifactId}/${coords.version}`);
                    jarData = await downloadJarFromExchange(apiHelper, baseUrl, coords.groupId, coords.artifactId, coords.version);
                    if (jarData) {
                        log(`CH1 JAR downloaded via Exchange for "${app.name}" (${(jarData as any).byteLength || 0} bytes)`);
                    }
                }
            }
        } else {
            // CH2: try GraphQL → S3 download for the artifact
            const ref = app.rawData?.application?.ref;
            if (ref?.groupId && ref?.artifactId && ref?.version) {
                log(`Downloading CH2 JAR for "${app.name}" via GraphQL (${ref.groupId}/${ref.artifactId}/${ref.version})`);
                try {
                    const gqlResp = await apiHelper.post(`${baseUrl}/graph/api/v2/graphql`, {
                        query: `query asset { asset(groupId:"${ref.groupId}", assetId:"${ref.artifactId}", version:"${ref.version}") { files { classifier packaging externalLink } } }`
                    });
                    if (gqlResp.status === 200) {
                        const files = gqlResp.data?.data?.asset?.files || [];
                        const jarFile = files.find((f: any) => f.packaging === 'jar' && f.externalLink);
                        if (jarFile?.externalLink) {
                            const s3Resp = await axios.get(jarFile.externalLink, {
                                responseType: 'arraybuffer',
                                timeout: 30000,
                                validateStatus: (status: number) => (status ?? 0) < 500,
                            });
                            if (s3Resp.status === 200 && s3Resp.data) {
                                jarData = s3Resp.data;
                                log(`CH2 JAR downloaded for "${app.name}" (${(s3Resp.data as any).byteLength || 'unknown'} bytes)`);
                            }
                        }
                    }
                } catch (gqlErr: any) {
                    log(`CH2 GraphQL JAR fetch failed for "${app.name}": ${gqlErr.message}`);
                }
            }
        }

        if (!jarData) {
            log(`No JAR available for "${app.name}", skipping .properties extraction`);
            return props;
        }

        const zip = await JSZip.loadAsync(jarData);
        let propFileCount = 0;

        for (const [path, file] of Object.entries(zip.files)) {
            if (file.dir) { continue; }
            // Match .properties and .yaml/.yml config files inside the JAR
            if (path.endsWith('.properties') || path.endsWith('.yaml') || path.endsWith('.yml')) {
                try {
                    const content = await file.async('string');
                    propFileCount++;

                    if (path.endsWith('.properties')) {
                        parsePropertiesFile(content, props);
                    } else {
                        parseYamlProperties(content, props);
                    }
                } catch {
                    // Skip unreadable files
                }
            }
        }

        log(`Extracted properties from ${propFileCount} config files in JAR for "${app.name}" → ${Object.keys(props).length} properties`);
    } catch (e: any) {
        log(`JAR extraction failed for "${app.name}": ${e.message}`);
    }

    return props;
}

function parsePropertiesFile(content: string, result: Record<string, string>): void {
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) { continue; }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) { continue; }
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (key && value && !value.startsWith('${') && !value.startsWith('![')) {
            result[key] = value;
        }
    }
}

function parseYamlProperties(content: string, result: Record<string, string>): void {
    // Lightweight YAML key:value extraction — handles flat and simple nested structures
    const lines = content.split('\n');
    const keyStack: string[] = [];
    const indentStack: number[] = [-1];

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) { continue; }
        const match = line.match(/^(\s*)([\w.-]+)\s*:\s*(.*)/);
        if (!match) { continue; }

        const indent = match[1].length;
        const key = match[2];
        const rawValue = match[3].trim();

        while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1]) {
            indentStack.pop();
            keyStack.pop();
        }

        if (rawValue && !rawValue.startsWith('{') && !rawValue.startsWith('[') && !rawValue.startsWith('${') && !rawValue.startsWith('![')) {
            const fullKey = [...keyStack, key].join('.');
            const cleaned = rawValue.replace(/^["']|["']$/g, '');
            if (cleaned) { result[fullKey] = cleaned; }
        } else if (!rawValue) {
            keyStack.push(key);
            indentStack.push(indent);
        }
    }
}

async function tryDownloadJar(
    apiHelper: ApiHelper,
    url: string,
    environmentId: string,
    organizationId: string
): Promise<ArrayBuffer | undefined> {
    try {
        const resp = await apiHelper.get(url, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationId,
                'Accept': 'application/java-archive, application/zip, application/octet-stream',
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: (status: number) => (status ?? 0) < 500,
        });
        if (resp.status === 200 && resp.data) {
            const size = (resp.data as any).byteLength || 0;
            const contentType = resp.headers?.['content-type'] || '';
            if (size > 1000 && !contentType.includes('text/html')) {
                return resp.data;
            }
            log(`JAR response too small (${size} bytes) or HTML from ${url}`);
        } else {
            log(`JAR download returned status ${resp.status} from ${url}`);
        }
    } catch (e: any) {
        log(`JAR download failed: ${e.message}`);
    }
    return undefined;
}

function parseFileNameCoordinates(fileName: string, fallbackGroupId: string): { groupId: string; artifactId: string; version: string } | undefined {
    // CH1 fileName formats:
    //   "bonfire-1.0.0-mule-application.jar"
    //   "cisco-meraki-nx-am-papi-2.3.1-mule-application.jar"
    //   Coordinates: groupId = orgId, artifactId = name part, version = version part
    const match = fileName.match(/^(.+?)-(\d+\.\d+\.\d+(?:-SNAPSHOT)?)-mule-application\.jar$/i);
    if (match) {
        return { groupId: fallbackGroupId, artifactId: match[1], version: match[2] };
    }
    return undefined;
}

async function downloadJarFromExchange(
    apiHelper: ApiHelper,
    baseUrl: string,
    groupId: string,
    artifactId: string,
    version: string
): Promise<ArrayBuffer | undefined> {
    // Strategy A: GraphQL to get S3 presigned URL
    try {
        log(`Exchange download: trying GraphQL for ${groupId}/${artifactId}/${version}`);
        const gqlResp = await apiHelper.post(`${baseUrl}/graph/api/v2/graphql`, {
            query: `query asset { asset(groupId:"${groupId}", assetId:"${artifactId}", version:"${version}") { files { classifier packaging externalLink } } }`
        });
        if (gqlResp.status === 200) {
            const files = gqlResp.data?.data?.asset?.files || [];
            const jarFile = files.find((f: any) => f.packaging === 'jar' && f.externalLink);
            if (jarFile?.externalLink) {
                log(`Exchange download: found S3 link for ${artifactId}`);
                const s3Resp = await axios.get(jarFile.externalLink, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    validateStatus: (status: number) => (status ?? 0) < 500,
                });
                if (s3Resp.status === 200 && s3Resp.data) {
                    return s3Resp.data;
                }
                log(`Exchange download: S3 returned status ${s3Resp.status}`);
            } else {
                log(`Exchange download: no JAR with externalLink found (${files.length} files)`);
            }
        }
    } catch (e: any) {
        log(`Exchange download: GraphQL failed: ${e.message}`);
    }

    // Strategy B: Maven Facade API
    try {
        const groupPath = groupId.replace(/\./g, '/');
        const mavenUrl = `https://maven.anypoint.mulesoft.com/api/v3/organizations/${groupId}/maven/${groupPath}/${artifactId}/${version}/${artifactId}-${version}-mule-application.jar`;
        log(`Exchange download: trying Maven Facade ${mavenUrl}`);
        const mvnResp = await apiHelper.get(mavenUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: (status: number) => (status ?? 0) < 500,
        });
        if (mvnResp.status === 200 && mvnResp.data) {
            const size = (mvnResp.data as any).byteLength || 0;
            if (size > 1000) {
                log(`Exchange download: Maven Facade success (${size} bytes)`);
                return mvnResp.data;
            }
        }
        log(`Exchange download: Maven Facade returned status ${mvnResp.status}`);
    } catch (e: any) {
        log(`Exchange download: Maven Facade failed: ${e.message}`);
    }

    // Strategy C: Exchange API
    try {
        const exchangeUrl = `${baseUrl}/exchange/api/v2/assets/${groupId}/${artifactId}/${version}/artifact`;
        log(`Exchange download: trying Exchange API ${exchangeUrl}`);
        const exResp = await apiHelper.get(exchangeUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: (status: number) => (status ?? 0) < 500,
        });
        if (exResp.status === 200 && exResp.data) {
            const size = (exResp.data as any).byteLength || 0;
            if (size > 1000) {
                log(`Exchange download: Exchange API success (${size} bytes)`);
                return exResp.data;
            }
        }
        log(`Exchange download: Exchange API returned status ${exResp.status}`);
    } catch (e: any) {
        log(`Exchange download: Exchange API failed: ${e.message}`);
    }

    return undefined;
}

async function fetchMetricsForApps(
    appNames: string[],
    baseUrl: string,
    accessToken: string,
    organizationId: string,
    environmentId: string
): Promise<Map<string, AppMetrics>> {
    const metricsMap = new Map<string, AppMetrics>();
    const datasource = await getVisualizerDatasource(baseUrl, accessToken);
    if (!datasource) { return metricsMap; }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const batchSize = 5;

    for (let i = 0; i < appNames.length; i += batchSize) {
        const batch = appNames.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(async (appName) => {
            try {
                const condition = `("org_id" = '${organizationId}' AND "env_id" = '${environmentId}' AND "app_id" = '${appName}')`;

                const totalReqQuery = `SELECT sum("avg_request_count") FROM "app_inbound_metric" WHERE ${condition} AND time >= now() - 15m GROUP BY time(1m) fill(0) tz('${timezone}')`;
                const failedReqQuery = `SELECT sum("avg_request_count") FROM "app_inbound_metric" WHERE ${condition} AND "response_type" = 'FAILED' AND time >= now() - 15m GROUP BY time(1m) fill(0) tz('${timezone}')`;
                const responseTimeQuery = `SELECT percentile("avg_response_time", 75) FROM "app_inbound_metric" WHERE ${condition} AND time >= now() - 15m GROUP BY time(1m) fill(none) tz('${timezone}')`;

                const proxyUrl = `${datasource.baseUrl}/monitoring/api/visualizer/api/datasources/proxy/${datasource.id}/query`;
                const authHeaders = { 'Authorization': `Bearer ${accessToken}` };

                const [totalResp, failedResp, rtResp] = await Promise.allSettled([
                    axios.get(proxyUrl, { params: { db: `"${datasource.database}"`, q: totalReqQuery, epoch: 'ms' }, headers: authHeaders, timeout: 8000 }),
                    axios.get(proxyUrl, { params: { db: `"${datasource.database}"`, q: failedReqQuery, epoch: 'ms' }, headers: authHeaders, timeout: 8000 }),
                    axios.get(proxyUrl, { params: { db: `"${datasource.database}"`, q: responseTimeQuery, epoch: 'ms' }, headers: authHeaders, timeout: 8000 }),
                ]);

                const totalRequests = sumSeriesValues(totalResp);
                const failedRequests = sumSeriesValues(failedResp);
                const avgResponseTimeMs = averageSeriesValues(rtResp);

                const minutes = 15;
                const requestsPerMin = totalRequests > 0 ? Math.round(totalRequests / minutes) : 0;
                const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

                metricsMap.set(appName, {
                    requestsPerMin,
                    errorRate: Math.round(errorRate * 100) / 100,
                    avgResponseTimeMs: Math.round(avgResponseTimeMs),
                    failedRequests: Math.round(failedRequests),
                    totalRequests: Math.round(totalRequests),
                });
            } catch { /* metrics unavailable for this app */ }
        }));

        if (i + batchSize < appNames.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return metricsMap;
}

function sumSeriesValues(result: PromiseSettledResult<any>): number {
    if (result.status !== 'fulfilled') { return 0; }
    try {
        const series = result.value.data?.results?.[0]?.series?.[0]?.values || [];
        return series.reduce((sum: number, point: any[]) => sum + (point[1] || 0), 0);
    } catch { return 0; }
}

function averageSeriesValues(result: PromiseSettledResult<any>): number {
    if (result.status !== 'fulfilled') { return 0; }
    try {
        const series = result.value.data?.results?.[0]?.series?.[0]?.values || [];
        const validPoints = series.filter((p: any[]) => p[1] !== null && p[1] !== undefined);
        if (validPoints.length === 0) { return 0; }
        const sum = validPoints.reduce((s: number, p: any[]) => s + p[1], 0);
        return sum / validPoints.length;
    } catch { return 0; }
}

async function getVisualizerDatasource(baseUrl: string, accessToken: string): Promise<CachedDatasource | undefined> {
    if (cachedDatasource && (Date.now() - cachedDatasource.fetchedAt) < DATASOURCE_CACHE_TTL) {
        return cachedDatasource;
    }

    try {
        const resp = await axios.get(`${baseUrl}/monitoring/api/visualizer/api/bootdata`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            timeout: 10000
        });

        const datasources = resp.data?.Settings?.datasources || [];
        const influx = datasources.find((d: any) => d.name === 'influxdb')
            || datasources.find((d: any) => d.type === 'influxdb' || d.meta?.id === 'influxdb');

        if (!influx) { return undefined; }

        cachedDatasource = {
            id: influx.id,
            database: influx.database || influx.jsonData?.database || 'anypoint_monitoring',
            baseUrl,
            fetchedAt: Date.now()
        };
        return cachedDatasource;
    } catch {
        return undefined;
    }
}
