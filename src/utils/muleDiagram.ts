import * as path from 'path';

export type MuleFlowType = 'flow' | 'sub-flow' | 'unknown';

export interface MuleComponent {
    id: string;
    name: string;
    type: string;
    tagName: string;
    configRef?: string;
    doc?: string;
    attributes?: Record<string, string>;
    icon?: string;
    children?: MuleComponent[];
    depth?: number;
    position?: number;
}

export interface MuleFlowNode {
    id: string;
    name: string;
    filePath: string;
    type: MuleFlowType;
    components: MuleComponent[];
}

export interface MuleFlowEdge {
    from: string;
    to: string;
    sourceFile: string;
    targetFile?: string;
}

export interface MuleFlowGraph {
    nodes: MuleFlowNode[];
    edges: MuleFlowEdge[];
}

interface FlowDefinition {
    name: string;
    type: MuleFlowType;
    filePath: string;
    body: string;
    components: MuleComponent[];
}

interface ComponentDescriptor {
    type: string;
    icon?: string;
    isContainer?: boolean;
    defaultLabel?: string;
}

const COMPONENT_LIBRARY: Record<string, ComponentDescriptor> = {
    // Core processors
    'logger': { type: 'Logger', icon: '📝' },
    'transform': { type: 'Transform', icon: '🔄' },
    'ee:transform': { type: 'Transform Message', icon: '🔄' },
    'ee:transform-message': { type: 'Transform Message', icon: '🔄' },
    'choice': { type: 'Choice', icon: '🔀', isContainer: true },
    'when': { type: 'When', icon: '⚖️', isContainer: true },
    'otherwise': { type: 'Otherwise', icon: '⚖️', isContainer: true },
    'scatter-gather': { type: 'Scatter-Gather', icon: '🌟', isContainer: true },
    'async': { type: 'Async', icon: '⚡', isContainer: true },
    'foreach': { type: 'For Each', icon: '🔁', isContainer: true },
    'parallel-foreach': { type: 'Parallel For Each', icon: '⚡🔁', isContainer: true },
    'try': { type: 'Try', icon: '🛡️', isContainer: true },
    'error-handler': { type: 'Error Handler', icon: '🚨', isContainer: true },
    'on-error-continue': { type: 'On Error Continue', icon: '🚨', isContainer: true },
    'on-error-propagate': { type: 'On Error Propagate', icon: '🚨', isContainer: true },
    'until-successful': { type: 'Until Successful', icon: '🔄', isContainer: true },
    'set-variable': { type: 'Set Variable', icon: '📌' },
    'set-payload': { type: 'Set Payload', icon: '📦' },
    'remove-variable': { type: 'Remove Variable', icon: '🗑️' },
    
    // HTTP
    'http:listener': { type: 'HTTP Listener', icon: '🌐' },
    'http:request': { type: 'HTTP Request', icon: '🌐' },

    // Database
    'db:select': { type: 'DB Select', icon: '🗄️' },
    'db:insert': { type: 'DB Insert', icon: '🗄️➕' },
    'db:update': { type: 'DB Update', icon: '🗄️✏️' },
    'db:delete': { type: 'DB Delete', icon: '🗄️🗑️' },

    // File system
    'file:read': { type: 'File Read', icon: '📁📖' },
    'file:write': { type: 'File Write', icon: '📁✏️' },
    'file:list': { type: 'File List', icon: '📁📋' },

    // Salesforce
    'salesforce:create': { type: 'SF Create', icon: '☁️➕' },
    'salesforce:query': { type: 'SF Query', icon: '☁️🔍' },
    'salesforce:update': { type: 'SF Update', icon: '☁️✏️' },

    // Messaging
    'vm:publish': { type: 'VM Publish', icon: '📨' },
    'vm:consume': { type: 'VM Consume', icon: '📥' },
    'jms:publish': { type: 'JMS Publish', icon: '📤' },
    'jms:consume': { type: 'JMS Consume', icon: '📥' },
    'anypoint-mq:publish': { type: 'MQ Publish', icon: '📤' },
    'anypoint-mq:subscriber': { type: 'MQ Subscriber', icon: '📨' },
    'anypoint-mq:consume': { type: 'MQ Consume', icon: '📥' },

    // Object Store
    'os:store': { type: 'OS Store', icon: '💾' },
    'os:retrieve': { type: 'OS Retrieve', icon: '💾📖' },
    'os:remove': { type: 'OS Remove', icon: '💾🗑️' },
    'os:contains': { type: 'OS Contains', icon: '💾🔍' },

    // Validation
    'validation:is-true': { type: 'Validate True', icon: '✅' },
    'validation:is-false': { type: 'Validate False', icon: '❌' },

    // Flow references
    'flow-ref': { type: 'Flow Reference', icon: '🔗' },
    'sub-flow-ref': { type: 'Sub-Flow Reference', icon: '🔗' },

    // Batch
    'batch:job': { type: 'Batch Job', icon: '🧮', isContainer: true, defaultLabel: 'Batch Job' },
    'batch:step': { type: 'Batch Step', icon: '🧮', isContainer: true, defaultLabel: 'Batch Step' },
    'batch:process-records': { type: 'Process Records', icon: '🧮', isContainer: true },
    'batch:on-complete': { type: 'Batch On Complete', icon: '🧮', isContainer: true },
    'batch:on-error-continue': { type: 'Batch On Error Continue', icon: '🧮', isContainer: true },
    'batch:on-error-propagate': { type: 'Batch On Error Propagate', icon: '🧮', isContainer: true },

    // Scheduling / Polling
    'poll': { type: 'Poll', icon: '⏱️', isContainer: true },
    'scheduler:scheduled': { type: 'Scheduled', icon: '⏱️', isContainer: true },

    // Generic catch-all
    'connector': { type: 'Connector', icon: '🔌' },
};

const DEFAULT_CONTAINER_TAGS = new Set<string>([
    'choice',
    'when',
    'otherwise',
    'try',
    'error-handler',
    'on-error-continue',
    'on-error-propagate',
    'on-error',
    'scatter-gather',
    'foreach',
    'parallel-foreach',
    'async',
    'until-successful',
    'poll',
    'scheduler:scheduled',
    'batch:job',
    'batch:step',
    'batch:process-records',
    'batch:on-complete',
    'batch:on-error-continue',
    'batch:on-error-propagate'
]);

const DEFAULT_CONTAINER_LOCAL_NAMES = new Set<string>([
    'choice',
    'when',
    'otherwise',
    'try',
    'error-handler',
    'on-error-continue',
    'on-error-propagate',
    'on-error',
    'scatter-gather',
    'foreach',
    'parallel-foreach',
    'async',
    'until-successful',
    'poll',
    'scheduled',
    'process-records'
]);

function normalizeTagName(tagName: string): string {
    return (tagName || '').trim().toLowerCase();
}

function getLocalName(tagName: string): string {
    const normalized = normalizeTagName(tagName);
    const colonIndex = normalized.indexOf(':');
    return colonIndex === -1 ? normalized : normalized.substring(colonIndex + 1);
}

function resolveComponentDescriptor(tagName: string): ComponentDescriptor {
    const normalized = normalizeTagName(tagName);
    const localName = getLocalName(normalized);

    const direct = COMPONENT_LIBRARY[normalized];
    if (direct) {
        return { ...direct };
    }

    const local = COMPONENT_LIBRARY[localName];
    if (local) {
        return { ...local };
    }

    const derivedType = deriveTypeFromTag(normalized);
    return {
        type: derivedType,
        icon: getComponentIcon(derivedType),
        isContainer: DEFAULT_CONTAINER_TAGS.has(normalized) || DEFAULT_CONTAINER_LOCAL_NAMES.has(localName)
    };
}

function deriveTypeFromTag(tagName: string): string {
    const normalized = normalizeTagName(tagName);
    const colonIndex = normalized.indexOf(':');
    const prefix = colonIndex === -1 ? '' : normalized.substring(0, colonIndex);
    const local = colonIndex === -1 ? normalized : normalized.substring(colonIndex + 1);

    const typeCore = toTitleCase(local.replace(/[-_]+/g, ' '));
    if (!prefix) {
        return typeCore.length > 0 ? typeCore : 'Component';
    }

    const formattedPrefix = formatPrefix(prefix);
    if (!formattedPrefix) {
        return typeCore.length > 0 ? typeCore : 'Component';
    }

    if (!typeCore) {
        return formattedPrefix;
    }

    return `${formattedPrefix} ${typeCore}`.trim();
}

function formatPrefix(prefix: string): string {
    const upper = prefix.toUpperCase();
    if (upper.length <= 3) {
        return upper;
    }

    switch (prefix) {
        case 'http':
            return 'HTTP';
        case 'db':
            return 'DB';
        case 'vm':
            return 'VM';
        case 'jms':
            return 'JMS';
        case 'os':
            return 'OS';
        case 'ee':
            return '';
        case 'batch':
            return 'Batch';
        case 'salesforce':
            return 'Salesforce';
        case 'anypoint-mq':
            return 'MQ';
        default:
            return toTitleCase(prefix.replace(/[-_]+/g, ' '));
    }
}

function toTitleCase(value: string): string {
    return value
        .split(' ')
        .filter(part => part.length > 0)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

const FLOW_OPEN_TAG = /<(flow|sub-flow)\b[^>]*name="([^"]+)"[^>]*>/gi;
const FLOW_REF_TAG = /<(flow-ref|sub-flow-ref)\b[^>]*name="([^"]+)"[^>]*>/gi;

export function buildMuleFlowGraph(files: Record<string, string>): MuleFlowGraph {
    const nodes = new Map<string, MuleFlowNode>();
    const edges: MuleFlowEdge[] = [];
    const nameRegistry = new Map<string, MuleFlowNode[]>();
    const flowIdentifierByFile = new Map<string, string>();
    const idUsage = new Map<string, number>();

    const toKey = (file: string, name: string) => `${file}::${name}`;

    const registerNode = (definition: FlowDefinition): MuleFlowNode => {
        const key = toKey(definition.filePath, definition.name);
        if (flowIdentifierByFile.has(key)) {
            const existingId = flowIdentifierByFile.get(key)!;
            return nodes.get(existingId)!;
        }

        const baseId = sanitizeId(definition.name);
        const usageCount = idUsage.get(baseId) ?? 0;
        idUsage.set(baseId, usageCount + 1);
        const uniqueId = usageCount === 0 ? baseId : `${baseId}_${usageCount}`;

        const node: MuleFlowNode = {
            id: uniqueId,
            name: definition.name,
            filePath: definition.filePath,
            type: definition.type,
            components: definition.components,
        };

        nodes.set(uniqueId, node);
        flowIdentifierByFile.set(key, uniqueId);

        if (!nameRegistry.has(definition.name)) {
            nameRegistry.set(definition.name, []);
        }
        nameRegistry.get(definition.name)!.push(node);

        return node;
    };

    const ensureNamedNode = (flowName: string): MuleFlowNode | undefined => {
        const registryEntry = nameRegistry.get(flowName);
        if (registryEntry && registryEntry.length > 0) {
            return registryEntry[0];
        }

        const placeholder: FlowDefinition = {
            name: flowName,
            type: 'unknown',
            filePath: 'unknown',
            body: '',
            components: [],
        };
        return registerNode(placeholder);
    };

    for (const [filePath, content] of Object.entries(files)) {
        const definitions = extractFlowDefinitions(content, filePath);
        definitions.forEach(def => registerNode(def));

        definitions.forEach(def => {
            const sourceNode = registerNode(def);
            const refs = extractReferencedFlows(def.body);

            refs.forEach(targetName => {
                const targetNode = ensureNamedNode(targetName);
                edges.push({
                    from: sourceNode.id,
                    to: targetNode ? targetNode.id : sanitizeId(targetName),
                    sourceFile: sourceNode.filePath,
                    targetFile: targetNode?.filePath,
                });
            });
        });
    }

    return {
        nodes: Array.from(nodes.values()),
        edges,
    };
}

export function buildMermaidDefinition(graph: MuleFlowGraph): string {
    return buildMermaidDefinitionWithMode(graph, 'auto');
}

export function buildMermaidDefinitionWithMode(graph: MuleFlowGraph, mode: string): string {
    const totalNodes = graph.nodes.length;
    const totalComponents = graph.nodes.reduce((sum, node) => sum + countComponents(node.components), 0);
    const estimatedSize = totalNodes * 100 + totalComponents * 50 + graph.edges.length * 30;
    
    switch (mode) {
        case 'simplified':
            return buildSimplifiedMermaidDefinition(graph);
        case 'detailed':
            return buildDetailedMermaidDefinition(graph);
        case 'full-detailed':
            return buildFullDetailedMermaidDefinition(graph);
        case 'auto':
        default:
            // Auto mode: decide based on size
            if (estimatedSize > 8000 || totalNodes > 30) {
                return buildSimplifiedMermaidDefinition(graph);
            }
            return buildDetailedMermaidDefinition(graph);
    }
}

export function countComponents(components: MuleComponent[]): number {
    return components.reduce((total, component) => {
        const childCount = component.children ? countComponents(component.children) : 0;
        return total + 1 + childCount;
    }, 0);
}

function buildSimplifiedMermaidDefinition(graph: MuleFlowGraph): string {
    const lines: string[] = ['graph TD'];
    
    // Ultra-conservative approach: bulletproof node definitions
    graph.nodes.forEach(node => {
        const componentCount = countComponents(node.components);
        const safeLabel = createSafeLabel(node.name, node.type, componentCount);
        const safeId = createSafeId(node.id);
        // Use only simple rectangle with safe labels
        lines.push(`${safeId}["${safeLabel}"]`);
    });
    
    // Add simple connections with safe IDs
    graph.edges.forEach(edge => {
        const safeFromId = createSafeId(edge.from);
        const safeToId = createSafeId(edge.to);
        lines.push(`${safeFromId} --> ${safeToId}`);
    });
    
    // Enhanced styling with solid colors, emotional design, and improved visual hierarchy
    lines.push('classDef flow fill:#667eea,stroke:#4c51bf,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef subflow fill:#f093fb,stroke:#e53e3e,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef unknown fill:#a8b3cf,stroke:#718096,stroke-width:3px,color:#2d3748,font-weight:bold');
    
    // Enhanced component-specific styling with emotional colors
    lines.push('classDef httpComponent fill:#3182ce,stroke:#2a4365,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef dbComponent fill:#38a169,stroke:#276749,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef transformComponent fill:#805ad5,stroke:#44337a,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef errorComponent fill:#e53e3e,stroke:#9b2c2c,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef loggerComponent fill:#ecc94b,stroke:#b7791f,stroke-width:3px,color:#744210,font-weight:bold');
    lines.push('classDef apiComponent fill:#00d4aa,stroke:#00a693,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef securityComponent fill:#ff6b9d,stroke:#e63972,stroke-width:3px,color:#fff,font-weight:bold');
    lines.push('classDef variableComponent fill:#ffa726,stroke:#f57c00,stroke-width:3px,color:#fff,font-weight:bold');
    
    graph.nodes.forEach(node => {
        const className = getNodeClassName(node);
        const safeId = createSafeId(node.id);
        lines.push(`class ${safeId} ${className}`);
    });
    
    return lines.join('\n');
}

function buildDetailedMermaidDefinition(graph: MuleFlowGraph): string {
    const lines: string[] = ['graph TD'];
    
    // Ultra-safe approach with bulletproof IDs and labels
    graph.nodes.forEach(node => {
        // Add the main flow node
        const safeId = createSafeId(node.id);
        const totalComponentCount = countComponents(node.components);
        const safeLabel = createSafeLabel(node.name, node.type, totalComponentCount);
        lines.push(`${safeId}["${safeLabel}"]`);
        
        // Show all components in detailed mode (increased limit for better visibility)
        const maxComponents = 10;
        node.components.slice(0, maxComponents).forEach((component, compIndex) => {
            const compId = createSafeId(`${node.id}_c${compIndex}`);
            const compLabel = createSafeComponentLabel(component);
            const shape = getComponentShape(component);
            lines.push(`${compId}${shape.open}"${compLabel}"${shape.close}`);
            
            // Connect in sequence
            if (compIndex === 0) {
                lines.push(`${safeId} --> ${compId}`);
            } else {
                const prevCompId = createSafeId(`${node.id}_c${compIndex - 1}`);
                lines.push(`${prevCompId} --> ${compId}`);
            }
        });
        
        // Add "more" indicator if needed
        const totalComponents = countComponents(node.components);
        const displayedCount = Math.min(node.components.length, maxComponents);
        if (totalComponents > displayedCount) {
            const moreId = createSafeId(`${node.id}_more`);
            const remainingCount = Math.max(0, totalComponents - displayedCount);
            lines.push(`${moreId}["Plus ${remainingCount} more components"]`);
            if (maxComponents > 0) {
                const lastCompId = createSafeId(`${node.id}_c${maxComponents - 1}`);
                lines.push(`${lastCompId} --> ${moreId}`);
            } else {
                lines.push(`${safeId} --> ${moreId}`);
            }
        }
    });
    
    // Add flow-to-flow connections with safe IDs
    graph.edges.forEach(edge => {
        const safeFromId = createSafeId(edge.from);
        const safeToId = createSafeId(edge.to);
        lines.push(`${safeFromId} --> ${safeToId}`);
    });

    // Enhanced sophisticated styling with component-specific themes
    lines.push('classDef flow fill:#667eea,stroke:#4c51bf,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef subflow fill:#f093fb,stroke:#e53e3e,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef unknown fill:#a8b3cf,stroke:#718096,stroke-width:3px,color:#2d3748,font-weight:bold');
    lines.push('classDef component fill:#e2e8f0,stroke:#4a5568,stroke-width:2px,color:#2d3748');
    
    // Component-specific styling for better visual distinction
    lines.push('classDef http fill:#3182ce,stroke:#2a4365,stroke-width:2px,color:#fff');
    lines.push('classDef database fill:#38a169,stroke:#276749,stroke-width:2px,color:#fff');
    lines.push('classDef transform fill:#805ad5,stroke:#44337a,stroke-width:2px,color:#fff');
    lines.push('classDef choice fill:#ed8936,stroke:#9c4221,stroke-width:2px,color:#fff');
    lines.push('classDef error fill:#e53e3e,stroke:#9b2c2c,stroke-width:2px,color:#fff');
    lines.push('classDef logger fill:#ecc94b,stroke:#b7791f,stroke-width:2px,color:#744210');

    // Apply styles with safe IDs
    graph.nodes.forEach(node => {
        const className = getNodeClassName(node);
        const safeId = createSafeId(node.id);
        lines.push(`class ${safeId} ${className}`);
        
        // Style components with specific classes
        const maxComponents = 2;
        node.components.slice(0, maxComponents).forEach((component, compIndex) => {
            const compId = createSafeId(`${node.id}_c${compIndex}`);
            const compClassName = getComponentClassName(component);
            lines.push(`class ${compId} ${compClassName}`);
        });
        
        if (countComponents(node.components) > Math.min(node.components.length, maxComponents)) {
            const moreId = createSafeId(`${node.id}_more`);
            lines.push(`class ${moreId} component`);
        }
    });

    return lines.join('\n');
}

function formatSimplifiedFlowLabel(node: MuleFlowNode, componentCount: number): string {
    const icon = node.type === 'sub-flow' ? '🔗' : '⚡';
    const shortName = node.name.length > 20 ? node.name.substring(0, 17) + '...' : node.name;
    const compText = componentCount > 0 ? ` (${componentCount})` : '';
    return `${icon} ${shortName}${compText}`;
}

function formatUltraSimpleFlowLabel(node: MuleFlowNode, componentCount: number): string {
    // Ultra-simple labels with minimal special characters
    const icon = node.type === 'sub-flow' ? 'SUB' : 'FLOW';
    const shortName = node.name.length > 15 ? node.name.substring(0, 12) + '...' : node.name;
    const compText = componentCount > 0 ? ` (${componentCount})` : '';
    return `${icon}: ${shortName}${compText}`;
}

function formatSimpleComponentLabel(component: MuleComponent): string {
    // Ultra-simple component labels
    const shortName = component.name.length > 15 ? component.name.substring(0, 12) + '...' : component.name;
    const shortType = component.type.length > 10 ? component.type.substring(0, 7) + '...' : component.type;
    return `${shortType}: ${shortName}`;
}

function createSafeId(rawId: string): string {
    if (!rawId || typeof rawId !== 'string') {
        return `node_${Math.random().toString(36).slice(2, 8)}`;
    }
    
    // Create ultra-safe IDs that work with any Mermaid version
    let safeId = rawId
        .replace(/[^a-zA-Z0-9]/g, '_')  // Replace all non-alphanumeric with underscore
        .replace(/_+/g, '_')            // Remove consecutive underscores
        .replace(/^_+|_+$/g, '')        // Remove leading/trailing underscores
        .toLowerCase();                 // Lowercase for consistency
    
    // Ensure it starts with a letter
    if (!safeId || /^\d/.test(safeId)) {
        safeId = `n_${safeId}`;
    }
    
    // Limit length
    if (safeId.length > 30) {
        safeId = safeId.substring(0, 30);
    }
    
    return safeId || `node_${Math.random().toString(36).slice(2, 8)}`;
}

function createSafeLabel(name: string, type: string, componentCount?: number): string {
    if (!name || typeof name !== 'string') {
        return 'Unknown Flow';
    }
    
    // Create safe labels without special characters
    const typePrefix = type === 'sub-flow' ? 'SUB-FLOW' : 'FLOW';
    const safeName = name
        .replace(/['"\\]/g, '')         // Remove quotes and backslashes
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .trim();
    
    const shortName = safeName.length > 25 ? safeName.substring(0, 22) + '...' : safeName;
    const compText = componentCount && componentCount > 0 ? ` (${componentCount})` : '';
    
    return `${typePrefix}: ${shortName}${compText}`;
}

function createSafeComponentLabel(component: MuleComponent): string {
    if (!component || !component.name) {
        return 'Unknown Component';
    }
    
    const safeName = component.name
        .replace(/['"\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const safeType = (component.type || 'Component')
        .replace(/['"\\]/g, '')
        .trim();
    
    const shortName = safeName.length > 20 ? safeName.substring(0, 17) + '...' : safeName;
    const shortType = safeType.length > 15 ? safeType.substring(0, 12) + '...' : safeType;
    
    // Add component-specific icons
    const icon = getComponentIcon(component.type);
    
    // Include config reference if available
    const configInfo = component.configRef ? ` (${component.configRef})` : '';
    
    return `${icon} ${shortName}${configInfo.length > 20 ? '' : configInfo}`;
}


function groupNodesByFile(nodes: MuleFlowNode[]): Record<string, MuleFlowNode[]> {
    const groups: Record<string, MuleFlowNode[]> = {};
    
    nodes.forEach(node => {
        const key = node.filePath === 'unknown' ? 'unknown' : node.filePath;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(node);
    });
    
    return groups;
}

function getNodeShape(node: MuleFlowNode): { open: string; close: string } {
    // Different shapes for different flow types
    if (node.name.toLowerCase().includes('api')) {
        return { open: '([', close: '])' }; // Stadium for API flows
    } else if (node.name.toLowerCase().includes('error')) {
        return { open: '{', close: '}' }; // Rhombus for error flows  
    } else if (node.type === 'sub-flow') {
        return { open: '[[', close: ']]' }; // Subroutine for sub-flows
    } else {
        return { open: '[', close: ']' }; // Rectangle for regular flows
    }
}

function buildFullDetailedMermaidDefinition(graph: MuleFlowGraph): string {
    const lines: string[] = ['graph TD'];
    
    // Ultra-detailed approach: show ALL components including nested ones
    graph.nodes.forEach(node => {
        // Add the main flow node
        const safeId = createSafeId(node.id);
        const totalComponentCount = countComponents(node.components);
        const safeLabel = createSafeLabel(node.name, node.type, totalComponentCount);
        lines.push(`${safeId}["${safeLabel}"]`);
        
        // Function to recursively add all components
        function addAllComponents(components: MuleComponent[], parentId: string, depth: number = 0): void {
            components.forEach((component, compIndex) => {
                const compId = createSafeId(`${parentId}_c${depth}_${compIndex}`);
                const compLabel = createSafeComponentLabel(component);
                const shape = getComponentShape(component);
                lines.push(`${compId}${shape.open}"${compLabel}"${shape.close}`);
                
                // Connect to parent
                lines.push(`${parentId} --> ${compId}`);
                
                // Recursively add children if they exist
                if (component.children && component.children.length > 0) {
                    addAllComponents(component.children, compId, depth + 1);
                }
            });
        }
        
        // Add all components recursively
        addAllComponents(node.components, safeId);
    });
    
    // Add flow-to-flow connections
    graph.edges.forEach(edge => {
        const safeFromId = createSafeId(edge.from);
        const safeToId = createSafeId(edge.to);
        lines.push(`${safeFromId} --> ${safeToId}`);
    });

    // Enhanced sophisticated styling with component-specific themes
    lines.push('classDef flow fill:#667eea,stroke:#4c51bf,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef subflow fill:#f093fb,stroke:#e53e3e,stroke-width:4px,color:#fff,font-weight:bold');
    lines.push('classDef unknown fill:#a8b3cf,stroke:#718096,stroke-width:3px,color:#2d3748,font-weight:bold');
    lines.push('classDef component fill:#e2e8f0,stroke:#4a5568,stroke-width:2px,color:#2d3748');
    
    // Component-specific styling for better visual distinction
    lines.push('classDef http fill:#3182ce,stroke:#2a4365,stroke-width:2px,color:#fff');
    lines.push('classDef database fill:#38a169,stroke:#276749,stroke-width:2px,color:#fff');
    lines.push('classDef transform fill:#805ad5,stroke:#44337a,stroke-width:2px,color:#fff');
    lines.push('classDef choice fill:#ed8936,stroke:#9c4221,stroke-width:2px,color:#fff');
    lines.push('classDef error fill:#e53e3e,stroke:#9b2c2c,stroke-width:2px,color:#fff');
    lines.push('classDef logger fill:#ecc94b,stroke:#b7791f,stroke-width:2px,color:#744210');

    // Apply styles with safe IDs
    graph.nodes.forEach(node => {
        const className = getNodeClassName(node);
        const safeId = createSafeId(node.id);
        lines.push(`class ${safeId} ${className}`);
        
        // Apply component-specific styling recursively
        function styleAllComponents(components: MuleComponent[], parentId: string, depth: number = 0): void {
            components.forEach((component, compIndex) => {
                const compId = createSafeId(`${parentId}_c${depth}_${compIndex}`);
                const compClassName = getComponentClassName(component);
                lines.push(`class ${compId} ${compClassName}`);
                
                // Style children recursively
                if (component.children && component.children.length > 0) {
                    styleAllComponents(component.children, compId, depth + 1);
                }
            });
        }
        
        styleAllComponents(node.components, safeId);
    });

    return lines.join('\n');
}

function getNodeClassName(node: MuleFlowNode): string {
    const name = node.name.toLowerCase();
    
    if (name.includes('api')) {
        return 'apiflow';
    } else if (name.includes('error')) {
        return 'errorflow';
    } else if (node.type === 'sub-flow') {
        return 'subflow';
    } else if (node.type === 'flow') {
        return 'flow';
    } else {
        return 'unknown';
    }
}


function extractFlowDefinitions(content: string, filePath: string): FlowDefinition[] {
    if (!content || typeof content !== 'string') {
        return [];
    }
    
    const defs: FlowDefinition[] = [];
    let match: RegExpExecArray | null;

    while ((match = FLOW_OPEN_TAG.exec(content)) !== null) {
        const tagType = match[1] as MuleFlowType;
        const name = match[2];
        
        // Skip if name is empty or undefined
        if (!name || name.trim() === '') {
            continue;
        }
        
        const type: MuleFlowType = tagType === 'sub-flow' ? 'sub-flow' : 'flow';

        const openTagEnd = match.index + match[0].length;
        const closingTag = `</${tagType}>`;
        const closeIndex = content.indexOf(closingTag, openTagEnd);
        const body = closeIndex !== -1
            ? content.substring(openTagEnd, closeIndex)
            : content.substring(openTagEnd);

        try {
            const components = extractComponentsFromFlowBody(body || '');
            
            defs.push({
                name: name.trim(),
                type,
                body: body || '',
                filePath: filePath || 'unknown',
                components,
            });
        } catch (error) {
            console.warn(`Failed to extract components for flow "${name}":`, error);
            // Still add the flow but with empty components
            defs.push({
                name: name.trim(),
                type,
                body: body || '',
                filePath: filePath || 'unknown',
                components: [],
            });
        }

        if (closeIndex !== -1) {
            FLOW_OPEN_TAG.lastIndex = closeIndex + closingTag.length;
        }
    }

    FLOW_OPEN_TAG.lastIndex = 0;
    return defs;
}

function extractReferencedFlows(body: string): string[] {
    const refs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = FLOW_REF_TAG.exec(body)) !== null) {
        refs.push(match[2]);
    }
    FLOW_REF_TAG.lastIndex = 0;
    return refs;
}

function sanitizeId(raw: string): string {
    if (!raw || typeof raw !== 'string') {
        return `flow_${Math.random().toString(36).slice(2, 8)}`;
    }
    
    // Replace all non-alphanumeric characters with underscores
    let base = raw.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Remove consecutive underscores
    base = base.replace(/_+/g, '_');
    
    // Remove leading/trailing underscores
    base = base.replace(/^_+|_+$/g, '');
    
    // Ensure it starts with a letter (Mermaid requirement)
    if (base.length === 0 || /^\d/.test(base)) {
        base = `flow_${base}`;
    }
    
    // Limit length to prevent issues with very long names
    if (base.length > 50) {
        const hash = Math.abs(raw.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0));
        base = base.substring(0, 40) + '_' + hash.toString(36);
    }
    
    // Handle Mermaid reserved words
    const reservedWords = ['graph', 'subgraph', 'end', 'click', 'class', 'classDef', 'direction', 'TD', 'TB', 'BT', 'RL', 'LR'];
    if (reservedWords.includes(base.toLowerCase())) {
        base = `flow_${base}`;
    }
    
    return base.length > 0 ? base : `flow_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNodeLabel(node: MuleFlowNode): string {
    const fileName = node.filePath === 'unknown'
        ? 'unknown file'
        : path.basename(node.filePath);

    const escapedName = escapeMermaidText(node.name);
    const escapedFile = escapeMermaidText(fileName);
    return `"${escapedName}\\n${escapedFile}"`;
}

function escapeMermaidText(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Escape quotes and other problematic characters for Mermaid
    return text
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape quotes
        .replace(/'/g, "\\'")    // Escape single quotes
        .replace(/\n/g, '\\n')   // Escape newlines
        .replace(/\r/g, '\\r')   // Escape carriage returns
        .replace(/\t/g, '\\t')   // Escape tabs
        .replace(/\[/g, '\\[')   // Escape square brackets
        .replace(/\]/g, '\\]')   // Escape square brackets
        .replace(/\{/g, '\\{')   // Escape curly braces
        .replace(/\}/g, '\\}')   // Escape curly braces
        .replace(/\(/g, '\\(')   // Escape parentheses
        .replace(/\)/g, '\\)')   // Escape parentheses
        .replace(/\|/g, '\\|')   // Escape pipes
        .replace(/;/g, '\\;')    // Escape semicolons
        .replace(/#/g, '\\#')    // Escape hash symbols
        .trim();
}

function escapeMermaidLabel(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Simple escaping for subgraph labels - only escape quotes
    return text.replace(/"/g, '\\"').trim();
}

export function selectRelevantXmlEntries(entries: Array<{ path: string; content: string }>): Record<string, string> {
    const filtered: Record<string, string> = {};

    entries.forEach(entry => {
        const lowered = entry.path.toLowerCase();
        if (!lowered.endsWith('.xml')) {
            return;
        }

        if (lowered.includes('meta-inf/')) {
            return;
        }

        filtered[normalizePath(entry.path)] = entry.content;
    });

    return filtered;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

function extractComponentsFromFlowBody(body: string): MuleComponent[] {
    if (!body || typeof body !== 'string') {
        return [];
    }

    const components: MuleComponent[] = [];
    const stack: Array<{ component: MuleComponent; tagName: string }> = [];
    let componentIndex = 0;

    const tagRegex = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/)?([\w:-]+)([^>]*?)(\/?)>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(body)) !== null) {
        const fullMatch = match[0];

        // Skip comments and CDATA blocks entirely
        if (fullMatch.startsWith('<!--') || fullMatch.startsWith('<![CDATA')) {
            continue;
        }

        const isClosing = match[1] === '/';
        const rawTagName = match[2];
        const attributeSegment = match[3] ?? '';
        const trailingSlash = match[4] === '/';

        if (!rawTagName) {
            continue;
        }

        const normalizedTag = normalizeTagName(rawTagName);
        const localName = getLocalName(normalizedTag);

        if (isClosing) {
            const closingName = normalizedTag;
            while (stack.length > 0) {
                const last = stack.pop();
                if (last && last.tagName === closingName) {
                    break;
                }
            }
            continue;
        }

        const isSelfClosing = trailingSlash || attributeSegment.trim().endsWith('/');
        const attributes = extractAttributes(attributeSegment);

        const descriptor = resolveComponentDescriptor(normalizedTag);
        const type = descriptor.type;

        componentIndex += 1;

        const rawDisplayName = attributes['doc:name']
            || attributes.name
            || attributes.path
            || attributes.url
            || attributes.host
            || attributes.method
            || attributes.query
            || attributes.target
            || attributes.displayName
            || descriptor.defaultLabel;

        // Enhanced naming logic for better component identification
        let displayName: string;
        if (rawDisplayName && rawDisplayName.trim().length > 0) {
            displayName = rawDisplayName.trim();
        } else {
            // Create more meaningful names based on component type and attributes
            if (type.toLowerCase().includes('listener')) {
                const method = attributes.method || attributes.allowedMethods || 'ANY';
                const path = attributes.path || attributes.url || '/';
                displayName = `${method} ${path}`;
            } else if (type.toLowerCase().includes('request')) {
                const method = attributes.method || 'GET';
                const url = attributes.url || attributes.path || attributes.host || 'endpoint';
                displayName = `${method} ${url}`;
            } else if (type.toLowerCase().includes('response')) {
                const status = attributes.statusCode || '200';
                displayName = `Response ${status}`;
            } else if (type.toLowerCase().includes('transform')) {
                displayName = 'Transform Message';
            } else if (type.toLowerCase().includes('logger')) {
                const message = attributes.message || attributes.category || 'Log Event';
                displayName = `Log: ${message}`;
            } else if (type.toLowerCase().includes('error')) {
                const errorType = attributes.type || 'Error Handler';
                displayName = errorType;
            } else if (type.toLowerCase().includes('choice')) {
                displayName = 'Route Decision';
            } else if (type.toLowerCase().includes('set')) {
                const target = attributes.target || attributes.variableName || 'variable';
                displayName = `Set ${target}`;
            } else {
                displayName = `${type} ${componentIndex}`;
            }
        }

        const component: MuleComponent = {
            id: `comp_${componentIndex}`,
            name: displayName,
            type,
            tagName: normalizedTag,
            configRef: attributes['config-ref'] || attributes.config,
            doc: attributes['doc:description'] || attributes.doc,
            attributes,
            icon: descriptor.icon || getComponentIcon(type),
            children: descriptor.isContainer ? [] : undefined,
            depth: stack.length,
            position: componentIndex,
        };

        const parent = stack.length > 0 ? stack[stack.length - 1].component : undefined;
        if (parent && parent.children) {
            parent.children.push(component);
        } else {
            components.push(component);
        }

        const isContainer = !isSelfClosing
            && (descriptor.isContainer
                || DEFAULT_CONTAINER_TAGS.has(normalizedTag)
                || DEFAULT_CONTAINER_LOCAL_NAMES.has(localName));

        if (isContainer) {
            if (!component.children) {
                component.children = [];
            }
            stack.push({ component, tagName: normalizedTag });
        }
    }

    return components;
}

function extractAttributes(xmlTag: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    
    // Extract attributes using regex
    const attrRegex = /([\w:-]+)\s*=\s*["']([^"']*?)["']/g;
    let match: RegExpExecArray | null;
    
    while ((match = attrRegex.exec(xmlTag)) !== null) {
        attributes[match[1]] = match[2];
    }
    
    return attributes;
}

// Component type to icon mapping
function getComponentIcon(type: string): string {
    const iconMap: Record<string, string> = {
        'Logger': '📝',
        'Transform': '🔄',
        'Transform Message': '🔄',
        'Choice': '🔀',
        'Scatter-Gather': '🌟',
        'Async': '⚡',
        'For Each': '🔁',
        'Parallel For Each': '⚡🔁',
        'Try': '🛡️',
        'Error Handler': '🚨',
        'On Error Continue': '🚨',
        'On Error Propagate': '🚨',
        'Until Successful': '🔄',
        'Set Variable': '📌',
        'Set Payload': '📦',
        'Remove Variable': '🗑️',
        'When': '⚖️',
        'Otherwise': '⚖️',
        'HTTP Listener': '🌐',
        'HTTP Request': '🌐',
        'DB Select': '🗄️',
        'DB Insert': '🗄️➕',
        'DB Update': '🗄️✏️',
        'DB Delete': '🗄️🗑️',
        'File Read': '📁📖',
        'File Write': '📁✏️',
        'File List': '📁📋',
        'SF Create': '☁️➕',
        'SF Query': '☁️🔍',
        'SF Update': '☁️✏️',
        'VM Publish': '📨',
        'VM Consume': '📥',
        'JMS Publish': '📤',
        'JMS Consume': '📥',
        'MQ Publish': '📤',
        'MQ Subscriber': '📨',
        'MQ Consume': '📥',
        'Flow Reference': '🔗',
        'Sub-Flow Reference': '🔗',
        'Batch Job': '🧮',
        'Batch Step': '🧮',
        'Process Records': '🧮',
        'Batch On Complete': '🧮',
        'Batch On Error Continue': '🧮',
        'Batch On Error Propagate': '🧮',
        'Poll': '⏱️',
        'Scheduled': '⏱️',
        'Connector': '🔌',
    };
    
    return iconMap[type] || '⚙️';
}

// Missing helper functions for Mermaid generation
function formatFlowNodeLabel(node: MuleFlowNode): string {
    if (!node || !node.name) {
        return '❓ Unknown Flow';
    }
    
    const icon = node.type === 'sub-flow' ? '🔗' : '⚡';
    const escapedName = escapeMermaidText(node.name);
    
    // Ensure we don't have empty labels
    if (!escapedName || escapedName.trim() === '') {
        return `${icon} Unnamed Flow`;
    }
    
    // Limit label length to prevent diagram issues
    const maxLength = 30;
    const finalName = escapedName.length > maxLength 
        ? escapedName.substring(0, maxLength) + '...'
        : escapedName;
    
    return `${icon} ${finalName}`;
}

function formatComponentLabel(component: MuleComponent): string {
    if (!component || !component.name) {
        return '⚙️ Unknown Component';
    }
    
    const icon = getComponentIcon(component.type || 'unknown');
    const escapedName = escapeMermaidText(component.name);
    
    // Ensure we don't have empty labels
    if (!escapedName || escapedName.trim() === '') {
        return `${icon} Unnamed Component`;
    }
    
    // Limit label length and config ref display
    const maxNameLength = 25;
    const finalName = escapedName.length > maxNameLength 
        ? escapedName.substring(0, maxNameLength) + '...'
        : escapedName;
        
    const configRef = component.configRef && component.configRef.length < 15
        ? ` (${escapeMermaidText(component.configRef)})`
        : '';
        
    return `${icon} ${finalName}${configRef}`;
}

function getComponentShape(component: MuleComponent): { open: string; close: string } {
    // Different shapes based on component type
    const type = component.type.toLowerCase();
    
    if (type.includes('choice') || type.includes('error')) {
        return { open: '{', close: '}' }; // Diamond for decision points
    } else if (type.includes('transform') || type.includes('logger')) {
        return { open: '(', close: ')' }; // Circle for processing
    } else if (type.includes('http') || type.includes('db') || type.includes('file')) {
        return { open: '[[', close: ']]' }; // Subroutine for connectors
    } else if (type.includes('async') || type.includes('scatter')) {
        return { open: '([', close: '])' }; // Stadium for async operations
    } else {
        return { open: '[', close: ']' }; // Rectangle for general components
    }
}

function getComponentClassName(component: MuleComponent): string {
    const type = component.type.toLowerCase();
    const name = component.name.toLowerCase();
    
    if (type.includes('http') || name.includes('http')) {
        return 'httpComponent';
    } else if (type.includes('db') || type.includes('database') || name.includes('database')) {
        return 'dbComponent';
    } else if (type.includes('transform') || name.includes('transform')) {
        return 'transformComponent';
    } else if (type.includes('error') || type.includes('choice') || name.includes('error')) {
        return 'errorComponent';
    } else if (type.includes('logger') || name.includes('log')) {
        return 'loggerComponent';
    } else if (type.includes('api') || name.includes('api') || name.includes('endpoint')) {
        return 'apiComponent';
    } else if (type.includes('security') || type.includes('auth') || name.includes('security')) {
        return 'securityComponent';
    } else if (type.includes('set') || type.includes('variable') || name.includes('variable')) {
        return 'variableComponent';
    } else {
        return 'component';
    }
}
