// src/fire/logParser.ts
// Failure Intelligence & Replay Engine — Log Parser

import {
  ParsedMuleError,
  MuleErrorCategory,
  ExecutionContext,
} from './types.js';

// ─── Regex Patterns ───────────────────────────────────────────────────────────

/** Matches Mule error codes like MULE:EXPRESSION, HTTP:CONNECTIVITY */
const RE_ERROR_TYPE = /\b([A-Z][A-Z0-9_]*:[A-Z][A-Z0-9_]+)\b/;

/** Matches Mule structured error block: "Error type            : HTTP:CONNECTIVITY" */
const RE_ERROR_TYPE_STRUCTURED = /Error type\s*:\s*([A-Z][A-Z0-9_]*:[A-Z][A-Z0-9_]+)/i;

/** Matches flow names from stack traces: at process-order-flow( */
const RE_FLOW_NAME = /(?:^|\s)(?:at\s+)?([a-zA-Z][\w\-]+-(?:flow|subflow|apikit)[\w\-]*)\s*(?:\(|\/)/m;

/** Matches FlowStack entries: "at connectivity-error-flow(" */
const RE_FLOWSTACK = /\bat\s+([a-zA-Z][\w\-]+(?:flow|subflow)[^\s(]*)\s*\(/i;

/** Matches "Flow: process-order" label format */
const RE_FLOW_LABEL = /\bFlow[:\s]+([a-zA-Z][\w\-]+)/i;

/** Matches processor paths like processors/2/processors/0 */
const RE_PROCESSOR_PATH = /(?:flow|subflow)?\/?((?:[\w\-]+\/)?processors\/[\d\/]+)/;

/** Matches "Element: transform-message:Transform Message" label */
const RE_ELEMENT_LABEL = /\bElement[:\s]+([a-zA-Z][\w\-]+(?::[^\s,]+)?)/i;

/**
 * Matches Mule structured Element block:
 * "Element               : connectivity-error-flow/processors/2"
 */
const RE_ELEMENT_STRUCTURED = /Element\s*:\s*([a-zA-Z][\w\-]+(?:flow|subflow)[^\s@]+)/i;

/** Matches thread names from Mule log output */
const RE_THREAD_NAME = /\[?(MuleRuntime|http\-[a-z\-]+|uber|cpuLight|cpuIntensive|io)[\w\.\-]*\]?/;

/** Matches JSON blobs in log output */
const RE_JSON_BLOB = /(\{[\s\S]*?\})/g;

/** Matches XML blobs */
const RE_XML_BLOB = /(<\?xml[\s\S]*?>[\s\S]*?<\/[^>]+>)/;

/** Matches flow variable assignments: vars.customerId = CUST-4471 */
const RE_FLOW_VAR = /\bvars?\.([a-zA-Z][\w]+)\s*[=:]\s*([^\s,}\n]+)/g;

/** Matches HTTP attribute assignments: attributes.method = POST */
const RE_HTTP_ATTR = /\battributes?\.([a-zA-Z][\w]+)\s*[=:]\s*([^\s,}\n]+)/g;

// ─── Error Category Map ───────────────────────────────────────────────────────

const CATEGORY_MAP: Array<{ pattern: RegExp; category: MuleErrorCategory }> = [
  { pattern: /^(MULE:EXPRESSION|DW:|SCRIPTING:)/,       category: 'expression'   },
  { pattern: /^(HTTP:|DB:|FTP:|SFTP:|SMTP:|IMAP:)/,     category: 'connectivity' },
  { pattern: /^(MULE:CLIENT_SECURITY|MULE:SERVER_SECURITY|OAUTH:)/, category: 'security' },
  { pattern: /^(MULE:|JAVA:|SPRING:)/,                  category: 'runtime'      },
];

function categorise(errorType: string | null): MuleErrorCategory {
  if (!errorType) { return 'unknown'; }
  for (const entry of CATEGORY_MAP) {
    if (entry.pattern.test(errorType)) { return entry.category; }
  }
  return 'runtime';
}

// ─── Confidence Scoring ───────────────────────────────────────────────────────

function scoreConfidence(fields: {
  errorType: string | null;
  flowName: string | null;
  processorPath: string | null;
  threadName: string | null;
}): number {
  let score = 0;
  if (fields.errorType)     { score += 0.35; }
  if (fields.flowName)      { score += 0.35; }
  if (fields.processorPath) { score += 0.20; }
  if (fields.threadName)    { score += 0.10; }
  return Math.min(score, 1);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseLogEntry(message: string): ParsedMuleError {
  if (!message || typeof message !== 'string') {
    return emptyError();
  }

  // 1. Initial Extraction
  const errorTypeMatch = RE_ERROR_TYPE_STRUCTURED.exec(message) ?? RE_ERROR_TYPE.exec(message);
  const flowNameMatch = RE_FLOW_NAME.exec(message) ??
                        RE_FLOWSTACK.exec(message) ??
                        RE_FLOW_LABEL.exec(message);

  const processorMatch  = RE_PROCESSOR_PATH.exec(message);
  const elementMatch    = RE_ELEMENT_LABEL.exec(message);
  const elementStructured = RE_ELEMENT_STRUCTURED.exec(message);
  const threadMatch     = RE_THREAD_NAME.exec(message);

  let errorType   = errorTypeMatch?.[1]  ?? null;
  const flowName    = flowNameMatch?.[1]   ?? null;
  const threadName  = threadMatch?.[0]     ?? null;

  const rawElement  = elementMatch?.[1] ?? elementStructured?.[1] ?? processorMatch?.[1] ?? null;
  const elementPath = rawElement?.includes('/')
    ? rawElement.split('/').slice(1).join('/')
    : rawElement;
  const processorPath = processorMatch?.[1] ?? null;

  let errorMessage: string | null = null;
  if (errorType) {
    const startIdx = message.indexOf(errorType) + errorType.length;
    errorMessage = message.slice(startIdx).trim().slice(0, 500) || null;
  }

  // 2. Handle MULE:COMPOSITE_ROUTING (The "Senior" Logic)
  // If we have a composite error, we look into the errorMessage to find the FIRST 
  // nested error code to provide a more accurate category for the Hypothesis Engine.
  let category = categorise(errorType);

  if (errorType === 'MULE:COMPOSITE_ROUTING' && errorMessage) {
    // Look for patterns like "0=HTTP:CONNECTIVITY" or "Route 1: MULE:EXPRESSION"
    const nestedErrorMatch = RE_ERROR_TYPE.exec(errorMessage);
    if (nestedErrorMatch) {
      const nestedType = nestedErrorMatch[1];
      const nestedCategory = categorise(nestedType);
      
      // If the nested error is more specific (like Connectivity), upgrade the category
      if (nestedCategory !== 'runtime' && nestedCategory !== 'unknown') {
        category = nestedCategory;
      }
    }
  }

  // 3. Final Scoring
  const confidence = scoreConfidence({ errorType, flowName, processorPath, threadName });

  return {
    errorType,
    flowName,
    processorPath,
    elementPath,
    threadName,
    errorMessage,
    category,
    confidence,
  };
}

export function isActionableLogEntry(priority: string, message: string): boolean {
  if (!message) { return false; }

  const isErrorLevel = /^(ERROR|WARN)$/i.test(priority);

  // Generic Mule error pattern — catches ALL connector namespaces
  // MULE:, HTTP:, DB:, SALESFORCE:, SAP:, AGGREGATOR:, S3:, OAUTH:, etc.
  const MULE_ERROR_PATTERN = /[A-Z0-9_]{2,}:[A-Z0-9_]{2,}/;

  // Location pattern — processor path or FlowStack entry
  const LOCATION_PATTERN = /\sat\s+[\w-]+(?:\/processors\/\d+|\([\w-]+)/i;

  // Structural pattern — CloudHub error block markers
  const STRUCTURE_PATTERN = /(Error type\s*:|FlowStack\s*:|Element\s*:)/i;

  const hasErrorCode = MULE_ERROR_PATTERN.test(message);
  const hasContext   = LOCATION_PATTERN.test(message) || STRUCTURE_PATTERN.test(message);

  // Must have a Mule error code AND either a location or structural context
  // This eliminates false positives from plain INFO logs that happen to contain
  // words with colons (e.g. "Connecting to: localhost:8081")
  const isMuleError = hasErrorCode && hasContext;

  return isErrorLevel || isMuleError;
}

export function extractPayload(message: string): string | null {
  if (!message) { return null; }

  let bestJson: string | null = null;
  let bestLength = 0;
  let match: RegExpExecArray | null;
// CloudHub loggers often wrap JSON in quotes: "Expression error test: {\"key\":\"val\"}"
  // Unescape and extract the JSON object
  const unescaped = message.replace(/\\"/g, '"').replace(/\\n/g, ' ');
  RE_JSON_BLOB.lastIndex = 0;
  let unescapedMatch: RegExpExecArray | null;
  while ((unescapedMatch = RE_JSON_BLOB.exec(unescaped)) !== null) {
    const candidate = unescapedMatch[1];
    if (candidate.length > bestLength) {
      try {
        JSON.parse(candidate);
        bestJson = candidate;
        bestLength = candidate.length;
      } catch {
        // skip
      }
    }
  }
  if (bestJson) { return bestJson; }

  RE_JSON_BLOB.lastIndex = 0;
  while ((match = RE_JSON_BLOB.exec(message)) !== null) {
    const candidate = match[1];
    if (candidate.length > bestLength) {
      try {
        JSON.parse(candidate);
        bestJson = candidate;
        bestLength = candidate.length;
      } catch {
        // not valid JSON, skip
      }
    }
  }

  if (bestJson) { return bestJson; }

  const xmlMatch = RE_XML_BLOB.exec(message);
  if (xmlMatch) { return xmlMatch[1]; }

  return null;
}

export function extractVariables(message: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!message) { return vars; }

  RE_FLOW_VAR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_FLOW_VAR.exec(message)) !== null) {
    const [, key, value] = match;
    vars[key] = value;
  }
  return vars;
}

export function extractAttributes(message: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!message) { return attrs; }

  RE_HTTP_ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_HTTP_ATTR.exec(message)) !== null) {
    const [, key, value] = match;
    attrs[key] = value;
  }
  return attrs;
}

export function buildExecutionContext(
  entries: Array<{ priority: string; message: string; timestamp: number }>,
  appDomain: string
): ExecutionContext | null {
  // Find the failing entry first
  const failingEntry = entries.find(e => isActionableLogEntry(e.priority, e.message));
  if (!failingEntry) { return null; }

  const error = parseLogEntry(failingEntry.message);
  if (error.confidence < 0.3) { return null; }

  // ── Thread correlation ────────────────────────────────────────────────────
  // Extract the thread ID and correlation ID from the failing entry so we only
  // use log lines from the SAME transaction. In high-traffic environments,
  // logs from 50 concurrent requests are interleaved — without this filter,
  // we'd extract a payload from Transaction A and an error from Transaction B.

  const threadId    = extractThreadId(failingEntry.message);
  const correlationId = extractCorrelationId(failingEntry.message);

  // Filter entries to only those sharing the same thread or correlation ID
  const correlatedEntries = entries.filter(e => {
    if (e === failingEntry) { return true; }

    // Match by correlation ID first (most reliable)
    if (correlationId) {
      const entryCorrelationId = extractCorrelationId(e.message);
      if (entryCorrelationId && entryCorrelationId === correlationId) { return true; }
    }

    // Fall back to thread ID matching
    if (threadId) {
      const entryThreadId = extractThreadId(e.message);
      if (entryThreadId && entryThreadId === threadId) { return true; }
    }

    // If we couldn't extract any thread info from this entry, include it
    // (it might be a multi-line continuation of the same log entry)
    return !extractThreadId(e.message) && !extractCorrelationId(e.message);
  });

  // Use correlated entries if we found more than just the failing entry,
  // otherwise fall back to all entries (sparse logging scenario)
  const contextEntries = correlatedEntries.length > 1 ? correlatedEntries : entries;

  let rawPayload: string | null = null;
  const variables: Record<string, string> = {};
  const attributes: Record<string, string> = {};

  for (const entry of contextEntries) {
    if (!rawPayload) {
      rawPayload = extractPayload(entry.message);
    }
    Object.assign(variables,  extractVariables(entry.message));
    Object.assign(attributes, extractAttributes(entry.message));
  }

  return {
    error,
    rawPayload,
    variables,
    attributes,
    threadName:        threadId ?? error.threadName,
    timestamp:         failingEntry.timestamp,
    applicationDomain: appDomain,
  };
}


/**
 * Extract the thread ID from a Mule log message.
 * Handles formats like:
 *   [MuleRuntime].uber-3
 *   [MuleRuntime].cpuLight.02
 *   [uber-3]
 */
export function extractThreadId(message: string): string | null {
  if (!message) { return null; }
  const match = /\[(MuleRuntime[\w\.\-]*)\]|\b(uber-\d+|cpuLight[\w\.\-]*|cpuIntensive[\w\.\-]*|io\.[\w\.\-]+)\b/.exec(message);
  return match?.[1] ?? match?.[2] ?? null;
}

/**
 * Extract the correlation ID from a Mule log message.
 * Handles formats like:
 *   x-correlation-id: abc-123
 *   correlationId=abc-123
 *   [correlationId: abc-123]
 */
export function extractCorrelationId(message: string): string | null {
  if (!message) { return null; }
  const match = /(?:x-correlation-id|correlationId|correlation-id|X-Correlation-Id)\s*[=:\s]+([a-zA-Z0-9\-_]{6,64})/i.exec(message);
  return match?.[1] ?? null;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function emptyError(): ParsedMuleError {
  return {
    errorType:     null,
    flowName:      null,
    processorPath: null,
    elementPath:   null,
    threadName:    null,
    errorMessage:  null,
    category:      'unknown',
    confidence:    0,
  };
}
