import * as assert from 'assert';

import { parseMuleProject, MuleProject } from '../utils/muleProject';
import { buildHeuristicNarrative } from '../utils/muleProjectSummary';

const MULE_NS = 'xmlns="http://www.mulesoft.org/schema/mule/core"';
const HTTP_NS = 'xmlns:http="http://www.mulesoft.org/schema/mule/http"';
const DB_NS = 'xmlns:db="http://www.mulesoft.org/schema/mule/db"';
const SF_NS = 'xmlns:salesforce="http://www.mulesoft.org/schema/mule/salesforce"';
const MQ_NS = 'xmlns:anypoint-mq="http://www.mulesoft.org/schema/mule/anypoint-mq"';
const APIKIT_NS = 'xmlns:apikit="http://www.mulesoft.org/schema/mule/mule-apikit"';

function project(files: Record<string, string>): MuleProject {
    return parseMuleProject({ files });
}

suite('Mule project parser', () => {
    test('parses flows and resolves flow-ref edges across files', () => {
        const p = project({
            'src/main/mule/order.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS}>
                    <flow name="OrderFlow">
                        <flow-ref name="CheckStock"/>
                        <logger message="done"/>
                    </flow>
                </mule>`,
            'src/main/mule/stock.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS}>
                    <sub-flow name="CheckStock">
                        <flow-ref name="Notify"/>
                    </sub-flow>
                    <flow name="Notify"/>
                </mule>`,
        });

        const allNames = p.flows.concat(p.subFlows).map(f => f.name).sort();
        assert.deepStrictEqual(allNames, ['CheckStock', 'Notify', 'OrderFlow']);
        assert.strictEqual(p.flows.length, 2);
        assert.strictEqual(p.subFlows.length, 1);

        const edgePairs = p.edges.map(e => `${e.from}->${e.to}`);
        const orderId = p.flows.find(f => f.name === 'OrderFlow')!.id;
        const stockId = p.subFlows.find(f => f.name === 'CheckStock')!.id;
        const notifyId = p.flows.find(f => f.name === 'Notify')!.id;
        assert.ok(edgePairs.includes(`${orderId}->${stockId}`), `missing OrderFlow->CheckStock; got: ${edgePairs.join(', ')}`);
        assert.ok(edgePairs.includes(`${stockId}->${notifyId}`), `missing CheckStock->Notify; got: ${edgePairs.join(', ')}`);
    });

    test('extracts http listeners with method and path', () => {
        const p = project({
            'src/main/mule/api.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${HTTP_NS}>
                    <http:listener-config name="HTTP_Listener_config">
                        <http:listener-connection host="0.0.0.0" port="8081"/>
                    </http:listener-config>
                    <flow name="post-orders">
                        <http:listener config-ref="HTTP_Listener_config" path="/api/orders" allowedMethods="POST"/>
                        <logger/>
                    </flow>
                </mule>`,
        });

        assert.strictEqual(p.listeners.length, 1);
        const l = p.listeners[0];
        assert.strictEqual(l.method, 'POST');
        assert.strictEqual(l.path, '/api/orders');
        assert.strictEqual(l.flowName, 'post-orders');
        assert.strictEqual(l.configRef, 'HTTP_Listener_config');

        const http = p.connectorConfigs.find(c => c.localName === 'listener-config');
        assert.ok(http, 'HTTP listener-config should be detected');
        assert.strictEqual(http!.kind, 'http');
    });

    test('extracts schedulers (cron + fixed-frequency)', () => {
        const p = project({
            'src/main/mule/schedules.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS}>
                    <flow name="cron-flow">
                        <scheduler>
                            <scheduling-strategy>
                                <cron expression="0 0/5 * * * ?"/>
                            </scheduling-strategy>
                        </scheduler>
                        <logger/>
                    </flow>
                    <flow name="fixed-flow">
                        <scheduler>
                            <scheduling-strategy>
                                <fixed-frequency frequency="30" timeUnit="SECONDS"/>
                            </scheduling-strategy>
                        </scheduler>
                        <logger/>
                    </flow>
                </mule>`,
        });

        assert.strictEqual(p.schedulers.length, 2);
        const cron = p.schedulers.find(s => s.kind === 'cron');
        assert.ok(cron);
        assert.strictEqual(cron!.expression, '0 0/5 * * * ?');
        assert.strictEqual(cron!.flowName, 'cron-flow');

        const fixed = p.schedulers.find(s => s.kind === 'fixed-frequency');
        assert.ok(fixed);
        assert.strictEqual(fixed!.frequency, '30');
        assert.strictEqual(fixed!.timeUnit, 'SECONDS');
    });

    test('detects connector operations across multiple namespaces', () => {
        const p = project({
            'src/main/mule/integration.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${DB_NS} ${SF_NS} ${MQ_NS}>
                    <db:config name="postgres-config"/>
                    <salesforce:config name="sfdc-config"/>
                    <anypoint-mq:config name="mq-config"/>
                    <flow name="process-order">
                        <db:select config-ref="postgres-config">
                            <db:sql>SELECT id, name FROM customers WHERE id = :id</db:sql>
                        </db:select>
                        <salesforce:create config-ref="sfdc-config" type="Account"/>
                        <anypoint-mq:publish config-ref="mq-config" destination="orders.out"/>
                    </flow>
                    <flow name="consume-orders">
                        <anypoint-mq:subscriber config-ref="mq-config" destination="orders.in"/>
                        <logger/>
                    </flow>
                </mule>`,
        });

        const ops = p.connectorOperations;
        const dbOp = ops.find(o => o.kind === 'database' && o.operation === 'select');
        assert.ok(dbOp, `expected db:select op, got: ${ops.map(o => o.kind + ':' + o.operation).join(', ')}`);
        assert.ok(dbOp!.detail && dbOp!.detail.includes('SELECT id'));
        assert.strictEqual(dbOp!.configRef, 'postgres-config');

        const sfOp = ops.find(o => o.kind === 'salesforce');
        assert.ok(sfOp);
        assert.strictEqual(sfOp!.detail, 'Account');

        const mqPublish = ops.find(o => o.operation === 'publish');
        assert.ok(mqPublish);
        assert.strictEqual(mqPublish!.direction, 'out');

        const mqSubscriber = ops.find(o => o.operation === 'subscriber');
        assert.ok(mqSubscriber);
        assert.strictEqual(mqSubscriber!.direction, 'in');

        // External systems summary should include database, salesforce, anypoint-mq
        const sysKinds = p.summary.externalSystems.map(s => s.kind).sort();
        assert.ok(sysKinds.includes('database'));
        assert.ok(sysKinds.includes('salesforce'));
        assert.ok(sysKinds.includes('anypoint-mq'));
    });

    test('detects APIkit routes from generated flow names', () => {
        const p = project({
            'src/main/mule/api.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${APIKIT_NS}>
                    <apikit:config name="my-api-config" raml="api.raml"/>
                    <flow name="get:\\customers:my-api-config">
                        <logger/>
                    </flow>
                    <flow name="post:\\customers:my-api-config">
                        <logger/>
                    </flow>
                </mule>`,
        });

        // The APIkit config gets registered with empty resource/method initially,
        // plus the two derived routes from the flow names.
        const realRoutes = p.apiKitRoutes.filter(r => r.method && r.resource);
        assert.strictEqual(realRoutes.length, 2);

        const get = realRoutes.find(r => r.method === 'GET');
        assert.ok(get);
        assert.strictEqual(get!.resource, '/customers');
        assert.strictEqual(get!.apiConfig, 'my-api-config');

        const post = realRoutes.find(r => r.method === 'POST');
        assert.ok(post);
        assert.strictEqual(post!.resource, '/customers');
    });

    test('parses .properties files into the inventory', () => {
        const p = project({
            'src/main/resources/dev.properties': `
# comment
db.host=localhost
db.port=5432
api.path = /api/v1
`,
            'src/main/mule/empty.xml': `<?xml version="1.0"?><mule ${MULE_NS}/>`,
        });

        assert.deepStrictEqual(p.properties.propertiesFiles, ['src/main/resources/dev.properties']);
        assert.strictEqual(p.properties.values['db.host'], 'localhost');
        assert.strictEqual(p.properties.values['db.port'], '5432');
        assert.strictEqual(p.properties.values['api.path'], '/api/v1');
        assert.strictEqual(p.summary.propertyFiles.keys, 3);
    });

    test('parses simple YAML property files (nested keys flattened)', () => {
        const p = project({
            'src/main/resources/config.yaml': `
db:
  host: prod.example.com
  port: 5432
api:
  path: "/api/v2"
`,
            'src/main/mule/empty.xml': `<?xml version="1.0"?><mule ${MULE_NS}/>`,
        });

        assert.strictEqual(p.properties.values['db.host'], 'prod.example.com');
        assert.strictEqual(p.properties.values['db.port'], '5432');
        assert.strictEqual(p.properties.values['api.path'], '/api/v2');
    });

    test('inventories DataWeave files with version + output', () => {
        const p = project({
            'src/main/resources/dwl/transform.dwl': `// transform input to output
%dw 2.0
output application/json
---
payload`,
            'src/main/mule/empty.xml': `<?xml version="1.0"?><mule ${MULE_NS}/>`,
        });

        assert.strictEqual(p.dataweaveFiles.length, 1);
        const dw = p.dataweaveFiles[0];
        assert.strictEqual(dw.version, '2.0');
        assert.strictEqual(dw.output, 'application/json');
        assert.strictEqual(dw.description, 'transform input to output');
    });

    test('parses pom.xml dependencies and infers connector kinds', () => {
        const p = project({
            'pom.xml': `<?xml version="1.0"?>
                <project xmlns="http://maven.apache.org/POM/4.0.0">
                    <dependencies>
                        <dependency>
                            <groupId>org.mule.connectors</groupId>
                            <artifactId>mule-salesforce-connector</artifactId>
                            <version>11.0.0</version>
                        </dependency>
                        <dependency>
                            <groupId>org.mule.connectors</groupId>
                            <artifactId>mule-db-connector</artifactId>
                            <version>1.14.0</version>
                        </dependency>
                    </dependencies>
                </project>`,
            'src/main/mule/empty.xml': `<?xml version="1.0"?><mule ${MULE_NS}/>`,
        });

        assert.strictEqual(p.pomDependencies.length, 2);
        const sfdc = p.pomDependencies.find(d => d.artifactId.includes('salesforce'));
        assert.ok(sfdc);
        assert.strictEqual(sfdc!.kind, 'salesforce');

        const db = p.pomDependencies.find(d => d.artifactId.includes('db'));
        assert.ok(db);
        assert.strictEqual(db!.kind, 'database');
    });

    test('summary builds entry-points + external-systems counts', () => {
        const p = project({
            'src/main/mule/app.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${HTTP_NS} ${DB_NS}>
                    <db:config name="orders-db"/>
                    <flow name="api-flow">
                        <http:listener path="/orders" allowedMethods="GET"/>
                        <db:select config-ref="orders-db">
                            <db:sql>SELECT * FROM orders</db:sql>
                        </db:select>
                    </flow>
                    <flow name="schedule-flow">
                        <scheduler>
                            <scheduling-strategy>
                                <fixed-frequency frequency="60" timeUnit="SECONDS"/>
                            </scheduling-strategy>
                        </scheduler>
                        <logger/>
                    </flow>
                </mule>`,
        });

        const eps = p.summary.entryPoints;
        assert.ok(eps.some(e => e.kind === 'http' && e.label === 'GET /orders'));
        assert.ok(eps.some(e => e.kind === 'scheduler' && e.label.includes('60')));

        const dbSys = p.summary.externalSystems.find(s => s.kind === 'database');
        assert.ok(dbSys);
        assert.strictEqual(dbSys!.usageCount, 1);
        assert.ok(dbSys!.configs.includes('orders-db'));
    });

    test('heuristic narrative is non-empty and mentions detected systems', () => {
        const p = project({
            'src/main/mule/app.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${HTTP_NS} ${SF_NS}>
                    <salesforce:config name="sfdc"/>
                    <flow name="api-flow">
                        <http:listener path="/orders" allowedMethods="POST"/>
                        <salesforce:create config-ref="sfdc" type="Account"/>
                    </flow>
                </mule>`,
        });

        const narrative = buildHeuristicNarrative(p);
        assert.strictEqual(narrative.source, 'heuristic');
        assert.ok(narrative.text.length > 0);
        assert.ok(/HTTP|endpoint/i.test(narrative.text), `expected entry-point mention; got: ${narrative.text}`);
        assert.ok(/Salesforce/i.test(narrative.text), `expected Salesforce mention; got: ${narrative.text}`);
    });

    test('resolves ${prop} placeholders in listener paths and op details', () => {
        const p = project({
            'src/main/resources/dev.properties': `api.path=/api/v3
mq.queue=orders.in
`,
            'src/main/mule/app.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${HTTP_NS} ${MQ_NS}>
                    <flow name="api-flow">
                        <http:listener path="\${api.path}" allowedMethods="GET"/>
                    </flow>
                    <flow name="consumer-flow">
                        <anypoint-mq:subscriber destination="\${mq.queue}"/>
                    </flow>
                </mule>`,
        });

        // Listener path should be resolved to the actual property value
        const listener = p.listeners[0];
        assert.strictEqual(listener.path, '/api/v3', `expected resolved path; got ${listener.path}`);

        // MQ subscriber detail should be resolved
        const subOp = p.connectorOperations.find(o => o.operation === 'subscriber');
        assert.ok(subOp);
        assert.strictEqual(subOp!.detail, 'dest: orders.in', `expected resolved detail; got ${subOp!.detail}`);
    });

    test('leaves unresolved ${prop} placeholders intact', () => {
        const p = project({
            'src/main/mule/app.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS} ${HTTP_NS}>
                    <flow name="api-flow">
                        <http:listener path="\${unknown.key}"/>
                    </flow>
                </mule>`,
        });
        assert.strictEqual(p.listeners[0].path, '${unknown.key}');
    });

    test('returns empty project gracefully when no Mule files are present', () => {
        const p = project({
            'README.md': '# Just a readme',
        });
        assert.strictEqual(p.flows.length, 0);
        assert.strictEqual(p.subFlows.length, 0);
        assert.strictEqual(p.summary.entryPoints.length, 0);
    });

    test('skips malformed XML without aborting the whole project', () => {
        const p = project({
            'src/main/mule/broken.xml': '<mule><flow name="oops"', // unterminated
            'src/main/mule/ok.xml': `<?xml version="1.0"?>
                <mule ${MULE_NS}>
                    <flow name="OkFlow"><logger/></flow>
                </mule>`,
        });

        // The good file should still produce a flow.
        assert.ok(p.flows.some(f => f.name === 'OkFlow'));
    });
});
