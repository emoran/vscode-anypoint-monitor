// src/test/suite/fire.logParser.test.ts
// Unit tests for the FIRE log parser.
// These tests run without a VS Code host — pure logic only.

import * as assert from 'assert';
import {
  parseLogEntry,
  isActionableLogEntry,
  extractPayload,
  extractVariables,
  extractAttributes,
  buildExecutionContext,
} from '../../fire/logParser.js';

// ─── Real-world Mule log samples ─────────────────────────────────────────────
// These strings are representative of what CloudHub actually emits.

const SAMPLE_EXPRESSION_ERROR =
  `ERROR 2024-03-15 14:32:01.442 [[MuleRuntime].uber-3] ` +
  `MULE:EXPRESSION at process-order-flow/processors/2/processors/0 ` +
  `(Transform Message): Error evaluating expression: ` +
  `"payload.customerId" - Field 'customerId' not found`;

const SAMPLE_HTTP_ERROR =
  `ERROR 2024-03-15 14:33:10.001 [MuleRuntime].cpuLight.01 ` +
  `HTTP:CONNECTIVITY - Failed to connect to host: api.external.com:443`;

const SAMPLE_WITH_FLOW_LABEL =
  `ERROR 2024-03-15 14:35:00.000 [uber-1] ` +
  `Flow: process-order | Element: transform-message:Transform Message ` +
  `MULE:EXPRESSION something went wrong`;

const SAMPLE_WITH_JSON_PAYLOAD =
  `INFO 2024-03-15 14:31:59.000 [MuleRuntime].uber-3 ` +
  `Request received: {"orderId": "ORD-9921", "amount": 99.99, "currency": "USD"}`;

const SAMPLE_WITH_VARS =
  `DEBUG 2024-03-15 14:32:00.000 [MuleRuntime].uber-3 ` +
  `vars.customerId = CUST-4471, vars.region = US-EAST`;

const SAMPLE_WITH_ATTRS =
  `DEBUG 2024-03-15 14:32:00.000 [MuleRuntime].uber-3 ` +
  `attributes.method = POST, attributes.requestPath = /orders`;

const SAMPLE_INFO_ONLY =
  `INFO 2024-03-15 14:30:00.000 [MuleRuntime].uber-3 ` +
  `Processing request for customer CUST-4471`;

const SAMPLE_EMPTY = ``;

// ─── parseLogEntry ────────────────────────────────────────────────────────────

suite('FIRE › logParser › parseLogEntry', () => {

  test('extracts MULE:EXPRESSION error type', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.strictEqual(result.errorType, 'MULE:EXPRESSION');
  });

  test('extracts flow name from stack trace format', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.strictEqual(result.flowName, 'process-order-flow');
  });

  test('extracts processor path', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.ok(
      result.processorPath?.includes('processors'),
      `Expected processorPath to contain "processors", got: ${result.processorPath}`
    );
  });

  test('extracts thread name', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.ok(
      result.threadName?.includes('MuleRuntime'),
      `Expected threadName to include "MuleRuntime", got: ${result.threadName}`
    );
  });

  test('categorises MULE:EXPRESSION as expression', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.strictEqual(result.category, 'expression');
  });

  test('categorises HTTP:CONNECTIVITY as connectivity', () => {
    const result = parseLogEntry(SAMPLE_HTTP_ERROR);
    assert.strictEqual(result.category, 'connectivity');
  });

  test('confidence is high when errorType + flowName + processorPath all present', () => {
    const result = parseLogEntry(SAMPLE_EXPRESSION_ERROR);
    assert.ok(
      result.confidence >= 0.8,
      `Expected confidence >= 0.8, got: ${result.confidence}`
    );
  });

  test('confidence is low when message is plain INFO', () => {
    const result = parseLogEntry(SAMPLE_INFO_ONLY);
    assert.ok(
      result.confidence < 0.4,
      `Expected confidence < 0.4, got: ${result.confidence}`
    );
  });

  test('extracts flow name from "Flow: X" label format', () => {
    const result = parseLogEntry(SAMPLE_WITH_FLOW_LABEL);
    assert.ok(
      result.flowName !== null,
      'Expected flowName to be non-null for Flow: label format'
    );
  });

  test('extracts element path from "Element: X" label', () => {
    const result = parseLogEntry(SAMPLE_WITH_FLOW_LABEL);
    assert.ok(
      result.elementPath !== null,
      'Expected elementPath to be non-null for Element: label format'
    );
  });

  test('never throws on empty string', () => {
    assert.doesNotThrow(() => parseLogEntry(SAMPLE_EMPTY));
  });

  test('never throws on null-like input', () => {
    assert.doesNotThrow(() => parseLogEntry(null as any));
  });

  test('returns confidence 0 for empty input', () => {
    const result = parseLogEntry(SAMPLE_EMPTY);
    assert.strictEqual(result.confidence, 0);
  });

  test('error message is capped at 500 characters', () => {
    const longMsg = 'MULE:EXPRESSION ' + 'x'.repeat(600);
    const result = parseLogEntry(longMsg);
    assert.ok(
      (result.errorMessage?.length ?? 0) <= 500,
      'Error message should be capped at 500 chars'
    );
  });
});

// ─── isActionableLogEntry ─────────────────────────────────────────────────────

suite('FIRE › logParser › isActionableLogEntry', () => {

  test('returns true for ERROR with Mule error code', () => {
    assert.strictEqual(
      isActionableLogEntry('ERROR', SAMPLE_EXPRESSION_ERROR),
      true
    );
  });

  test('returns true for WARN with Mule error code', () => {
    assert.strictEqual(
      isActionableLogEntry('WARN', SAMPLE_HTTP_ERROR),
      true
    );
  });

test('returns true for INFO level when message contains Mule error with location context', () => {
    // CloudHub emits real Mule errors at INFO priority — FIRE must catch these
    assert.strictEqual(
      isActionableLogEntry('INFO', SAMPLE_EXPRESSION_ERROR),
      true
    );
  });

  test('returns false for plain INFO log', () => {
    assert.strictEqual(
      isActionableLogEntry('INFO', SAMPLE_INFO_ONLY),
      false
    );
  });

  test('returns false for empty message', () => {
    assert.strictEqual(
      isActionableLogEntry('ERROR', ''),
      false
    );
  });

  test('returns true for SALESFORCE: connector error', () => {
    const msg = 'SALESFORCE:CONNECTIVITY at upsert-contact-flow/processors/2 (Upsert Contact): Failed to connect';
    assert.strictEqual(isActionableLogEntry('INFO', msg), true);
  });

  test('returns true for AGGREGATOR: error', () => {
    const msg = 'AGGREGATOR:TIMEOUT at order-aggregator-flow/processors/1 (Aggregator): Timeout reached';
    assert.strictEqual(isActionableLogEntry('INFO', msg), true);
  });

  test('returns true for CloudHub structured block regardless of priority', () => {
    const msg = ' ************************ Error type: SALESFORCE:CONNECTIVITY FlowStack: at salesforce-flow(salesforce-flow/processors/2) ************************';
    assert.strictEqual(isActionableLogEntry('INFO', msg), true);
  });

  test('returns false for plain localhost URL with colon', () => {
    const msg = 'Connecting to database at localhost:5432 - connection established';
    assert.strictEqual(isActionableLogEntry('INFO', msg), false);
  });

  test('returns false for HTTP URL without error context', () => {
    const msg = 'Request received from https://api.example.com:443/orders';
    assert.strictEqual(isActionableLogEntry('INFO', msg), false);
  });
});

// ─── extractPayload ───────────────────────────────────────────────────────────

suite('FIRE › logParser › extractPayload', () => {

  test('extracts valid JSON object from log message', () => {
    const result = extractPayload(SAMPLE_WITH_JSON_PAYLOAD);
    assert.ok(result !== null, 'Expected JSON payload to be extracted');
    const parsed = JSON.parse(result!);
    assert.strictEqual(parsed.orderId, 'ORD-9921');
  });

  test('returns null when no JSON or XML present', () => {
    assert.strictEqual(extractPayload(SAMPLE_INFO_ONLY), null);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(extractPayload(''), null);
  });

  test('ignores invalid JSON and returns null', () => {
    const msg = 'ERROR something { not valid json at all :::';
    assert.strictEqual(extractPayload(msg), null);
  });

  test('extracts largest valid JSON when multiple JSON blobs present', () => {
    const msg = `log {"a":1} and also {"orderId":"ORD-001","amount":50.00,"items":[1,2,3]}`;
    const result = extractPayload(msg);
    assert.ok(result !== null);
    const parsed = JSON.parse(result!);
    assert.strictEqual(parsed.orderId, 'ORD-001');
  });
});

// ─── extractVariables ────────────────────────────────────────────────────────

suite('FIRE › logParser › extractVariables', () => {

  test('extracts vars.* key-value pairs', () => {
    const result = extractVariables(SAMPLE_WITH_VARS);
    assert.strictEqual(result['customerId'], 'CUST-4471');
    assert.strictEqual(result['region'], 'US-EAST');
  });

  test('returns empty object when no vars present', () => {
    const result = extractVariables(SAMPLE_INFO_ONLY);
    assert.deepStrictEqual(result, {});
  });

  test('returns empty object for empty string', () => {
    assert.deepStrictEqual(extractVariables(''), {});
  });
});

// ─── extractAttributes ───────────────────────────────────────────────────────

suite('FIRE › logParser › extractAttributes', () => {

  test('extracts attributes.* key-value pairs', () => {
    const result = extractAttributes(SAMPLE_WITH_ATTRS);
    assert.strictEqual(result['method'], 'POST');
    assert.strictEqual(result['requestPath'], '/orders');
  });

  test('returns empty object when no attributes present', () => {
    assert.deepStrictEqual(extractAttributes(SAMPLE_INFO_ONLY), {});
  });
});

// ─── buildExecutionContext ────────────────────────────────────────────────────

suite('FIRE › logParser › buildExecutionContext', () => {

  const threadEntries = [
    { priority: 'INFO',  message: SAMPLE_WITH_JSON_PAYLOAD, timestamp: 1710000000000 },
    { priority: 'DEBUG', message: SAMPLE_WITH_VARS,         timestamp: 1710000001000 },
    { priority: 'ERROR', message: SAMPLE_EXPRESSION_ERROR,  timestamp: 1710000002000 },
  ];

  test('returns ExecutionContext when a failing entry is present', () => {
    const ctx = buildExecutionContext(threadEntries, 'my-api');
    assert.ok(ctx !== null, 'Expected a non-null ExecutionContext');
  });

  test('sets applicationDomain correctly', () => {
    const ctx = buildExecutionContext(threadEntries, 'my-api');
    assert.strictEqual(ctx?.applicationDomain, 'my-api');
  });

  test('extracts payload from earlier INFO entry in same thread', () => {
    const ctx = buildExecutionContext(threadEntries, 'my-api');
    assert.ok(ctx?.rawPayload !== null, 'Expected rawPayload to be extracted from INFO entry');
  });

  test('extracts variables from DEBUG entry in same thread', () => {
    const ctx = buildExecutionContext(threadEntries, 'my-api');
    assert.ok(
      ctx?.variables['customerId'] === 'CUST-4471',
      'Expected customerId variable to be extracted'
    );
  });

  test('returns null when no actionable entry in batch', () => {
    const infoOnly = [
      { priority: 'INFO', message: SAMPLE_INFO_ONLY, timestamp: 1710000000000 },
    ];
    const ctx = buildExecutionContext(infoOnly, 'my-api');
    assert.strictEqual(ctx, null);
  });

  test('returns null for empty entries array', () => {
    assert.strictEqual(buildExecutionContext([], 'my-api'), null);
  });
});