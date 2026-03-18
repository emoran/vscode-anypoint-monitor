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

    // Discover API Manager contracts (client app -> API provider app)
    progress?.report({ message: 'Discovering API contracts...' });
    const contractDeps = await discoverApiContracts(
        apiHelper, baseUrl, organizationId, environmentId, allApps
    );
    dependencies.push(...contractDeps);

    // Discover naming convention relationships (eapi -> papi -> sapi)
    progress?.report({ message: 'Inferring naming convention dependencies...' });
    const namingDeps = discoverByNamingConvention(allApps);
    dependencies.push(...namingDeps);

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

export interface AppInfo {
    name: string;
    id: string;
    deploymentId?: string;
    properties?: Record<string, string>;
    rawData?: any;
}

export async function fetchAllDeployedApps(
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

export function extractEndpoints(app: AppInfo): string[] {
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

export async function discoverDependencies(
    apiHelper: ApiHelper,
    baseUrl: string,
    app: AppInfo,
    organizationId: string,
    environmentId: string,
    endpointMap: Map<string, string>
): Promise<DependencyEntry[]> {
    const deps: DependencyEntry[] = [];
    const seen = new Set<string>();

    const properties = app.properties || {};
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== 'string') { continue; }

        // Strategy 1: Extract full URLs (https://...)
        const urls = extractUrlsFromValue(value);
        for (const url of urls) {
            const targetApp = resolveUrlToApp(url, endpointMap);
            if (targetApp && targetApp !== app.name) {
                const k = `${targetApp}:property_file`;
                if (!seen.has(k)) {
                    seen.add(k);
                    deps.push({
                        sourceApp: app.name,
                        targetApp,
                        targetUrl: url,
                        discoveryMethod: 'property_file',
                        confidence: 'high',
                        isExternal: false
                    });
                }
            } else if (!targetApp && isRelevantUrl(url)) {
                const hostname = extractHostname(url);
                const k = `${hostname}:property_file`;
                if (!seen.has(k)) {
                    seen.add(k);
                    deps.push({
                        sourceApp: app.name,
                        targetApp: hostname,
                        targetUrl: url,
                        discoveryMethod: 'property_file',
                        confidence: isExternalService(url) ? 'low' : 'medium',
                        isExternal: true
                    });
                }
            }
        }

        // Strategy 2: Extract bare hostnames from property values
        // Matches patterns like "my-app.us-e1.cloudhub.io", "host.example.com:443"
        const hostnames = extractHostnamesFromValue(value, key);
        for (const host of hostnames) {
            const resolvedApp = resolveHostnameToApp(host, endpointMap);
            if (resolvedApp && resolvedApp !== app.name) {
                const k = `${resolvedApp}:property_file`;
                if (!seen.has(k)) {
                    seen.add(k);
                    deps.push({
                        sourceApp: app.name,
                        targetApp: resolvedApp,
                        targetUrl: host,
                        discoveryMethod: 'property_file',
                        confidence: 'high',
                        isExternal: false
                    });
                }
            } else if (!resolvedApp && isRelevantHostname(host)) {
                const k = `${host}:property_file`;
                if (!seen.has(k)) {
                    seen.add(k);
                    deps.push({
                        sourceApp: app.name,
                        targetApp: host,
                        targetUrl: host,
                        discoveryMethod: 'property_file',
                        confidence: isExternalService(host) ? 'low' : 'medium',
                        isExternal: true
                    });
                }
            }
        }
    }

    return deps;
}

function extractHostnamesFromValue(value: string, key: string): string[] {
    const hostnames: string[] = [];

    // Skip encrypted values, class names, record type IDs, JKS files, non-connection properties
    if (value.startsWith('![') || value.startsWith('^/') || value.match(/^[0-9a-zA-Z]{15,18}$/)) {
        return hostnames;
    }

    // Property key hints that the value contains a host/url
    const keyLower = key.toLowerCase();
    const isConnectionKey = keyLower.includes('host') || keyLower.includes('url') ||
        keyLower.includes('endpoint') || keyLower.includes('server') ||
        keyLower.includes('uri') || keyLower.includes('domain') ||
        keyLower.includes('address') || keyLower.includes('broker');

    // Hostname pattern: word chars and hyphens, at least 2 domain segments, known TLDs
    // Also match hostnames with port (e.g., host.com:9092)
    const hostnameRegex = /([a-zA-Z0-9][-a-zA-Z0-9]*\.[-a-zA-Z0-9.]+\.[a-zA-Z]{2,})(?::\d+)?/g;
    let match;
    while ((match = hostnameRegex.exec(value)) !== null) {
        let hostname = match[1];
        // Skip if already captured as a full URL
        if (value.includes('://' + hostname)) { continue; }
        // Only extract from non-connection keys if it looks like a cloudhub/mulesoft host
        if (!isConnectionKey && !hostname.includes('cloudhub.io') && !hostname.includes('mulesoft.com')) {
            continue;
        }
        hostnames.push(hostname);
    }

    return hostnames;
}

function resolveHostnameToApp(hostname: string, endpointMap: Map<string, string>): string | null {
    // Direct match
    if (endpointMap.has(hostname)) {
        return endpointMap.get(hostname)!;
    }

    // Strip port if present
    const hostOnly = hostname.replace(/:\d+$/, '');
    if (endpointMap.has(hostOnly)) {
        return endpointMap.get(hostOnly)!;
    }

    // Try first segment as app name (e.g., "accountmatch-prod.us-e1.cloudhub.io" → "accountmatch-prod")
    const parts = hostOnly.split('.');
    if (parts.length > 0) {
        const appName = parts[0];
        if (endpointMap.has(`${appName}.cloudhub.io`)) {
            return endpointMap.get(`${appName}.cloudhub.io`)!;
        }
        // Try matching against all endpoint map entries by first segment
        for (const [ep, name] of endpointMap) {
            const epFirst = ep.split('.')[0];
            if (epFirst === appName && ep.includes('cloudhub.io')) {
                return name;
            }
        }
    }

    return null;
}

function isRelevantHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return !INFRA_PATTERNS.some(p => lower.includes(p));
}

export async function discoverApiManagerDependencies(
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

export function extractUrlsFromValue(value: string): string[] {
    const urlRegex = /https?:\/\/[^\s,;'"}\]]+/g;
    const matches = value.match(urlRegex) || [];
    return matches;
}

export function resolveUrlToApp(url: string, endpointMap: Map<string, string>): string | null {
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

const EXTERNAL_SERVICE_PATTERNS = [
    'salesforce.com', 'force.com', 'sfdc.net',
    'splunkcloud.com', 'splunk.com',
    'snowflakecomputing.com',
    'amazonaws.com', 'aws.amazon.com', 's3.amazonaws.com',
    'azure.com', 'windows.net', 'microsoft.com',
    'googleapis.com', 'google.com',
    'servicebus.windows.net', 'kafka.',
    'mongodb.net', 'documentdb.amazonaws.com',
    'slack.com', 'webhook.site',
    'twilio.com', 'sendgrid.net',
    'datadog.com', 'newrelic.com', 'pagerduty.com',
    'okta.com', 'auth0.com',
    'jira.', 'atlassian.net', 'confluence.',
    'sap.com', 'successfactors.com',
    'workday.com', 'netsuite.com',
    'zendesk.com', 'freshdesk.com',
];

const INFRA_PATTERNS = [
    'localhost', '127.0.0.1', '0.0.0.0',
    'anypoint.mulesoft.com', 'maven.', 'repo.',
    'github.com', 'docker.', 'registry.',
    'npmjs.org', 'gradle.org',
];

function isExternalService(url: string): boolean {
    const lower = url.toLowerCase();
    return EXTERNAL_SERVICE_PATTERNS.some(p => lower.includes(p));
}

function isRelevantUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return !INFRA_PATTERNS.some(p => lowerUrl.includes(p));
}

function extractHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

export async function discoverApiContracts(
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    allApps: AppInfo[]
): Promise<DependencyEntry[]> {
    const deps: DependencyEntry[] = [];
    const appNameSet = new Set(allApps.map(a => a.name.toLowerCase()));

    try {
        const apiManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis`;
        const response = await apiHelper.get(apiManagerUrl, {
            params: { limit: 100, offset: 0 }
        });

        if (response.status !== 200) { return deps; }

        const apis = response.data?.apis || response.data?.assets || [];

        for (const api of apis) {
            const apiId = api.id;
            const apiAssetId = api.assetId || api.name || '';
            if (!apiId) { continue; }

            // Resolve which deployed app implements this API
            const providerApp = resolveApiToApp(api, allApps);
            if (!providerApp) { continue; }

            // Fetch contracts for this API
            try {
                const contractsUrl = `${baseUrl}/apimanager/api/v1/organizations/${organizationId}/environments/${environmentId}/apis/${apiId}/contracts`;
                const contractResp = await apiHelper.get(contractsUrl, { timeout: 8000 });
                if (contractResp.status !== 200) { continue; }

                const contracts = contractResp.data?.contracts || contractResp.data || [];
                for (const contract of contracts) {
                    const clientApp = contract.application?.name || contract.applicationName || '';
                    if (!clientApp) { continue; }

                    // Check if the client app is a deployed MuleSoft app
                    const isInternal = appNameSet.has(clientApp.toLowerCase()) ||
                        allApps.some(a => a.name.toLowerCase().includes(clientApp.toLowerCase()) ||
                                         clientApp.toLowerCase().includes(a.name.toLowerCase()));

                    const resolvedClientName = allApps.find(a =>
                        a.name.toLowerCase() === clientApp.toLowerCase() ||
                        a.name.toLowerCase().includes(clientApp.toLowerCase())
                    )?.name || clientApp;

                    deps.push({
                        sourceApp: resolvedClientName,
                        targetApp: providerApp,
                        targetUrl: apiAssetId,
                        discoveryMethod: 'api_contract',
                        confidence: 'high',
                        isExternal: !isInternal
                    });
                }
            } catch {
                // Contract fetch failed for this API, continue
            }
        }
    } catch (error: any) {
        console.log('DependencyMapper: API contract discovery failed:', error.message);
    }

    return deps;
}

export function resolveApiToApp(api: any, allApps: AppInfo[]): string | null {
    // Strategy 1: autodiscovery binding
    const autodiscoveryId = api.autodiscoveryInstanceName || api.autodiscoveryApiName;
    if (autodiscoveryId) {
        const owner = allApps.find(app => {
            const props = app.properties || {};
            return Object.values(props).some(v =>
                typeof v === 'string' && v.includes(String(autodiscoveryId))
            );
        });
        if (owner) { return owner.name; }
    }

    // Strategy 2: match assetId or API name to an app name
    const assetId = (api.assetId || '').toLowerCase();
    const apiName = (api.name || '').toLowerCase();
    for (const app of allApps) {
        const appLower = app.name.toLowerCase();
        if (assetId && (appLower.includes(assetId) || assetId.includes(appLower))) {
            return app.name;
        }
        if (apiName && (appLower.includes(apiName) || apiName.includes(appLower))) {
            return app.name;
        }
    }

    return null;
}

export function discoverByNamingConvention(allApps: AppInfo[]): DependencyEntry[] {
    const deps: DependencyEntry[] = [];
    const appNames = allApps.map(a => a.name);

    const layerSuffixes = ['-eapi', '-exp-api', '-experience-api', '-papi', '-proc-api', '-process-api', '-sapi', '-sys-api', '-system-api'];

    function getLayerAndPrefix(name: string): { layer: 'eapi' | 'papi' | 'sapi'; prefix: string } | null {
        const lower = name.toLowerCase();
        if (lower.endsWith('-eapi') || lower.endsWith('-exp-api') || lower.endsWith('-experience-api')) {
            const prefix = extractNamingPrefix(lower, ['-eapi', '-exp-api', '-experience-api']);
            return prefix ? { layer: 'eapi', prefix } : null;
        }
        if (lower.endsWith('-papi') || lower.endsWith('-proc-api') || lower.endsWith('-process-api')) {
            const prefix = extractNamingPrefix(lower, ['-papi', '-proc-api', '-process-api']);
            return prefix ? { layer: 'papi', prefix } : null;
        }
        if (lower.endsWith('-sapi') || lower.endsWith('-sys-api') || lower.endsWith('-system-api')) {
            const prefix = extractNamingPrefix(lower, ['-sapi', '-sys-api', '-system-api']);
            return prefix ? { layer: 'sapi', prefix } : null;
        }
        return null;
    }

    function extractNamingPrefix(name: string, suffixes: string[]): string | null {
        for (const suffix of suffixes) {
            if (name.endsWith(suffix)) {
                return name.slice(0, -suffix.length);
            }
        }
        return null;
    }

    function findAppByPrefixAndLayer(prefix: string, targetSuffixes: string[]): string | null {
        for (const appName of appNames) {
            const lower = appName.toLowerCase();
            for (const suffix of targetSuffixes) {
                if (lower === prefix + suffix) {
                    return appName;
                }
            }
        }
        return null;
    }

    for (const appName of appNames) {
        const parsed = getLayerAndPrefix(appName);
        if (!parsed) { continue; }

        const { layer, prefix } = parsed;

        if (layer === 'eapi') {
            // eapi calls papi
            const papi = findAppByPrefixAndLayer(prefix, ['-papi', '-proc-api', '-process-api']);
            if (papi) {
                deps.push({
                    sourceApp: appName,
                    targetApp: papi,
                    targetUrl: '',
                    discoveryMethod: 'naming_convention',
                    confidence: 'low',
                    isExternal: false
                });
            }
        }

        if (layer === 'papi') {
            // papi calls sapi
            const sapi = findAppByPrefixAndLayer(prefix, ['-sapi', '-sys-api', '-system-api']);
            if (sapi) {
                deps.push({
                    sourceApp: appName,
                    targetApp: sapi,
                    targetUrl: '',
                    discoveryMethod: 'naming_convention',
                    confidence: 'low',
                    isExternal: false
                });
            }
        }
    }

    return deps;
}
