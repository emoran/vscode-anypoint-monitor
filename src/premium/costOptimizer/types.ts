export type SizingStatus = 'over-provisioned' | 'under-provisioned' | 'right-sized';
export type TimeWindow = '7d' | '30d';

export interface HistoricalMetricPoint {
    timestamp: number;
    value: number;
}

export interface AppHistoricalMetrics {
    appName: string;
    appType: 'CH1' | 'CH2';
    cpu: HistoricalMetricPoint[];
    memory: HistoricalMetricPoint[];
    timeWindowDays: number;
}

export interface PercentileStats {
    p50: number;
    p95: number;
    p99: number;
    max: number;
    avg: number;
}

export interface AppUtilization {
    appName: string;
    appType: 'CH1' | 'CH2';
    currentAllocation: ResourceAllocation;
    cpuStats: PercentileStats;
    memoryStats: PercentileStats;
    status: SizingStatus;
    metricsAvailable: boolean;
}

export interface ResourceAllocation {
    vCores: number;
    workers: number;
    workerType?: string;
    memoryMB?: number;
    cpuReserved?: number;
    memoryReserved?: number;
    replicas?: number;
}

export interface CostRecommendation {
    appName: string;
    appType: 'CH1' | 'CH2';
    status: SizingStatus;
    currentAllocation: ResourceAllocation;
    recommendedAllocation: ResourceAllocation;
    currentMonthlyCost: number;
    recommendedMonthlyCost: number;
    monthlySavings: number;
    annualSavings: number;
    cpuStats: PercentileStats;
    memoryStats: PercentileStats;
    reasoning: string;
}

export interface FleetCostSummary {
    totalAppsAnalyzed: number;
    appsWithMetrics: number;
    overProvisioned: number;
    underProvisioned: number;
    rightSized: number;
    currentMonthlySpend: number;
    optimizedMonthlySpend: number;
    potentialMonthlySavings: number;
    potentialAnnualSavings: number;
    optimizationScore: number;
}
