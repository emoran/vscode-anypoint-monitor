// src/fire/hypothesisEngine.ts
// Failure Intelligence & Replay Engine — Hypothesis Engine
//
// Responsibilities:
//   Given a ParsedMuleError + ExecutionContext, produce ranked human-readable
//   hypotheses explaining why the failure occurred and what to do about it.
//
// Design:
//   - Pure rule-based pattern matching — no AI, no network calls, no VS Code API
//   - Each rule is a self-contained object: easy to add, remove, or reorder
//   - Rules are evaluated in order; all matching rules are returned (ranked by confidence)
//   - Fully testable without a VS Code host

import { ParsedMuleError, ExecutionContext, FailureHypothesis } from './types.js';

// ─── Rule definition ──────────────────────────────────────────────────────────

interface HypothesisRule {
  /** Short identifier used in tests */
  id: string;
  /** Return true if this rule applies to the given error + context */
  matches: (error: ParsedMuleError, ctx: ExecutionContext | null) => boolean;
  /** Produce the hypothesis when the rule matches */
  produce: (error: ParsedMuleError, ctx: ExecutionContext | null) => FailureHypothesis;
}

// ─── Rules registry ───────────────────────────────────────────────────────────

const RULES: HypothesisRule[] = [

  // ── DataWeave / Expression errors ─────────────────────────────────────────

  {
    id: 'dw-field-not-found',
    matches: (e) =>
      e.category === 'expression' &&
      e.errorMessage !== null &&
      /field ['"]?\w+['"]? (?:not found|does not exist)/i.test(e.errorMessage),
    produce: (e) => {
      const fieldMatch = /field ['"]?(\w+)['"]?/i.exec(e.errorMessage ?? '');
      const field = fieldMatch?.[1] ?? 'unknown';
      return {
        title: `Field '${field}' not found in payload`,
        explanation:
          `The DataWeave expression tried to access '${field}' but it was not ` +
          `present in the incoming payload. This usually means the upstream ` +
          `system sent a different payload shape than expected.`,
        suggestion:
          `Add a null-safe selector: payload.${field}? — or validate the ` +
          `payload structure with a Choice router before the Transform.`,
        confidence: 0.92,
      };
    },
  },

  {
    id: 'dw-null-pointer',
    matches: (e) =>
      e.category === 'expression' &&
      e.errorMessage !== null &&
      /null\s*pointer|cannot.*null|null.*cannot/i.test(e.errorMessage),
    produce: () => ({
      title: 'Null value accessed in DataWeave expression',
      explanation:
        'A variable or payload field evaluated to null when the expression ' +
        'expected a non-null value.',
      suggestion:
        'Use the null-safe operator (?.) and provide a default value with ' +
        'the default keyword: payload.field? default "fallback"',
      confidence: 0.88,
    }),
  },

  {
    id: 'dw-type-mismatch',
    matches: (e) =>
      e.category === 'expression' &&
      e.errorMessage !== null &&
      /type mismatch|cannot coerce|expected.*got|incompatible type/i.test(e.errorMessage),
    produce: () => ({
      title: 'DataWeave type mismatch',
      explanation:
        'The expression received a value of an unexpected type — for example ' +
        'a String where a Number was expected, or an Object where an Array was needed.',
      suggestion:
        'Use explicit type coercion: (payload.amount as Number) or ' +
        '(payload.items as Array). Check the upstream API contract.',
      confidence: 0.85,
    }),
  },

{
    id: 'dw-general-expression',
    matches: (e) => e.category === 'expression',
    produce: (e, ctx) => {
      const hasData = ctx?.rawPayload || Object.keys(ctx?.variables ?? {}).length > 0;
      
      return {
        title: 'DataWeave expression evaluation failed',
        explanation:
          `The transformation failed at '${e.processorPath ?? e.elementPath ?? 'unknown'}'. ` +
          `This usually indicates a logic error in your script or an unexpected data structure.`,
        suggestion:
          `1. Copy the extracted **Production Payload** and **DataWeave Script** from the panels below.\n` +
          `2. Open the **AM: DataWeave Playground** (Cmd+Shift+P / Ctrl+Shift+P).\n` +
          `3. Paste the data to reproduce and fix the error in real-time.` +
          (hasData ? `\n\n💡 *Context detected: Use the extracted variables to simulate the exact flow state.*` : ''),
        confidence: 0.70,
      };
    },
  },

  {
  id: 'http-localhost-error',
  matches: (e) => 
    e.category === 'connectivity' && 
    /localhost|127\.0\.0\.1/i.test(e.errorMessage ?? ''),
  produce: () => ({
    title: 'CloudHub cannot connect to localhost',
    explanation: 'The application is trying to call "localhost". In CloudHub, this refers to the worker itself, not your local machine or a remote API.',
    suggestion: 'Update the HTTP Request configuration to use a valid external URL, a VPC internal DNS name, or a functional property (${api.host}).',
    confidence: 0.98, // Very high confidence because this is almost always a config error
  }),
},

{
  id: 'mule-composite-routing',
  matches: (e) => 
    e.errorType === 'MULE:COMPOSITE_ROUTING' || 
    /composite routing error/i.test(e.errorMessage ?? ''),
  produce: (e) => ({
    title: 'Multiple routes failed in Scatter-Gather',
    explanation: 
      'A Scatter-Gather component failed because one or more of its internal routes ' +
      'threw an error. In Mule 4, this wraps all failures into a single Composite error.',
    suggestion: 
      'Expand the "FlowStack" in the Replay Panel to identify which specific routes failed. ' +
      'Check if any external services called in parallel were down simultaneously. ' +
      'Consider adding individual Error Handlers to each route inside the Scatter-Gather.',
    confidence: 0.95,
  }),
},

  // ── Connectivity errors ───────────────────────────────────────────────────

  {
    id: 'http-connection-refused',
    matches: (e) =>
      e.category === 'connectivity' &&
      e.errorMessage !== null &&
      /connection refused|connect.*failed|unable to connect/i.test(e.errorMessage),
    produce: () => ({
      title: 'HTTP connection refused by target host',
      explanation:
        'The HTTP Requester could not establish a connection to the target host. ' +
        'The remote service may be down, firewalled, or the URL is incorrect.',
      suggestion:
        'Check the HTTP Request configuration URL and port. Verify the target ' +
        'service is running. Check CloudHub VPC/firewall rules if calling an internal service.',
      confidence: 0.90,
    }),
  },

  {
    id: 'http-timeout',
    matches: (e) =>
      e.category === 'connectivity' &&
      e.errorMessage !== null &&
      /timeout|timed out|read.*timeout|connection.*timeout/i.test(e.errorMessage),
    produce: () => ({
      title: 'HTTP request timed out',
      explanation:
        'The target service did not respond within the configured timeout period. ' +
        'This may indicate the remote service is overloaded or the timeout is too short.',
      suggestion:
        'Increase the Response Timeout in the HTTP Request config. ' +
        'Consider adding a retry strategy with exponential backoff. ' +
        'Check the target service performance metrics.',
      confidence: 0.88,
    }),
  },

  {
    id: 'db-connectivity',
    matches: (e) =>
      e.errorType !== null &&
      /^DB:/i.test(e.errorType),
    produce: () => ({
      title: 'Database connector error',
      explanation:
        'The database operation failed. This could be a connection pool exhaustion, ' +
        'a query syntax error, or the database server being unreachable.',
      suggestion:
        'Check the DB Connector connection pool settings (maxPoolSize). ' +
        'Verify database server health. Review the SQL query for syntax errors. ' +
        'Check CloudHub worker memory — high heap usage causes slow pool release.',
      confidence: 0.85,
    }),
  },

  {
    id: 'general-connectivity',
    matches: (e) => e.category === 'connectivity',
    produce: (e) => ({
      title: `Connectivity failure: ${e.errorType ?? 'unknown connector'}`,
      explanation:
        'An external system or resource could not be reached or returned an error.',
      suggestion:
        'Verify network connectivity from CloudHub to the target system. ' +
        'Check the connector configuration and credentials. ' +
        'Review CloudHub application logs for the full stack trace.',
      confidence: 0.65,
    }),
  },

  // ── Security errors ───────────────────────────────────────────────────────

  {
    id: 'security-token-expired',
    matches: (e) =>
      e.category === 'security' &&
      e.errorMessage !== null &&
      /token.*expired|expired.*token|unauthorized|401/i.test(e.errorMessage),
    produce: () => ({
      title: 'Authentication token expired or invalid',
      explanation:
        'The request was rejected because the access token has expired or ' +
        'the credentials are no longer valid.',
      suggestion:
        'Implement token refresh logic in your OAuth2 configuration. ' +
        'Check the Token Expiration field in the HTTP Request OAuth settings. ' +
        'Verify the Connected App credentials in Anypoint Platform.',
      confidence: 0.90,
    }),
  },

  // ── Runtime errors ────────────────────────────────────────────────────────

  {
    id: 'runtime-out-of-memory',
    matches: (e) =>
      e.errorMessage !== null &&
      /out of memory|heap space|java\.lang\.OutOfMemory/i.test(e.errorMessage),
    produce: () => ({
      title: 'Worker out of memory (JVM heap exhausted)',
      explanation:
        'The Mule worker JVM ran out of heap space. This is typically caused by ' +
        'processing very large payloads, memory leaks in DataWeave scripts, or ' +
        'insufficient worker size for the workload.',
      suggestion:
        'Increase the worker size in CloudHub deployment settings. ' +
        'Use streaming instead of in-memory processing for large payloads. ' +
        'Check for DataWeave scripts that collect large arrays into memory. ' +
        'Enable GC logging to identify the source of allocation.',
      confidence: 0.95,
    }),
  },

  {
    id: 'runtime-general',
    matches: (e) => e.category === 'runtime' && e.confidence > 0.3,
    produce: (e) => ({
      title: `Runtime error: ${e.errorType ?? 'MULE:UNKNOWN'}`,
      explanation:
        `The flow '${e.flowName ?? 'unknown'}' encountered an unhandled runtime error ` +
        `at '${e.elementPath ?? e.processorPath ?? 'unknown processor'}'.`,
      suggestion:
        'Add an error handler to the flow to catch this error type and provide ' +
        'a meaningful response. Check the full stack trace in CloudHub logs for ' +
        'the root cause.',
      confidence: 0.55,
    }),
  },

];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate ranked failure hypotheses for a given parsed error + context.
 *
 * @param error   The parsed Mule error
 * @param ctx     The full execution context (may be null if only partial info available)
 * @returns       Array of hypotheses sorted by confidence descending.
 *                Empty array if no rules match (never throws).
 */
export function generateHypotheses(
  error: ParsedMuleError,
  ctx: ExecutionContext | null
): FailureHypothesis[] {
  if (!error || error.confidence === 0) {
    return [];
  }

  const results: FailureHypothesis[] = [];

  for (const rule of RULES) {
    try {
      if (rule.matches(error, ctx)) {
        results.push(rule.produce(error, ctx));
      }
    } catch {
      // A broken rule must never crash the entire engine
    }
  }

  // Sort by confidence descending, cap at top 3 for UI clarity
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/**
 * Return the single best hypothesis, or null if none apply.
 * Convenience wrapper for callers that only need one suggestion.
 */
export function getBestHypothesis(
  error: ParsedMuleError,
  ctx: ExecutionContext | null
): FailureHypothesis | null {
  const all = generateHypotheses(error, ctx);
  return all.length > 0 ? all[0] : null;
}