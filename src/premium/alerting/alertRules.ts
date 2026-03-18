import { AlertRule, AlertEvent, AlertSeverity, AppMetricsSnapshot } from './types';

const HEALTHY_STATUSES: Record<string, string[]> = {
    'CH1': ['STARTED'],
    'CH2': ['APPLIED', 'RUNNING', 'STARTED'],
    'HYBRID': ['STARTED', 'RUNNING'],
};

export const DEFAULT_RULES: AlertRule[] = [
    {
        id: 'app_stopped',
        name: 'Application Stopped',
        description: 'Fires when an application is not in a healthy running state',
        metric: 'app_status',
        operator: 'not_healthy',
        threshold: 'RUNNING',
        severity: 'critical',
        enabled: true,
        cooldownMs: 300000
    },
    {
        id: 'cpu_high',
        name: 'High CPU Usage',
        description: 'Fires when CPU usage exceeds 85%',
        metric: 'cpu',
        operator: 'gt',
        threshold: 85,
        severity: 'warning',
        enabled: true,
        cooldownMs: 300000
    },
    {
        id: 'cpu_critical',
        name: 'Critical CPU Usage',
        description: 'Fires when CPU usage exceeds 95%',
        metric: 'cpu',
        operator: 'gt',
        threshold: 95,
        severity: 'critical',
        enabled: true,
        cooldownMs: 180000
    },
    {
        id: 'memory_high',
        name: 'High Memory Usage',
        description: 'Fires when memory usage exceeds 85%',
        metric: 'memory',
        operator: 'gt',
        threshold: 85,
        severity: 'warning',
        enabled: true,
        cooldownMs: 300000
    },
    {
        id: 'memory_critical',
        name: 'Critical Memory Usage',
        description: 'Fires when memory usage exceeds 95%',
        metric: 'memory',
        operator: 'gt',
        threshold: 95,
        severity: 'critical',
        enabled: true,
        cooldownMs: 180000
    },
    {
        id: 'error_rate_high',
        name: 'High Error Rate',
        description: 'Fires when error rate exceeds 5%',
        metric: 'error_rate',
        operator: 'gt',
        threshold: 5,
        severity: 'warning',
        enabled: true,
        cooldownMs: 300000
    }
];

function getMetricValue(app: AppMetricsSnapshot, metric: string): number | string | undefined {
    switch (metric) {
        case 'app_status': return app.status;
        case 'cpu': return app.cpu;
        case 'memory': return app.memory;
        case 'error_rate': return app.errorRate;
        case 'deployment_status': return app.lastDeploymentStatus;
        default: return undefined;
    }
}

function isHealthyStatus(status: string, appType: string): boolean {
    const healthy = HEALTHY_STATUSES[appType] || HEALTHY_STATUSES['CH1'];
    return healthy.some(h => h === status.toUpperCase());
}

function compareValues(
    actual: number | string,
    operator: string,
    threshold: number | string,
    appType?: string
): boolean {
    if (operator === 'not_healthy') {
        return !isHealthyStatus(String(actual), appType || 'CH1');
    }

    if (typeof actual === 'string' || typeof threshold === 'string') {
        const a = String(actual).toUpperCase();
        const t = String(threshold).toUpperCase();
        switch (operator) {
            case 'eq': return a === t;
            case 'neq': return a !== t;
            default: return false;
        }
    }

    const numActual = Number(actual);
    const numThreshold = Number(threshold);
    if (isNaN(numActual) || isNaN(numThreshold)) {
        return false;
    }

    switch (operator) {
        case 'gt': return numActual > numThreshold;
        case 'lt': return numActual < numThreshold;
        case 'gte': return numActual >= numThreshold;
        case 'lte': return numActual <= numThreshold;
        case 'eq': return numActual === numThreshold;
        case 'neq': return numActual !== numThreshold;
        default: return false;
    }
}

function formatAlertMessage(rule: AlertRule, app: AppMetricsSnapshot, currentValue: number | string): string {
    switch (rule.metric) {
        case 'app_status': {
            const expected = (HEALTHY_STATUSES[app.type] || ['STARTED']).join('/');
            return `${app.name} is ${currentValue} (expected ${expected})`;
        }
        case 'cpu':
            return `${app.name} CPU at ${Number(currentValue).toFixed(1)}% (threshold: ${rule.threshold}%)`;
        case 'memory':
            return `${app.name} memory at ${Number(currentValue).toFixed(1)}% (threshold: ${rule.threshold}%)`;
        case 'error_rate':
            return `${app.name} error rate at ${Number(currentValue).toFixed(1)}% (threshold: ${rule.threshold}%)`;
        default:
            return `${app.name}: ${rule.name} triggered (value: ${currentValue}, threshold: ${rule.threshold})`;
    }
}

export function evaluateRules(
    app: AppMetricsSnapshot,
    rules: AlertRule[],
    environmentId: string,
    environmentName: string
): AlertEvent[] {
    const events: AlertEvent[] = [];

    for (const rule of rules) {
        if (!rule.enabled) {
            continue;
        }

        const currentValue = getMetricValue(app, rule.metric);
        if (currentValue === undefined || currentValue === null) {
            continue;
        }

        if (compareValues(currentValue, rule.operator, rule.threshold, app.type)) {
            events.push({
                id: `${app.name}-${rule.id}-${Date.now()}`,
                ruleId: rule.id,
                ruleName: rule.name,
                appName: app.name,
                appType: app.type,
                environmentId,
                environmentName,
                severity: rule.severity,
                status: 'active',
                message: formatAlertMessage(rule, app, currentValue),
                currentValue,
                threshold: rule.threshold,
                firedAt: new Date().toISOString()
            });
        }
    }

    return events;
}

export function mergeRulesWithDefaults(customRules?: Partial<AlertRule>[]): AlertRule[] {
    if (!customRules || customRules.length === 0) {
        return [...DEFAULT_RULES];
    }

    const merged = DEFAULT_RULES.map(def => ({ ...def }));
    for (const custom of customRules) {
        if (!custom.id) { continue; }
        const idx = merged.findIndex(r => r.id === custom.id);
        if (idx >= 0) {
            merged[idx] = {
                ...merged[idx],
                enabled: custom.enabled ?? merged[idx].enabled,
                severity: custom.severity ?? merged[idx].severity,
                cooldownMs: custom.cooldownMs ?? merged[idx].cooldownMs,
            };
        }
    }
    return merged;
}
