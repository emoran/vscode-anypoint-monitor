import {
    AppHistoricalMetrics,
    AppUtilization,
    CostRecommendation,
    FleetCostSummary,
    PercentileStats,
    ResourceAllocation,
    SizingStatus
} from './types';

const CH1_PRICE_MAP: Record<string, number> = {
    'Micro': 0,
    '0.1 vCores': 15,
    '0.2 vCores': 30,
    '1 vCore': 122.50,
    '2 vCores': 245,
    '4 vCores': 490,
    '8 vCores': 980,
    '16 vCores': 1960
};

const CH1_TIERS = [
    { name: 'Micro', vCores: 0.1, price: 0 },
    { name: '0.1 vCores', vCores: 0.1, price: 15 },
    { name: '0.2 vCores', vCores: 0.2, price: 30 },
    { name: '1 vCore', vCores: 1, price: 122.50 },
    { name: '2 vCores', vCores: 2, price: 245 },
    { name: '4 vCores', vCores: 4, price: 490 },
    { name: '8 vCores', vCores: 8, price: 980 },
    { name: '16 vCores', vCores: 16, price: 1960 }
];

function computePercentiles(values: number[]): PercentileStats {
    if (values.length === 0) {
        return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;

    return {
        p50: sorted[Math.floor(sorted.length * 0.50)] || 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
        max: sorted[sorted.length - 1] || 0,
        avg
    };
}

function calculateCH1MonthlyCost(allocation: ResourceAllocation): number {
    const workerType = allocation.workerType || '1 vCore';
    const basePrice = CH1_PRICE_MAP[workerType] || 122.50;
    return basePrice * allocation.workers;
}

function calculateCH2MonthlyCost(allocation: ResourceAllocation): number {
    const cpuReserved = allocation.cpuReserved || 0.5;
    const memoryReserved = allocation.memoryReserved || 1;
    const replicas = allocation.replicas || 1;
    const cpuCostPerHour = cpuReserved * 0.09;
    const memoryCostPerHour = memoryReserved * 0.01;
    return (cpuCostPerHour + memoryCostPerHour) * replicas * 24 * 30;
}

function calculateMonthlyCost(appType: 'CH1' | 'CH2', allocation: ResourceAllocation): number {
    if (appType === 'CH1') {
        return calculateCH1MonthlyCost(allocation);
    }
    return calculateCH2MonthlyCost(allocation);
}

function determineSizingStatus(cpuStats: PercentileStats, memoryStats: PercentileStats): SizingStatus {
    if (cpuStats.p95 > 80 || memoryStats.p95 > 85) {
        return 'under-provisioned';
    }
    if (cpuStats.p95 < 30 && memoryStats.p95 < 40) {
        return 'over-provisioned';
    }
    return 'right-sized';
}

function recommendCH1Allocation(
    current: ResourceAllocation,
    cpuStats: PercentileStats,
    status: SizingStatus
): ResourceAllocation {
    if (status === 'right-sized') {
        return { ...current };
    }

    const currentTierIdx = CH1_TIERS.findIndex(t => t.name === current.workerType);
    const baseIdx = currentTierIdx >= 0 ? currentTierIdx : 3;

    if (status === 'over-provisioned') {
        const newIdx = Math.max(1, baseIdx - 1);
        return {
            ...current,
            workerType: CH1_TIERS[newIdx].name,
            vCores: CH1_TIERS[newIdx].vCores
        };
    }

    // under-provisioned
    const newIdx = Math.min(CH1_TIERS.length - 1, baseIdx + 1);
    return {
        ...current,
        workerType: CH1_TIERS[newIdx].name,
        vCores: CH1_TIERS[newIdx].vCores
    };
}

function recommendCH2Allocation(
    current: ResourceAllocation,
    cpuStats: PercentileStats,
    memoryStats: PercentileStats,
    status: SizingStatus
): ResourceAllocation {
    if (status === 'right-sized') {
        return { ...current };
    }

    const cpu = current.cpuReserved || 0.5;
    const mem = current.memoryReserved || 1;
    const replicas = current.replicas || 1;

    if (status === 'over-provisioned') {
        const newCpu = Math.max(0.1, roundTo(cpu * 0.6, 0.1));
        const newMem = Math.max(0.5, roundTo(mem * 0.7, 0.5));
        return {
            ...current,
            cpuReserved: newCpu,
            memoryReserved: newMem,
            vCores: newCpu,
            replicas
        };
    }

    // under-provisioned
    let newCpu = cpu;
    let newMem = mem;
    let newReplicas = replicas;

    if (cpuStats.p95 > 80) {
        newCpu = roundTo(cpu * 1.5, 0.1);
    }
    if (memoryStats.p95 > 85) {
        newMem = roundTo(mem * 1.5, 0.5);
    }
    if (cpuStats.p95 > 90 && replicas < 3) {
        newReplicas = replicas + 1;
    }

    return {
        ...current,
        cpuReserved: newCpu,
        memoryReserved: newMem,
        vCores: newCpu,
        replicas: newReplicas
    };
}

function roundTo(value: number, step: number): number {
    return Math.round(value / step) * step;
}

function buildReasoning(
    status: SizingStatus,
    cpuStats: PercentileStats,
    memoryStats: PercentileStats,
    current: ResourceAllocation,
    recommended: ResourceAllocation
): string {
    if (status === 'right-sized') {
        return `Resource utilization is within optimal range (CPU P95: ${cpuStats.p95.toFixed(1)}%, Memory P95: ${memoryStats.p95.toFixed(1)}%). No changes needed.`;
    }

    if (status === 'over-provisioned') {
        return `CPU P95 at ${cpuStats.p95.toFixed(1)}% and Memory P95 at ${memoryStats.p95.toFixed(1)}% indicate significant over-provisioning. ` +
            `Recommend downsizing from ${formatAllocation(current)} to ${formatAllocation(recommended)}.`;
    }

    return `CPU P95 at ${cpuStats.p95.toFixed(1)}% and/or Memory P95 at ${memoryStats.p95.toFixed(1)}% exceed safe thresholds. ` +
        `Recommend upsizing from ${formatAllocation(current)} to ${formatAllocation(recommended)} to prevent performance degradation.`;
}

function formatAllocation(a: ResourceAllocation): string {
    if (a.workerType) {
        return `${a.workers}x ${a.workerType}`;
    }
    return `${a.replicas || 1}x (${a.cpuReserved || 0.5} CPU, ${a.memoryReserved || 1} GB)`;
}

export function analyzeUtilization(
    apps: Array<{
        name: string;
        type: 'CH1' | 'CH2';
        allocation: ResourceAllocation;
    }>,
    metricsMap: Map<string, AppHistoricalMetrics>
): CostRecommendation[] {
    const recommendations: CostRecommendation[] = [];

    for (const app of apps) {
        const metrics = metricsMap.get(app.name);

        if (!metrics || (metrics.cpu.length === 0 && metrics.memory.length === 0)) {
            recommendations.push({
                appName: app.name,
                appType: app.type,
                status: 'right-sized',
                currentAllocation: app.allocation,
                recommendedAllocation: app.allocation,
                currentMonthlyCost: calculateMonthlyCost(app.type, app.allocation),
                recommendedMonthlyCost: calculateMonthlyCost(app.type, app.allocation),
                monthlySavings: 0,
                annualSavings: 0,
                cpuStats: { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 },
                memoryStats: { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 },
                reasoning: 'No historical metrics available. Unable to generate recommendation.'
            });
            continue;
        }

        const cpuValues = metrics.cpu.map(p => p.value * 100);
        const memValues = metrics.memory.map(p => p.value / (1024 * 1024));

        // Normalize memory to percentage if we have allocation info
        const allocMemMB = (app.allocation.memoryReserved || 1) * 1024;
        const memPercentValues = allocMemMB > 0
            ? memValues.map(v => (v / allocMemMB) * 100)
            : memValues;

        const cpuStats = computePercentiles(cpuValues);
        const memoryStats = computePercentiles(memPercentValues);
        const status = determineSizingStatus(cpuStats, memoryStats);

        let recommended: ResourceAllocation;
        if (app.type === 'CH1') {
            recommended = recommendCH1Allocation(app.allocation, cpuStats, status);
        } else {
            recommended = recommendCH2Allocation(app.allocation, cpuStats, memoryStats, status);
        }

        const currentCost = calculateMonthlyCost(app.type, app.allocation);
        const recommendedCost = calculateMonthlyCost(app.type, recommended);
        const savings = currentCost - recommendedCost;

        recommendations.push({
            appName: app.name,
            appType: app.type,
            status,
            currentAllocation: app.allocation,
            recommendedAllocation: recommended,
            currentMonthlyCost: Math.round(currentCost * 100) / 100,
            recommendedMonthlyCost: Math.round(recommendedCost * 100) / 100,
            monthlySavings: Math.round(savings * 100) / 100,
            annualSavings: Math.round(savings * 12 * 100) / 100,
            cpuStats,
            memoryStats,
            reasoning: buildReasoning(status, cpuStats, memoryStats, app.allocation, recommended)
        });
    }

    return recommendations.sort((a, b) => b.monthlySavings - a.monthlySavings);
}

export function computeFleetSummary(recommendations: CostRecommendation[]): FleetCostSummary {
    const withMetrics = recommendations.filter(r => r.reasoning !== 'No historical metrics available. Unable to generate recommendation.');
    const overProvisioned = recommendations.filter(r => r.status === 'over-provisioned').length;
    const underProvisioned = recommendations.filter(r => r.status === 'under-provisioned').length;
    const rightSized = recommendations.filter(r => r.status === 'right-sized').length;

    const currentSpend = recommendations.reduce((s, r) => s + r.currentMonthlyCost, 0);
    const optimizedSpend = recommendations.reduce((s, r) => s + r.recommendedMonthlyCost, 0);
    const savings = currentSpend - optimizedSpend;

    const total = recommendations.length;
    const score = total > 0
        ? Math.round((rightSized / total) * 100)
        : 100;

    return {
        totalAppsAnalyzed: total,
        appsWithMetrics: withMetrics.length,
        overProvisioned,
        underProvisioned,
        rightSized,
        currentMonthlySpend: Math.round(currentSpend * 100) / 100,
        optimizedMonthlySpend: Math.round(optimizedSpend * 100) / 100,
        potentialMonthlySavings: Math.round(savings * 100) / 100,
        potentialAnnualSavings: Math.round(savings * 12 * 100) / 100,
        optimizationScore: score
    };
}
