export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'snoozed' | 'resolved';
export type AlertMetric = 'app_status' | 'cpu' | 'memory' | 'error_rate' | 'mq_queue_depth' | 'deployment_status';
export type AlertOperator = 'gt' | 'lt' | 'eq' | 'neq' | 'gte' | 'lte' | 'not_healthy';
export type PollingInterval = 30000 | 60000 | 300000;

export interface AlertRule {
    id: string;
    name: string;
    description: string;
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number | string;
    severity: AlertSeverity;
    enabled: boolean;
    cooldownMs: number;
}

export interface AlertEvent {
    id: string;
    ruleId: string;
    ruleName: string;
    appName: string;
    appType: 'CH1' | 'CH2' | 'HYBRID';
    environmentId: string;
    environmentName: string;
    severity: AlertSeverity;
    status: AlertStatus;
    message: string;
    currentValue: number | string;
    threshold: number | string;
    firedAt: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
    snoozedUntil?: string;
}

export interface AlertState {
    events: AlertEvent[];
    lastPollAt?: string;
    isPolling: boolean;
    pollingIntervalMs: PollingInterval;
    monitoredEnvironments: Array<{ id: string; name: string }>;
}

export interface AlertConfig {
    enabled: boolean;
    pollingIntervalMs: PollingInterval;
    rules: AlertRule[];
    monitoredEnvironments: Array<{ id: string; name: string }>;
    mutedApps: string[];
}

export interface AppMetricsSnapshot {
    name: string;
    type: 'CH1' | 'CH2' | 'HYBRID';
    status: string;
    cpu?: number;
    memory?: number;
    errorRate?: number;
    lastDeploymentStatus?: string;
}
