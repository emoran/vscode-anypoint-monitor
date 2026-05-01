// src/fire/replayPanel.ts
// Failure Intelligence & Replay Engine — Replay Panel
//
// Renders the interactive debugger UI when a replay session is ready.
// Shows: flow context, extracted payload, variables, hypotheses, DW script editor.

import * as vscode from 'vscode';
import { ReplaySession, FailureHypothesis } from './types.js';
import {
    wrapWebviewHtml,
    badge,
    button,
    escapeHtml,
} from '../webview/ui-kit';

const FEEDBACK_STORAGE_KEY = 'fire.hypothesis.feedback';

const activePanels = new Map<string, vscode.WebviewPanel>();

export async function showReplayPanel(
    context: vscode.ExtensionContext,
    session: ReplaySession
): Promise<void> {
    const existing = activePanels.get(session.sessionId);
    if (existing) {
        const newHypotheses: FailureHypothesis[] = (session.context.error as any)._hypotheses ?? [];
        existing.webview.html = getReplayPanelHtml(session, newHypotheses);

        existing.reveal(vscode.ViewColumn.Two);
        return;
    }

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
                const raw = context.globalState.get<Record<string, number>>(FEEDBACK_STORAGE_KEY) ?? {};
                const key = `hypothesis.${message.title.toLowerCase().replace(/\s+/g, '_')}`;
                const current = raw[key] ?? 0;
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
    const ctx = session.context;

    let payloadStr: string | null = null;
    let payloadHighlighted: string | null = null;

    if (ctx.rawPayload) {
        try {
            const parsed = JSON.parse(ctx.rawPayload);
            payloadStr = JSON.stringify(parsed, null, 2);

            const fieldMatch = /field ['"]?(\w+)['"]?/i.exec(
                error.errorMessage ?? hypotheses[0]?.title ?? ''
            );
            const missingField = fieldMatch?.[1] ?? null;

            if (missingField) {
                payloadHighlighted = payloadStr
                    .split('\n')
                    .map(line => {
                        if (line.toLowerCase().includes(`"${missingField.toLowerCase()}"`)) {
                            return `<mark class="field-present">${escapeHtml(line)}</mark>`;
                        }
                        return escapeHtml(line);
                    })
                    .join('\n');

                if (!payloadStr.toLowerCase().includes(`"${missingField.toLowerCase()}"`)) {
                    payloadHighlighted += `\n<span class="field-missing">  ⚠ "${missingField}" — field not found in this payload</span>`;
                }
            }
        } catch {
            payloadStr = ctx.rawPayload;
        }
    }

    const varsEntries = Object.entries(ctx.variables);
    const attrsEntries = Object.entries(ctx.attributes);

    const hypothesesHtml = hypotheses.length > 0
        ? hypotheses.map((h, i) => {
            const titleJson = JSON.stringify(h.title);
            return `
        <div class="hypothesis" id="hyp-${i}">
          <div class="h-header">
            <span class="h-rank">#${i + 1}</span>
            <span class="h-title">${escapeHtml(h.title)}</span>
            <span class="h-conf">${Math.round(h.confidence * 100)}%</span>
          </div>
          <div class="h-explanation">${escapeHtml(h.explanation)}</div>
          <div class="h-suggestion">💡 ${escapeHtml(h.suggestion)}</div>
          <div class="h-feedback" id="feedback-${i}">
            <span class="feedback-label">Was this helpful?</span>
            ${button('👍 Yes', { variant: 'ghost', onclick: `sendFeedback(${i}, true, ${titleJson})` })}
            ${button('👎 No', { variant: 'ghost', onclick: `sendFeedback(${i}, false, ${titleJson})` })}
          </div>
        </div>`;
        }).join('')
        : `<div class="empty-hint">No hypotheses generated for this error type</div>`;

    const sourceHtml = session.sourceLocation
        ? `<div class="source-found">
        ${badge('✅ Found', 'success')}
        <span class="source-file">${escapeHtml(session.sourceLocation.filePath.split(/[\\/]/).pop() ?? 'unknown.xml')}</span>
        <span class="source-line">line ${session.sourceLocation.lineNumber + 1}</span>
        <span class="source-method">(${escapeHtml(session.sourceLocation.matchMethod)})</span>
        ${button('Open in editor', { variant: 'secondary', onclick: 'jumpToSource()' })}
       </div>`
        : `<div class="source-not-found">
        ${badge('⚠️ Not found', 'warning')}
        <span>Open the Mule project folder in VS Code to enable source navigation</span>
       </div>`;

    const dwHtml = session.dataWeaveScript
        ? `<pre class="code-block">${escapeHtml(session.dataWeaveScript)}</pre>
       <div class="replay-inline-actions">
         ${button('Copy script', { variant: 'secondary', onclick: 'copyScript()' })}
         <span class="replay-hint">Paste into AM: DataWeave Playground · native playground injection coming Q2</span>
       </div>`
        : `<div class="empty-hint">No DataWeave script found — source mapping required</div>`;

    const varsHtml = varsEntries.length > 0
        ? varsEntries.map(([k, v]) => `
        <div class="kv-row">
          <span class="kv-key">vars.${escapeHtml(k)}</span>
          <span class="kv-val">${escapeHtml(v)}</span>
        </div>`).join('')
        : `<div class="empty-hint">No variables extracted</div>`;

    const attrsHtml = attrsEntries.length > 0
        ? attrsEntries.map(([k, v]) => `
        <div class="kv-row">
          <span class="kv-key">attributes.${escapeHtml(k)}</span>
          <span class="kv-val">${escapeHtml(v)}</span>
        </div>`).join('')
        : `<div class="empty-hint">No attributes extracted</div>`;

    const headerRight = error.errorType
        ? `<div class="am-page-header-right">${badge(error.errorType, 'error')}</div>`
        : '';

    const body = `
<div class="am-container replay-root">
  <header class="am-page-header replay-page-header">
    <div>
      <h1>🔥 Failure Replay — ${escapeHtml(ctx.applicationDomain)}</h1>
      <div class="am-page-header-meta">
        <span class="am-timestamp">${escapeHtml(new Date(ctx.timestamp).toISOString().replace('T', ' ').replace('Z', ''))} · Flow: ${escapeHtml(error.flowName ?? 'unknown')}</span>
      </div>
    </div>
    ${headerRight}
  </header>

  <div class="replay-stack">

    <div class="am-card">
      <div class="am-card-title">⚡ Failure context</div>
      <div class="flow-info">
        <div class="flow-field">
          <div class="flow-label">Flow</div>
          <div class="flow-value">${escapeHtml(error.flowName ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Error type</div>
          <div class="flow-value">${escapeHtml(error.errorType ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Component</div>
          <div class="flow-value">${escapeHtml(error.elementPath ?? error.processorPath ?? 'unknown')}</div>
        </div>
        <div class="flow-field">
          <div class="flow-label">Category</div>
          <div class="flow-value">${escapeHtml(error.category)}</div>
        </div>
      </div>
      ${error.errorMessage ? `<div class="error-message-box">${escapeHtml(error.errorMessage)}</div>` : ''}
    </div>

    <div class="am-card">
      <div class="am-card-title">📄 Source location</div>
      ${sourceHtml}
    </div>

    <div class="am-card">
      <div class="am-card-title">🧠 Why did this fail?</div>
      ${hypothesesHtml}
    </div>

    <div class="two-col">
      <div class="am-card">
        <div class="am-card-title">📦 Payload</div>
        ${payloadStr
        ? `<pre class="code-block">${payloadHighlighted ?? escapeHtml(payloadStr)}</pre>
             <div class="replay-inline-actions">
               ${button('Copy payload', { variant: 'secondary', onclick: 'copyPayload()' })}
               <span class="replay-hint">Paste as input in AM: DataWeave Playground</span>
             </div>`
        : `<div class="empty-hint">No payload detected in log context</div>`}
      </div>

      <div class="am-card">
        <div class="am-card-title">🔧 Variables &amp; attributes</div>
        ${varsHtml}
        ${attrsEntries.length > 0 ? `<div class="attrs-block">${attrsHtml}</div>` : ''}
      </div>
    </div>

    <div class="am-card">
      <div class="am-card-title">⚙️ DataWeave script</div>
      ${dwHtml}
    </div>

  </div>
</div>
`;

    const extraStyles = `
        .replay-root { padding-bottom: 40px; }
        .replay-page-header { margin-bottom: 16px; }
        .replay-stack { display: flex; flex-direction: column; gap: 16px; }
        .replay-inline-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
            flex-wrap: wrap;
        }
        .replay-hint { font-size: 11px; color: var(--am-text-muted); }

        .flow-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .flow-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--am-text-muted);
            margin-bottom: 3px;
        }
        .flow-value {
            font-size: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--am-text-primary);
        }
        .error-message-box {
            margin-top: 10px;
            padding: 8px 10px;
            background: color-mix(in srgb, var(--am-error) 12%, transparent);
            border-radius: var(--am-radius-sm);
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            line-height: 1.5;
            overflow: auto;
            max-height: 80px;
            border: 1px solid color-mix(in srgb, var(--am-error) 35%, transparent);
            color: var(--am-text-primary);
        }

        .hypothesis {
            border-left: 3px solid var(--am-error);
            padding: 10px 12px;
            margin-bottom: 10px;
            border-radius: 0 var(--am-radius-sm) var(--am-radius-sm) 0;
            background: color-mix(in srgb, var(--am-error) 6%, transparent);
        }
        .hypothesis:last-child { margin-bottom: 0; }
        .h-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .h-rank {
            width: 20px; height: 20px;
            border-radius: 50%;
            background: color-mix(in srgb, var(--am-error) 20%, transparent);
            color: var(--am-error);
            font-size: 10px; font-weight: 700;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        .h-title { font-weight: 600; font-size: 12px; flex: 1; color: var(--am-text-primary); }
        .h-conf { font-size: 10px; color: var(--am-text-muted); }
        .h-explanation { font-size: 12px; color: var(--am-text-secondary); margin-bottom: 6px; line-height: 1.5; }
        .h-suggestion { font-size: 12px; color: var(--am-success); line-height: 1.5; }

        .code-block {
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
            padding: 10px 12px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            overflow: auto;
            max-height: 200px;
            white-space: pre;
            margin-bottom: 8px;
            color: var(--am-text-primary);
        }
        .kv-row {
            display: flex;
            gap: 12px;
            padding: 5px 0;
            border-bottom: 1px solid var(--am-border);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
        }
        .kv-row:last-child { border-bottom: none; }
        .kv-key { color: var(--am-info); min-width: 160px; }
        .kv-val { color: var(--am-text-secondary); }
        .attrs-block { margin-top: 8px; }

        .source-found { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .source-not-found { display: flex; align-items: center; gap: 8px; color: var(--am-text-secondary); }
        .source-file { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
        .source-line { color: var(--am-text-muted); font-size: 11px; }
        .source-method { color: var(--am-text-muted); font-size: 11px; }

        mark.field-present {
            background: color-mix(in srgb, var(--am-success) 28%, transparent);
            color: inherit;
            border-radius: 2px;
        }
        .field-missing {
            color: var(--am-error);
            font-style: italic;
            font-size: 11px;
        }

        .h-feedback { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
        .feedback-label { font-size: 11px; color: var(--am-text-muted); }
        .h-feedback .am-btn { padding: 4px 10px; font-size: 11px; }
        .feedback-thanks { font-size: 11px; color: var(--am-text-muted); font-style: italic; }
        .empty-hint { color: var(--am-text-muted); font-size: 12px; font-style: italic; }

        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 600px) {
            .two-col { grid-template-columns: 1fr; }
            .flow-info { grid-template-columns: 1fr; }
        }
    `;

    const scripts = `
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
`;

    return wrapWebviewHtml({
        title: 'FIRE Replay',
        body,
        scripts,
        extraStyles,
    });
}
