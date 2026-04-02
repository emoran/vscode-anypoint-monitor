// src/fire/replayPanel.ts
// Failure Intelligence & Replay Engine — Replay Panel
//
// Renders the interactive debugger UI when a replay session is ready.
// Shows: flow context, extracted payload, variables, hypotheses, DW script editor.

import * as vscode from 'vscode';
import { ReplaySession, FailureHypothesis } from './types.js';
const FEEDBACK_STORAGE_KEY = 'fire.hypothesis.feedback';

const activePanels = new Map<string, vscode.WebviewPanel>();

export async function showReplayPanel(
  context: vscode.ExtensionContext,
  session: ReplaySession
): Promise<void> {
  // Reuse existing panel for same session
const existing = activePanels.get(session.sessionId);
  if (existing) {
    // FIX: Pull the new hypotheses and refresh the HTML content
    const newHypotheses: FailureHypothesis[] = (session.context.error as any)._hypotheses ?? [];
    existing.webview.html = getReplayPanelHtml(session, newHypotheses);
    
    existing.reveal(vscode.ViewColumn.Two);
    return;
  }

  // 2. Otherwise, create a new one
  const panel = vscode.window.createWebviewPanel(
    'fireReplay',
    `🔥 FIRE — ${session.context.applicationDomain}`,
    vscode.ViewColumn.Two,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  activePanels.set(session.sessionId, panel);

  panel.onDidDispose(() => {
    activePanels.delete(session.sessionId);
  });

  const hypotheses: FailureHypothesis[] = (session.context.error as any)._hypotheses ?? [];

  panel.webview.html = getReplayPanelHtml(session, hypotheses);


panel.webview.onDidReceiveMessage(async (message) => {
    console.log(`FIRE Panel: Received command: ${message.command}`);

    switch (message.command) {
        case 'jumpToSource':
            // IMPLEMENTATION MATCH: We use the orchestrator's jumpToSource 
            // specifically passing the single location from the session
            if (session.sourceLocation) {
                const { openSourceLocation } = await import('./sourceMapper.js');
                await openSourceLocation(session.sourceLocation);
            } else {
                vscode.window.showWarningMessage('Source location not available for this failure.');
            }
            break;

        case 'copyPayload':
            await vscode.env.clipboard.writeText(session.context.rawPayload ?? '{}');
            vscode.window.showInformationMessage('📦 Payload copied to clipboard');
            break;

        case 'copyScript':
            await vscode.env.clipboard.writeText(session.dataWeaveScript ?? '');
            vscode.window.showInformationMessage('⚙️ DataWeave script copied to clipboard');
            break;

      case 'hypothesisFeedback': {
        // Load existing feedback scores
        const raw = context.globalState.get<Record<string, number>>(FEEDBACK_STORAGE_KEY) ?? {};
        const key = `hypothesis.${message.title.toLowerCase().replace(/\s+/g, '_')}`;
        const current = raw[key] ?? 0;
        // Increment or decrement confidence weight based on feedback
        raw[key] = message.helpful ? current + 1 : Math.max(current - 1, -5);
        await context.globalState.update(FEEDBACK_STORAGE_KEY, raw);
        console.log(`FIRE: Feedback recorded for "${message.title}": ${message.helpful ? '+1' : '-1'} (total: ${raw[key]})`);
        break;
      }

        case 'openInPlayground':
            await vscode.commands.executeCommand('anypoint-monitor.dataweavePlayground');
            break;
    }
});
}

function getReplayPanelHtml(session: ReplaySession, hypotheses: FailureHypothesis[]): string {
  const error = session.context.error;
  const ctx   = session.context;

let payloadStr: string | null = null;
  let payloadHighlighted: string | null = null;

  if (ctx.rawPayload) {
    try {
      const parsed = JSON.parse(ctx.rawPayload);
      payloadStr = JSON.stringify(parsed, null, 2);

      // If hypothesis is field-not-found, highlight the missing field in the payload
      const fieldMatch = /field ['"]?(\w+)['"]?/i.exec(
        error.errorMessage ?? hypotheses[0]?.title ?? ''
      );
      const missingField = fieldMatch?.[1] ?? null;

      if (missingField) {
        // Highlight lines that contain the missing field key (or mark its absence)
        payloadHighlighted = payloadStr
          .split('\n')
          .map(line => {
            if (line.toLowerCase().includes(`"${missingField.toLowerCase()}"`)) {
              return `<mark class="field-present">${escHtml(line)}</mark>`;
            }
            return escHtml(line);
          })
          .join('\n');

        // If the field is NOT present in payload, add a missing field indicator
        if (!payloadStr.toLowerCase().includes(`"${missingField.toLowerCase()}"`)) {
          payloadHighlighted += `\n<span class="field-missing">  ⚠ "${missingField}" — field not found in this payload</span>`;
        }
      }
    } catch {
      payloadStr = ctx.rawPayload;
    }
  }

  const varsEntries  = Object.entries(ctx.variables);
  const attrsEntries = Object.entries(ctx.attributes);

const hypothesesHtml = hypotheses.length > 0
    ? hypotheses.map((h, i) => `
        <div class="hypothesis" id="hyp-${i}">
          <div class="h-header">
            <span class="h-rank">#${i + 1}</span>
            <span class="h-title">${escHtml(h.title)}</span>
            <span class="h-conf">${Math.round(h.confidence * 100)}%</span>
          </div>
          <div class="h-explanation">${escHtml(h.explanation)}</div>
          <div class="h-suggestion">💡 ${escHtml(h.suggestion)}</div>
          <div class="h-feedback" id="feedback-${i}">
            <span class="feedback-label">Was this helpful?</span>
            <button class="feedback-btn" onclick="sendFeedback(${i}, true, '${escHtml(h.title)}')">👍 Yes</button>
            <button class="feedback-btn" onclick="sendFeedback(${i}, false, '${escHtml(h.title)}')">👎 No</button>
          </div>
        </div>`).join('')
    : `<div class="empty-hint">No hypotheses generated for this error type</div>`;

const sourceHtml = session.sourceLocation
    ? `<div class="source-found">
        <span class="badge badge-ok">✅ Found</span>
        <span class="source-file">${escHtml(session.sourceLocation.filePath.split(/[\\/]/).pop() ?? 'unknown.xml')}</span>
        <span class="source-line">line ${session.sourceLocation.lineNumber + 1}</span>
        <span class="source-method">(${escHtml(session.sourceLocation.matchMethod)})</span>
        <button class="btn btn-sm" onclick="jumpToSource()">Open in editor</button>
       </div>`
    : `<div class="source-not-found">
        <span class="badge badge-warn">⚠️ Not found</span>
        <span>Open the Mule project folder in VS Code to enable source navigation</span>
       </div>`;

const dwHtml = session.dataWeaveScript
    ? `<pre class="code-block">${escHtml(session.dataWeaveScript)}</pre>
       <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
         <button class="btn btn-sm" onclick="copyScript()">Copy script</button>
         <span style="font-size:11px;opacity:0.5;">Paste into AM: DataWeave Playground · native playground injection coming Q2</span>
       </div>`
    : `<div class="empty-hint">No DataWeave script found — source mapping required</div>`;

  const varsHtml = varsEntries.length > 0
    ? varsEntries.map(([k, v]) => `
        <div class="kv-row">
          <span class="kv-key">vars.${escHtml(k)}</span>
          <span class="kv-val">${escHtml(v)}</span>
        </div>`).join('')
    : `<div class="empty-hint">No variables extracted</div>`;

  const attrsHtml = attrsEntries.length > 0
    ? attrsEntries.map(([k, v]) => `
        <div class="kv-row">
          <span class="kv-key">attributes.${escHtml(k)}</span>
          <span class="kv-val">${escHtml(v)}</span>
        </div>`).join('')
    : `<div class="empty-hint">No attributes extracted</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FIRE Replay</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0 0 40px 0;
  }
  .top-bar {
    background: var(--vscode-titleBar-activeBackground, #1e1e2e);
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .top-bar-title { font-size: 14px; font-weight: 600; }
  .top-bar-sub { font-size: 11px; opacity: 0.6; }
  .error-type-badge {
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    background: rgba(248,81,73,0.2);
    color: #f85149;
    border: 1px solid rgba(248,81,73,0.4);
    margin-left: auto;
  }
  .content { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
  .section {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .section-header {
    background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,0.05));
    padding: 8px 14px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vscode-sideBarSectionHeader-foreground);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-body { padding: 12px 14px; }
  .flow-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .flow-field { }
  .flow-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.5; margin-bottom: 3px; }
  .flow-value { font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
  .hypothesis {
    border-left: 3px solid #f85149;
    padding: 10px 12px;
    margin-bottom: 10px;
    border-radius: 0 4px 4px 0;
    background: rgba(248,81,73,0.05);
  }
  .hypothesis:last-child { margin-bottom: 0; }
  .h-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .h-rank {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: rgba(248,81,73,0.2);
    color: #f85149;
    font-size: 10px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .h-title { font-weight: 600; font-size: 12px; flex: 1; }
  .h-conf { font-size: 10px; opacity: 0.6; }
  .h-explanation { font-size: 12px; opacity: 0.8; margin-bottom: 6px; line-height: 1.5; }
  .h-suggestion { font-size: 12px; color: #3fb950; line-height: 1.5; }
  .code-block {
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 10px 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    overflow: auto;
    max-height: 200px;
    white-space: pre;
    margin-bottom: 8px;
  }
  .kv-row {
    display: flex;
    gap: 12px;
    padding: 5px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  .kv-row:last-child { border-bottom: none; }
  .kv-key { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); min-width: 160px; }
  .kv-val { opacity: 0.8; }
  .btn {
    padding: 5px 12px;
    border: 1px solid var(--vscode-button-border, #444);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    margin-right: 6px;
    margin-top: 4px;
  }
  .btn:hover { opacity: 0.85; }
  .btn-sm { padding: 3px 10px; font-size: 11px; }
  .badge {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
  }
  .badge-ok { background: rgba(63,185,80,0.15); color: #3fb950; }
  .badge-warn { background: rgba(210,153,34,0.15); color: #d29922; }
  .source-found { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .source-not-found { display: flex; align-items: center; gap: 8px; opacity: 0.8; }
  .source-file { font-family: monospace; font-size: 12px; }
  .source-line { opacity: 0.6; font-size: 11px; }
  .source-method { opacity: 0.5; font-size: 11px; }
  mark.field-present {
    background: rgba(63,185,80,0.25);
    color: inherit;
    border-radius: 2px;
  }
  .field-missing {
    color: #f85149;
    font-style: italic;
    font-size: 11px;
  }
  .h-feedback { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .feedback-label { font-size: 11px; opacity: 0.5; }
  .feedback-btn {
    padding: 2px 8px;
    font-size: 11px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    border-radius: 3px;
    cursor: pointer;
  }
  .feedback-btn:hover { background: var(--vscode-editor-inactiveSelectionBackground); }
  .feedback-thanks { font-size: 11px; opacity: 0.6; font-style: italic; }
  .empty-hint { opacity: 0.5; font-size: 12px; font-style: italic; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 600px) { .two-col { grid-template-columns: 1fr; } .flow-info { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="top-bar">
  <div>
    <div class="top-bar-title">🔥 Failure Replay — ${escHtml(ctx.applicationDomain)}</div>
    <div class="top-bar-sub">${new Date(ctx.timestamp).toISOString().replace('T', ' ').replace('Z', '')} · Flow: ${escHtml(error.flowName ?? 'unknown')}</div>
  </div>
  ${error.errorType ? `<div class="error-type-badge">${escHtml(error.errorType)}</div>` : ''}
</div>

<div class="content">

  <!-- Flow context -->
  <div class="section">
    <div class="section-header">⚡ Failure context</div>
    <div class="section-body">
      <div class="flow-info">
        <div class="flow-field">
          <div class="flow-label">Flow</div>
          <div class="flow-value">${escHtml(error.flowName ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Error type</div>
          <div class="flow-value">${escHtml(error.errorType ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Component</div>
          <div class="flow-value">${escHtml(error.elementPath ?? error.processorPath ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Category</div>
          <div class="flow-value">${escHtml(error.category)}</div>
        </div>
      </div>
      ${error.errorMessage ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(248,81,73,0.08);border-radius:4px;font-size:11px;font-family:monospace;line-height:1.5;overflow:auto;max-height:80px;">${escHtml(error.errorMessage)}</div>` : ''}
    </div>
  </div>

  <!-- Source location -->
  <div class="section">
    <div class="section-header">📄 Source location</div>
    <div class="section-body">${sourceHtml}</div>
  </div>

  <!-- Hypotheses -->
  <div class="section">
    <div class="section-header">🧠 Why did this fail?</div>
    <div class="section-body">${hypothesesHtml}</div>
  </div>

  <div class="two-col">

    <!-- Payload -->
    <div class="section">
      <div class="section-header">📦 Payload</div>
      <div class="section-body">
        ${payloadStr
          ? `<pre class="code-block">${payloadHighlighted ?? escHtml(payloadStr)}</pre>
             <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
               <button class="btn btn-sm" onclick="copyPayload()">Copy payload</button>
               <span style="font-size:11px;opacity:0.5;">Paste as input in AM: DataWeave Playground</span>
             </div>`
          : `<div class="empty-hint">No payload detected in log context</div>`}
      </div>
    </div>

    <!-- Variables & Attributes -->
    <div class="section">
      <div class="section-header">🔧 Variables &amp; attributes</div>
      <div class="section-body">
        ${varsHtml}
        ${attrsEntries.length > 0 ? `<div style="margin-top:8px;">${attrsHtml}</div>` : ''}
      </div>
    </div>

  </div>

  <!-- DataWeave script -->
  <div class="section">
    <div class="section-header">⚙️ DataWeave script</div>
    <div class="section-body">${dwHtml}</div>
  </div>

</div>

<script>
  // Acquire the API once at the top
  const vscode = acquireVsCodeApi();

  function jumpToSource() { 
    vscode.postMessage({ command: 'jumpToSource' }); 
  }

  function copyPayload() { 
    vscode.postMessage({ command: 'copyPayload' }); 
  }

  function copyScript() { 
    vscode.postMessage({ command: 'copyScript' }); 
  }

  function sendFeedback(index, helpful, title) {
    vscode.postMessage({ 
      command: 'hypothesisFeedback', 
      index: index, 
      helpful: helpful, 
      title: title 
    });
    
    const el = document.getElementById('feedback-' + index);
    if (el) {
      el.innerHTML = '<span class="feedback-thanks">✅ Thanks for the feedback!</span>';
    }
  }
</script>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
