import * as path from 'path';

export type MuleFlowType = 'flow' | 'sub-flow' | 'unknown';

export interface MuleComponent {
    id: string;
    name: string;
    type: string;
    configRef?: string;
    doc?: string;
    attributes?: Record<string, string>;
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
    const lines: string[] = ['graph TD'];

    // Add subgraphs for different files to improve organization
    const fileGroups = groupNodesByFile(graph.nodes);
    
    Object.entries(fileGroups).forEach(([filePath, nodes], index) => {
        if (nodes.length > 1 && filePath !== 'unknown') {
            const fileName = path.basename(filePath, '.xml');
            const subgraphId = `subgraph${index}`;
            lines.push(`subgraph ${subgraphId}["📄 ${fileName}"]`);
            
            nodes.forEach(node => {
                // Create a subgraph for each flow with its components
                const flowSubgraphId = `flow_${node.id}`;
                lines.push(`subgraph ${flowSubgraphId}["${node.name}"]`);
                
                // Add the main flow node
                const flowLabel = formatFlowNodeLabel(node);
                const flowShape = getNodeShape(node);
                lines.push(`${node.id}${flowShape.open}${flowLabel}${flowShape.close}`);
                
                // Add internal components
                if (node.components.length > 0) {
                    node.components.forEach((component, compIndex) => {
                        const compId = `${node.id}_${component.id}`;
                        const compLabel = formatComponentLabel(component);
                        const compShape = getComponentShape(component);
                        lines.push(`${compId}${compShape.open}${compLabel}${compShape.close}`);
                        
                        // Connect components in sequence (simplified)
                        if (compIndex === 0) {
                            lines.push(`${node.id} --> ${compId}`);
                        } else {
                            const prevCompId = `${node.id}_${node.components[compIndex - 1].id}`;
                            lines.push(`${prevCompId} --> ${compId}`);
                        }
                    });
                }
                
                lines.push('end');
            });
            
            lines.push('end');
        } else {
            // Single nodes or unknown files
            nodes.forEach(node => {
                // Create a subgraph for each flow with its components
                const flowSubgraphId = `flow_${node.id}`;
                lines.push(`subgraph ${flowSubgraphId}["${node.name}"]`);
                
                // Add the main flow node
                const flowLabel = formatFlowNodeLabel(node);
                const flowShape = getNodeShape(node);
                lines.push(`${node.id}${flowShape.open}${flowLabel}${flowShape.close}`);
                
                // Add internal components
                if (node.components.length > 0) {
                    node.components.forEach((component, compIndex) => {
                        const compId = `${node.id}_${component.id}`;
                        const compLabel = formatComponentLabel(component);
                        const compShape = getComponentShape(component);
                        lines.push(`${compId}${compShape.open}${compLabel}${compShape.close}`);
                        
                        // Connect components in sequence (simplified)
                        if (compIndex === 0) {
                            lines.push(`${node.id} --> ${compId}`);
                        } else {
                            const prevCompId = `${node.id}_${node.components[compIndex - 1].id}`;
                            lines.push(`${prevCompId} --> ${compId}`);
                        }
                    });
                }
                
                lines.push('end');
            });
        }
    });

    // Enhanced edges with different styles
    graph.edges.forEach(edge => {
        const sourceNode = graph.nodes.find(n => n.id === edge.from);
        const targetNode = graph.nodes.find(n => n.id === edge.to);
        
        // Different arrow styles based on flow types
        if (sourceNode?.type === 'flow' && targetNode?.type === 'sub-flow') {
            lines.push(`${edge.from} -.-> ${edge.to}`); // Dotted for flow->subflow
        } else if (edge.sourceFile !== edge.targetFile) {
            lines.push(`${edge.from} ===> ${edge.to}`); // Thick for cross-file
        } else {
            lines.push(`${edge.from} --> ${edge.to}`); // Normal for same-file
        }
    });

    // Enhanced styling with gradients and modern colors
    lines.push('classDef flow fill:#4f46e5,stroke:#312e81,stroke-width:2px,color:#ffffff,font-weight:bold;');
    lines.push('classDef subflow fill:#f59e0b,stroke:#92400e,stroke-width:2px,color:#ffffff,font-weight:bold;');
    lines.push('classDef unknown fill:#6b7280,stroke:#374151,stroke-width:2px,color:#ffffff;');
    lines.push('classDef apiflow fill:#10b981,stroke:#047857,stroke-width:2px,color:#ffffff,font-weight:bold;');
    lines.push('classDef errorflow fill:#ef4444,stroke:#b91c1c,stroke-width:2px,color:#ffffff,font-weight:bold;');
    
    // Component styles
    lines.push('classDef component fill:#e5e7eb,stroke:#6b7280,stroke-width:1px,color:#374151,font-size:11px;');
    lines.push('classDef httpComponent fill:#3b82f6,stroke:#1e40af,stroke-width:1px,color:#ffffff,font-size:11px;');
    lines.push('classDef dbComponent fill:#10b981,stroke:#047857,stroke-width:1px,color:#ffffff,font-size:11px;');
    lines.push('classDef transformComponent fill:#f59e0b,stroke:#92400e,stroke-width:1px,color:#ffffff,font-size:11px;');
    lines.push('classDef errorComponent fill:#ef4444,stroke:#b91c1c,stroke-width:1px,color:#ffffff,font-size:11px;');

    graph.nodes.forEach(node => {
        const className = getNodeClassName(node);
        lines.push(`class ${node.id} ${className};`);
        
        // Apply component styles
        node.components.forEach(component => {
            const compId = `${node.id}_${component.id}`;
            const compClassName = getComponentClassName(component);
            lines.push(`class ${compId} ${compClassName};`);
        });
    });

    return lines.join('\n');
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
    const defs: FlowDefinition[] = [];
    let match: RegExpExecArray | null;

    while ((match = FLOW_OPEN_TAG.exec(content)) !== null) {
        const tagType = match[1] as MuleFlowType;
        const name = match[2];
        const type: MuleFlowType = tagType === 'sub-flow' ? 'sub-flow' : 'flow';

        const openTagEnd = match.index + match[0].length;
        const closingTag = `</${tagType}>`;
        const closeIndex = content.indexOf(closingTag, openTagEnd);
        const body = closeIndex !== -1
            ? content.substring(openTagEnd, closeIndex)
            : content.substring(openTagEnd);

        const components = extractComponentsFromFlowBody(body);
        
        defs.push({
            name,
            type,
            body,
            filePath,
            components,
        });

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
    const base = raw.replace(/[^a-zA-Z0-9_]/g, '_');
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
    return text.replace(/"/g, '\\"');
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
    const components: MuleComponent[] = [];
    let componentIndex = 0;

    // Common Mule component patterns
    const componentPatterns = [
        // Core components
        { regex: /<logger\b[^>]*(?:\/>|>[\s\S]*?<\/logger>)/gi, type: 'Logger', icon: '📝' },
        { regex: /<transform\b[^>]*(?:\/>|>[\s\S]*?<\/transform>)/gi, type: 'Transform', icon: '🔄' },
        { regex: /<choice\b[^>]*(?:\/>|>[\s\S]*?<\/choice>)/gi, type: 'Choice', icon: '🔀' },
        { regex: /<scatter-gather\b[^>]*(?:\/>|>[\s\S]*?<\/scatter-gather>)/gi, type: 'Scatter-Gather', icon: '🌟' },
        { regex: /<async\b[^>]*(?:\/>|>[\s\S]*?<\/async>)/gi, type: 'Async', icon: '⚡' },
        { regex: /<foreach\b[^>]*(?:\/>|>[\s\S]*?<\/foreach>)/gi, type: 'For Each', icon: '🔁' },
        { regex: /<parallel-foreach\b[^>]*(?:\/>|>[\s\S]*?<\/parallel-foreach>)/gi, type: 'Parallel For Each', icon: '⚡🔁' },
        { regex: /<try\b[^>]*(?:\/>|>[\s\S]*?<\/try>)/gi, type: 'Try', icon: '🛡️' },
        { regex: /<error-handler\b[^>]*(?:\/>|>[\s\S]*?<\/error-handler>)/gi, type: 'Error Handler', icon: '🚨' },
        { regex: /<until-successful\b[^>]*(?:\/>|>[\s\S]*?<\/until-successful>)/gi, type: 'Until Successful', icon: '🔄' },
        { regex: /<set-variable\b[^>]*(?:\/>|>[\s\S]*?<\/set-variable>)/gi, type: 'Set Variable', icon: '📌' },
        { regex: /<set-payload\b[^>]*(?:\/>|>[\s\S]*?<\/set-payload>)/gi, type: 'Set Payload', icon: '📦' },
        { regex: /<remove-variable\b[^>]*(?:\/>|>[\s\S]*?<\/remove-variable>)/gi, type: 'Remove Variable', icon: '🗑️' },
        
        // HTTP components
        { regex: /<http:listener\b[^>]*(?:\/>|>[\s\S]*?<\/http:listener>)/gi, type: 'HTTP Listener', icon: '🌐' },
        { regex: /<http:request\b[^>]*(?:\/>|>[\s\S]*?<\/http:request>)/gi, type: 'HTTP Request', icon: '🌐' },
        
        // Database components
        { regex: /<db:select\b[^>]*(?:\/>|>[\s\S]*?<\/db:select>)/gi, type: 'DB Select', icon: '🗄️' },
        { regex: /<db:insert\b[^>]*(?:\/>|>[\s\S]*?<\/db:insert>)/gi, type: 'DB Insert', icon: '🗄️➕' },
        { regex: /<db:update\b[^>]*(?:\/>|>[\s\S]*?<\/db:update>)/gi, type: 'DB Update', icon: '🗄️✏️' },
        { regex: /<db:delete\b[^>]*(?:\/>|>[\s\S]*?<\/db:delete>)/gi, type: 'DB Delete', icon: '🗄️🗑️' },
        
        // File components
        { regex: /<file:read\b[^>]*(?:\/>|>[\s\S]*?<\/file:read>)/gi, type: 'File Read', icon: '📁📖' },
        { regex: /<file:write\b[^>]*(?:\/>|>[\s\S]*?<\/file:write>)/gi, type: 'File Write', icon: '📁✏️' },
        { regex: /<file:list\b[^>]*(?:\/>|>[\s\S]*?<\/file:list>)/gi, type: 'File List', icon: '📁📋' },
        
        // Salesforce components
        { regex: /<salesforce:create\b[^>]*(?:\/>|>[\s\S]*?<\/salesforce:create>)/gi, type: 'SF Create', icon: '☁️➕' },
        { regex: /<salesforce:query\b[^>]*(?:\/>|>[\s\S]*?<\/salesforce:query>)/gi, type: 'SF Query', icon: '☁️🔍' },
        { regex: /<salesforce:update\b[^>]*(?:\/>|>[\s\S]*?<\/salesforce:update>)/gi, type: 'SF Update', icon: '☁️✏️' },
        
        // VM components
        { regex: /<vm:publish\b[^>]*(?:\/>|>[\s\S]*?<\/vm:publish>)/gi, type: 'VM Publish', icon: '📨' },
        { regex: /<vm:consume\b[^>]*(?:\/>|>[\s\S]*?<\/vm:consume>)/gi, type: 'VM Consume', icon: '📥' },
        
        // JMS components
        { regex: /<jms:publish\b[^>]*(?:\/>|>[\s\S]*?<\/jms:publish>)/gi, type: 'JMS Publish', icon: '📤' },
        { regex: /<jms:consume\b[^>]*(?:\/>|>[\s\S]*?<\/jms:consume>)/gi, type: 'JMS Consume', icon: '📥' },
        
        // Flow refs (already handled separately, but included for completeness)
        { regex: /<flow-ref\b[^>]*(?:\/>|>[\s\S]*?<\/flow-ref>)/gi, type: 'Flow Reference', icon: '🔗' },
        { regex: /<sub-flow-ref\b[^>]*(?:\/>|>[\s\S]*?<\/sub-flow-ref>)/gi, type: 'Sub-Flow Reference', icon: '🔗' },
    ];

    componentPatterns.forEach(pattern => {
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(body)) !== null) {
            const fullMatch = match[0];
            const attributes = extractAttributes(fullMatch);
            
            componentIndex++;
            components.push({
                id: `comp_${componentIndex}`,
                name: attributes.name || attributes['doc:name'] || `${pattern.type} ${componentIndex}`,
                type: pattern.type,
                configRef: attributes.config || attributes['config-ref'],
                doc: attributes.doc || attributes['doc:description'],
                attributes
            });
        }
        
        // Reset regex state
        pattern.regex.lastIndex = 0;
    });

    return components.sort((a, b) => {
        // Sort by position in the original text (approximate)
        const aPos = body.indexOf(a.name) || 0;
        const bPos = body.indexOf(b.name) || 0;
        return aPos - bPos;
    });
}

function extractAttributes(xmlTag: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    
    // Extract attributes using regex
    const attrRegex = /(\w+(?::\w+)?)\s*=\s*["']([^"']*?)["']/g;
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
        'Choice': '🔀',
        'Scatter-Gather': '🌟',
        'Async': '⚡',
        'For Each': '🔁',
        'Parallel For Each': '⚡🔁',
        'Try': '🛡️',
        'Error Handler': '🚨',
        'Until Successful': '🔄',
        'Set Variable': '📌',
        'Set Payload': '📦',
        'Remove Variable': '🗑️',
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
        'Flow Reference': '🔗',
        'Sub-Flow Reference': '🔗',
    };
    
    return iconMap[type] || '⚙️';
}

// Missing helper functions for Mermaid generation
function formatFlowNodeLabel(node: MuleFlowNode): string {
    const icon = node.type === 'sub-flow' ? '🔗' : '⚡';
    const escapedName = escapeMermaidText(node.name);
    return `${icon} ${escapedName}`;
}

function formatComponentLabel(component: MuleComponent): string {
    const icon = getComponentIcon(component.type);
    const escapedName = escapeMermaidText(component.name);
    const configRef = component.configRef ? ` (${component.configRef})` : '';
    return `${icon} ${escapedName}${configRef}`;
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
    
    if (type.includes('http')) {
        return 'httpComponent';
    } else if (type.includes('db') || type.includes('database')) {
        return 'dbComponent';
    } else if (type.includes('transform')) {
        return 'transformComponent';
    } else if (type.includes('error') || type.includes('choice')) {
        return 'errorComponent';
    } else {
        return 'component';
    }
}
