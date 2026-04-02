// src/fire/sourceMapper.ts
// Failure Intelligence & Replay Engine — Source Mapper
//
// Responsibilities:
//   Given a ParsedMuleError (flowName + elementPath), search the VS Code
//   workspace for Mule XML files and return the exact file path + line number
//   of the failing processor.
//
// Design decisions:
//   - Uses vscode.workspace.findFiles — no direct fs calls (respects .gitignore)
//   - Reads files with vscode.workspace.openTextDocument for encoding safety
//   - Never throws — always returns null on failure so callers stay clean
//   - Scores matches so "exact" beats "fuzzy" beats "flow-only"

import * as vscode from 'vscode';
import { ParsedMuleError, SourceLocation } from './types.js';

// ─── XML search patterns ──────────────────────────────────────────────────────

/**
 * Glob pattern that matches all Mule XML config files in the workspace.
 * Covers both Maven-layout (src/main/mule) and flat projects.
 */
const MULE_XML_GLOB = '**/*.xml';

/**
 * Directories to always exclude when searching for Mule XML files.
 * Prevents scanning target/, node_modules/, .vscode/, etc.
 */
const EXCLUDE_GLOB = '{**/node_modules/**,**/target/**,**/.vscode/**,**/.git/**,**/test-resources/**}';

/**
 * Maximum number of XML files to scan. Safety limit to avoid hanging on
 * huge monorepos. In practice a Mule project has < 50 XML files.
 */
const MAX_FILES = 200;

/**
 * Maximum file size to read (bytes). Files larger than this are skipped.
 * Prevents reading generated/minified XML that is definitely not a Mule config.
 */
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the source location of a failing Mule processor in the workspace.
 *
 * @param error   The parsed Mule error containing flowName and elementPath
 * @returns       A SourceLocation if found, or null if no match
 */
export async function findSourceLocation(
  error: ParsedMuleError
): Promise<SourceLocation | null> {
  if (!error.flowName) {
    return null;
  }

  // Find all XML files in the workspace
  const xmlFiles = await vscode.workspace.findFiles(MULE_XML_GLOB, EXCLUDE_GLOB, MAX_FILES);

  if (xmlFiles.length === 0) {
    return null;
  }

  // Score each file and collect candidates
  const candidates: SourceLocation[] = [];

  for (const fileUri of xmlFiles) {
    try {
      const location = await scanFileForError(fileUri, error);
      if (location) {
        candidates.push(location);
      }
    } catch {
      // Skip unreadable files silently — never let one bad file break the search
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Return the highest-confidence match
  return rankCandidates(candidates);
}

/**
 * Open the source location in the VS Code editor and highlight the line.
 * Returns true if the file was opened successfully.
 */
export async function openSourceLocation(location: SourceLocation): Promise<boolean> {
  try {
    const uri = vscode.Uri.file(location.filePath);
    const document = await vscode.workspace.openTextDocument(uri);

    const position = new vscode.Position(location.lineNumber, location.columnNumber);
    const range = new vscode.Range(position, position);

    await vscode.window.showTextDocument(document, {
      selection: range,
      viewColumn: vscode.ViewColumn.Beside, // Open beside the log panel, not replacing it
      preserveFocus: false,
    });

    // Highlight the full line so the developer can see the failing processor
    const lineRange = document.lineAt(location.lineNumber).range;
    const decoration = createFailureDecoration();
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(decoration, [lineRange]);
      // Auto-clear the highlight after 8 seconds
      setTimeout(() => {
        editor.setDecorations(decoration, []);
        decoration.dispose();
      }, 8000);
    }

    return true;
  } catch {
    return false;
  }
}

// ─── Internal — file scanning ─────────────────────────────────────────────────

/**
 * Scan a single XML file for a flow + processor match.
 * Returns a SourceLocation if found, null otherwise.
 */
async function scanFileForError(
  fileUri: vscode.Uri,
  error: ParsedMuleError
): Promise<SourceLocation | null> {
  // Check file size before reading
  const stat = await vscode.workspace.fs.stat(fileUri);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return null;
  }

  const document = await vscode.workspace.openTextDocument(fileUri);
  const text = document.getText();

  // Fast pre-check: does this file even mention the flow name?
  // This avoids line-by-line scanning on irrelevant files.
  if (!error.flowName || !textMentionsFlow(text, error.flowName)) {
    return null;
  }

  const lines = text.split('\n');
  let insideTargetFlow = false;
  let flowStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect flow/sub-flow opening tag
    const flowOpen = detectFlowOpen(line);
    if (flowOpen) {
      const isTargetFlow = matchesFlowName(flowOpen, error.flowName);
      insideTargetFlow = isTargetFlow;
      if (isTargetFlow) {
        flowStartLine = i;
      }
    }

    // Detect flow/sub-flow closing tag — exit the flow scope
    if (insideTargetFlow && isFlowClose(line)) {
      insideTargetFlow = false;
    }

    // If we're inside the target flow, look for the processor
    if (insideTargetFlow && error.elementPath) {
      const processorName = extractProcessorName(error.elementPath);
      if (processorName && lineMatchesProcessor(line, processorName)) {
        const col = line.search(/\S/); // first non-whitespace = start of tag
        return {
          filePath: fileUri.fsPath,
          lineNumber: i,
          columnNumber: col >= 0 ? col : 0,
          flowName: error.flowName,
          processorName,
          matchMethod: 'exact',
        };
      }
    }
  }

  // Fallback: if we found the flow but not the specific processor,
  // return the flow opening line as a "flow-only" match
  if (flowStartLine >= 0) {
    const col = lines[flowStartLine].search(/\S/);
    return {
      filePath: fileUri.fsPath,
      lineNumber: flowStartLine,
      columnNumber: col >= 0 ? col : 0,
      flowName: error.flowName,
      processorName: error.elementPath ?? 'unknown',
      matchMethod: 'flow-only',
    };
  }

  return null;
}

// ─── Internal — XML analysis helpers ─────────────────────────────────────────

/**
 * Quick text search to see if a file even mentions the flow name.
 * Uses simple string includes — faster than regex for a pre-filter.
 */
function textMentionsFlow(text: string, flowName: string): boolean {
  // Try exact name first, then a normalised version (hyphens → spaces or underscores)
  if (text.includes(flowName)) { return true; }
  const normalised = flowName.replace(/[-_]/g, '[-_ ]');
  return new RegExp(normalised, 'i').test(text);
}

/**
 * Detect a Mule flow or sub-flow opening tag on a line.
 * Returns the name attribute value if found, null otherwise.
 *
 * Matches tags like:
 *   <flow name="process-order-flow">
 *   <sub-flow name="validate-payload-subflow">
 */
function detectFlowOpen(line: string): string | null {
  const match = /<(?:flow|sub-flow)\s[^>]*name\s*=\s*["']([^"']+)["']/i.exec(line);
  return match?.[1] ?? null;
}

/**
 * Check if a line contains a Mule flow or sub-flow closing tag.
 */
function isFlowClose(line: string): boolean {
  return /<\/(?:flow|sub-flow)>/i.test(line);
}

/**
 * Compare a flow name from the XML with the flow name from the error.
 * Handles common variations: hyphens vs underscores, case differences,
 * and suffix differences (e.g. "-flow" sometimes omitted in logs).
 */
function matchesFlowName(xmlFlowName: string, errorFlowName: string): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');
  const a = normalise(xmlFlowName);
  const b = normalise(errorFlowName);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Extract the human-readable processor name from an element path.
 *
 * Input examples:
 *   "transform-message:Transform Message"  → "transform-message"
 *   "processors/2/processors/0"            → null (numeric path, no name)
 *   "set-payload"                          → "set-payload"
 */
function extractProcessorName(elementPath: string): string | null {
  if (!elementPath) { return null; }

  if (elementPath.includes(':')) {
    return elementPath.split(':')[0].trim();
  }

  // Reject purely numeric/structural paths like:
  //   "2/0"
  //   "processors/2/processors/0"
  //   "process-order-flow/processors/3"
  // Rule: if every segment is either a pure integer OR the word "processors",
  // there is no human-readable element name to extract.
  const segments = elementPath.split('/');
  const isStructuralOnly = segments.every(
    seg => /^\d+$/.test(seg) || seg === 'processors'
  );
  if (isStructuralOnly) { return null; }

  return elementPath.trim();
}

/**
 * Check if an XML line contains a reference to the target processor.
 *
 * Matches patterns like:
 *   <transform-message doc:name="Transform Message" ...>
 *   <ee:transform doc:name="Transform Message">
 *   <set-payload value="..." doc:name="Set Payload"/>
 */
function lineMatchesProcessor(line: string, processorName: string): boolean {
  const lower = line.toLowerCase();
  const target = processorName.toLowerCase();

  // Direct tag name match: <transform-message or <ee:transform-message
  if (lower.includes(`<${target}`) || lower.includes(`:${target}`)) {
    return true;
  }

  // doc:name attribute match (handles aliased elements)
  const docNameMatch = /doc:name\s*=\s*["']([^"']+)["']/i.exec(line);
  if (docNameMatch) {
    const docName = docNameMatch[1].toLowerCase().replace(/\s+/g, '-');
    if (docName === target || docName.includes(target) || target.includes(docName)) {
      return true;
    }
  }

  return false;
}

// ─── Internal — ranking ───────────────────────────────────────────────────────

const MATCH_SCORE: Record<SourceLocation['matchMethod'], number> = {
  exact:      3,
  fuzzy:      2,
  'flow-only': 1,
};

function rankCandidates(candidates: SourceLocation[]): SourceLocation {
  return candidates.sort(
    (a, b) => MATCH_SCORE[b.matchMethod] - MATCH_SCORE[a.matchMethod]
  )[0];
}

// ─── Internal — VS Code decoration ───────────────────────────────────────────

/**
 * Create a red gutter decoration for the failing line.
 * Disposed automatically after 8 seconds by openSourceLocation().
 */
function createFailureDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('errorForeground'),
    overviewRulerColor: new vscode.ThemeColor('errorForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: new vscode.ThemeIcon('error').id as any,
  });
}