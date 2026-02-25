import * as vscode from 'vscode';
import { LogGroup, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
import { AccountService } from '../../controllers/accountService';
import { getBaseUrl } from '../../constants';

const COLLECTOR_TIMEOUT = 30000;

export interface LogCollectorResult {
    groups: LogGroup[];
    totalEntries: number;
    errors: number;
    warnings: number;
}

function normalizeLogPattern(message: string): string {
    let pattern = message;
    pattern = pattern.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
    pattern = pattern.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<IP>');
    pattern = pattern.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*/g, '<TIMESTAMP>');
    pattern = pattern.replace(/\b\d{5,}\b/g, '<ID>');
    pattern = pattern.replace(/0x[0-9a-fA-F]+/g, '<HEX>');
    return pattern.substring(0, 200);
}

export async function collectLogs(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    deploymentId?: string,
    specificationId?: string
): Promise<{ result: LogCollectorResult; errors: CollectionError[] }> {
    const errors: CollectionError[] = [];
    const groups: Map<string, LogGroup> = new Map();
    let totalEntries = 0;
    let errorCount = 0;
    let warningCount = 0;

    try {
        const apiHelper = new ApiHelper(context);
        const baseUrl = await getBaseUrl(context);

        const logEntries = await fetchLogsWithTimeout(
            context, apiHelper, baseUrl, appName, appId, organizationId, environmentId,
            timeWindow, deploymentId, specificationId
        );

        for (const entry of logEntries) {
            totalEntries++;
            const level = entry.priority?.toUpperCase() || entry.level?.toUpperCase() || 'INFO';

            if (level !== 'ERROR' && level !== 'WARN' && level !== 'WARNING') {
                continue;
            }

            const isError = level === 'ERROR';
            if (isError) {
                errorCount++;
            } else {
                warningCount++;
            }

            const message = entry.message || entry.line || '';
            const pattern = normalizeLogPattern(message);
            const rawTimestamp = entry.timestamp || entry.recordTimestamp || entry.time;
            const timestamp = rawTimestamp
                ? (typeof rawTimestamp === 'number' ? new Date(rawTimestamp).toISOString() : String(rawTimestamp))
                : new Date().toISOString();
            const normalizedLevel = isError ? 'ERROR' : 'WARN';

            const key = `${normalizedLevel}:${pattern}`;
            const existing = groups.get(key);

            if (existing) {
                existing.count++;
                if (timestamp < existing.firstSeen) { existing.firstSeen = timestamp; }
                if (timestamp > existing.lastSeen) { existing.lastSeen = timestamp; }
            } else {
                groups.set(key, {
                    pattern,
                    level: normalizedLevel,
                    count: 1,
                    firstSeen: timestamp,
                    lastSeen: timestamp,
                    sampleMessage: message.substring(0, 500),
                    appName
                });
            }
        }
    } catch (error: any) {
        if (error.message === 'COLLECTOR_TIMEOUT') {
            errors.push({ collector: 'logs', app: appName, error: 'Timed out after 30s (partial results returned)' });
        } else {
            errors.push({ collector: 'logs', app: appName, error: error.message || 'Unknown error' });
        }
    }

    const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count);

    return {
        result: { groups: sortedGroups, totalEntries, errors: errorCount, warnings: warningCount },
        errors
    };
}

async function fetchLogsWithTimeout(
    context: vscode.ExtensionContext,
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    deploymentId?: string,
    specificationId?: string
): Promise<any[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        // If we have deploymentId + specificationId, this is a CH2 app
        if (deploymentId && specificationId) {
            try {
                const ch2Logs = await fetchCH2Logs(
                    context, apiHelper, baseUrl, organizationId, environmentId,
                    deploymentId, specificationId, timeWindow, controller.signal
                );
                return ch2Logs;
            } catch (ch2Error: any) {
                if (ch2Error.name === 'AbortError' || ch2Error.name === 'CanceledError') {
                    throw new Error('COLLECTOR_TIMEOUT');
                }
                // Fall through to CH1
            }
        }

        // Try CH1 logging API
        try {
            const ch1Logs = await fetchCH1Logs(
                apiHelper, baseUrl, appName, organizationId,
                environmentId, timeWindow, controller.signal
            );
            return ch1Logs;
        } catch (ch1Error: any) {
            if (ch1Error.name === 'AbortError' || ch1Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            throw ch1Error;
        }
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Fetch CloudHub 2.0 logs using the AMC Application Manager API.
 * Endpoint: /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}/specs/{specId}/logs
 */
async function fetchCH2Logs(
    context: vscode.ExtensionContext,
    apiHelper: ApiHelper,
    baseUrl: string,
    organizationId: string,
    environmentId: string,
    deploymentId: string,
    specificationId: string,
    timeWindow: { start: Date; end: Date },
    signal: AbortSignal
): Promise<any[]> {
    const startTimeMs = timeWindow.start.getTime();
    const endTimeMs = timeWindow.end.getTime();

    const url = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${deploymentId}/specs/${specificationId}/logs?limit=500&offset=0&startTime=${startTimeMs}&endTime=${endTimeMs}`;

    // CH2 logs API uses fetch directly (matching the working realTimeLogs.ts pattern)
    const accountService = new AccountService(context);
    const accessToken = await accountService.getActiveAccountAccessToken();
    if (!accessToken) {
        throw new Error('No access token found');
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        signal
    });

    if (!response.ok) {
        throw new Error(`CH2 logs: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;

    // CH2 logs response can be an array or an object with items
    let entries: any[];
    if (Array.isArray(data)) {
        entries = data;
    } else if (data?.items) {
        entries = data.items;
    } else if (data?.data) {
        entries = data.data;
    } else if (data?.logs) {
        entries = data.logs;
    } else {
        entries = [];
    }

    return entries;
}

/**
 * Fetch CloudHub 1.0 logs.
 * First gets the latest deploymentId, then fetches logs for that deployment.
 * Endpoint: /cloudhub/api/v2/applications/{domain}/deployments/{deploymentId}/logs
 */
async function fetchCH1Logs(
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    signal: AbortSignal
): Promise<any[]> {
    const headers = {
        'X-ANYPNT-ENV-ID': environmentId,
        'X-ANYPNT-ORG-ID': organizationId,
    };

    // First get the latest deployment ID
    const deploymentsUrl = `${baseUrl}/cloudhub/api/v2/applications/${appName}/deployments?orderByDate=DESC`;
    const deploymentsResponse = await apiHelper.get(deploymentsUrl, { headers, signal });

    if (deploymentsResponse.status !== 200 || !deploymentsResponse.data?.data?.[0]?.deploymentId) {
        throw new Error('Could not get CH1 deployment ID');
    }

    const deploymentId = deploymentsResponse.data.data[0].deploymentId;

    // Fetch logs
    const startTime = timeWindow.start.getTime();
    const endTime = timeWindow.end.getTime();
    const logsUrl = `${baseUrl}/cloudhub/api/v2/applications/${appName}/deployments/${deploymentId}/logs?startTime=${startTime}&endTime=${endTime}&limit=500`;

    const logsResponse = await apiHelper.get(logsUrl, { headers, signal });

    if (logsResponse.status === 200) {
        const data = logsResponse.data;
        return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    }
    return [];
}
