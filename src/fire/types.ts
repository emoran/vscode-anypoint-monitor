// src/fire/types.ts
// Failure Intelligence & Replay Engine — Shared Types
// All types for FIRE are defined here. Nothing in this file imports from VS Code
// so it can be tested without a VS Code host.

// ─── Log Parsing ─────────────────────────────────────────────────────────────

/**
 * A structured representation of a parsed Mule error extracted from a raw log message.
 * All fields are optional because not every error log contains every field.
 */
export interface ParsedMuleError {
  /** The Mule error code, e.g. "MULE:EXPRESSION", "HTTP:CONNECTIVITY" */
  errorType: string | null;

  /** The flow where the error occurred, e.g. "process-order-flow" */
  flowName: string | null;

  /** The processor/component that failed, e.g. "Transform Message", "Set Payload" */
  processorPath: string | null;

  /** The raw element path from the stack trace, e.g. "processors/2/processors/0" */
  elementPath: string | null;

  /** Thread identifier for correlating multiple log entries to the same request */
  threadName: string | null;

  /** The full human-readable error message */
  errorMessage: string | null;

  /** The error type category: runtime, expression, connectivity, or security */
  category: MuleErrorCategory;

  /** Confidence score 0–1 for how certain we are this is a parseable Mule error */
  confidence: number;
}

/**
 * Broad category of Mule error. Used to choose the right suggestion strategy.
 */
export type MuleErrorCategory =
  | 'expression'    // MULE:EXPRESSION, DW failures
  | 'connectivity'  // HTTP:CONNECTIVITY, DB:CONNECTIVITY
  | 'security'      // MULE:CLIENT_SECURITY, MULE:SERVER_SECURITY
  | 'runtime'       // MULE:UNKNOWN, general runtime errors
  | 'unknown';      // Could not be categorised

// ─── Execution Context ────────────────────────────────────────────────────────

/**
 * The full execution context extracted from one or more log entries belonging
 * to the same thread/transaction. This is what gets sent to the Replay Engine.
 */
export interface ExecutionContext {
  /** The parsed error from the failing log entry */
  error: ParsedMuleError;

  /** Raw JSON/XML payload detected in nearby log entries, if any */
  rawPayload: string | null;

  /** Flow variables detected in log output (key → value string) */
  variables: Record<string, string>;

  /** HTTP attributes detected in log output */
  attributes: Record<string, string>;

  /** The thread name used to correlate all log entries */
  threadName: string | null;

  /** Unix timestamp (ms) of the failing log entry */
  timestamp: number;

  /** The application domain name, used to locate workspace XML files */
  applicationDomain: string;
}

// ─── Source Mapping ───────────────────────────────────────────────────────────

/**
 * A resolved source location — a specific file and line in the workspace.
 */
export interface SourceLocation {
  /** Absolute path to the Mule XML file on disk */
  filePath: string;

  /** 0-based line number of the matching processor element */
  lineNumber: number;

  /** 0-based column number */
  columnNumber: number;

  /** The flow name that was matched */
  flowName: string;

  /** The processor name that was matched */
  processorName: string;

  /** How the match was found */
  matchMethod: 'exact' | 'fuzzy' | 'flow-only';
}

// ─── Replay Session ───────────────────────────────────────────────────────────

/**
 * Everything needed to populate the Live Data Replay Engine panel.
 */
export interface ReplaySession {
  /** Unique ID for this session (used to avoid duplicate panels) */
  sessionId: string;

  /** The full execution context from the failing log */
  context: ExecutionContext;

  /** The resolved source location, if found */
  sourceLocation: SourceLocation | null;

  /** The raw DataWeave script source, if found in the XML */
  dataWeaveScript: string | null;

  /** ISO timestamp when this session was created */
  createdAt: string;
}

// ─── Hypothesis ───────────────────────────────────────────────────────────────

/**
 * A suggested reason for why the error occurred, shown inline in the debugger.
 */
export interface FailureHypothesis {
  /** Short title shown in the UI */
  title: string;

  /** Longer explanation of what likely went wrong */
  explanation: string;

  /** Actionable fix suggestion */
  suggestion: string;

  /** Confidence 0–1 */
  confidence: number;
}