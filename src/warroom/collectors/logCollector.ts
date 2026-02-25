import * as vscode from 'vscode';
import { LogGroup, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
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
    // Replace UUIDs
    pattern = pattern.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
    // Replace IP addresses
    pattern = pattern.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<IP>');
    // Replace timestamps in common formats
    pattern = pattern.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*/g, '<TIMESTAMP>');
    // Replace numeric IDs
    pattern = pattern.replace(/\b\d{5,}\b/g, '<ID>');
    // Replace hex strings
    pattern = pattern.replace(/0x[0-9a-fA-F]+/g, '<HEX>');
    // Truncate to first 200 chars for grouping
    return pattern.substring(0, 200);
}

export async function collectLogs(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    deploymentId?: string
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
            apiHelper, baseUrl, appName, appId, organizationId, environmentId,
            timeWindow, deploymentId
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
            const timestamp = entry.timestamp || entry.recordTimestamp || new Date().toISOString();
            const normalizedLevel = isError ? 'ERROR' : 'WARN';

            const key = `${normalizedLevel}:${pattern}`;
            const existing = groups.get(key);

            if (existing) {
                existing.count++;
                if (timestamp < existing.firstSeen) {
                    existing.firstSeen = timestamp;
                }
                if (timestamp > existing.lastSeen) {
                    existing.lastSeen = timestamp;
                }
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
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    deploymentId?: string
): Promise<any[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        const allEntries: any[] = [];

        // Try CH2 logging API first
        try {
            const ch2Logs = await fetchCH2Logs(
                apiHelper, baseUrl, appName, appId, organizationId,
                environmentId, timeWindow, deploymentId, controller.signal
            );
            allEntries.push(...ch2Logs);
        } catch (ch2Error: any) {
            if (ch2Error.name === 'AbortError' || ch2Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            // Try CH1 logging API as fallback
            try {
                const ch1Logs = await fetchCH1Logs(
                    apiHelper, baseUrl, appName, organizationId,
                    environmentId, timeWindow, controller.signal
                );
                allEntries.push(...ch1Logs);
            } catch (ch1Error: any) {
                if (ch1Error.name === 'AbortError' || ch1Error.name === 'CanceledError') {
                    throw new Error('COLLECTOR_TIMEOUT');
                }
                throw ch1Error;
            }
        }

        return allEntries;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchCH2Logs(
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    deploymentId: string | undefined,
    signal: AbortSignal
): Promise<any[]> {
    const targetId = deploymentId || appId;
    const url = `${baseUrl}/cloudhub/api/v2/applications/${targetId}/logs`;

    const response = await apiHelper.get(url, {
        params: {
            startTime: timeWindow.start.getTime(),
            endTime: timeWindow.end.getTime(),
            limit: 500,
            priority: 'ERROR,WARN'
        },
        headers: {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationId,
        },
        signal
    });

    if (response.status === 200) {
        const data = response.data;
        return Array.isArray(data) ? data : (data?.data || data?.items || data?.logs || []);
    }
    return [];
}

async function fetchCH1Logs(
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date },
    signal: AbortSignal
): Promise<any[]> {
    const url = `${baseUrl}/cloudhub/api/applications/${appName}/logs`;

    const response = await apiHelper.post(url, {
        startTime: timeWindow.start.getTime(),
        endTime: timeWindow.end.getTime(),
        limit: 500,
        priority: ['ERROR', 'WARN']
    }, {
        headers: {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationId,
        },
        signal
    });

    if (response.status === 200) {
        const data = response.data;
        return Array.isArray(data) ? data : (data?.data || data?.items || data?.logs || []);
    }
    return [];
}
