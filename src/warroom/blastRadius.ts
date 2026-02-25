import { BlastRadius, DependencyMap } from './types';

const MAX_HOPS = 2;

export function calculateBlastRadius(
    seedApps: string[],
    dependencyMap: DependencyMap
): BlastRadius {
    const upstream: Map<string, number> = new Map();
    const downstream: Map<string, number> = new Map();
    const seedSet = new Set(seedApps);

    // Build adjacency lists from the dependency map
    // sourceApp -> targetApp means sourceApp CALLS targetApp
    // So targetApp's upstream includes sourceApp
    // And sourceApp's downstream includes targetApp
    const callsTo: Map<string, Set<string>> = new Map(); // app -> apps it calls (downstream)
    const calledBy: Map<string, Set<string>> = new Map(); // app -> apps that call it (upstream)

    for (const dep of dependencyMap.dependencies) {
        if (dep.isExternal) { continue; }

        if (!callsTo.has(dep.sourceApp)) {
            callsTo.set(dep.sourceApp, new Set());
        }
        callsTo.get(dep.sourceApp)!.add(dep.targetApp);

        if (!calledBy.has(dep.targetApp)) {
            calledBy.set(dep.targetApp, new Set());
        }
        calledBy.get(dep.targetApp)!.add(dep.sourceApp);
    }

    // Walk downstream (apps that seed apps call, and their callees)
    for (const seed of seedApps) {
        walkGraph(seed, callsTo, downstream, seedSet, 0);
    }

    // Walk upstream (apps that call seed apps, and their callers)
    for (const seed of seedApps) {
        walkGraph(seed, calledBy, upstream, seedSet, 0);
    }

    const allAffected = new Set<string>([
        ...seedApps,
        ...upstream.keys(),
        ...downstream.keys()
    ]);

    return {
        seedApps,
        upstream: Array.from(upstream.entries())
            .map(([app, hops]) => ({ app, hops }))
            .sort((a, b) => a.hops - b.hops),
        downstream: Array.from(downstream.entries())
            .map(([app, hops]) => ({ app, hops }))
            .sort((a, b) => a.hops - b.hops),
        allAffected: Array.from(allAffected)
    };
}

function walkGraph(
    current: string,
    adjacency: Map<string, Set<string>>,
    visited: Map<string, number>,
    seedSet: Set<string>,
    currentHop: number
): void {
    if (currentHop >= MAX_HOPS) { return; }

    const neighbors = adjacency.get(current);
    if (!neighbors) { return; }

    for (const neighbor of neighbors) {
        if (seedSet.has(neighbor)) { continue; }

        const nextHop = currentHop + 1;
        const existingHops = visited.get(neighbor);

        if (existingHops === undefined || nextHop < existingHops) {
            visited.set(neighbor, nextHop);
            walkGraph(neighbor, adjacency, visited, seedSet, nextHop);
        }
    }
}
