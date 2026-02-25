import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    WarRoomReport,
    WarRoomData,
    TimelineEvent,
    CorrelationResult,
    BlastRadius,
    AppWarRoomData
} from './types';

const WARROOM_DIR = '.warroom';
const REPORTS_DIR = 'reports';

export async function generateReport(
    data: WarRoomData,
    timeline: TimelineEvent[],
    correlations: CorrelationResult[]
): Promise<string> {
    const report: WarRoomReport = {
        config: data.config,
        blastRadius: data.blastRadius,
        timeline,
        correlations,
        apps: data.apps,
        collectionErrors: data.collectionErrors,
        collectionTime: data.collectionTime,
        generatedAt: new Date().toISOString()
    };

    const markdown = renderMarkdown(report);

    // Save to file
    const filePath = await saveReport(markdown);

    // Open in VS Code editor
    if (filePath) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } else {
        // If no workspace, open as untitled document
        const doc = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    return markdown;
}

function renderMarkdown(report: WarRoomReport): string {
    const lines: string[] = [];
    const { config, blastRadius, timeline, correlations, apps, collectionErrors, collectionTime } = report;

    // Header
    lines.push(`# War Room Incident Report`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Severity** | ${config.severity} |`);
    lines.push(`| **Environment** | ${config.environment} |`);
    lines.push(`| **Seed Applications** | ${config.applications.map(a => a.name).join(', ')} |`);
    lines.push(`| **Time Window** | ${formatDate(config.timeWindow.start)} - ${formatDate(config.timeWindow.end)} |`);
    lines.push(`| **Report Generated** | ${formatDate(new Date(report.generatedAt))} |`);
    lines.push(`| **Total Apps Analyzed** | ${apps.size} |`);
    lines.push('');

    // Probable Cause
    lines.push(`## Probable Cause`);
    lines.push('');
    if (correlations.length > 0) {
        const primary = correlations[0];
        lines.push(`> **${primary.probableCause}**`);
        lines.push(`>`);
        lines.push(`> Confidence: **${primary.confidence.toUpperCase()}**`);
        lines.push('');
        lines.push('### Evidence');
        lines.push('');
        for (const evidence of primary.evidence) {
            lines.push(`- ${evidence}`);
        }
        lines.push('');

        if (correlations.length > 1) {
            lines.push('### Other Possible Causes');
            lines.push('');
            for (let i = 1; i < correlations.length; i++) {
                const corr = correlations[i];
                lines.push(`${i}. **${corr.probableCause}** (${corr.confidence} confidence)`);
                for (const ev of corr.evidence) {
                    lines.push(`   - ${ev}`);
                }
            }
            lines.push('');
        }
    }

    // Blast Radius Map
    lines.push(`## Blast Radius`);
    lines.push('');
    lines.push(`| App | Direction | Hops | Status | Errors | Warnings |`);
    lines.push(`|-----|-----------|------|--------|--------|----------|`);

    for (const seedApp of blastRadius.seedApps) {
        const appData = apps.get(seedApp);
        const status = appData?.status.status || 'UNKNOWN';
        const errors = appData?.logs.errors || 0;
        const warnings = appData?.logs.warnings || 0;
        lines.push(`| **${seedApp}** | SEED | 0 | ${statusBadge(status)} | ${errors} | ${warnings} |`);
    }

    for (const up of blastRadius.upstream) {
        const appData = apps.get(up.app);
        const status = appData?.status.status || 'UNKNOWN';
        const errors = appData?.logs.errors || 0;
        const warnings = appData?.logs.warnings || 0;
        lines.push(`| ${up.app} | UPSTREAM | ${up.hops} | ${statusBadge(status)} | ${errors} | ${warnings} |`);
    }

    for (const down of blastRadius.downstream) {
        const appData = apps.get(down.app);
        const status = appData?.status.status || 'UNKNOWN';
        const errors = appData?.logs.errors || 0;
        const warnings = appData?.logs.warnings || 0;
        lines.push(`| ${down.app} | DOWNSTREAM | ${down.hops} | ${statusBadge(status)} | ${errors} | ${warnings} |`);
    }
    lines.push('');

    // Timeline
    lines.push(`## Timeline`);
    lines.push('');
    if (timeline.length > 0) {
        lines.push(`| Time | App | Type | Severity | Description |`);
        lines.push(`|------|-----|------|----------|-------------|`);
        for (const event of timeline.slice(0, 100)) {
            const time = formatTime(event.timestamp);
            const sevIcon = event.severity === 'critical' ? '!!!' : (event.severity === 'warning' ? '!!' : '');
            lines.push(`| ${time} | ${event.app} | ${event.type} | ${sevIcon} ${event.severity} | ${escapeMarkdown(event.description.substring(0, 120))} |`);
        }
        if (timeline.length > 100) {
            lines.push(`| ... | ... | ... | ... | *(${timeline.length - 100} more events omitted)* |`);
        }
    } else {
        lines.push('*No significant events detected in the time window.*');
    }
    lines.push('');

    // Error Summary
    lines.push(`## Error Summary`);
    lines.push('');
    let hasErrors = false;
    for (const [appName, appData] of apps) {
        const errorGroups = appData.logs.groups.filter(g => g.level === 'ERROR');
        if (errorGroups.length > 0) {
            hasErrors = true;
            lines.push(`### ${appName} (${appData.logs.errors} errors)`);
            lines.push('');
            lines.push(`| Count | First Seen | Last Seen | Pattern |`);
            lines.push(`|-------|------------|-----------|---------|`);
            for (const group of errorGroups.slice(0, 10)) {
                lines.push(`| ${group.count} | ${formatTime(group.firstSeen)} | ${formatTime(group.lastSeen)} | ${escapeMarkdown(group.pattern.substring(0, 80))} |`);
            }
            if (errorGroups.length > 10) {
                lines.push(`| ... | ... | ... | *(${errorGroups.length - 10} more patterns)* |`);
            }
            lines.push('');
        }
    }
    if (!hasErrors) {
        lines.push('*No ERROR-level log entries found in the time window.*');
        lines.push('');
    }

    // Recent Deployments
    lines.push(`## Recent Deployments`);
    lines.push('');
    let hasDeployments = false;
    lines.push(`| App | Version | Timestamp | Status | Triggered By | Flag |`);
    lines.push(`|-----|---------|-----------|--------|--------------|------|`);
    for (const [appName, appData] of apps) {
        for (const dep of appData.deployments) {
            hasDeployments = true;
            const flag = dep.suspicious ? `SUSPICIOUS: ${dep.suspiciousReason || 'deployed near incident window'}` : '';
            lines.push(`| ${dep.appName} | ${dep.version} | ${formatTime(dep.timestamp)} | ${dep.status} | ${dep.triggeredBy} | ${flag} |`);
        }
    }
    if (!hasDeployments) {
        lines.push(`| *No deployments found* | | | | | |`);
    }
    lines.push('');

    // Metric Anomalies
    lines.push(`## Metric Anomalies`);
    lines.push('');
    let hasAnomalies = false;
    lines.push(`| App | Metric | Current | Baseline | Deviation | Severity |`);
    lines.push(`|-----|--------|---------|----------|-----------|----------|`);
    for (const [appName, appData] of apps) {
        for (const anomaly of appData.metrics.anomalies) {
            hasAnomalies = true;
            lines.push(`| ${appName} | ${anomaly.metric} | ${formatMetricValue(anomaly.current, anomaly.metric)} | ${formatMetricValue(anomaly.baseline, anomaly.metric)} | ${anomaly.deviation.toFixed(1)}x | ${anomaly.severity} |`);
        }
    }
    if (!hasAnomalies) {
        lines.push(`| *No anomalies detected* | | | | | |`);
    }
    lines.push('');

    // App Status Summary
    lines.push(`## Application Status`);
    lines.push('');
    lines.push(`| App | Status | Workers | Runtime | Region | Last Restart |`);
    lines.push(`|-----|--------|---------|---------|--------|--------------|`);
    for (const [appName, appData] of apps) {
        const s = appData.status;
        lines.push(`| ${s.name} | ${statusBadge(s.status)} | ${s.workerCount ?? 'N/A'} | ${s.runtimeVersion || 'N/A'} | ${s.region || 'N/A'} | ${s.lastRestart ? formatTime(s.lastRestart) : 'N/A'} |`);
    }
    lines.push('');

    // Recommended Actions
    lines.push(`## Recommended Actions`);
    lines.push('');
    const actions = generateRecommendations(report);
    for (let i = 0; i < actions.length; i++) {
        lines.push(`${i + 1}. ${actions[i]}`);
    }
    lines.push('');

    // Collection Metadata
    lines.push(`## Collection Metadata`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Collection Time | ${(collectionTime / 1000).toFixed(1)}s |`);
    lines.push(`| Apps Analyzed | ${apps.size} |`);
    lines.push(`| Collection Errors | ${collectionErrors.length} |`);
    lines.push('');

    if (collectionErrors.length > 0) {
        lines.push('### Collection Errors');
        lines.push('');
        for (const err of collectionErrors) {
            lines.push(`- **${err.collector}** (${err.app}): ${err.error}`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push(`*Generated by Anypoint Monitor War Room Mode*`);

    return lines.join('\n');
}

function generateRecommendations(report: WarRoomReport): string[] {
    const actions: string[] = [];
    const primary = report.correlations[0];

    if (!primary) {
        actions.push('Review application logs for any error patterns');
        actions.push('Check Anypoint Platform status page for known incidents');
        return actions;
    }

    switch (primary.category) {
        case 'recent_deployment': {
            // Find suspicious deployments to suggest rollback
            for (const [, appData] of report.apps) {
                for (const dep of appData.deployments) {
                    if (dep.suspicious) {
                        actions.push(`**Rollback ${dep.appName}** to previous version (currently v${dep.version}, deployed by ${dep.triggeredBy})`);
                    }
                }
            }
            actions.push('Review deployment change logs and diff for the suspicious deployments');
            actions.push('Check if the deployment included configuration changes that may have caused the issue');
            break;
        }
        case 'resource_exhaustion': {
            for (const [appName, appData] of report.apps) {
                for (const anomaly of appData.metrics.anomalies) {
                    if (anomaly.metric === 'CPU' && anomaly.severity === 'high') {
                        actions.push(`**Scale up ${appName}** workers or increase worker size (CPU at ${anomaly.current.toFixed(1)}%)`);
                    }
                    if (anomaly.metric === 'Memory' && anomaly.severity === 'high') {
                        actions.push(`**Investigate memory leak in ${appName}** or increase worker memory (Memory at ${anomaly.current.toFixed(1)}%)`);
                    }
                }
            }
            actions.push('Consider enabling auto-scaling if available');
            actions.push('Review recent traffic patterns for unexpected load increases');
            break;
        }
        case 'downstream_failure': {
            const downstreamApps = report.blastRadius.downstream.map(d => d.app);
            actions.push(`**Investigate downstream services**: ${downstreamApps.join(', ')}`);
            actions.push('Check if downstream services are responding and healthy');
            actions.push('Review circuit breaker and retry policies in calling applications');
            actions.push('Consider enabling fallback responses for degraded downstream services');
            break;
        }
        case 'shared_dependency': {
            actions.push('Check shared infrastructure: load balancers, VPNs, databases');
            actions.push('Review Anypoint Platform status page for regional outages');
            actions.push('Check network connectivity between applications');
            actions.push('Verify shared credentials and certificates have not expired');
            break;
        }
        default: {
            actions.push('Review application logs for error patterns');
            actions.push('Check application metrics for anomalies');
            actions.push('Verify recent deployments or configuration changes');
            actions.push('Check Anypoint Platform status page for known incidents');
        }
    }

    // Add severity-specific actions
    if (report.config.severity === 'SEV1') {
        actions.push('**[SEV1]** Escalate to on-call engineering lead immediately');
        actions.push('**[SEV1]** Begin customer communication if external impact confirmed');
    } else if (report.config.severity === 'SEV2') {
        actions.push('**[SEV2]** Notify engineering team lead within 30 minutes');
    }

    return actions;
}

async function saveReport(markdown: string): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const reportsDir = path.join(workspaceFolders[0].uri.fsPath, WARROOM_DIR, REPORTS_DIR);
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(reportsDir, `incident-${timestamp}.md`);
    fs.writeFileSync(filePath, markdown, 'utf-8');

    return filePath;
}

function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) { return String(date); }
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatTime(timestamp: string): string {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) { return timestamp; }
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function statusBadge(status: string): string {
    const upper = status.toUpperCase();
    if (['STARTED', 'RUNNING', 'DEPLOYED', 'APPLIED'].includes(upper)) {
        return `**${status}**`;
    }
    if (['STOPPED', 'FAILED', 'UNDEPLOYED'].includes(upper)) {
        return `***${status}***`;
    }
    return status;
}

function formatMetricValue(value: number, metric: string): string {
    if (metric === 'Response Time') {
        return `${value.toFixed(0)}ms`;
    }
    if (metric === 'Message Count') {
        return `${value.toFixed(0)}`;
    }
    return `${value.toFixed(1)}%`;
}

function escapeMarkdown(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
