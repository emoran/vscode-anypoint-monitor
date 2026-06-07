// src/fire/orchestrator.ts
// Failure Intelligence & Replay Engine — Orchestrator
//
// This is the ONLY file in src/fire/ that imports from vscode.
// All other fire/ modules are pure logic.
//
// Responsibilities:
//   Given a batch of log entries from the Real-Time Logs session,
//   produce a complete ReplaySession: parsed error + source location +
//   DataWeave script + hypotheses — ready to render in the debugger panel.

import * as vscode from 'vscode';
import * as path from 'path';
import { parseLogEntry, buildExecutionContext } from './logParser.js';
import { findSourceLocation, openSourceLocation } from './sourceMapper.js';
import { generateHypotheses } from './hypothesisEngine.js';
import { ReplaySession, ExecutionContext, FailureHypothesis } from './types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a full ReplaySession from a batch of log entries.
 *
 * Call this when the user clicks "Replay Failure" or "Jump to Source"
 * on a log entry in the Real-Time Logs panel.
 *
 * @param entries       Raw log entries from the active session
 *                      (all entries from the same thread, if possible)
 * @param appDomain     The CloudHub application domain name
 * @param failingIndex  Index of the specific failing entry in the array
 * @returns             A ReplaySession, or null if the entry is not actionable
 */
export async function buildReplaySession(
  entries: Array<{ priority: string; message: string; timestamp: number }>,
  appDomain: string,
  failingIndex: number
): Promise<ReplaySession | null> {

  // 1. Build execution context from the log batch
  const ctx = buildExecutionContext(entries, appDomain);
  if (!ctx) { return null; }

  // 2. Find source location in workspace
  const sourceLocation = await findSourceLocation(ctx.error);

  // 3. Extract DataWeave script from XML if source was found
  let dataWeaveScript: string | null = null;
  if (sourceLocation) {
    dataWeaveScript = await extractDataWeaveScript(sourceLocation.filePath, ctx.error.flowName);
  }

  // 4. Generate hypotheses
  const hypotheses = generateHypotheses(ctx.error, ctx);

  const session: ReplaySession = {
    sessionId:      generateSessionId(appDomain, ctx.timestamp),
    context:        ctx,
    sourceLocation,
    dataWeaveScript,
    createdAt:      new Date().toISOString(),
  };

  // Attach hypotheses to context error for downstream use
  (session.context.error as any)._hypotheses = hypotheses;

  return session;
}

/**
 * Jump directly to the source location for a failing log entry.
 * Shows the XML file beside the log panel and highlights the failing line.
 *
 * @returns true if the file was opened, false if no location could be found
 */
export async function jumpToSource(
  entries: Array<{ priority: string; message: string; timestamp: number }>,
  appDomain: string
): Promise<boolean> {
  const ctx = buildExecutionContext(entries, appDomain);
  if (!ctx) {
    vscode.window.showWarningMessage(
      'FIRE: Could not extract flow information from this log entry. ' +
      'Ensure the log contains a flow name and error type.'
    );
    return false;
  }

  const location = await findSourceLocation(ctx.error);
  if (!location) {
    const flowName = ctx.error.flowName ?? 'unknown';
    vscode.window.showWarningMessage(
      `FIRE: Could not find flow '${flowName}' in the workspace. ` +
      `Make sure the Mule project is open in VS Code.`
    );
    return false;
  }

  const opened = await openSourceLocation(location);
  if (opened) {
    const matchDesc = location.matchMethod === 'exact'
      ? `line ${location.lineNumber + 1} in ${path.basename(location.filePath)}`
      : `flow '${location.flowName}' in ${path.basename(location.filePath)} (processor not pinpointed)`;

    vscode.window.showInformationMessage(
      `FIRE: Jumped to ${matchDesc}`
    );
  }

  return opened;
}

/**
 * Extract hypotheses for a single log entry without building a full session.
 * Lightweight — used to show the inline "Why did this fail?" tooltip.
 */
export function getInlineHypotheses(
  message: string,
  priority: string
): FailureHypothesis[] {
  const error = parseLogEntry(message);
  if (error.confidence < 0.3) { return []; }
  return generateHypotheses(error, null);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract the first DataWeave script found inside a given flow in an XML file.
 * Looks for <ee:set-payload>, <ee:set-variable>, or <dw:transform-message> blocks.
 */
async function extractDataWeaveScript(
  filePath: string,
  flowName: string | null
): Promise<string | null> {
  try {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const lines = text.split('\n');

    let insideFlow = false;
    let insideCdata = false;
    const scriptLines: string[] = [];
    let collecting = false;

    for (const line of lines) {
      // Track flow scope — same logic as sourceMapper
      const flowTag = /<(?:flow|sub-flow)\s[^>]*name\s*=\s*["']([^"']+)["']/i.exec(line);
      if (flowTag) {
        const matches = flowName
          ? normaliseFlowName(flowTag[1]) === normaliseFlowName(flowName)
          : false;
        insideFlow = matches;
      }
      if (/<\/(?:flow|sub-flow)>/i.test(line)) {
        if (insideFlow && collecting) {
          // We've exited the flow while collecting — stop
          break;
        }
        insideFlow = false;
      }

      if (!insideFlow) { continue; }

      // Start collecting on CDATA open (DataWeave lives inside CDATA)
      if (line.includes('<![CDATA[')) {
        collecting = true;
        insideCdata = true;
        const cdataStart = line.indexOf('<![CDATA[') + 9;
        const afterCdata = line.slice(cdataStart);
        if (afterCdata.trim()) { scriptLines.push(afterCdata); }
        continue;
      }

      // Stop collecting on CDATA close
      if (insideCdata && line.includes(']]>')) {
        const beforeClose = line.slice(0, line.indexOf(']]>'));
        if (beforeClose.trim()) { scriptLines.push(beforeClose); }
        break; // Take only the first script found
      }

      if (collecting) {
        scriptLines.push(line);
      }
    }

    const script = scriptLines.join('\n').trim();
    return script.length > 0 ? script : null;

  } catch {
    return null;
  }
}

function normaliseFlowName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, '');
}

function generateSessionId(appDomain: string, timestamp: number): string {
  return `fire-${appDomain}-${timestamp}`;
}