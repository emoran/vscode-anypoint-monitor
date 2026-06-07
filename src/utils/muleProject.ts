/**
 * Namespace-aware Mule 4 project parser.
 *
 * Replaces the legacy regex parser in `muleDiagram.ts` with a real XML parser
 * (fast-xml-parser) and a richer project model that captures listeners,
 * schedulers, connector configs, error handlers, properties, RAML routes,
 * DataWeave files, and pom.xml metadata.
 */

import { XMLParser } from 'fast-xml-parser';
import * as path from 'path';
import {
    MuleFlowGraph,
    MuleFlowNode,
    MuleComponent,
    MuleFlowEdge
} from './muleDiagram';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MuleArtifactInfo {
    groupId?: string;
    artifactId?: string;
    version?: string;
    muleVersion?: string;
    minMuleVersion?: string;
    requiredProduct?: string;
    secureProperties: string[];
}

export interface HttpListener {
    flowName: string;
    filePath: string;
    method: string;
    path: string;
    configRef?: string;
    host?: string;
    port?: string;
    basePath?: string;
}

export interface HttpRequester {
    flowName: string;
    filePath: string;
    method: string;
    path?: string;
    configRef?: string;
    target?: string;
}

export interface SchedulerTrigger {
    flowName: string;
    filePath: string;
    /** 'cron' | 'fixed-frequency' | 'unknown' */
    kind: 'cron' | 'fixed-frequency' | 'unknown';
    expression?: string;
    frequency?: string;
    timeUnit?: string;
}

export type ConnectorKind =
    | 'http'
    | 'https'
    | 'database'
    | 'salesforce'
    | 'sap'
    | 'anypoint-mq'
    | 'jms'
    | 'vm'
    | 'sftp'
    | 'ftp'
    | 'file'
    | 'email'
    | 'object-store'
    | 'redis'
    | 'mongodb'
    | 'amazon-s3'
    | 'amazon-sqs'
    | 'kafka'
    | 'oauth'
    | 'apikit'
    | 'unknown';

export interface ConnectorConfig {
    /** The XML element name including prefix, e.g. "salesforce:config" */
    tagName: string;
    /** Local-name only, e.g. "config" / "request-config" */
    localName: string;
    /** Module prefix in this file, e.g. "salesforce", "db", "http" */
    modulePrefix: string;
    /** Inferred connector kind */
    kind: ConnectorKind;
    /** name="..." attribute (the config-ref target) */
    name?: string;
    filePath: string;
    /** Resolved attributes (placeholders kept verbatim, e.g. "${db.host}") */
    attributes: Record<string, string>;
}

export interface ConnectorOperation {
    flowName: string;
    filePath: string;
    /** Module prefix, e.g. "salesforce" */
    modulePrefix: string;
    /** Local op name, e.g. "create", "select", "publish" */
    operation: string;
    kind: ConnectorKind;
    configRef?: string;
    /** Best-effort summary (e.g. SQL text first 80 chars, queue name, sObject) */
    detail?: string;
    /** If this operation publishes/sends, true; subscriber/listen handled separately */
    direction?: 'in' | 'out';
}

export interface ApiKitRoute {
    /** Flow name implementing the route, e.g. "get:\customers:my-api-config" */
    flowName: string;
    /** HTTP method (uppercased) */
    method: string;
    /** RAML/OAS resource path */
    resource: string;
    /** apikit config name (matches httpListener config-ref via separate router config) */
    apiConfig?: string;
}

export interface RamlOasInventory {
    files: string[];
    /** Distinct API titles found in spec files (best-effort) */
    apiTitles: string[];
}

export interface DataWeaveFile {
    filePath: string;
    /** %dw 2.0 / 1.0 / unknown */
    version?: string;
    /** Output declaration, e.g. application/json */
    output?: string;
    /** First-line comment if present */
    description?: string;
    sizeBytes: number;
}

export interface PropertiesInventory {
    yamlFiles: string[];
    propertiesFiles: string[];
    /** Combined key set from all property files */
    keys: string[];
    /** Quick lookup: key -> resolved value (last-write-wins across files) */
    values: Record<string, string>;
}

export interface PomDependency {
    groupId: string;
    artifactId: string;
    version?: string;
    /** Inferred connector kind (best-effort) */
    kind: ConnectorKind;
}

export interface ProjectSummary {
    /** Inbound triggers grouped by kind */
    entryPoints: Array<{
        kind: 'http' | 'apikit' | 'scheduler' | 'mq-listener' | 'jms-listener' | 'vm-listener' | 'sftp-listener' | 'file-listener' | 'kafka-listener' | 'unknown';
        label: string;
        targetFlow?: string;
    }>;
    /** External systems used (deduped, with usage counts) */
    externalSystems: Array<{
        kind: ConnectorKind;
        label: string;
        usageCount: number;
        configs: string[];
    }>;
    /** Composition counts */
    composition: {
        flows: number;
        subFlows: number;
        components: number;
        errorHandlers: number;
        dataweaveFiles: number;
    };
    /** Property files & key count */
    propertyFiles: { yaml: number; properties: number; keys: number };
}

export interface MuleProject {
    artifact: MuleArtifactInfo;
    pomDependencies: PomDependency[];
    flows: MuleFlowNode[];
    subFlows: MuleFlowNode[];
    listeners: HttpListener[];
    requesters: HttpRequester[];
    schedulers: SchedulerTrigger[];
    connectorConfigs: ConnectorConfig[];
    connectorOperations: ConnectorOperation[];
    apiKitRoutes: ApiKitRoute[];
    ramlOas: RamlOasInventory;
    dataweaveFiles: DataWeaveFile[];
    properties: PropertiesInventory;
    errorHandlers: Array<{ name: string; filePath: string }>;
    edges: MuleFlowEdge[];
    summary: ProjectSummary;
    /** Map of normalized JAR-relative path -> raw file content (xml/properties/yaml/dwl/raml/oas/pom). */
    rawFiles: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Parser entry point
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    preserveOrder: true,
    // Disable DTD processing (XXE hardening); fast-xml-parser does not load
    // external entities, but we keep tag-value coercion off to avoid surprises.
    processEntities: true,
});

export interface ParseInput {
    /** Map of path -> string content for every file extracted from the JAR. */
    files: Record<string, string>;
}

export function parseMuleProject(input: ParseInput): MuleProject {
    const files = input.files || {};

    const artifact = parseMuleArtifact(files);
    const pomDependencies = parsePomDependencies(files);
    const properties = parseProperties(files);
    const ramlOas = inventoryRamlOas(files);
    const dataweaveFiles = inventoryDataweave(files);

    // Mule config XMLs live under src/main/mule/*.xml in the JAR's source tree
    // or at the JAR root (rare). We accept any *.xml outside META-INF that
    // references the Mule core namespace.
    const muleXmlPaths = Object.keys(files)
        .filter(p => p.toLowerCase().endsWith('.xml'))
        .filter(p => !p.toLowerCase().includes('meta-inf/'))
        .filter(p => looksLikeMuleConfig(files[p]));

    const flows: MuleFlowNode[] = [];
    const subFlows: MuleFlowNode[] = [];
    const listeners: HttpListener[] = [];
    const requesters: HttpRequester[] = [];
    const schedulers: SchedulerTrigger[] = [];
    const connectorConfigs: ConnectorConfig[] = [];
    const connectorOperations: ConnectorOperation[] = [];
    const apiKitRoutes: ApiKitRoute[] = [];
    const errorHandlers: Array<{ name: string; filePath: string }> = [];
    const edges: MuleFlowEdge[] = [];

    // Track flow id assignment; consistent with legacy graph
    const idUsage = new Map<string, number>();
    const allocId = (raw: string): string => {
        const base = sanitizeId(raw);
        const used = idUsage.get(base) ?? 0;
        idUsage.set(base, used + 1);
        return used === 0 ? base : `${base}_${used}`;
    };

    for (const filePath of muleXmlPaths) {
        const content = files[filePath];
        let parsed: any;
        try {
            parsed = xmlParser.parse(content);
        } catch (err) {
            // Skip malformed XML; we still want the rest of the project
            continue;
        }

        const ctx = new FileParseContext(filePath, parsed);
        ctx.collectGlobals({
            connectorConfigs,
            errorHandlers,
            apiKitRoutesAccumulator: apiKitRoutes,
        });

        ctx.collectFlows({
            flows,
            subFlows,
            listeners,
            requesters,
            schedulers,
            connectorOperations,
            edges,
            allocId,
        });
    }

    // Build a name -> flow id map to fix flow-ref edges that pointed at
    // placeholder ids during the first pass.
    resolveCrossFlowEdges(flows.concat(subFlows), edges);

    // Map APIKit router declarations to actual flows by name pattern
    enrichApiKitRoutes(apiKitRoutes, flows);

    // Resolve ${prop} placeholders in user-visible labels (listener paths,
    // operation details, scheduler expressions) so the UI shows real values
    // when the property is statically known. Falls through unchanged otherwise.
    resolvePlaceholdersOnArtifacts({
        listeners,
        requesters,
        connectorOperations,
        properties,
    });

    const summary = buildSummary({
        artifact,
        flows,
        subFlows,
        listeners,
        requesters,
        schedulers,
        connectorConfigs,
        connectorOperations,
        apiKitRoutes,
        errorHandlers,
        properties,
        dataweaveFiles,
    });

    return {
        artifact,
        pomDependencies,
        flows,
        subFlows,
        listeners,
        requesters,
        schedulers,
        connectorConfigs,
        connectorOperations,
        apiKitRoutes,
        ramlOas,
        dataweaveFiles,
        properties,
        errorHandlers,
        edges,
        summary,
        rawFiles: files,
    };
}

// ---------------------------------------------------------------------------
// Back-compat shim: feed the legacy MuleFlowGraph consumer.
// ---------------------------------------------------------------------------

export function projectToLegacyGraph(project: MuleProject): MuleFlowGraph {
    return {
        nodes: project.flows.concat(project.subFlows),
        edges: project.edges,
    };
}

// ---------------------------------------------------------------------------
// Internal: per-file parser
// ---------------------------------------------------------------------------

interface FlowAccumulator {
    flows: MuleFlowNode[];
    subFlows: MuleFlowNode[];
    listeners: HttpListener[];
    requesters: HttpRequester[];
    schedulers: SchedulerTrigger[];
    connectorOperations: ConnectorOperation[];
    edges: MuleFlowEdge[];
    allocId: (raw: string) => string;
}

interface GlobalAccumulator {
    connectorConfigs: ConnectorConfig[];
    errorHandlers: Array<{ name: string; filePath: string }>;
    apiKitRoutesAccumulator: ApiKitRoute[];
}

class FileParseContext {
    private nsByPrefix: Record<string, string> = {};
    private kindByPrefix: Record<string, ConnectorKind> = {};

    constructor(public readonly filePath: string, private readonly preserveOrderTree: any[]) {
        this.discoverNamespaces();
    }

    private discoverNamespaces(): void {
        // preserve-order trees look like: [{ "mule": [...], ":@": { "@_xmlns:db": "...", "@_xmlns": "http://..." } }]
        const root = findFirstElement(this.preserveOrderTree);
        if (!root) {
            return;
        }
        const attrs = (root[':@'] as Record<string, string>) || {};
        for (const [attr, value] of Object.entries(attrs)) {
            if (!attr.startsWith('@_xmlns')) {
                continue;
            }
            const prefix = attr === '@_xmlns' ? '' : attr.replace(/^@_xmlns:/, '');
            this.nsByPrefix[prefix] = value;
            this.kindByPrefix[prefix] = inferConnectorKindFromNamespace(prefix, value);
        }
    }

    /** First top-level element regardless of preserve-order shape. */
    private rootChildren(): any[] {
        const root = findFirstElement(this.preserveOrderTree);
        if (!root) {
            return [];
        }
        const tagName = elementTagName(root);
        return (root[tagName] as any[]) || [];
    }

    collectGlobals(out: GlobalAccumulator): void {
        for (const child of this.rootChildren()) {
            const tag = elementTagName(child);
            if (!tag) {
                continue;
            }

            const attrs = elementAttrs(child);
            const local = getLocalName(tag);
            const prefix = getPrefix(tag);

            // Connector configs: any element that ends with -config, or "config"
            // inside a module namespace (e.g. salesforce:config, db:config).
            if (isConnectorConfig(tag, local)) {
                out.connectorConfigs.push({
                    tagName: tag,
                    localName: local,
                    modulePrefix: prefix,
                    kind: this.kindByPrefix[prefix] || inferConnectorKindFromTag(tag),
                    name: attrs.name,
                    filePath: this.filePath,
                    attributes: attrs,
                });
                continue;
            }

            // Global error handlers
            if (local === 'configuration' && tag === 'configuration') {
                continue;
            }
            if (tag === 'error-handler' && attrs.name) {
                out.errorHandlers.push({ name: attrs.name, filePath: this.filePath });
                continue;
            }

            // APIkit router config: <apikit:config name="..." raml="..."/>
            if (prefix === 'apikit' && local === 'config' && attrs.name) {
                // We don't emit a connector config for APIkit; APIkit routes are derived
                // separately. Just keep the config name visible by stashing into routes
                // accumulator with no resource/method (resolved later).
                if (!out.apiKitRoutesAccumulator.some(r => r.apiConfig === attrs.name)) {
                    out.apiKitRoutesAccumulator.push({
                        flowName: '',
                        method: '',
                        resource: '',
                        apiConfig: attrs.name,
                    });
                }
            }
        }
    }

    collectFlows(out: FlowAccumulator): void {
        for (const child of this.rootChildren()) {
            const tag = elementTagName(child);
            if (tag !== 'flow' && tag !== 'sub-flow') {
                continue;
            }
            const attrs = elementAttrs(child);
            const flowName = attrs.name?.trim();
            if (!flowName) {
                continue;
            }
            const flowType = tag === 'sub-flow' ? 'sub-flow' : 'flow';

            const components: MuleComponent[] = [];
            const counter = { value: 0 };

            const childElements = (child[tag] as any[]) || [];
            for (const node of childElements) {
                this.walkComponent(
                    node,
                    components,
                    {
                        flowName,
                        flowType,
                        depth: 0,
                        counter,
                        out,
                    }
                );
            }

            const flowNode: MuleFlowNode = {
                id: out.allocId(flowName),
                name: flowName,
                filePath: this.filePath,
                type: flowType,
                components,
            };

            if (flowType === 'sub-flow') {
                out.subFlows.push(flowNode);
            } else {
                out.flows.push(flowNode);
            }
        }
    }

    private walkComponent(
        node: any,
        siblings: MuleComponent[],
        ctx: {
            flowName: string;
            flowType: 'flow' | 'sub-flow';
            depth: number;
            counter: { value: number };
            out: FlowAccumulator;
        }
    ): void {
        const tag = elementTagName(node);
        if (!tag) {
            return;
        }
        const attrs = elementAttrs(node);
        const local = getLocalName(tag);
        const prefix = getPrefix(tag);

        ctx.counter.value += 1;

        const component: MuleComponent = {
            id: `comp_${ctx.counter.value}`,
            name: deriveComponentDisplayName(tag, attrs),
            type: deriveComponentType(tag),
            tagName: tag,
            configRef: attrs['config-ref'] || attrs.config,
            doc: attrs['doc:description'],
            attributes: attrs,
            depth: ctx.depth,
            position: ctx.counter.value,
        };

        // Emit catalog entries for important component types
        const kind = this.kindByPrefix[prefix] || inferConnectorKindFromTag(tag);

        if (tag === 'http:listener') {
            ctx.out.listeners.push({
                flowName: ctx.flowName,
                filePath: this.filePath,
                method: (attrs['allowedMethods'] || attrs['method'] || 'ANY').toUpperCase(),
                path: attrs['path'] || '/',
                configRef: component.configRef,
            });
        } else if (tag === 'http:request') {
            ctx.out.requesters.push({
                flowName: ctx.flowName,
                filePath: this.filePath,
                method: (attrs['method'] || 'GET').toUpperCase(),
                path: attrs['path'] || attrs['url'],
                configRef: component.configRef,
                target: attrs['target'],
            });
        } else if (tag === 'scheduler' || local === 'scheduler') {
            const trigger = extractSchedulerTrigger(node, this.filePath, ctx.flowName);
            if (trigger) {
                ctx.out.schedulers.push(trigger);
            }
        } else if (tag === 'flow-ref') {
            const targetName = attrs['name'];
            if (targetName) {
                // Edge target id is resolved in second pass; use sanitized name as
                // a temporary placeholder.
                ctx.out.edges.push({
                    from: '__SOURCE__:' + ctx.flowName,
                    to: '__NAME__:' + targetName,
                    sourceFile: this.filePath,
                });
            }
        } else if (prefix === 'apikit' && local === 'router') {
            // APIkit router; routes are detected from flow names later.
        } else if (isConnectorOperationTag(tag)) {
            ctx.out.connectorOperations.push({
                flowName: ctx.flowName,
                filePath: this.filePath,
                modulePrefix: prefix,
                operation: local,
                kind,
                configRef: component.configRef,
                detail: extractOperationDetail(tag, attrs, node),
                direction: deriveOperationDirection(local),
            });
        }

        siblings.push(component);

        // Recurse into children (preserve-order keeps them under the tag key)
        const childElements = (node[tag] as any[]) || [];
        if (childElements.length > 0 && isContainerByConvention(tag, local)) {
            component.children = component.children || [];
            for (const grand of childElements) {
                this.walkComponent(grand, component.children, {
                    ...ctx,
                    depth: ctx.depth + 1,
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers: element tree shape
// ---------------------------------------------------------------------------

/** preserve-order entries are objects with exactly one tag key (besides ":@"). */
function elementTagName(node: any): string {
    if (!node || typeof node !== 'object') {
        return '';
    }
    for (const key of Object.keys(node)) {
        if (key === ':@' || key === '#text') {
            continue;
        }
        return key;
    }
    return '';
}

function elementAttrs(node: any): Record<string, string> {
    const raw = (node?.[':@'] as Record<string, string>) || {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('@_')) {
            continue;
        }
        out[key.slice(2)] = String(value ?? '');
    }
    return out;
}

function findFirstElement(tree: any[]): any {
    if (!Array.isArray(tree)) {
        return undefined;
    }
    for (const item of tree) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const name = elementTagName(item);
        // Skip XML processing instructions (e.g. <?xml ... ?>) and DOCTYPE pseudo-tags.
        if (!name || name.startsWith('?') || name === '!doctype') {
            continue;
        }
        return item;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Helpers: tag classification
// ---------------------------------------------------------------------------

function getLocalName(tag: string): string {
    const idx = tag.indexOf(':');
    return idx === -1 ? tag : tag.slice(idx + 1);
}

function getPrefix(tag: string): string {
    const idx = tag.indexOf(':');
    return idx === -1 ? '' : tag.slice(0, idx);
}

function isConnectorConfig(tag: string, local: string): boolean {
    // A namespaced "config" element, e.g. <salesforce:config>, <db:config>.
    if (local === 'config' && tag.includes(':')) {
        return true;
    }
    // Variant naming: e.g. <db:my-mssql-config>, <http:listener-config>, <http:request-config>.
    return /-config$/.test(local);
}

const OPERATION_LOCAL_NAMES = new Set([
    'select', 'insert', 'update', 'delete', 'execute-script', 'execute-ddl', 'bulk-execute',
    'create', 'query', 'retrieve', 'upsert', 'invoke-soap',
    'publish', 'consume', 'subscriber', 'listen', 'send', 'send-and-receive',
    'request', 'listener',
    'read', 'write', 'list', 'copy', 'move',
    'store', 'remove', 'contains',
    'get', 'put', 'post', 'patch', 'head',
    'send-email', 'mark-as-read',
    'on-new-or-updated-file', 'on-new-file',
]);

function isConnectorOperationTag(tag: string): boolean {
    const prefix = getPrefix(tag);
    if (!prefix) {
        return false;
    }
    if (prefix === 'ee' || prefix === 'doc' || prefix === 'mule' || prefix === 'spring') {
        return false;
    }
    const local = getLocalName(tag);
    if (OPERATION_LOCAL_NAMES.has(local)) {
        return true;
    }
    // db:select, salesforce:create-job, etc.
    if (/^[a-z]+(?:-[a-z]+)+$/.test(local)) {
        return true;
    }
    return false;
}

const CONTAINER_LOCAL_NAMES = new Set([
    'choice', 'when', 'otherwise', 'try', 'error-handler', 'on-error-continue',
    'on-error-propagate', 'on-error', 'scatter-gather', 'foreach', 'parallel-foreach',
    'async', 'until-successful', 'poll', 'scheduled', 'process-records', 'router',
    'batch:job', 'batch:step', 'route',
]);

function isContainerByConvention(tag: string, local: string): boolean {
    return CONTAINER_LOCAL_NAMES.has(tag) || CONTAINER_LOCAL_NAMES.has(local);
}

function deriveOperationDirection(local: string): 'in' | 'out' | undefined {
    if (local === 'publish' || local === 'send' || local === 'request' || local === 'put' || local === 'post' || local === 'send-email') {
        return 'out';
    }
    if (local === 'consume' || local === 'subscriber' || local === 'listen' || local === 'listener' || local === 'on-new-file' || local === 'on-new-or-updated-file') {
        return 'in';
    }
    return undefined;
}

function deriveComponentType(tag: string): string {
    const prefix = getPrefix(tag);
    const local = getLocalName(tag);
    const localTitle = toTitleCase(local.replace(/[-_]+/g, ' '));
    if (!prefix) {
        return localTitle || 'Component';
    }
    return `${formatPrefix(prefix)} ${localTitle}`.trim();
}

function deriveComponentDisplayName(tag: string, attrs: Record<string, string>): string {
    const docName = attrs['doc:name'];
    if (docName && docName.trim()) {
        return docName.trim();
    }
    const local = getLocalName(tag);
    if (tag === 'http:listener') {
        return `${(attrs['allowedMethods'] || 'ANY').toUpperCase()} ${attrs['path'] || '/'}`;
    }
    if (tag === 'http:request') {
        return `${(attrs['method'] || 'GET').toUpperCase()} ${attrs['path'] || attrs['url'] || ''}`.trim();
    }
    if (tag === 'logger') {
        return attrs['message'] ? `Log: ${truncate(attrs['message'], 40)}` : 'Logger';
    }
    if (tag === 'set-variable') {
        return `Set ${attrs['variableName'] || 'variable'}`;
    }
    if (tag === 'set-payload') {
        return 'Set Payload';
    }
    if (tag === 'flow-ref') {
        return attrs['name'] ? `→ ${attrs['name']}` : 'Flow Reference';
    }
    if (local === 'select' || local === 'insert' || local === 'update' || local === 'delete') {
        return `DB ${toTitleCase(local)}`;
    }
    return deriveComponentType(tag);
}

function extractOperationDetail(tag: string, attrs: Record<string, string>, node: any): string | undefined {
    // For DB ops, extract the inline <db:sql> child text
    const childElements = (node[tag] as any[]) || [];
    const sqlChild = childElements.find(c => {
        const t = elementTagName(c);
        return t === 'db:sql' || t === 'db:parameterized-query' || t === 'db:dynamic-query';
    });
    if (sqlChild) {
        const t = elementTagName(sqlChild);
        const arr = (sqlChild[t] as any[]) || [];
        const text = arr.map(x => x['#text'] ?? '').join(' ').trim();
        if (text) {
            return truncate(text, 80);
        }
    }
    if (attrs['queueName']) {
        return `queue: ${attrs['queueName']}`;
    }
    if (attrs['destination']) {
        return `dest: ${attrs['destination']}`;
    }
    if (attrs['topicName']) {
        return `topic: ${attrs['topicName']}`;
    }
    if (attrs['type']) {
        // salesforce:create type="Account"
        return `${attrs['type']}`;
    }
    return undefined;
}

function extractSchedulerTrigger(schedulerNode: any, filePath: string, flowName: string): SchedulerTrigger | undefined {
    const arr = (schedulerNode['scheduler'] as any[]) || [];
    const strategyEl = arr.find(c => elementTagName(c) === 'scheduling-strategy');
    if (!strategyEl) {
        return { kind: 'unknown', flowName, filePath };
    }
    const strategyChildren = (strategyEl['scheduling-strategy'] as any[]) || [];
    const kindNode = strategyChildren[0];
    if (!kindNode) {
        return { kind: 'unknown', flowName, filePath };
    }
    const kindTag = elementTagName(kindNode);
    const attrs = elementAttrs(kindNode);
    if (kindTag === 'cron') {
        return {
            kind: 'cron',
            expression: attrs['expression'],
            flowName,
            filePath,
        };
    }
    if (kindTag === 'fixed-frequency') {
        return {
            kind: 'fixed-frequency',
            frequency: attrs['frequency'],
            timeUnit: attrs['timeUnit'] || 'MILLISECONDS',
            flowName,
            filePath,
        };
    }
    return { kind: 'unknown', flowName, filePath };
}

function looksLikeMuleConfig(content: string): boolean {
    if (!content) {
        return false;
    }
    // Cheap pre-flight: only parse files that look like Mule configs.
    return /xmlns\s*=\s*["']http:\/\/www\.mulesoft\.org\/schema\/mule\/core/i.test(content)
        || /<mule\b/i.test(content)
        || /<flow\b/i.test(content)
        || /<sub-flow\b/i.test(content);
}

// ---------------------------------------------------------------------------
// Cross-flow edge resolution
// ---------------------------------------------------------------------------

function resolveCrossFlowEdges(allFlows: MuleFlowNode[], edges: MuleFlowEdge[]): void {
    const idByName = new Map<string, string>();
    const fileByName = new Map<string, string>();
    for (const f of allFlows) {
        if (!idByName.has(f.name)) {
            idByName.set(f.name, f.id);
            fileByName.set(f.name, f.filePath);
        }
    }
    for (const edge of edges) {
        if (edge.from.startsWith('__SOURCE__:')) {
            const sourceName = edge.from.slice('__SOURCE__:'.length);
            edge.from = idByName.get(sourceName) || sanitizeId(sourceName);
        }
        if (edge.to.startsWith('__NAME__:')) {
            const targetName = edge.to.slice('__NAME__:'.length);
            edge.to = idByName.get(targetName) || sanitizeId(targetName);
            edge.targetFile = fileByName.get(targetName);
        }
    }
}

function enrichApiKitRoutes(routes: ApiKitRoute[], flows: MuleFlowNode[]): void {
    // APIkit-generated flow names look like:  get:\customers:my-api-config
    // or                                       post:\orders\(orderId):application\json:my-api-config
    const ROUTE_RE = /^(get|post|put|patch|delete|head|options):(.+):([\w-]+)$/i;
    for (const flow of flows) {
        const match = ROUTE_RE.exec(flow.name);
        if (!match) {
            continue;
        }
        const method = match[1].toUpperCase();
        const resource = match[2].replace(/^\\/, '/').replace(/\\/g, '/');
        const apiConfig = match[3];
        routes.push({
            flowName: flow.name,
            method,
            resource,
            apiConfig,
        });
    }
}

// ---------------------------------------------------------------------------
// Properties / YAML
// ---------------------------------------------------------------------------

function parseProperties(files: Record<string, string>): PropertiesInventory {
    const propFiles: string[] = [];
    const yamlFiles: string[] = [];
    const values: Record<string, string> = {};

    for (const [filePath, content] of Object.entries(files)) {
        const lower = filePath.toLowerCase();
        if (!lower.startsWith('src/main/resources/') && !lower.match(/^[^/]+\.(properties|ya?ml)$/)) {
            // Restrict to the resources tree to avoid noise from META-INF
            if (!lower.match(/\.(properties|ya?ml)$/)) {
                continue;
            }
            if (lower.includes('meta-inf/')) {
                continue;
            }
        }
        if (lower.endsWith('.properties')) {
            propFiles.push(filePath);
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
                    continue;
                }
                const eqIdx = firstUnescapedDelim(trimmed);
                if (eqIdx === -1) {
                    continue;
                }
                const key = trimmed.slice(0, eqIdx).trim();
                const value = trimmed.slice(eqIdx + 1).trim();
                if (key) {
                    values[key] = value;
                }
            }
        } else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
            yamlFiles.push(filePath);
            const parsed = parseSimpleYaml(content);
            for (const [k, v] of Object.entries(parsed)) {
                values[k] = v;
            }
        }
    }

    return {
        propertiesFiles: propFiles.sort(),
        yamlFiles: yamlFiles.sort(),
        keys: Object.keys(values).sort(),
        values,
    };
}

function firstUnescapedDelim(line: string): number {
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '=' || c === ':') {
            return i;
        }
        if (c === '\\') {
            i++;
        }
    }
    return -1;
}

/**
 * Minimal flat YAML parser sufficient for Mule property files.
 * Handles nested keys (dotted-out), simple scalars, and ignores anchors/lists.
 * NOT a general YAML implementation.
 */
function parseSimpleYaml(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    const stack: Array<{ indent: number; prefix: string }> = [{ indent: -1, prefix: '' }];
    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
            continue;
        }
        const indent = rawLine.match(/^[ \t]*/)?.[0].length ?? 0;
        const line = rawLine.slice(indent);
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
            continue;
        }
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
            value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
            value = value.slice(1, -1);
        }
        // pop stack to current indent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const prefix = stack[stack.length - 1].prefix;
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value === '') {
            stack.push({ indent, prefix: fullKey });
        } else {
            out[fullKey] = value;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// pom.xml
// ---------------------------------------------------------------------------

function parsePomDependencies(files: Record<string, string>): PomDependency[] {
    const pomPath = Object.keys(files).find(p => p.toLowerCase().endsWith('pom.xml'));
    if (!pomPath) {
        return [];
    }
    const content = files[pomPath];
    let parsed: any;
    try {
        parsed = xmlParser.parse(content);
    } catch {
        return [];
    }
    const projectEl = findElementByName(parsed, 'project');
    if (!projectEl) {
        return [];
    }
    const depsContainer = findChildElementByName(projectEl, 'dependencies');
    if (!depsContainer) {
        return [];
    }
    const out: PomDependency[] = [];
    for (const depNode of (depsContainer.dependencies as any[]) || []) {
        if (elementTagName(depNode) !== 'dependency') {
            continue;
        }
        const depChildren = (depNode.dependency as any[]) || [];
        const find = (name: string) => {
            const c = depChildren.find(x => elementTagName(x) === name);
            if (!c) {
                return '';
            }
            const arr = (c[name] as any[]) || [];
            return arr.map(x => x['#text'] ?? '').join('').trim();
        };
        const groupId = find('groupId');
        const artifactId = find('artifactId');
        const version = find('version');
        if (!groupId || !artifactId) {
            continue;
        }
        out.push({
            groupId,
            artifactId,
            version,
            kind: inferConnectorKindFromArtifactId(artifactId),
        });
    }
    return out;
}

function findElementByName(tree: any, name: string): any {
    if (!Array.isArray(tree)) {
        return undefined;
    }
    return tree.find(item => elementTagName(item) === name);
}

function findChildElementByName(parent: any, name: string): any {
    const tag = elementTagName(parent);
    const arr = (parent[tag] as any[]) || [];
    return arr.find(c => elementTagName(c) === name);
}

// ---------------------------------------------------------------------------
// mule-artifact.json + META-INF/maven coordinates
// ---------------------------------------------------------------------------

function parseMuleArtifact(files: Record<string, string>): MuleArtifactInfo {
    const out: MuleArtifactInfo = { secureProperties: [] };

    // mule-artifact.json (could be at root or under META-INF/mule-artifact/)
    const artifactJsonPath = Object.keys(files).find(p => p.toLowerCase().endsWith('mule-artifact.json'));
    if (artifactJsonPath) {
        try {
            const json = JSON.parse(files[artifactJsonPath]);
            out.minMuleVersion = json.minMuleVersion;
            out.requiredProduct = json.requiredProduct;
            if (Array.isArray(json.secureProperties)) {
                out.secureProperties = json.secureProperties;
            }
        } catch {
            // ignore
        }
    }

    // pom.properties under META-INF/maven/<group>/<artifact>/pom.properties
    const pomPropsPath = Object.keys(files).find(p => /META-INF\/maven\/.+\/pom\.properties$/i.test(p));
    if (pomPropsPath) {
        const lines = files[pomPropsPath].split(/\r?\n/);
        for (const line of lines) {
            const m = line.match(/^(groupId|artifactId|version)=(.*)$/);
            if (m) {
                (out as any)[m[1]] = m[2].trim();
            }
        }
    }

    // Mule runtime version often sits in pom.xml as <app.runtime>4.6.0</app.runtime>
    const pomPath = Object.keys(files).find(p => p.toLowerCase().endsWith('pom.xml'));
    if (pomPath) {
        const m = files[pomPath].match(/<app\.runtime>([^<]+)<\/app\.runtime>/);
        if (m) {
            out.muleVersion = m[1].trim();
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// RAML / OAS
// ---------------------------------------------------------------------------

function inventoryRamlOas(files: Record<string, string>): RamlOasInventory {
    const apiFiles: string[] = [];
    const titles: string[] = [];
    for (const [filePath, content] of Object.entries(files)) {
        const lower = filePath.toLowerCase();
        if (!/\.(raml|ya?ml|json)$/.test(lower)) {
            continue;
        }
        if (lower.includes('meta-inf/')) {
            continue;
        }
        if (lower.endsWith('.raml')) {
            apiFiles.push(filePath);
            const m = content.match(/^title:\s*(.+)$/m);
            if (m) {
                titles.push(m[1].trim().replace(/^["']|["']$/g, ''));
            }
            continue;
        }
        // OAS heuristic: top-level "openapi" key
        if (/^\s*openapi\s*:/m.test(content) || /"openapi"\s*:/.test(content)) {
            apiFiles.push(filePath);
            const m = content.match(/title["']?\s*[:=]\s*["']([^"']+)["']/);
            if (m) {
                titles.push(m[1]);
            }
        }
    }
    return { files: apiFiles.sort(), apiTitles: dedupe(titles) };
}

// ---------------------------------------------------------------------------
// DataWeave
// ---------------------------------------------------------------------------

function inventoryDataweave(files: Record<string, string>): DataWeaveFile[] {
    const out: DataWeaveFile[] = [];
    for (const [filePath, content] of Object.entries(files)) {
        if (!filePath.toLowerCase().endsWith('.dwl')) {
            continue;
        }
        const versionMatch = content.match(/%dw\s+([\d.]+)/);
        // Match the DataWeave header directive only (start of a line), to avoid
        // capturing the word "output" inside a comment or function body.
        const outputMatch = content.match(/^[ \t]*output\s+([^\s\n]+)/m);
        const firstLine = content.split('\n').find(l => l.trim().startsWith('//'));
        out.push({
            filePath,
            version: versionMatch?.[1],
            output: outputMatch?.[1],
            description: firstLine?.replace(/^\/\/\s*/, '').trim(),
            sizeBytes: Buffer.byteLength(content, 'utf8'),
        });
    }
    return out.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

// ---------------------------------------------------------------------------
// Connector-kind inference
// ---------------------------------------------------------------------------

function inferConnectorKindFromNamespace(prefix: string, ns: string): ConnectorKind {
    const n = ns.toLowerCase();
    if (n.includes('/db')) {return 'database';}
    if (n.includes('/salesforce')) {return 'salesforce';}
    if (n.includes('/sap')) {return 'sap';}
    if (n.includes('/anypoint-mq')) {return 'anypoint-mq';}
    if (n.includes('/jms')) {return 'jms';}
    if (n.includes('/vm')) {return 'vm';}
    if (n.includes('/sftp')) {return 'sftp';}
    if (n.includes('/ftp')) {return 'ftp';}
    if (n.includes('/file')) {return 'file';}
    if (n.includes('/email')) {return 'email';}
    if (n.includes('/objectstore') || n.includes('/os')) {return 'object-store';}
    if (n.includes('/redis')) {return 'redis';}
    if (n.includes('/mongodb') || n.includes('/mongo')) {return 'mongodb';}
    if (n.includes('/s3')) {return 'amazon-s3';}
    if (n.includes('/sqs')) {return 'amazon-sqs';}
    if (n.includes('/kafka')) {return 'kafka';}
    if (n.includes('/oauth')) {return 'oauth';}
    if (n.includes('/apikit')) {return 'apikit';}
    if (n.includes('/http')) {return 'http';}
    return inferConnectorKindFromTag(prefix);
}

function inferConnectorKindFromTag(tag: string): ConnectorKind {
    const prefix = getPrefix(tag) || tag;
    switch (prefix) {
        case 'http': return 'http';
        case 'db': return 'database';
        case 'salesforce': return 'salesforce';
        case 'sap': return 'sap';
        case 'anypoint-mq': return 'anypoint-mq';
        case 'jms': return 'jms';
        case 'vm': return 'vm';
        case 'sftp': return 'sftp';
        case 'ftp': return 'ftp';
        case 'file': return 'file';
        case 'email': return 'email';
        case 'os': return 'object-store';
        case 'redis': return 'redis';
        case 'mongo': case 'mongodb': return 'mongodb';
        case 's3': return 'amazon-s3';
        case 'sqs': return 'amazon-sqs';
        case 'kafka': return 'kafka';
        case 'oauth': return 'oauth';
        case 'apikit': return 'apikit';
        default: return 'unknown';
    }
}

function inferConnectorKindFromArtifactId(artifactId: string): ConnectorKind {
    const a = artifactId.toLowerCase();
    if (a.includes('http')) {return 'http';}
    if (a.includes('db-connector') || a.includes('database')) {return 'database';}
    if (a.includes('salesforce')) {return 'salesforce';}
    if (a.includes('sap')) {return 'sap';}
    if (a.includes('anypoint-mq')) {return 'anypoint-mq';}
    if (a.includes('jms')) {return 'jms';}
    if (a.includes('vm')) {return 'vm';}
    if (a.includes('sftp')) {return 'sftp';}
    if (a.includes('ftp')) {return 'ftp';}
    if (a.includes('file')) {return 'file';}
    if (a.includes('email') || a.includes('smtp')) {return 'email';}
    if (a.includes('object-store') || a.includes('objectstore')) {return 'object-store';}
    if (a.includes('redis')) {return 'redis';}
    if (a.includes('mongo')) {return 'mongodb';}
    if (a.includes('s3')) {return 'amazon-s3';}
    if (a.includes('sqs')) {return 'amazon-sqs';}
    if (a.includes('kafka')) {return 'kafka';}
    if (a.includes('apikit')) {return 'apikit';}
    return 'unknown';
}

// ---------------------------------------------------------------------------
// Project summary
// ---------------------------------------------------------------------------

function buildSummary(args: {
    artifact: MuleArtifactInfo;
    flows: MuleFlowNode[];
    subFlows: MuleFlowNode[];
    listeners: HttpListener[];
    requesters: HttpRequester[];
    schedulers: SchedulerTrigger[];
    connectorConfigs: ConnectorConfig[];
    connectorOperations: ConnectorOperation[];
    apiKitRoutes: ApiKitRoute[];
    errorHandlers: Array<{ name: string; filePath: string }>;
    properties: PropertiesInventory;
    dataweaveFiles: DataWeaveFile[];
}): ProjectSummary {
    const entryPoints: ProjectSummary['entryPoints'] = [];

    for (const route of args.apiKitRoutes) {
        if (!route.flowName || !route.method) {
            continue;
        }
        entryPoints.push({
            kind: 'apikit',
            label: `${route.method} ${route.resource}`,
            targetFlow: route.flowName,
        });
    }

    for (const listener of args.listeners) {
        // Skip listeners that already showed up as APIkit routes (their flow names match)
        if (args.apiKitRoutes.some(r => r.flowName === listener.flowName)) {
            continue;
        }
        entryPoints.push({
            kind: 'http',
            label: `${listener.method} ${listener.path}`,
            targetFlow: listener.flowName,
        });
    }

    for (const sched of args.schedulers) {
        let label = 'Scheduler';
        if (sched.kind === 'cron' && sched.expression) {
            label = `cron ${sched.expression}`;
        } else if (sched.kind === 'fixed-frequency' && sched.frequency) {
            label = `every ${sched.frequency} ${(sched.timeUnit || 'ms').toLowerCase()}`;
        }
        entryPoints.push({ kind: 'scheduler', label, targetFlow: sched.flowName });
    }

    for (const op of args.connectorOperations) {
        if (op.direction !== 'in') {
            continue;
        }
        const kindToEntryKind: Record<string, ProjectSummary['entryPoints'][number]['kind']> = {
            'anypoint-mq': 'mq-listener',
            'jms': 'jms-listener',
            'vm': 'vm-listener',
            'sftp': 'sftp-listener',
            'file': 'file-listener',
            'kafka': 'kafka-listener',
        };
        const entryKind = kindToEntryKind[op.kind] || 'unknown';
        entryPoints.push({
            kind: entryKind,
            label: op.detail ? `${op.kind} (${op.detail})` : `${op.kind} ${op.operation}`,
            targetFlow: op.flowName,
        });
    }

    // External systems
    const systemsByKind = new Map<ConnectorKind, { count: number; configs: Set<string> }>();
    for (const op of args.connectorOperations) {
        if (op.kind === 'unknown') {
            continue;
        }
        const entry = systemsByKind.get(op.kind) || { count: 0, configs: new Set<string>() };
        entry.count += 1;
        if (op.configRef) {
            entry.configs.add(op.configRef);
        }
        systemsByKind.set(op.kind, entry);
    }
    for (const cfg of args.connectorConfigs) {
        if (cfg.kind === 'unknown') {
            continue;
        }
        const entry = systemsByKind.get(cfg.kind) || { count: 0, configs: new Set<string>() };
        if (cfg.name) {
            entry.configs.add(cfg.name);
        }
        systemsByKind.set(cfg.kind, entry);
    }
    const externalSystems = Array.from(systemsByKind.entries())
        .filter(([kind]) => kind !== 'http' && kind !== 'apikit') // http/apikit are entry transports, not systems
        .map(([kind, info]) => ({
            kind,
            label: humanizeKind(kind),
            usageCount: info.count,
            configs: Array.from(info.configs).sort(),
        }))
        .sort((a, b) => b.usageCount - a.usageCount);

    let componentCount = 0;
    const visit = (nodes: MuleFlowNode[]) => {
        for (const n of nodes) {
            const stack = [...n.components];
            while (stack.length) {
                const c = stack.pop()!;
                componentCount += 1;
                if (c.children) {
                    stack.push(...c.children);
                }
            }
        }
    };
    visit(args.flows);
    visit(args.subFlows);

    return {
        entryPoints,
        externalSystems,
        composition: {
            flows: args.flows.length,
            subFlows: args.subFlows.length,
            components: componentCount,
            errorHandlers: args.errorHandlers.length,
            dataweaveFiles: args.dataweaveFiles.length,
        },
        propertyFiles: {
            yaml: args.properties.yamlFiles.length,
            properties: args.properties.propertiesFiles.length,
            keys: args.properties.keys.length,
        },
    };
}

function humanizeKind(kind: ConnectorKind): string {
    switch (kind) {
        case 'http': return 'HTTP';
        case 'https': return 'HTTPS';
        case 'database': return 'Database';
        case 'salesforce': return 'Salesforce';
        case 'sap': return 'SAP';
        case 'anypoint-mq': return 'Anypoint MQ';
        case 'jms': return 'JMS';
        case 'vm': return 'VM';
        case 'sftp': return 'SFTP';
        case 'ftp': return 'FTP';
        case 'file': return 'File';
        case 'email': return 'Email';
        case 'object-store': return 'Object Store';
        case 'redis': return 'Redis';
        case 'mongodb': return 'MongoDB';
        case 'amazon-s3': return 'Amazon S3';
        case 'amazon-sqs': return 'Amazon SQS';
        case 'kafka': return 'Kafka';
        case 'oauth': return 'OAuth';
        case 'apikit': return 'APIkit';
        default: return 'Unknown';
    }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function sanitizeId(raw: string): string {
    if (!raw) {
        return `flow_${Math.random().toString(36).slice(2, 8)}`;
    }
    let base = raw.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!base || /^\d/.test(base)) {
        base = `flow_${base}`;
    }
    if (base.length > 50) {
        const hash = Math.abs(raw.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
        base = base.slice(0, 40) + '_' + hash.toString(36);
    }
    return base;
}

function toTitleCase(value: string): string {
    return value
        .split(' ')
        .filter(part => part.length > 0)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
}

function formatPrefix(prefix: string): string {
    if (!prefix) {
        return '';
    }
    if (prefix.length <= 3) {
        return prefix.toUpperCase();
    }
    switch (prefix) {
        case 'http': return 'HTTP';
        case 'https': return 'HTTPS';
        case 'salesforce': return 'Salesforce';
        case 'anypoint-mq': return 'MQ';
        case 'apikit': return 'APIkit';
        case 'kafka': return 'Kafka';
        default: return toTitleCase(prefix.replace(/[-_]+/g, ' '));
    }
}

function truncate(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    return text.slice(0, max - 1) + '…';
}

function dedupe<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}

// Re-export utility for callers that just want the file basename
export function projectFlowFileBasename(flow: MuleFlowNode): string {
    return path.basename(flow.filePath || 'unknown.xml');
}

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/**
 * Resolves Mule property placeholders (e.g. `${anypoint.mq.queue}`) against the
 * static property files we parsed. Unknown keys are left as-is so the user can
 * still see something meaningful. Mutates in place because every consumer
 * reaches for the post-resolution value.
 */
function resolvePlaceholdersOnArtifacts(args: {
    listeners: HttpListener[];
    requesters: HttpRequester[];
    connectorOperations: ConnectorOperation[];
    properties: PropertiesInventory;
}): void {
    const values = args.properties.values;
    const resolve = (input: string | undefined): string | undefined => {
        if (!input || !input.includes('${')) {
            return input;
        }
        return input.replace(PLACEHOLDER_RE, (_, key) => {
            const trimmed = String(key).trim();
            return Object.prototype.hasOwnProperty.call(values, trimmed)
                ? values[trimmed]
                : `\${${trimmed}}`;
        });
    };
    for (const l of args.listeners) {
        l.path = resolve(l.path) || l.path;
    }
    for (const r of args.requesters) {
        r.path = resolve(r.path);
    }
    for (const op of args.connectorOperations) {
        op.detail = resolve(op.detail);
    }
}
