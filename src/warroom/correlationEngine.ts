import {
    WarRoomData,
    TimelineEvent,
    CorrelationResult,
    BlastRadius,
    AppWarRoomData
} from './types';

export function buildTimeline(data: WarRoomData): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    for (const [appName, appData] of data.apps) {
        // Deployment events
        for (const dep of appData.deployments) {
            if (dep.timestamp !== 'unknown') {
                events.push({
                    timestamp: dep.timestamp,
                    type: 'deployment',
                    app: appName,
                    description: `Deployed v${dep.version} by ${dep.triggeredBy}${dep.suspicious ? ' [SUSPICIOUS]' : ''}`,
                    severity: dep.suspicious ? 'critical' : 'info',
                    data: { deploymentId: dep.deploymentId, version: dep.version, suspicious: dep.suspicious }
                });
            }
        }

        // Error spikes from log groups
        for (const group of appData.logs.groups) {
            if (group.level === 'ERROR' && group.count >= 5) {
                events.push({
                    timestamp: group.firstSeen,
                    type: 'error_spike',
                    app: appName,
                    description: `Error pattern (${group.count}x): ${group.pattern.substring(0, 100)}`,
                    severity: group.count >= 50 ? 'critical' : 'warning',
                    data: { count: group.count, pattern: group.pattern }
                });
            }
            if (group.level === 'WARN' && group.count >= 20) {
                events.push({
                    timestamp: group.firstSeen,
                    type: 'warning_spike',
                    app: appName,
                    description: `Warning pattern (${group.count}x): ${group.pattern.substring(0, 100)}`,
                    severity: 'warning',
                    data: { count: group.count, pattern: group.pattern }
                });
            }
        }

        // Metric anomalies
        for (const anomaly of appData.metrics.anomalies) {
            events.push({
                timestamp: appData.metrics.current.timestamp,
                type: 'metric_anomaly',
                app: appName,
                description: anomaly.description,
                severity: anomaly.severity === 'high' ? 'critical' : 'warning',
                data: { metric: anomaly.metric, current: anomaly.current, baseline: anomaly.baseline }
            });
        }

        // Status change events
        const status = appData.status.status.toUpperCase();
        if (status !== 'STARTED' && status !== 'RUNNING' && status !== 'DEPLOYED' && status !== 'APPLIED') {
            events.push({
                timestamp: appData.status.lastRestart || data.config.timeWindow.start.toISOString(),
                type: 'status_change',
                app: appName,
                description: `App status: ${appData.status.status}`,
                severity: (status === 'STOPPED' || status === 'FAILED' || status === 'UNDEPLOYED')
                    ? 'critical' : 'warning'
            });
        }
    }

    // Sort chronologically
    events.sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        if (isNaN(dateA) && isNaN(dateB)) { return 0; }
        if (isNaN(dateA)) { return 1; }
        if (isNaN(dateB)) { return -1; }
        return dateA - dateB;
    });

    return events;
}

export function analyzeCorrelations(
    data: WarRoomData,
    timeline: TimelineEvent[]
): CorrelationResult[] {
    const results: CorrelationResult[] = [];

    // Rule 1: Deployment within 15min before error spike
    const deploymentCorrelation = checkDeploymentCorrelation(data, timeline);
    if (deploymentCorrelation) {
        results.push(deploymentCorrelation);
    }

    // Rule 2: Resource exhaustion (CPU/memory spike preceded errors)
    const resourceCorrelation = checkResourceExhaustion(data);
    if (resourceCorrelation) {
        results.push(resourceCorrelation);
    }

    // Rule 3: Downstream dependency failure
    const downstreamCorrelation = checkDownstreamFailure(data, timeline);
    if (downstreamCorrelation) {
        results.push(downstreamCorrelation);
    }

    // Rule 4: Multiple apps failing simultaneously
    const sharedDependencyCorrelation = checkSharedDependencyFailure(data);
    if (sharedDependencyCorrelation) {
        results.push(sharedDependencyCorrelation);
    }

    // Sort by confidence
    const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => (confidenceOrder[a.confidence] || 3) - (confidenceOrder[b.confidence] || 3));

    // If no correlations found, add unknown
    if (results.length === 0) {
        results.push({
            probableCause: 'Unable to determine root cause from available data',
            confidence: 'low',
            evidence: ['No clear correlation patterns detected in the collected data'],
            category: 'unknown'
        });
    }

    return results;
}

function checkDeploymentCorrelation(
    data: WarRoomData,
    timeline: TimelineEvent[]
): CorrelationResult | null {
    const suspiciousDeployments: Array<{ app: string; version: string; timestamp: string }> = [];
    const appsWithErrors: Set<string> = new Set();

    for (const [appName, appData] of data.apps) {
        if (appData.logs.errors > 0) {
            appsWithErrors.add(appName);
        }

        for (const dep of appData.deployments) {
            if (dep.suspicious) {
                suspiciousDeployments.push({
                    app: appName,
                    version: dep.version,
                    timestamp: dep.timestamp
                });
            }
        }
    }

    if (suspiciousDeployments.length > 0) {
        const affectedApps = suspiciousDeployments.filter(d => appsWithErrors.has(d.app));
        const evidence: string[] = [];

        for (const dep of suspiciousDeployments) {
            evidence.push(`${dep.app} deployed v${dep.version} at ${dep.timestamp}`);
        }

        if (affectedApps.length > 0) {
            evidence.push(`${affectedApps.map(d => d.app).join(', ')} showing errors after deployment`);
        }

        return {
            probableCause: `Recent Deployment: ${suspiciousDeployments.map(d => `${d.app} v${d.version}`).join(', ')} deployed shortly before incident`,
            confidence: affectedApps.length > 0 ? 'high' : 'medium',
            evidence,
            category: 'recent_deployment'
        };
    }

    return null;
}

function checkResourceExhaustion(data: WarRoomData): CorrelationResult | null {
    const resourceIssues: Array<{ app: string; metric: string; value: number }> = [];

    for (const [appName, appData] of data.apps) {
        for (const anomaly of appData.metrics.anomalies) {
            if (anomaly.metric === 'CPU' || anomaly.metric === 'Memory') {
                if (anomaly.severity === 'high') {
                    resourceIssues.push({
                        app: appName,
                        metric: anomaly.metric,
                        value: anomaly.current
                    });
                }
            }
        }
    }

    if (resourceIssues.length > 0) {
        const evidence = resourceIssues.map(
            issue => `${issue.app}: ${issue.metric} at ${issue.value.toFixed(1)}%`
        );

        return {
            probableCause: `Resource Exhaustion: ${resourceIssues.map(i => `${i.app} ${i.metric}`).join(', ')} critically high`,
            confidence: resourceIssues.length >= 2 ? 'high' : 'medium',
            evidence,
            category: 'resource_exhaustion'
        };
    }

    return null;
}

function checkDownstreamFailure(
    data: WarRoomData,
    timeline: TimelineEvent[]
): CorrelationResult | null {
    const downstreamApps = new Set(data.blastRadius.downstream.map(d => d.app));
    const failingDownstream: string[] = [];
    const failingUpstream: string[] = [];

    for (const [appName, appData] of data.apps) {
        const hasErrors = appData.logs.errors > 10;
        const isStopped = ['STOPPED', 'FAILED', 'UNDEPLOYED'].includes(appData.status.status.toUpperCase());

        if (hasErrors || isStopped) {
            if (downstreamApps.has(appName)) {
                failingDownstream.push(appName);
            } else if (data.blastRadius.seedApps.includes(appName)) {
                failingUpstream.push(appName);
            }
        }
    }

    if (failingDownstream.length > 0) {
        const evidence = [
            `Downstream apps failing: ${failingDownstream.join(', ')}`,
            ...failingUpstream.map(app => `Seed app ${app} also experiencing errors`)
        ];

        // Check if downstream errors started before upstream errors
        const downstreamFirstError = getFirstErrorTimestamp(data, failingDownstream);
        const upstreamFirstError = getFirstErrorTimestamp(data, data.blastRadius.seedApps);

        if (downstreamFirstError && upstreamFirstError && downstreamFirstError < upstreamFirstError) {
            evidence.push('Downstream errors started before upstream errors');
            return {
                probableCause: `Downstream Dependency Failure: ${failingDownstream.join(', ')} failed before upstream apps`,
                confidence: 'high',
                evidence,
                category: 'downstream_failure'
            };
        }

        return {
            probableCause: `Downstream Dependency Failure: ${failingDownstream.join(', ')} experiencing issues`,
            confidence: 'medium',
            evidence,
            category: 'downstream_failure'
        };
    }

    return null;
}

function checkSharedDependencyFailure(data: WarRoomData): CorrelationResult | null {
    const failingApps: string[] = [];

    for (const [appName, appData] of data.apps) {
        if (appData.logs.errors > 5 || ['STOPPED', 'FAILED'].includes(appData.status.status.toUpperCase())) {
            failingApps.push(appName);
        }
    }

    if (failingApps.length >= 3) {
        const evidence = [
            `${failingApps.length} apps failing simultaneously: ${failingApps.join(', ')}`,
            'Pattern suggests shared infrastructure or dependency issue'
        ];

        return {
            probableCause: `Shared Dependency or Infrastructure Issue: ${failingApps.length} apps failing simultaneously`,
            confidence: failingApps.length >= 5 ? 'high' : 'medium',
            evidence,
            category: 'shared_dependency'
        };
    }

    return null;
}

function getFirstErrorTimestamp(data: WarRoomData, appNames: string[]): Date | null {
    let earliest: Date | null = null;

    for (const appName of appNames) {
        const appData = data.apps.get(appName);
        if (!appData) { continue; }

        for (const group of appData.logs.groups) {
            if (group.level === 'ERROR') {
                const date = new Date(group.firstSeen);
                if (!isNaN(date.getTime()) && (earliest === null || date < earliest)) {
                    earliest = date;
                }
            }
        }
    }

    return earliest;
}
