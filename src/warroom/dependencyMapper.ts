import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DependencyMap, DependencyEntry, ManualDependencyFile } from './types';
import { ApiHelper } from '../controllers/apiHelper';
import { AccountService } from '../controllers/accountService';
import { getBaseUrl } from '../constants';

const WARROOM_DIR = '.warroom';
const DEPENDENCY_MAP_FILE = 'dependency-map.json';
const MANUAL_DEPS_FILE = 'manual-dependencies.json';

export async function buildDependencyMap(
    context: vscode.ExtensionContext,
    environmentId: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<DependencyMap> {
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationId = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);

    // Get environment name
    const envName = await getEnvironmentName(accountService, context, environmentId);

    progress?.report({ message: 'Fetching deployed applications...' });

    // Fetch all deployed apps
    const allApps = await fetchAllDeployedApps(apiHelper, baseUrl, organizationId, environmentId);

    progress?.report({ message: `Found ${allApps.length} apps. Scanning endpoints...` });

    // Build endpoint lookup: URL -> app name
    const endpointMap: Map<string, string> = new Map();
    const appEndpoints: Map<string, string[]> = new Map();

    for (const app of allApps) {
        const endpoints = extractEndpoints(app);
        appEndpoints.set(app.name, endpoints);
        for (const ep of endpoints) {
            endpointMap.set(ep, app.name);
            // Also store hostname-only version for matching
            try {
                const url = new URL(ep);
                endpointMap.set(url.hostname, app.name);
            } catch {
                // Not a valid URL, skip
            }
        }
    }

    progress?.report({ message: 'Scanning application properties for dependencies...' });

    // Discover dependencies by scanning app properties and configs
    const dependencies: DependencyEntry[] = [];

    for (let i = 0; i < allApps.length; i++) {
        const app = allApps[i];
        progress?.report({ message: `Scanning ${app.name} (${i + 1}/${allApps.length})...` });

        const appDeps = await discoverDependencies(
            apiHelper, baseUrl, app, organizationId, environmentId, endpointMap
        );
        dependencies.push(...appDeps);
    }

    // Check API Manager auto-discovery bindings
    progress?.report({ message: 'Checking API Manager bindings...' });
    const apiDeps = await discoverApiManagerDependencies(
        apiHelper, baseUrl, organizationId, environmentId, allApps, endpointMap
    );
    dependencies.push(...apiDeps);

    // Merge manual dependencies
    const manualDeps = loadManualDependencies();
    for (const manual of manualDeps) {
        // Remove any auto-discovered entry for the same source->target pair
        const existingIndex = dependencies.findIndex(
            d => d.sourceApp === manual.sourceApp && d.targetApp === manual.targetApp
        );
        if (existingIndex >= 0) {
            dependencies.splice(existingIndex, 1);
        }
        dependencies.push({
            sourceApp: manual.sourceApp,
            targetApp: manual.targetApp,
            targetUrl: '',
            discoveryMethod: 'manual',
            confidence: 'high',
            isExternal: !allApps.some(a => a.name === manual.targetApp)
        });
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueDeps = dependencies.filter(dep => {
        const key = `${dep.sourceApp}->${dep.targetApp}:${dep.targetUrl}`;
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });

    const depMap: DependencyMap = {
        generatedAt: new Date().toISOString(),
        environment: envName,
        apps: allApps.map(app => ({
            name: app.name,
            id: app.id,
            endpoints: appEndpoints.get(app.name) || []
        })),
        dependencies: uniqueDeps
    };

    // Save to workspace
    await saveDependencyMap(depMap);

    return depMap;
}

export function loadDependencyMap(): DependencyMap | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const filePath = path.join(workspaceFolders[0].uri.fsPath, WARROOM_DIR, DEPENDENCY_MAP_FILE);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as DependencyMap;
    } catch {
        return null;
    }
}

export function isDependencyMapStale(map: DependencyMap): boolean {
    const generatedAt = new Date(map.generatedAt);
    const now = new Date();
    const hoursSinceGeneration = (now.getTime() - generatedAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceGeneration > 24;
}

async function saveDependencyMap(map: DependencyMap): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const dirPath = path.join(workspaceFolders[0].uri.fsPath, WARROOM_DIR);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    const filePath = path.join(dirPath, DEPENDENCY_MAP_FILE);
    fs.writeFileSync(filePath, JSON.stringify(map, null, 2), 'utf-8');
}

function loadManualDependencies(): Array<{ sourceApp: string; targetApp: string }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return [];
    }

    const filePath = path.join(workspaceFolders[0].uri.fsPath, WARROOM_DIR, MANUAL_DEPS_FILE);
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content) as ManualDependencyFile;
        return parsed.dependencies || [];
    } catch {
        return [];
    }
}

async function getEnvironmentName(
    accountService: AccountService,
    context: vscode.ExtensionContext,
    environmentId: string
): Promise<string> {
    let storedEnvs = await accountService.getActiveAccountEnvironments();
    if (!storedEnvs) {
        storedEnvs = await context.secrets.get('anypoint.environments');
    }

    if (storedEnvs) {
        try {
            const environments = JSON.parse(storedEnvs);
            const env = environments.data?.find((e: any) => e.id === environmentId);
            if (env) { return env.name; }
        } catch { /* ignore */ }
    }

    return environmentId;
}

interface AppInfo {
    name: string;
    id: string;
    deploymentId?: string;
    properties?: Record<string, string>;
    rawData?: any;
}

async function fetchAllDeployedApps(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string
): Promise<AppInfo[]> {
    const apps: AppInfo[] = [];

    // Fetch CH2 apps
    try {
        const ch2Url = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments`;
        const response = await apiHelper.get(ch2Url);

        if (response.status === 200) {
            let ch2Apps = response.data;
            if (!Array.isArray(ch2Apps)) {
                ch2Apps = ch2Apps?.data || ch2Apps?.items || ch2Apps?.applications || [];
            }
            for (const app of ch2Apps) {
                apps.push({
                    name: app.name || app.domain || '',
                    id: app.id || '',
                    deploymentId: app.id,
                    properties: app.application?.configuration?.properties || app.properties || {},
                    rawData: app
                });
            }
        }
    } catch (error: any) {
        console.log('War Room DependencyMapper: CH2 fetch failed:', error.message);
    }

    // Fetch CH1 apps
    try {
        const ch1Url = `${baseUrl}/cloudhub/api/applications`;
        const response = await apiHelper.get(ch1Url, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationId,
            }
        });

        if (response.status === 200) {
            const ch1Apps = Array.isArray(response.data) ? response.data : [];
            for (const app of ch1Apps) {
                // Avoid duplicates
                if (!apps.some(a => a.name === (app.domain || app.name))) {
                    apps.push({
                        name: app.domain || app.name || '',
                        id: app.domain || '',
                        properties: app.properties || {},
                        rawData: app
                    });
                }
            }
        }
    } catch (error: any) {
        console.log('War Room DependencyMapper: CH1 fetch failed:', error.message);
    }

    return apps.filter(a => a.name);
}

function extractEndpoints(app: AppInfo): string[] {
    const endpoints: string[] = [];
    const name = app.name;

    // Standard CloudHub internal DNS patterns
    endpoints.push(`${name}.cloudhub.io`);
    endpoints.push(`https://${name}.cloudhub.io`);
    endpoints.push(`http://${name}.cloudhub.io`);

    // CH2 patterns
    endpoints.push(`${name}.us-e1.cloudhub.io`);
    endpoints.push(`${name}.us-e2.cloudhub.io`);
    endpoints.push(`${name}.eu-c1.cloudhub.io`);

    // Check rawData for public URL or ingress
    const raw = app.rawData;
    if (raw) {
        // CH2 deployment target
        const target = raw.target || {};
        if (target.deploymentSettings?.http?.inbound?.publicUrl) {
            endpoints.push(target.deploymentSettings.http.inbound.publicUrl);
        }
        if (target.deploymentSettings?.http?.inbound?.lastMileSecurity !== undefined) {
            endpoints.push(`https://${name}.${target.provider || 'us-e2'}.cloudhub.io`);
        }

        // CH1 fullDomain
        if (raw.fullDomain) {
            endpoints.push(raw.fullDomain);
            endpoints.push(`https://${raw.fullDomain}`);
        }
    }

    return [...new Set(endpoints)];
}

async function discoverDependencies(
    apiHelper: ApiHelper,
    baseUrl: string,
    app: AppInfo,
    organizationId: string,
    environmentId: string,
    endpointMap: Map<string, string>
): Promise<DependencyEntry[]> {
    const deps: DependencyEntry[] = [];

    // Scan application properties for outbound URLs
    const properties = app.properties || {};
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== 'string') { continue; }

        const urls = extractUrlsFromValue(value);
        for (const url of urls) {
            const targetApp = resolveUrlToApp(url, endpointMap);
            if (targetApp && targetApp !== app.name) {
                deps.push({
                    sourceApp: app.name,
                    targetApp,
                    targetUrl: url,
                    discoveryMethod: 'property_file',
                    confidence: 'high',
                    isExternal: false
                });
            } else if (!targetApp && isRelevantUrl(url)) {
                // External dependency
                deps.push({
                    sourceApp: app.name,
                    targetApp: extractHostname(url),
                    targetUrl: url,
                    discoveryMethod: 'property_file',
                    confidence: 'medium',
                    isExternal: true
                });
            }
        }
    }

    return deps;
}

async function discoverApiManagerDependencies(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    allApps: AppInfo[],
    endpointMap: Map<string, string>
): Promise<DependencyEntry[]> {
    const deps: DependencyEntry[] = [];

    try {
        const apiManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis`;
        const response = await apiHelper.get(apiManagerUrl, {
            params: { limit: 100, offset: 0 }
        });

        if (response.status === 200) {
            const apis = response.data?.apis || response.data?.assets || [];
            for (const api of apis) {
                const autodiscoveryId = api.autodiscoveryInstanceName || api.autodiscoveryApiName;
                const apiEndpoint = api.endpointUri || api.endpoint?.uri || '';

                if (autodiscoveryId && apiEndpoint) {
                    // Find which app owns this API
                    const ownerApp = allApps.find(app => {
                        const props = app.properties || {};
                        return Object.values(props).some(v =>
                            typeof v === 'string' && v.includes(autodiscoveryId)
                        );
                    });

                    if (ownerApp) {
                        // Any app that calls this endpoint depends on the owner app
                        const targetAppName = resolveUrlToApp(apiEndpoint, endpointMap);
                        if (targetAppName && targetAppName !== ownerApp.name) {
                            deps.push({
                                sourceApp: ownerApp.name,
                                targetApp: targetAppName,
                                targetUrl: apiEndpoint,
                                discoveryMethod: 'api_autodiscovery',
                                confidence: 'medium',
                                isExternal: false
                            });
                        }
                    }
                }
            }
        }
    } catch (error: any) {
        console.log('War Room DependencyMapper: API Manager scan failed:', error.message);
    }

    return deps;
}

function extractUrlsFromValue(value: string): string[] {
    const urlRegex = /https?:\/\/[^\s,;'"}\]]+/g;
    const matches = value.match(urlRegex) || [];
    return matches;
}

function resolveUrlToApp(url: string, endpointMap: Map<string, string>): string | null {
    // Direct URL match
    if (endpointMap.has(url)) {
        return endpointMap.get(url)!;
    }

    // Try hostname match
    try {
        const parsed = new URL(url);
        if (endpointMap.has(parsed.hostname)) {
            return endpointMap.get(parsed.hostname)!;
        }
        // Try matching just the app name from the hostname (e.g., "my-app.cloudhub.io")
        const hostParts = parsed.hostname.split('.');
        if (hostParts.length > 0) {
            const potentialAppName = hostParts[0];
            if (endpointMap.has(`${potentialAppName}.cloudhub.io`)) {
                return endpointMap.get(`${potentialAppName}.cloudhub.io`)!;
            }
        }
    } catch {
        // Not a valid URL
    }

    return null;
}

function isRelevantUrl(url: string): boolean {
    // Filter out generic/infrastructure URLs
    const ignoredPatterns = [
        'localhost', '127.0.0.1', '0.0.0.0',
        'anypoint.mulesoft.com', 'maven.', 'repo.',
        'github.com', 'docker.', 'registry.'
    ];
    const lowerUrl = url.toLowerCase();
    return !ignoredPatterns.some(p => lowerUrl.includes(p));
}

function extractHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}
