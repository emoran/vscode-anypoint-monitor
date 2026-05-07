/**
 * Combined Application Diagram panel.
 *
 * Tabs:
 *   - Summary       : project overview + heuristic/LLM narrative
 *   - Architecture  : G6 graph (entry points, flows, external systems)
 *   - Flow Diagram  : G6 dagre layout of flow-ref topology
 *   - Files         : grouped flow list with click-to-open
 *
 * Diagrams use AntV G6 v5 with custom node shapes per type, animated edges,
 * minimap, hover halo, and click-to-open. Visual language matches the
 * Application Command Center: monochrome backbone, accent only on hover,
 * all colors derived from --am-* theme tokens (read at runtime so dark/light
 * theme switches work automatically).
 *
 * Notes on third-party content: G6 ships an opt-in iconfont fetched from
 * at.alicdn.com. We do NOT enable it — every icon we render is inline SVG
 * served from the extension itself, so the CSP stays locked to our origin.
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { badge, escapeHtml, escapeAttr, wrapWebviewHtml } from '../webview/ui-kit';
import { MuleProject, ConnectorKind } from '../utils/muleProject';
import { buildHeuristicNarrative, buildLlmNarrative, NarrativeResult } from '../utils/muleProjectSummary';
import { ExtractedJar, openExtractedFile } from '../utils/jarWorkspace';

export interface PanelOptions {
    appLabel: string;
}

export async function showProjectDiagramPanel(
    context: vscode.ExtensionContext,
    project: MuleProject,
    extracted: ExtractedJar | undefined,
    opts: PanelOptions
): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'anypointProjectDiagram',
        `Diagram — ${opts.appLabel}`,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                context.extensionUri,
                vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
            ],
        }
    );

    const g6Uri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@antv', 'g6', 'dist', 'g6.min.js')
    );

    const heuristic = buildHeuristicNarrative(project);

    panel.webview.html = renderHtml({
        webview: panel.webview,
        nonce: makeNonce(),
        appLabel: opts.appLabel,
        project,
        g6Uri: g6Uri.toString(),
        narrative: heuristic,
    });

    const aiEnabled = vscode.workspace
        .getConfiguration('anypointMonitor.diagram')
        .get<boolean>('aiSummary.enabled', false);
    if (aiEnabled) {
        runLlmNarrativeInBackground(panel, project);
    }

    panel.webview.onDidReceiveMessage(async (message) => {
        try {
            switch (message?.command) {
                case 'openFlowFile':
                    await handleOpenFlowFile(extracted, message.filePath);
                    break;
                case 'regenerateLlm':
                    runLlmNarrativeInBackground(panel, project, /*force*/ true);
                    break;
                case 'exportPng':
                    await handleExportPng(message.dataUri, opts.appLabel, message.tab);
                    break;
                case 'webviewError': {
                    // Surface any uncaught webview error to the host so a
                    // silently-broken canvas turns into something we can act
                    // on instead of an empty panel.
                    const text = typeof message.message === 'string' ? message.message : 'Unknown webview error';
                    console.error('[Diagram webview]', text);
                    vscode.window.showErrorMessage(`Diagram webview error: ${text.split('\n')[0]}`);
                    break;
                }
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Diagram action failed: ${errMsg}`);
        }
    }, undefined, context.subscriptions);
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleOpenFlowFile(extracted: ExtractedJar | undefined, filePath: unknown): Promise<void> {
    if (!extracted) {
        vscode.window.showInformationMessage('Source files are not available (the JAR was not extracted).');
        return;
    }
    if (typeof filePath !== 'string' || !filePath) {
        return;
    }
    await openExtractedFile(extracted, filePath);
}

async function handleExportPng(dataUri: unknown, appLabel: string, tab: unknown): Promise<void> {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/png;base64,')) {
        return;
    }
    const safeName = appLabel.replace(/[^a-zA-Z0-9._-]/g, '_') || 'diagram';
    const tabSuffix = typeof tab === 'string' && tab ? `-${tab}` : '';
    const target = await vscode.window.showSaveDialog({
        saveLabel: 'Export PNG',
        defaultUri: vscode.Uri.file(`${safeName}${tabSuffix}.png`),
        filters: { 'PNG image': ['png'] },
    });
    if (!target) {
        return;
    }
    const base64 = dataUri.replace(/^data:image\/png;base64,/, '');
    await vscode.workspace.fs.writeFile(target, Buffer.from(base64, 'base64'));
    vscode.window.showInformationMessage(`Diagram exported to ${target.fsPath}`);
}

async function runLlmNarrativeInBackground(
    panel: vscode.WebviewPanel,
    project: MuleProject,
    force = false
): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('anypointMonitor.diagram');
    if (!force && !cfg.get<boolean>('aiSummary.enabled', false)) {
        return;
    }
    const modelFamily = cfg.get<string>('aiSummary.modelFamily') || undefined;

    panel.webview.postMessage({ command: 'narrativeStatus', status: 'loading' });

    const result = await buildLlmNarrative(project, { modelFamily });
    panel.webview.postMessage({
        command: 'updateNarrative',
        narrative: result.text,
        source: result.source,
        modelName: result.modelName || '',
    });
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

interface RenderArgs {
    webview: vscode.Webview;
    nonce: string;
    appLabel: string;
    project: MuleProject;
    g6Uri: string;
    narrative: NarrativeResult;
}

function renderHtml(args: RenderArgs): string {
    const { webview, nonce, appLabel, project, g6Uri, narrative } = args;
    const cspSource = webview.cspSource;

    const csp = [
        "default-src 'none'",
        `style-src ${cspSource} 'unsafe-inline'`,
        `img-src ${cspSource} https: data:`,
        `font-src ${cspSource} https: data:`,
        `script-src 'nonce-${nonce}' ${cspSource}`,
    ].join('; ');

    const archElements = JSON.stringify(buildArchitectureElements(project));
    const flowElements = JSON.stringify(buildFlowGraphElements(project));
    const headerBadges = buildHeaderBadges(project);

    const body = `
        <div class="dg-page">
            <header class="dg-header">
                <div class="dg-header-row">
                    <div>
                        <h1 class="dg-title">${escapeHtml(appLabel)}</h1>
                        <div class="dg-meta">${headerBadges}</div>
                    </div>
                </div>
                <nav class="dg-tabs">
                    <button class="dg-tab dg-tab-active" data-tab="summary">Summary</button>
                    <button class="dg-tab" data-tab="arch">Architecture</button>
                    <button class="dg-tab" data-tab="flow">Flow Diagram</button>
                    <button class="dg-tab" data-tab="files">Files</button>
                </nav>
            </header>

            <section id="tab-summary" class="dg-panel dg-panel-active">
                ${renderSummaryTab(project, narrative)}
            </section>

            <section id="tab-arch" class="dg-panel">
                ${renderGraphTab('arch')}
            </section>

            <section id="tab-flow" class="dg-panel">
                ${renderGraphTab('flow')}
            </section>

            <section id="tab-files" class="dg-panel">
                ${renderFilesTab(project)}
            </section>
        </div>

        <script nonce="${nonce}" src="${g6Uri}"></script>
    `;

    return wrapWebviewHtml({
        title: `${appLabel} — Application Diagram`,
        nonce,
        headExtra: `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        body,
        extraStyles: getStyles(),
        scripts: getScripts({ archElements, flowElements }),
    });
}

function buildHeaderBadges(project: MuleProject): string {
    const a = project.artifact;
    const parts: string[] = [];
    if (a.version) parts.push(badge(`v${a.version}`, 'default', true));
    if (a.muleVersion) parts.push(badge(`Mule ${a.muleVersion}`, 'default', true));
    parts.push(badge(`${project.summary.composition.flows} flows`, 'default', true));
    if (project.summary.composition.subFlows > 0) {
        parts.push(badge(`${project.summary.composition.subFlows} sub-flows`, 'default', true));
    }
    if (project.summary.externalSystems.length > 0) {
        parts.push(badge(`${project.summary.externalSystems.length} external systems`, 'default', true));
    }
    return parts.join('');
}

// ---------------------------------------------------------------------------
// Tab: Summary
// ---------------------------------------------------------------------------

function renderSummaryTab(project: MuleProject, narrative: NarrativeResult): string {
    const s = project.summary;

    const entryRows = s.entryPoints.length === 0
        ? `<tr><td colspan="3" class="dg-empty">No entry points detected.</td></tr>`
        : s.entryPoints.slice(0, 30).map(ep => `
            <tr>
                <td><span class="dg-pill">${escapeHtml(humanizeEntryKind(ep.kind))}</span></td>
                <td><code class="dg-code">${escapeHtml(ep.label)}</code></td>
                <td>${ep.targetFlow
                    ? `<a href="#" class="dg-link" data-flow-name="${escapeAttr(ep.targetFlow)}">${escapeHtml(ep.targetFlow)}</a>`
                    : '<span class="dg-muted">—</span>'}</td>
            </tr>`).join('');

    const systemsRows = s.externalSystems.length === 0
        ? `<tr><td colspan="3" class="dg-empty">No external systems detected.</td></tr>`
        : s.externalSystems.map(sys => `
            <tr>
                <td>${escapeHtml(sys.label)}</td>
                <td class="dg-num">${sys.usageCount}</td>
                <td>${sys.configs.length === 0
                    ? '<span class="dg-muted">—</span>'
                    : sys.configs.map(c => `<code class="dg-code">${escapeHtml(c)}</code>`).join(' ')}</td>
            </tr>`).join('');

    const stats = [
        { label: 'Flows', value: s.composition.flows },
        { label: 'Sub-flows', value: s.composition.subFlows },
        { label: 'Components', value: s.composition.components },
        { label: 'Error handlers', value: s.composition.errorHandlers },
        { label: 'DataWeave', value: s.composition.dataweaveFiles },
        { label: 'Property keys', value: s.propertyFiles.keys },
    ];

    const narrativeSourceLabel = narrative.source === 'llm'
        ? `AI summary${narrative.modelName ? ` · ${escapeHtml(narrative.modelName)}` : ''}`
        : 'Heuristic summary';

    return `
        <div class="dg-grid">
            <article class="dg-card dg-card-narrative">
                <header class="dg-card-head">
                    <h2 class="dg-card-title">What this project does</h2>
                    <span class="dg-card-meta" id="dg-narrative-source">${escapeHtml(narrativeSourceLabel)}</span>
                </header>
                <p class="dg-narrative-text" id="dg-narrative-text">${escapeHtml(narrative.text)}</p>
                <div class="dg-card-actions">
                    <button class="dg-btn" id="dg-regenerate-llm">Regenerate with AI</button>
                </div>
            </article>

            <article class="dg-card">
                <header class="dg-card-head"><h2 class="dg-card-title">Composition</h2></header>
                <div class="dg-stats">
                    ${stats.map(s => `
                        <div class="dg-stat">
                            <div class="dg-stat-value">${s.value}</div>
                            <div class="dg-stat-label">${escapeHtml(s.label)}</div>
                        </div>`).join('')}
                </div>
            </article>

            <article class="dg-card dg-card-wide">
                <header class="dg-card-head"><h2 class="dg-card-title">Entry points</h2></header>
                <table class="dg-table">
                    <thead><tr><th>Kind</th><th>Trigger</th><th>Target flow</th></tr></thead>
                    <tbody>${entryRows}</tbody>
                </table>
            </article>

            <article class="dg-card dg-card-wide">
                <header class="dg-card-head"><h2 class="dg-card-title">External systems</h2></header>
                <table class="dg-table">
                    <thead><tr><th>System</th><th>Usages</th><th>Configs</th></tr></thead>
                    <tbody>${systemsRows}</tbody>
                </table>
            </article>
        </div>
    `;
}

function humanizeEntryKind(kind: string): string {
    switch (kind) {
        case 'http': return 'HTTP';
        case 'apikit': return 'APIkit';
        case 'scheduler': return 'Scheduler';
        case 'mq-listener': return 'Anypoint MQ';
        case 'jms-listener': return 'JMS';
        case 'kafka-listener': return 'Kafka';
        case 'vm-listener': return 'VM';
        case 'sftp-listener': return 'SFTP';
        case 'file-listener': return 'File';
        default: return 'Other';
    }
}

// ---------------------------------------------------------------------------
// Tab: Architecture / Flow (shared graph chrome)
// ---------------------------------------------------------------------------

function renderGraphTab(tabId: 'arch' | 'flow'): string {
    const subtitle = tabId === 'arch'
        ? 'How entry points, flows, and external systems are connected'
        : 'Hierarchical layout of all flow-to-flow references';
    return `
        <div class="dg-graph-toolbar">
            <div class="dg-graph-info">
                <p class="dg-graph-subtitle">${subtitle}</p>
            </div>
            <input type="search" class="dg-search" id="dg-${tabId}-search" placeholder="Search nodes…" />
            <div class="dg-toolbar-group">
                <button class="dg-iconbtn" id="dg-${tabId}-fit"   title="Fit to view">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
                </button>
                <button class="dg-iconbtn" id="dg-${tabId}-zoom-in" title="Zoom in">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4M7 5v4"/></svg>
                </button>
                <button class="dg-iconbtn" id="dg-${tabId}-zoom-out" title="Zoom out">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4"/></svg>
                </button>
                <button class="dg-iconbtn" id="dg-${tabId}-reset" title="Reset">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 1 1 1.5 3.5M3 8H1M3 8v-2"/></svg>
                </button>
                <span class="dg-toolbar-sep"></span>
                <button class="dg-iconbtn" id="dg-${tabId}-export" title="Export PNG">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M5 7l3 3 3-3M2 12v2h12v-2"/></svg>
                </button>
            </div>
        </div>
        <div class="dg-graph-canvas" id="dg-${tabId}-canvas"></div>
        <p class="dg-help">Click any flow node to open its source XML.</p>
    `;
}

// ---------------------------------------------------------------------------
// Tab: Files
// ---------------------------------------------------------------------------

function renderFilesTab(project: MuleProject): string {
    const grouped = new Map<string, Array<{ name: string; type: string }>>();
    for (const flow of project.flows.concat(project.subFlows)) {
        const key = flow.filePath || 'unknown';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push({ name: flow.name, type: flow.type });
    }

    if (grouped.size === 0) {
        return `<p class="dg-empty">No flow files detected.</p>`;
    }

    const cards = Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, flows]) => {
            const basename = path.basename(filePath);
            const flowItems = flows
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(f => `
                    <li class="dg-flow-item">
                        <span class="dg-flow-kind">${f.type === 'sub-flow' ? 'sub' : 'flow'}</span>
                        <span class="dg-flow-name">${escapeHtml(f.name)}</span>
                    </li>`).join('');
            return `
                <article class="dg-card">
                    <header class="dg-card-head">
                        <div>
                            <code class="dg-code dg-file-name">${escapeHtml(basename)}</code>
                            <div class="dg-muted dg-file-path">${escapeHtml(filePath)}</div>
                        </div>
                        <button class="dg-btn dg-btn-ghost dg-open-file" data-file-path="${escapeAttr(filePath)}">Open</button>
                    </header>
                    <ul class="dg-flow-list">${flowItems}</ul>
                </article>`;
        }).join('');

    return `<div class="dg-files-list">${cards}</div>`;
}

// ---------------------------------------------------------------------------
// G6 graph data
// ---------------------------------------------------------------------------

/**
 * G6 v5 data spec: { nodes: NodeSpec[], edges: EdgeSpec[] }.
 * Each node carries a `kind` in `data` so the runtime can pick a renderer
 * (entry-http, entry-scheduler, entry-listener, system, flow, sub-flow).
 * Each edge carries a `kind` so we can style inbound vs. flow-ref vs. connector
 * differently (animated dashes, color, stroke weight).
 */
type NodeKind =
    | 'flow' | 'sub-flow'
    | 'entry-http' | 'entry-apikit' | 'entry-scheduler' | 'entry-listener'
    | 'system';

type EdgeKind = 'inbound' | 'flow-ref' | 'connector';

interface G6Node {
    id: string;
    data: {
        label: string;
        sublabel?: string;
        fullLabel: string;
        kind: NodeKind;
        filePath?: string;
        method?: string;
    };
}

interface G6Edge {
    id: string;
    source: string;
    target: string;
    data: { kind: EdgeKind };
}

interface G6GraphData { nodes: G6Node[]; edges: G6Edge[]; }

function buildArchitectureElements(project: MuleProject): G6GraphData {
    const nodes: G6Node[] = [];
    const edges: G6Edge[] = [];
    const flowIds = new Set<string>();
    const flowIdByName = new Map<string, string>();

    for (const f of project.flows.concat(project.subFlows)) {
        flowIds.add(f.id);
        if (!flowIdByName.has(f.name)) flowIdByName.set(f.name, f.id);
        nodes.push({
            id: f.id,
            data: {
                label: shortLabel(f.name, 30),
                fullLabel: f.name,
                kind: f.type === 'sub-flow' ? 'sub-flow' : 'flow',
                filePath: f.filePath,
            },
        });
    }

    let epIdx = 0;
    const addEntry = (kind: NodeKind, label: string, sublabel: string | undefined, targetFlowName: string, method?: string) => {
        const id = `__ep_${epIdx++}`;
        nodes.push({
            id,
            data: { label, sublabel, fullLabel: `${label}${sublabel ? ' ' + sublabel : ''}`, kind, method },
        });
        const targetId = flowIdByName.get(targetFlowName);
        if (targetId) {
            edges.push({ id: `${id}__e`, source: id, target: targetId, data: { kind: 'inbound' } });
        }
    };

    for (const route of project.apiKitRoutes) {
        if (!route.flowName || !route.method) continue;
        addEntry('entry-apikit', route.method.toUpperCase(), route.resource, route.flowName, route.method.toUpperCase());
    }

    for (const listener of project.listeners) {
        if (project.apiKitRoutes.some(r => r.flowName === listener.flowName)) continue;
        addEntry('entry-http', (listener.method || 'GET').toUpperCase(), listener.path, listener.flowName, (listener.method || 'GET').toUpperCase());
    }

    for (const sched of project.schedulers) {
        let sublabel: string;
        if (sched.kind === 'cron' && sched.expression) sublabel = sched.expression;
        else if (sched.kind === 'fixed-frequency' && sched.frequency) {
            sublabel = `every ${sched.frequency} ${(sched.timeUnit || 'ms').toLowerCase()}`;
        } else { sublabel = sched.kind; }
        addEntry('entry-scheduler', 'Scheduler', sublabel, sched.flowName);
    }

    for (const op of project.connectorOperations) {
        if (op.direction !== 'in') continue;
        addEntry('entry-listener', humanizeKindShort(op.kind), op.detail || op.operation, op.flowName);
    }

    const sysIdByKind = new Map<ConnectorKind, string>();
    for (const sys of project.summary.externalSystems) {
        const id = `__sys_${sys.kind}`;
        sysIdByKind.set(sys.kind, id);
        nodes.push({
            id,
            data: { label: sys.label, fullLabel: sys.label, kind: 'system' },
        });
    }

    const seenEdges = new Set<string>();
    for (const op of project.connectorOperations) {
        if (op.direction === 'in') continue;
        const sysId = sysIdByKind.get(op.kind);
        if (!sysId) continue;
        const sourceId = flowIdByName.get(op.flowName);
        if (!sourceId) continue;
        const edgeId = `${sourceId}__${sysId}`;
        if (seenEdges.has(edgeId)) continue;
        seenEdges.add(edgeId);
        edges.push({ id: edgeId, source: sourceId, target: sysId, data: { kind: 'connector' } });
    }

    for (const edge of project.edges) {
        if (!flowIds.has(edge.from) || !flowIds.has(edge.to)) continue;
        edges.push({
            id: `${edge.from}__${edge.to}`,
            source: edge.from,
            target: edge.to,
            data: { kind: 'flow-ref' },
        });
    }

    return { nodes, edges };
}

function buildFlowGraphElements(project: MuleProject): G6GraphData {
    const nodes: G6Node[] = [];
    const edges: G6Edge[] = [];
    const flowIds = new Set<string>();
    for (const f of project.flows.concat(project.subFlows)) {
        flowIds.add(f.id);
        nodes.push({
            id: f.id,
            data: {
                label: shortLabel(f.name, 34),
                fullLabel: f.name,
                kind: f.type === 'sub-flow' ? 'sub-flow' : 'flow',
                filePath: f.filePath,
            },
        });
    }
    for (const edge of project.edges) {
        if (!flowIds.has(edge.from) || !flowIds.has(edge.to)) continue;
        edges.push({
            id: `${edge.from}__${edge.to}`,
            source: edge.from,
            target: edge.to,
            data: { kind: 'flow-ref' },
        });
    }
    return { nodes, edges };
}

function shortLabel(name: string, max: number): string {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function humanizeKindShort(kind: ConnectorKind): string {
    switch (kind) {
        case 'anypoint-mq': return 'AMQ';
        case 'database': return 'DB';
        case 'salesforce': return 'SFDC';
        case 'object-store': return 'OS';
        default: return kind.toUpperCase();
    }
}

// ---------------------------------------------------------------------------
// Styles  — Command Center vocabulary, no brand colors
// ---------------------------------------------------------------------------

function getStyles(): string {
    return `
        body { padding: 0; }
        .dg-page { padding: 24px 28px 48px; max-width: none; }

        /* ── Header ─────────────────────────────────────────────────── */
        .dg-header { margin-bottom: 24px; }
        .dg-header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 16px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--am-border);
        }
        .dg-title {
            font-size: 22px;
            font-weight: 500;
            letter-spacing: -0.2px;
            color: var(--am-text-primary);
            margin-bottom: 8px;
        }
        .dg-meta {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        /* ── Tabs (matches cc-tabs) ─────────────────────────────────── */
        .dg-tabs {
            display: flex;
            gap: 2px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 3px;
        }
        .dg-tab {
            background: transparent;
            border: none;
            color: var(--am-text-muted);
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            padding: 9px 20px;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s ease;
        }
        .dg-tab:hover { color: var(--am-text-primary); background: var(--am-bg-surface-hover); }
        .dg-tab-active { color: var(--am-text-primary); background: var(--am-bg-secondary); }

        .dg-panel { display: none; animation: am-fadeIn 0.2s ease-out; }
        .dg-panel-active { display: block; }

        /* ── Cards ──────────────────────────────────────────────────── */
        .dg-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
        }
        .dg-card {
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 18px 20px;
        }
        .dg-card-wide, .dg-card-narrative { grid-column: 1 / -1; }
        .dg-card-head {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            margin-bottom: 14px;
        }
        .dg-card-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--am-text-muted);
            margin: 0;
        }
        .dg-card-meta {
            font-size: 10px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.6px;
        }
        .dg-card-actions { margin-top: 12px; }
        .dg-narrative-text {
            font-size: 14px;
            line-height: 1.6;
            color: var(--am-text-primary);
            margin: 0;
            white-space: pre-wrap;
        }

        /* ── Stats strip ────────────────────────────────────────────── */
        .dg-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        .dg-stat { padding: 4px 0; }
        .dg-stat-value {
            font-size: 22px;
            font-weight: 300;
            color: var(--am-text-primary);
            line-height: 1.1;
            margin-bottom: 4px;
        }
        .dg-stat-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--am-text-muted);
        }

        /* ── Tables ─────────────────────────────────────────────────── */
        .dg-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .dg-table th, .dg-table td {
            text-align: left;
            padding: 10px 12px;
            border-bottom: 1px solid var(--am-border);
        }
        .dg-table th {
            color: var(--am-text-muted);
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            border-bottom-color: var(--am-border);
        }
        .dg-table tbody tr { transition: background 0.15s ease; }
        .dg-table tbody tr:hover { background: var(--am-bg-surface-hover); }
        .dg-table .dg-num { font-variant-numeric: tabular-nums; color: var(--am-text-secondary); }
        .dg-empty { color: var(--am-text-muted); font-style: italic; padding: 14px; text-align: center; }
        .dg-muted { color: var(--am-text-muted); }

        .dg-pill {
            display: inline-block;
            padding: 2px 9px;
            border-radius: var(--am-radius-pill);
            border: 1px solid var(--am-border);
            background: var(--am-bg-surface);
            color: var(--am-text-secondary);
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .dg-code {
            font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, monospace);
            font-size: 12px;
            color: var(--am-text-primary);
        }
        .dg-link {
            color: var(--am-text-link);
            text-decoration: none;
            border-bottom: 1px dashed transparent;
        }
        .dg-link:hover {
            color: var(--am-text-link-active);
            border-bottom-color: currentColor;
        }

        /* ── Buttons ────────────────────────────────────────────────── */
        .dg-btn {
            background: transparent;
            border: 1px solid var(--am-border);
            color: var(--am-text-secondary);
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 6px 14px;
            border-radius: var(--am-radius-sm);
            cursor: pointer;
            transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .dg-btn:hover {
            border-color: var(--am-info);
            color: var(--am-text-primary);
        }
        .dg-btn-ghost { border-color: transparent; }
        .dg-btn-ghost:hover { border-color: var(--am-border); }
        .dg-iconbtn {
            background: none;
            border: 1px solid transparent;
            color: var(--am-text-muted);
            width: 30px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: var(--am-radius-sm);
            position: relative;
            transition: all 0.15s;
        }
        .dg-iconbtn:hover {
            color: var(--am-text-primary);
            border-color: var(--am-border);
            background: var(--am-bg-surface);
        }
        .dg-iconbtn svg { width: 15px; height: 15px; }
        .dg-iconbtn[title]:hover::after {
            content: attr(title);
            position: absolute;
            top: calc(100% + 4px);
            left: 50%;
            transform: translateX(-50%);
            padding: 3px 8px;
            font-size: 10px;
            white-space: nowrap;
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
            color: var(--am-text-primary);
            z-index: 10;
        }
        .dg-toolbar-sep { width: 1px; background: var(--am-border); height: 18px; margin: 0 4px; }
        .dg-toolbar-group { display: inline-flex; gap: 4px; align-items: center; }

        /* ── Graph toolbar + canvas ─────────────────────────────────── */
        .dg-graph-toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 0;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--am-border);
        }
        .dg-graph-info { flex: 1; min-width: 0; }
        .dg-graph-subtitle {
            font-size: 11px;
            color: var(--am-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin: 0;
        }
        .dg-search {
            background: var(--am-bg-input);
            border: 1px solid var(--am-border-input);
            color: var(--am-text-primary);
            font-family: inherit;
            font-size: 12px;
            padding: 6px 10px;
            min-width: 180px;
            max-width: 280px;
            border-radius: var(--am-radius-sm);
        }
        .dg-search:focus {
            outline: none;
            border-color: var(--am-border-focus);
        }
        .dg-graph-canvas {
            position: relative;
            width: 100%;
            height: calc(100vh - 240px);
            min-height: 480px;
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            overflow: hidden;
        }
        /* G6 injects its <canvas> into this container; make sure it fills. */
        .dg-graph-canvas canvas { display: block; }
        .dg-help {
            font-size: 11px;
            color: var(--am-text-muted);
            margin-top: 8px;
            text-align: right;
        }

        /* ── Files ──────────────────────────────────────────────────── */
        .dg-files-list { display: flex; flex-direction: column; gap: 12px; }
        .dg-file-name { font-weight: 600; }
        .dg-file-path { font-size: 11px; color: var(--am-text-muted); margin-top: 2px; }
        .dg-flow-list { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 28px; }
        .dg-flow-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 13px;
            break-inside: avoid;
        }
        .dg-flow-kind {
            display: inline-block;
            min-width: 32px;
            text-align: center;
            padding: 1px 6px;
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-radius: 3px;
            border: 1px solid var(--am-border);
            color: var(--am-text-muted);
            background: var(--am-bg-surface);
        }
        .dg-flow-name { color: var(--am-text-primary); }
    `;
}

// ---------------------------------------------------------------------------
// Inline scripts — also use --am-* tokens for cytoscape colors
// ---------------------------------------------------------------------------

function getScripts(args: { archElements: string; flowElements: string }): string {
    // The script below uses G6's built-in 'rect' node + iconText + halo + state
    // overrides (no custom BaseNode subclass). Earlier we tried to extend
    // BaseNode but the v5 lifecycle (drawKeyShape vs render) is opinionated and
    // calling super.render incorrectly produced an empty canvas. The built-in
    // rect renderer already supports everything we need: stroke/fill, multi-line
    // labels via labelText with \\n, an icon glyph rendered inside the shape,
    // halo on hover, and per-state styling.
    return `
        const ARCH_DATA = ${args.archElements};
        const FLOW_DATA = ${args.flowElements};
        const vscode = acquireVsCodeApi();

        // Surface any uncaught error in the webview to the host so we never get
        // a silently empty canvas again.
        window.addEventListener('error', (e) => {
            vscode.postMessage({ command: 'webviewError', message: String(e.error?.stack || e.message || e) });
        });
        window.addEventListener('unhandledrejection', (e) => {
            vscode.postMessage({ command: 'webviewError', message: String(e.reason?.stack || e.reason || e) });
        });

        // --- Tab switching --------------------------------------------------
        function switchTab(id) {
            document.querySelectorAll('.dg-tab').forEach(t => t.classList.toggle('dg-tab-active', t.getAttribute('data-tab') === id));
            document.querySelectorAll('.dg-panel').forEach(p => p.classList.toggle('dg-panel-active', p.id === 'tab-' + id));
            if (id === 'arch') ensureGraph('arch');
            if (id === 'flow') ensureGraph('flow');
        }
        document.querySelectorAll('.dg-tab').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
        });

        // --- Theme tokens (live from VS Code) -------------------------------
        function token(name, fallback) {
            const v = getComputedStyle(document.documentElement).getPropertyValue(name);
            return (v && v.trim()) || fallback;
        }
        const C = {
            bg:        token('--am-bg-surface',     '#1e1e1e'),
            bgSec:     token('--am-bg-secondary',   '#252526'),
            border:    token('--am-border',         '#3e3e42'),
            text:      token('--am-text-primary',   '#cccccc'),
            textMuted: token('--am-text-muted',     '#888'),
            success:   token('--am-success',        '#3fb950'),
            warning:   token('--am-warning',        '#d29922'),
            info:      token('--am-info',           '#58a6ff'),
        };

        // Per-kind chrome: stroke (border) + accent (icon color) + glyph text.
        // We keep the fill consistent so every node reads as the same surface;
        // only the left-side icon and stroke vary.
        const KIND = {
            'flow':            { stroke: C.border,  accent: C.info,    icon: '\u25B6', dashed: false },
            'sub-flow':        { stroke: C.border,  accent: C.textMuted, icon: '\u25C7', dashed: true  },
            'entry-http':      { stroke: C.info,    accent: C.info,    icon: 'H',    dashed: false },
            'entry-apikit':    { stroke: C.info,    accent: C.info,    icon: 'A',    dashed: false },
            'entry-scheduler': { stroke: C.warning, accent: C.warning, icon: '\u23F1', dashed: false },
            'entry-listener':  { stroke: C.info,    accent: C.info,    icon: '\u2709', dashed: false },
            'system':          { stroke: C.success, accent: C.success, icon: '\u2A01', dashed: false },
        };

        function truncate(s, n) { return (s && s.length > n) ? s.slice(0, n - 1) + '\u2026' : (s || ''); }

        // Build a styleFn for the built-in 'rect' node. G6 v5 supports per-node
        // dynamic styles by passing a function; we read the kind off datum.data
        // and return everything (fill, stroke, label, icon, halo) as flat
        // top-level props.
        function nodeStyleFn(datum) {
            const data = (datum && datum.data) || {};
            const k = KIND[data.kind] || KIND.flow;
            const labelLine = truncate(data.label || '', 28);
            const subLine   = data.sublabel ? truncate(data.sublabel, 32) : '';
            // Width estimated from the longest line so labels don't get clipped.
            const longest = Math.max(labelLine.length, subLine.length);
            const width = Math.max(160, Math.min(56 + longest * 6.5, 250));
            const height = subLine ? 50 : 38;
            const labelText = subLine ? labelLine + '\\n' + subLine : labelLine;

            return {
                size: [width, height],
                radius: 8,
                fill: C.bgSec,
                stroke: k.stroke,
                lineWidth: 1,
                lineDash: k.dashed ? [4, 3] : undefined,
                shadowColor: 'rgba(0,0,0,0.4)',
                shadowBlur: 8,
                shadowOffsetY: 2,
                cursor: 'pointer',
                // Multi-line label centered inside the rect
                label: true,
                labelText,
                labelPlacement: 'center',
                labelFill: C.text,
                labelFontSize: 11,
                labelFontWeight: 500,
                labelTextAlign: 'center',
                labelTextBaseline: 'middle',
                labelWordWrap: false,
                // Single icon on the left edge, kind-colored
                icon: true,
                iconText: k.icon,
                iconFill: k.accent,
                iconFontSize: k.icon.length > 1 ? 10 : 13,
                iconFontWeight: 600,
                iconOffsetX: -width / 2 + 14,
                iconOffsetY: 0,
                // Halo (hidden by default, surfaces in hover state)
                halo: false,
                haloStroke: k.accent,
                haloLineWidth: 8,
            };
        }

        function edgeStyleFn(datum) {
            const kind = (datum && datum.data && datum.data.kind) || 'flow-ref';
            if (kind === 'inbound') {
                return {
                    stroke: C.info, lineWidth: 1.5, opacity: 0.85,
                    endArrow: true, endArrowType: 'triangle', endArrowSize: 7,
                    lineDash: [6, 4],
                };
            }
            if (kind === 'connector') {
                return {
                    stroke: C.success, lineWidth: 1.2, opacity: 0.7,
                    endArrow: true, endArrowType: 'triangle', endArrowSize: 7,
                    lineDash: [4, 3],
                };
            }
            return {
                stroke: C.textMuted, lineWidth: 1, opacity: 0.55,
                endArrow: true, endArrowType: 'triangle', endArrowSize: 6,
            };
        }

        // --- Layout per tab -------------------------------------------------
        function layoutFor(tabId) {
            return {
                type: 'antv-dagre',
                rankdir: tabId === 'flow' ? 'TB' : 'LR',
                nodesep: 30,
                ranksep: tabId === 'flow' ? 60 : 90,
            };
        }

        // --- Graph factory --------------------------------------------------
        const graphs = {};

        function ensureGraph(tabId) {
            if (graphs[tabId]) {
                try { graphs[tabId].resize(); graphs[tabId].fitView(); } catch {}
                return;
            }
            const data = tabId === 'arch' ? ARCH_DATA : FLOW_DATA;
            const container = document.getElementById('dg-' + tabId + '-canvas');
            if (!container || !window.G6) {
                console.warn('G6 not loaded or container missing', tabId);
                return;
            }

            try {
                const graph = new G6.Graph({
                    container,
                    data,
                    node: {
                        type: 'rect',
                        style: nodeStyleFn,
                        state: {
                            hover:     { halo: true, lineWidth: 2 },
                            selected:  { lineWidth: 2, halo: true },
                            highlight: { lineWidth: 2, halo: true },
                            dim:       { opacity: 0.25 },
                        },
                    },
                    edge: {
                        type: 'cubic-horizontal',
                        style: edgeStyleFn,
                        state: {
                            hover:     { lineWidth: 2.2, opacity: 1 },
                            highlight: { lineWidth: 2.2, opacity: 1 },
                            dim:       { opacity: 0.1 },
                        },
                    },
                    layout: layoutFor(tabId),
                    behaviors: [
                        'drag-canvas',
                        'zoom-canvas',
                        { type: 'hover-activate', degree: 1, state: 'hover' },
                        { type: 'click-select', multiple: false, state: 'selected' },
                    ],
                    plugins: [
                        { type: 'minimap', size: [180, 100], position: 'right-bottom' },
                    ],
                    autoFit: 'view',
                    padding: 24,
                    background: C.bg,
                    animation: { duration: 280 },
                });

                graph.on('node:click', (evt) => {
                    const id = evt.target && evt.target.id;
                    if (!id) return;
                    let datum;
                    try { datum = graph.getNodeData(id); } catch {}
                    const filePath = datum && datum.data && datum.data.filePath;
                    if (filePath) vscode.postMessage({ command: 'openFlowFile', filePath });
                });

                graphs[tabId] = graph;
                graph.render().then(() => {
                    try { graph.fitView(); } catch {}
                }).catch(err => {
                    vscode.postMessage({ command: 'webviewError', message: 'Graph render failed: ' + (err?.stack || err) });
                });
            } catch (err) {
                vscode.postMessage({ command: 'webviewError', message: 'Graph create failed: ' + (err?.stack || err) });
            }
        }

        // --- Toolbar wiring -------------------------------------------------
        function wireToolbar(tabId) {
            const get = id => document.getElementById('dg-' + tabId + '-' + id);
            get('fit')?.addEventListener('click', () => { try { graphs[tabId]?.fitView(); } catch {} });
            get('zoom-in')?.addEventListener('click', () => { try { graphs[tabId]?.zoomBy(1.2); } catch {} });
            get('zoom-out')?.addEventListener('click', () => { try { graphs[tabId]?.zoomBy(0.8); } catch {} });
            get('reset')?.addEventListener('click', () => {
                const g = graphs[tabId]; if (!g) return;
                clearStates(g);
                try { g.layout(); g.fitView(); } catch {}
                const search = get('search'); if (search) search.value = '';
            });
            get('search')?.addEventListener('input', evt => {
                const g = graphs[tabId]; if (!g) return;
                const term = (evt.target.value || '').toLowerCase().trim();
                clearStates(g);
                if (!term) return;
                const allNodes = g.getNodeData() || [];
                const matches = allNodes.filter(n => {
                    const d = n.data || {};
                    const haystack = [d.label, d.fullLabel, d.sublabel].filter(Boolean).join(' ').toLowerCase();
                    return haystack.includes(term);
                });
                if (matches.length === 0) return;
                const matchIds = new Set(matches.map(n => n.id));
                const neighborIds = new Set(matchIds);
                (g.getEdgeData() || []).forEach(e => {
                    if (matchIds.has(e.source)) neighborIds.add(e.target);
                    if (matchIds.has(e.target)) neighborIds.add(e.source);
                });
                allNodes.forEach(n => {
                    if (matchIds.has(n.id)) g.setElementState(n.id, ['highlight']);
                    else if (!neighborIds.has(n.id)) g.setElementState(n.id, ['dim']);
                });
                (g.getEdgeData() || []).forEach(e => {
                    if (matchIds.has(e.source) || matchIds.has(e.target)) g.setElementState(e.id, ['highlight']);
                    else g.setElementState(e.id, ['dim']);
                });
                try { g.focusElement(Array.from(neighborIds), { duration: 280 }); } catch {}
            });
            get('export')?.addEventListener('click', async () => {
                const g = graphs[tabId]; if (!g) return;
                try {
                    const dataUri = await g.toDataURL({ mode: 'overall', type: 'image/png', encoderOptions: 1 });
                    vscode.postMessage({ command: 'exportPng', dataUri, tab: tabId });
                } catch (err) {
                    console.error('Export failed', err);
                }
            });
        }

        function clearStates(g) {
            (g.getNodeData() || []).forEach(n => g.setElementState(n.id, []));
            (g.getEdgeData() || []).forEach(e => g.setElementState(e.id, []));
        }

        wireToolbar('arch');
        wireToolbar('flow');

        // --- Files tab "Open" buttons --------------------------------------
        document.querySelectorAll('.dg-open-file').forEach(btn => {
            btn.addEventListener('click', () => {
                const filePath = btn.getAttribute('data-file-path');
                if (filePath) vscode.postMessage({ command: 'openFlowFile', filePath });
            });
        });

        // --- Summary "Open in Architecture" links --------------------------
        document.querySelectorAll('.dg-link[data-flow-name]').forEach(a => {
            a.addEventListener('click', evt => {
                evt.preventDefault();
                const flowName = a.getAttribute('data-flow-name');
                if (!flowName) return;
                switchTab('arch');
                requestAnimationFrame(() => {
                    const g = graphs['arch']; if (!g) return;
                    clearStates(g);
                    const matches = (g.getNodeData() || []).filter(n => {
                        const d = n.data || {};
                        return d.fullLabel === flowName || d.label === flowName;
                    });
                    if (matches.length === 0) return;
                    matches.forEach(n => g.setElementState(n.id, ['highlight']));
                    try { g.focusElement(matches.map(n => n.id), { duration: 280 }); } catch {}
                });
            });
        });

        // --- LLM regenerate -------------------------------------------------
        document.getElementById('dg-regenerate-llm')?.addEventListener('click', () => {
            const src = document.getElementById('dg-narrative-source');
            if (src) src.textContent = 'Generating…';
            vscode.postMessage({ command: 'regenerateLlm' });
        });

        // --- Messages from extension ---------------------------------------
        window.addEventListener('message', evt => {
            const msg = evt.data || {};
            if (msg.command === 'updateNarrative') {
                const text = document.getElementById('dg-narrative-text');
                const src  = document.getElementById('dg-narrative-source');
                if (text) text.textContent = msg.narrative || '';
                if (src) {
                    src.textContent = msg.source === 'llm'
                        ? ('AI summary' + (msg.modelName ? ' \u00B7 ' + msg.modelName : ''))
                        : 'Heuristic summary';
                }
            } else if (msg.command === 'narrativeStatus' && msg.status === 'loading') {
                const src = document.getElementById('dg-narrative-source');
                if (src) src.textContent = 'Generating…';
            }
        });
    `;
}

function makeNonce(): string {
    return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}
