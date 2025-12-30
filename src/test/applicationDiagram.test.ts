import * as assert from 'assert';

import {
    buildMuleFlowGraph,
    buildMermaidDefinition,
    selectRelevantXmlEntries
} from '../utils/muleDiagram';

suite('Mule diagram utilities', () => {
    test('constructs flow graph from Mule XML files', () => {
        const files = {
            'src/main/mule/order.xml': `
                <mule>
                    <flow name="OrderFlow">
                        <flow-ref name="CheckStock" />
                    </flow>
                </mule>
            `,
            'src/main/mule/stock.xml': `
                <mule>
                    <sub-flow name="CheckStock">
                        <flow-ref name="Notify" />
                    </sub-flow>
                    <flow name="Notify" />
                </mule>
            `
        };

        const graph = buildMuleFlowGraph(files);
        const flowNames = graph.nodes.map(node => node.name);

        assert.strictEqual(graph.nodes.length, 3);
        assert.ok(flowNames.includes('OrderFlow'));
        assert.ok(flowNames.includes('CheckStock'));
        assert.ok(flowNames.includes('Notify'));

        const edges = graph.edges.map(edge => `${edge.from}->${edge.to}`);
        assert.strictEqual(edges.length, 2);
        assert.ok(edges.some(edge => edge.includes('OrderFlow') && edge.includes('CheckStock')));
        assert.ok(edges.some(edge => edge.includes('CheckStock') && edge.includes('Notify')));
    });

    test('produces mermaid definition with styled classes', () => {
        const graph = buildMuleFlowGraph({
            'mule-config.xml': `
                <mule>
                    <flow name="Root">
                        <flow-ref name="Child" />
                    </flow>
                    <sub-flow name="Child" />
                </mule>
            `
        });

        const definition = buildMermaidDefinition(graph);
        assert.ok(definition.includes('graph TD'));
        assert.ok(definition.includes('classDef flow'));
        assert.ok(definition.includes('classDef subflow'));
    });

    test('filters relevant XML entries while ignoring meta-inf', () => {
        const entries = selectRelevantXmlEntries([
            { path: 'src/main/mule/order.xml', content: '<xml />' },
            { path: 'META-INF/mule-artifact/mule-artifact.xml', content: '<xml />' },
            { path: 'lib/other.txt', content: 'noop' }
        ]);

        assert.strictEqual(Object.keys(entries).length, 1);
        assert.ok(entries['src/main/mule/order.xml']);
    });
});
