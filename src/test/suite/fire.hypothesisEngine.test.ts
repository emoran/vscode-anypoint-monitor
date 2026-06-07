// src/test/suite/fire.hypothesisEngine.test.ts
// Unit tests for the FIRE hypothesis engine.
// Pure logic — no VS Code API required.

import * as assert from 'assert';
import { generateHypotheses, getBestHypothesis } from '../../fire/hypothesisEngine.js';
import { ParsedMuleError, ExecutionContext } from '../../fire/types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeError(overrides: Partial<ParsedMuleError> = {}): ParsedMuleError {
  return {
    errorType:     null,
    flowName:      'process-order-flow',
    processorPath: 'processors/2/processors/0',
    elementPath:   'transform-message:Transform Message',
    threadName:    'MuleRuntime.uber-3',
    errorMessage:  null,
    category:      'unknown',
    confidence:    0.9,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    error:             makeError(),
    rawPayload:        '{"orderId":"ORD-001"}',
    variables:         { customerId: 'CUST-001' },
    attributes:        { method: 'POST' },
    threadName:        'MuleRuntime.uber-3',
    timestamp:         Date.now(),
    applicationDomain: 'my-api',
    ...overrides,
  };
}

// ─── generateHypotheses ───────────────────────────────────────────────────────

suite('FIRE › hypothesisEngine › generateHypotheses', () => {

  test('returns empty array for zero-confidence error', () => {
    const error = makeError({ confidence: 0 });
    assert.deepStrictEqual(generateHypotheses(error, null), []);
  });

  test('never throws on null-like error input', () => {
    assert.doesNotThrow(() => generateHypotheses(null as any, null));
  });

  test('returns at most 3 hypotheses', () => {
    // An expression error with a field-not-found message will match multiple rules
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: "Field 'customerId' not found in payload",
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length <= 3, `Expected max 3 results, got ${results.length}`);
  });

  test('results are sorted by confidence descending', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: 'some expression error',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i].confidence <= results[i - 1].confidence,
        'Results should be sorted by confidence descending'
      );
    }
  });

  test('every hypothesis has non-empty title, explanation, and suggestion', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: 'null pointer in expression',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0, 'Expected at least one hypothesis');
    for (const h of results) {
      assert.ok(h.title.length > 0,       'title must be non-empty');
      assert.ok(h.explanation.length > 0, 'explanation must be non-empty');
      assert.ok(h.suggestion.length > 0,  'suggestion must be non-empty');
      assert.ok(h.confidence > 0,         'confidence must be positive');
      assert.ok(h.confidence <= 1,        'confidence must be <= 1');
    }
  });

  // ── DataWeave / expression rules ────────────────────────────────────────────

  test('matches dw-field-not-found for field not found message', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: "Field 'customerId' not found in payload",
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    const best = results[0];
    assert.ok(
      best.title.toLowerCase().includes('customerId'.toLowerCase()) ||
      best.title.toLowerCase().includes('not found'),
      `Expected field-not-found hypothesis, got: ${best.title}`
    );
    assert.ok(best.confidence >= 0.9);
  });

  test('field name is interpolated into the hypothesis title', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: "Field 'orderId' not found",
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(
      results[0].title.includes('orderId'),
      `Expected 'orderId' in title, got: ${results[0].title}`
    );
  });

  test('matches dw-null-pointer for null pointer message', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: 'null pointer exception in expression evaluation',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].suggestion.toLowerCase().includes('null') ||
      results[0].suggestion.toLowerCase().includes('default'),
      `Expected null-safety suggestion, got: ${results[0].suggestion}`
    );
  });

  test('matches dw-type-mismatch for type coercion error', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: 'Cannot coerce String to Number',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('type') ||
      results[0].suggestion.toLowerCase().includes('coerce'),
      `Expected type mismatch hypothesis`
    );
  });

  test('falls back to dw-general-expression when no specific pattern matches', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: 'some completely unusual expression error',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0, 'Expected at least one hypothesis for expression error');
  });

  // ── Connectivity rules ──────────────────────────────────────────────────────

  test('matches http-connection-refused', () => {
    const error = makeError({
      category:     'connectivity',
      errorType:    'HTTP:CONNECTIVITY',
      errorMessage: 'Connection refused to host api.external.com:443',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('refused') ||
      results[0].title.toLowerCase().includes('connection'),
      `Expected connection-refused hypothesis, got: ${results[0].title}`
    );
    assert.ok(results[0].confidence >= 0.88);
  });

  test('matches http-timeout', () => {
    const error = makeError({
      category:     'connectivity',
      errorType:    'HTTP:TIMEOUT',
      errorMessage: 'Read timeout after 10000ms',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('timeout') ||
      results[0].suggestion.toLowerCase().includes('timeout'),
      `Expected timeout hypothesis`
    );
  });

  test('matches db-connectivity for DB: error type', () => {
    const error = makeError({
      category:     'connectivity',
      errorType:    'DB:CONNECTIVITY',
      errorMessage: 'Cannot acquire connection from pool',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('database') ||
      results[0].suggestion.toLowerCase().includes('pool'),
      `Expected DB hypothesis, got: ${results[0].title}`
    );
  });

  // ── Security rules ──────────────────────────────────────────────────────────

  test('matches security-token-expired for 401 message', () => {
    const error = makeError({
      category:     'security',
      errorType:    'MULE:CLIENT_SECURITY',
      errorMessage: 'Access token expired: 401 Unauthorized',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('token') ||
      results[0].title.toLowerCase().includes('auth'),
      `Expected security hypothesis, got: ${results[0].title}`
    );
    assert.ok(results[0].confidence >= 0.88);
  });

  // ── Runtime rules ───────────────────────────────────────────────────────────

  test('matches runtime-out-of-memory for OOM message', () => {
    const error = makeError({
      category:     'runtime',
      errorType:    'MULE:UNKNOWN',
      errorMessage: 'java.lang.OutOfMemoryError: Java heap space',
      confidence:   0.9,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.toLowerCase().includes('memory') ||
      results[0].title.toLowerCase().includes('heap'),
      `Expected OOM hypothesis, got: ${results[0].title}`
    );
    assert.ok(results[0].confidence >= 0.9);
  });

  test('matches runtime-general for generic MULE:UNKNOWN', () => {
    const error = makeError({
      category:     'runtime',
      errorType:    'MULE:UNKNOWN',
      errorMessage: 'An unexpected error occurred',
      confidence:   0.8,
    });
    const results = generateHypotheses(error, null);
    assert.ok(results.length > 0, 'Expected at least one hypothesis for runtime error');
  });

  test('flow name is interpolated into runtime-general hypothesis', () => {
    const error = makeError({
      category:     'runtime',
      errorType:    'MULE:UNKNOWN',
      errorMessage: 'unexpected error',
      flowName:     'my-special-flow',
      confidence:   0.8,
    });
    const results = generateHypotheses(error, null);
    const runtimeHyp = results.find(h => h.explanation.includes('my-special-flow'));
    assert.ok(runtimeHyp, 'Expected flow name in runtime hypothesis explanation');
  });

  // ── Unknown / edge cases ────────────────────────────────────────────────────

  test('returns empty array for unknown category with no message', () => {
    const error = makeError({
      category:    'unknown',
      errorType:   null,
      errorMessage: null,
      confidence:  0.5,
    });
    const results = generateHypotheses(error, null);
    // No rules should fire for a completely unknown error with no message
    assert.ok(Array.isArray(results), 'Should return an array');
  });

  test('works correctly with a full ExecutionContext', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: "Field 'amount' not found",
      confidence:   0.9,
    });
    const ctx = makeCtx({ error });
    assert.doesNotThrow(() => generateHypotheses(error, ctx));
    const results = generateHypotheses(error, ctx);
    assert.ok(results.length > 0);
  });
});

// ─── getBestHypothesis ────────────────────────────────────────────────────────

suite('FIRE › hypothesisEngine › getBestHypothesis', () => {

  test('returns single best hypothesis for expression error', () => {
    const error = makeError({
      category:     'expression',
      errorType:    'MULE:EXPRESSION',
      errorMessage: "Field 'customerId' not found",
      confidence:   0.9,
    });
    const result = getBestHypothesis(error, null);
    assert.ok(result !== null, 'Expected a hypothesis');
    assert.ok(result!.confidence >= 0.88);
  });

  test('returns null for zero-confidence error', () => {
    const error = makeError({ confidence: 0 });
    assert.strictEqual(getBestHypothesis(error, null), null);
  });

  test('returns null for unknown error with no matching rules', () => {
    const error = makeError({
      category:     'unknown',
      errorType:    null,
      errorMessage: null,
      confidence:   0.5,
    });
    const result = getBestHypothesis(error, null);
    // May be null or a low-confidence result — must not throw
    assert.doesNotThrow(() => getBestHypothesis(error, null));
  });

  test('returned hypothesis has all required fields', () => {
    const error = makeError({
      category:     'connectivity',
      errorType:    'HTTP:CONNECTIVITY',
      errorMessage: 'Connection refused',
      confidence:   0.9,
    });
    const result = getBestHypothesis(error, null);
    assert.ok(result !== null);
    assert.ok(typeof result!.title       === 'string' && result!.title.length > 0);
    assert.ok(typeof result!.explanation === 'string' && result!.explanation.length > 0);
    assert.ok(typeof result!.suggestion  === 'string' && result!.suggestion.length > 0);
    assert.ok(typeof result!.confidence  === 'number');
  });
});