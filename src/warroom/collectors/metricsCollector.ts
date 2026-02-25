import * as vscode from 'vscode';
import { MetricSnapshot, Anomaly, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
import { getBaseUrl } from '../../constants';

const COLLECTOR_TIMEOUT = 30000;

export interface MetricsCollectorResult {
    current: MetricSnapshot;
    baseline: MetricSnapshot;
    anomalies: Anomaly[];
}

export async function collectMetrics(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindow: { start: Date; end: Date }
): Promise<{ result: MetricsCollectorResult; errors: CollectionError[] }> {
    const errors: CollectionError[] = [];
    let current: MetricSnapshot = { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: new Date().toISOString() };
    let baseline: MetricSnapshot = { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: '' };
    const anomalies: Anomaly[] = [];

    try {
        const apiHelper = new ApiHelper(context);
        const baseUrl = await getBaseUrl(context);

        const [currentMetrics, baselineMetrics] = await Promise.allSettled([
            fetchMetricsWithTimeout(apiHelper, baseUrl, appId, organizationId, environmentId, timeWindow.start, timeWindow.end),
            fetchBaselineMetrics(apiHelper, baseUrl, appId, organizationId, environmentId, timeWindow.start)
        ]);

        if (currentMetrics.status === 'fulfilled' && currentMetrics.value) {
            current = currentMetrics.value;
        } else if (currentMetrics.status === 'rejected') {
            errors.push({ collector: 'metrics-current', app: appName, error: currentMetrics.reason?.message || 'Failed to fetch current metrics' });
        }

        if (baselineMetrics.status === 'fulfilled' && baselineMetrics.value) {
            baseline = baselineMetrics.value;
        } else if (baselineMetrics.status === 'rejected') {
            errors.push({ collector: 'metrics-baseline', app: appName, error: baselineMetrics.reason?.message || 'Failed to fetch baseline metrics' });
        }

        // Detect anomalies
        if (current.cpu !== null && baseline.cpu !== null && baseline.cpu > 0) {
            const deviation = current.cpu / baseline.cpu;
            if (deviation > 2 || current.cpu > 90) {
                anomalies.push({
                    metric: 'CPU',
                    current: current.cpu,
                    baseline: baseline.cpu,
                    deviation,
                    severity: current.cpu > 90 ? 'high' : 'medium',
                    description: `CPU at ${current.cpu.toFixed(1)}% (baseline: ${baseline.cpu.toFixed(1)}%, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }

        if (current.memory !== null && baseline.memory !== null && baseline.memory > 0) {
            const deviation = current.memory / baseline.memory;
            if (deviation > 2 || current.memory > 90) {
                anomalies.push({
                    metric: 'Memory',
                    current: current.memory,
                    baseline: baseline.memory,
                    deviation,
                    severity: current.memory > 90 ? 'high' : 'medium',
                    description: `Memory at ${current.memory.toFixed(1)}% (baseline: ${baseline.memory.toFixed(1)}%, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }

        if (current.responseTime !== null && baseline.responseTime !== null && baseline.responseTime > 0) {
            const deviation = current.responseTime / baseline.responseTime;
            if (deviation > 2) {
                anomalies.push({
                    metric: 'Response Time',
                    current: current.responseTime,
                    baseline: baseline.responseTime,
                    deviation,
                    severity: deviation > 5 ? 'high' : 'medium',
                    description: `Response time at ${current.responseTime.toFixed(0)}ms (baseline: ${baseline.responseTime.toFixed(0)}ms, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }

        if (current.messageCount !== null && baseline.messageCount !== null && baseline.messageCount > 0) {
            const deviation = current.messageCount / baseline.messageCount;
            if (deviation > 3 || (baseline.messageCount > 0 && current.messageCount === 0)) {
                const sev = current.messageCount === 0 ? 'high' : (deviation > 5 ? 'high' : 'medium');
                anomalies.push({
                    metric: 'Message Count',
                    current: current.messageCount,
                    baseline: baseline.messageCount,
                    deviation: current.messageCount === 0 ? 0 : deviation,
                    severity: sev,
                    description: current.messageCount === 0
                        ? `No messages processed (baseline: ${baseline.messageCount.toFixed(0)}/period)`
                        : `Message count at ${current.messageCount.toFixed(0)} (baseline: ${baseline.messageCount.toFixed(0)}, ${deviation.toFixed(1)}x deviation)`
                });
            }
        }
    } catch (error: any) {
        errors.push({ collector: 'metrics', app: appName, error: error.message || 'Unknown error' });
    }

    return { result: { current, baseline, anomalies }, errors };
}

async function fetchMetricsWithTimeout(
    apiHelper: ApiHelper,
    baseUrl: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    startTime: Date,
    endTime: Date
): Promise<MetricSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        const url = `${baseUrl}/monitoring/query/api/v1/organizations/${organizationId}/environments/${environmentId}/applications/${appId}`;

        const response = await apiHelper.post(url, {
            startDate: startTime.toISOString(),
            endDate: endTime.toISOString(),
            interval: '1m'
        }, {
            signal: controller.signal
        });

        if (response.status === 200 && response.data) {
            return parseMetricResponse(response.data);
        }

        return { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: endTime.toISOString() };
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchBaselineMetrics(
    apiHelper: ApiHelper,
    baseUrl: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    incidentStart: Date
): Promise<MetricSnapshot> {
    // 24 hour baseline ending 1 hour before the incident window
    const baselineEnd = new Date(incidentStart.getTime() - 60 * 60 * 1000);
    const baselineStart = new Date(baselineEnd.getTime() - 24 * 60 * 60 * 1000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        const url = `${baseUrl}/monitoring/query/api/v1/organizations/${organizationId}/environments/${environmentId}/applications/${appId}`;

        const response = await apiHelper.post(url, {
            startDate: baselineStart.toISOString(),
            endDate: baselineEnd.toISOString(),
            interval: '1h'
        }, {
            signal: controller.signal
        });

        if (response.status === 200 && response.data) {
            return parseMetricResponse(response.data, true);
        }

        return { cpu: null, memory: null, messageCount: null, responseTime: null, timestamp: baselineEnd.toISOString() };
    } finally {
        clearTimeout(timeout);
    }
}

function parseMetricResponse(data: any, average: boolean = false): MetricSnapshot {
    const snapshot: MetricSnapshot = {
        cpu: null,
        memory: null,
        messageCount: null,
        responseTime: null,
        timestamp: new Date().toISOString()
    };

    try {
        // The monitoring API can return data in various formats
        // Try common structures
        const metrics = data.data || data.metrics || data;

        if (Array.isArray(metrics)) {
            const cpuValues: number[] = [];
            const memValues: number[] = [];
            const msgValues: number[] = [];
            const rtValues: number[] = [];

            for (const point of metrics) {
                if (point.cpu !== undefined && point.cpu !== null) { cpuValues.push(Number(point.cpu)); }
                if (point.memory !== undefined && point.memory !== null) { memValues.push(Number(point.memory)); }
                if (point.messageCount !== undefined && point.messageCount !== null) { msgValues.push(Number(point.messageCount)); }
                if (point.responseTime !== undefined && point.responseTime !== null) { rtValues.push(Number(point.responseTime)); }
            }

            if (average) {
                snapshot.cpu = cpuValues.length > 0 ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length : null;
                snapshot.memory = memValues.length > 0 ? memValues.reduce((a, b) => a + b, 0) / memValues.length : null;
                snapshot.messageCount = msgValues.length > 0 ? msgValues.reduce((a, b) => a + b, 0) / msgValues.length : null;
                snapshot.responseTime = rtValues.length > 0 ? rtValues.reduce((a, b) => a + b, 0) / rtValues.length : null;
            } else {
                // Use the latest data point
                snapshot.cpu = cpuValues.length > 0 ? cpuValues[cpuValues.length - 1] : null;
                snapshot.memory = memValues.length > 0 ? memValues[memValues.length - 1] : null;
                snapshot.messageCount = msgValues.length > 0 ? msgValues[msgValues.length - 1] : null;
                snapshot.responseTime = rtValues.length > 0 ? rtValues[rtValues.length - 1] : null;
            }
        } else if (typeof metrics === 'object') {
            // Direct object with metric values
            snapshot.cpu = metrics.cpu !== undefined ? Number(metrics.cpu) : null;
            snapshot.memory = metrics.memory !== undefined ? Number(metrics.memory) : null;
            snapshot.messageCount = metrics.messageCount !== undefined ? Number(metrics.messageCount) : null;
            snapshot.responseTime = metrics.responseTime !== undefined ? Number(metrics.responseTime) : null;
        }
    } catch {
        // Return snapshot with nulls on parse error
    }

    return snapshot;
}
