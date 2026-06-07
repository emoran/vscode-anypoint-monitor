// Log Search webview panel. Provides Anypoint Monitoring (OpenSearch) log search
// with automatic CloudHub fallback, single-app or environment-wide scope, and
// saved searches. UI follows the minimal dark "Rivian" aesthetic used elsewhere.

import * as vscode from 'vscode';
import { discoverApps } from './cloudhubLogs.js';
import { getOrgId, searchLogs } from './logSearchService.js';
import { getSavedSearches, saveSearch, deleteSavedSearch } from './savedSearches.js';
import { LogSearchCriteria, LogSearchResult, NormalizedLog, SavedSearch, SearchableApp } from './types.js';
import { telemetryService } from '../../services/telemetryService.js';

let currentPanel: vscode.WebviewPanel | undefined;
let logChannel: vscode.OutputChannel | undefined;

function lsLog(msg: string): void {
  if (!logChannel) { logChannel = vscode.window.createOutputChannel('Anypoint Log Search'); }
  logChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

export function registerLogSearchSerializer(context: vscode.ExtensionContext): void {
  // Re-wire Log Search webviews that VS Code restores after a window/extension
  // reload. Without this, restored tabs come back as dead webviews (stale HTML,
  // no message handler) and appear permanently stuck on the loading overlay.
  if (typeof vscode.window.registerWebviewPanelSerializer !== 'function') { return; }
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('anypointLogSearch', {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        currentPanel = panel;
        setupPanel(context, panel);
      }
    })
  );
}

export async function showLogSearchPanel(context: vscode.ExtensionContext): Promise<void> {
  telemetryService.trackPageView?.('logSearch');

  if (currentPanel) {
    // Reuse the live panel but always refresh its HTML so it re-runs init.
    currentPanel.reveal(vscode.ViewColumn.One);
    currentPanel.webview.html = getHtml(currentPanel.webview);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'anypointLogSearch',
    'Log Search',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel = panel;
  setupPanel(context, panel);
}

function setupPanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): void {
  panel.webview.options = { enableScripts: true };

  panel.onDidDispose(() => {
    currentPanel = undefined;
  });

  let lastResult: LogSearchResult | undefined;

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      switch (message.command) {
        case 'init': {
          lsLog('init received from webview');
          // Cache-only: never make a network call here so init can't hang.
          const { environments, selectedEnvironmentId } = await readCachedEnvironments(context);
          lsLog(`readCachedEnvironments -> ${environments.length} env(s)`);
          panel.webview.postMessage({
            command: 'initData',
            environments,
            selectedEnvironmentId,
            savedSearches: getSavedSearches(context)
          });
          lsLog('initData posted to webview');
          break;
        }
        case 'fetchEnvironments': {
          try {
            const { getEnvironments } = await import('../../controllers/anypointService.js');
            await getEnvironments(context, false);
          } catch (fetchErr: any) {
            console.warn('Log Search: environment fetch failed:', fetchErr?.message || fetchErr);
          }
          const { environments, selectedEnvironmentId } = await readCachedEnvironments(context);
          panel.webview.postMessage({
            command: 'initData',
            environments,
            selectedEnvironmentId,
            savedSearches: getSavedSearches(context)
          });
          break;
        }
        case 'loadApps': {
          const orgId = await getOrgId(context);
          const apps = await discoverApps(context, orgId, message.environmentId);
          apps.sort((a, b) => a.name.localeCompare(b.name));
          panel.webview.postMessage({ command: 'apps', apps });
          break;
        }
        case 'search': {
          const criteria = buildCriteria(message);
          panel.webview.postMessage({ command: 'searchStarted' });
          const result = await searchLogs(context, criteria, (done, total) => {
            panel.webview.postMessage({ command: 'searchProgress', done, total });
          });
          lastResult = result;
          panel.webview.postMessage({ command: 'results', result });
          break;
        }
        case 'tailPoll': {
          // Incremental single-app fetch for Live Tail: only logs newer than the
          // client's last seen timestamp. Reuses searchLogs with an explicit window.
          const criteria = buildCriteria(message);
          criteria.scope = 'single';
          criteria.app = message.app;
          const sinceMs = Number(message.sinceMs);
          if (sinceMs && isFinite(sinceMs)) {
            criteria.startTime = sinceMs + 1;
            criteria.endTime = Date.now();
          }
          criteria.limit = 300;
          const result = await searchLogs(context, criteria);
          // Keep lastResult in sync so Copy/Export include tailed lines.
          if (result.logs.length) {
            lastResult = mergeTail(lastResult, result);
          }
          panel.webview.postMessage({ command: 'tailResults', result });
          break;
        }
        case 'saveSearch': {
          const name = await vscode.window.showInputBox({
            prompt: 'Name this search',
            placeHolder: 'e.g. Prod errors last hour',
            validateInput: (v) => (v && v.trim() ? undefined : 'Name is required')
          });
          if (!name) { break; }
          await saveSearch(context, { name: name.trim(), criteria: message.criteria });
          panel.webview.postMessage({ command: 'savedSearches', savedSearches: getSavedSearches(context) });
          vscode.window.showInformationMessage(`Saved search "${name.trim()}".`);
          break;
        }
        case 'deleteSearch': {
          await deleteSavedSearch(context, message.id);
          panel.webview.postMessage({ command: 'savedSearches', savedSearches: getSavedSearches(context) });
          break;
        }
        case 'copy': {
          await vscode.env.clipboard.writeText(String(message.text ?? ''));
          vscode.window.showInformationMessage(message.label ? `Copied ${message.label}.` : 'Copied to clipboard.');
          break;
        }
        case 'export': {
          if (!lastResult || lastResult.logs.length === 0) {
            vscode.window.showWarningMessage('No logs to export. Run a search first.');
            break;
          }
          await exportLogs(lastResult, message.format);
          break;
        }
      }
    } catch (err: any) {
      panel.webview.postMessage({ command: 'error', message: err?.message || String(err) });
      vscode.window.showErrorMessage(`Log Search error: ${err?.message || err}`);
    }
  });

  // Set HTML last so the webview's initial 'init' message is not dropped before
  // the message listener above is attached.
  panel.webview.html = getHtml(panel.webview);
}

/**
 * Read the environment list from cache only (no network), so `init` can never
 * hang. Falls back to the legacy `anypoint.environments` secret. Returns an
 * empty list (rather than throwing) when nothing is cached; the webview then
 * offers a "Load environments" action that triggers the network fetch.
 */
async function readCachedEnvironments(
  context: vscode.ExtensionContext
): Promise<{ environments: { id: string; name: string }[]; selectedEnvironmentId: string }> {
  const { AccountService } = await import('../../controllers/accountService.js');
  const accountService = new AccountService(context);

  const parse = (raw?: string): { id: string; name: string }[] => {
    if (!raw) { return []; }
    try {
      const parsed = JSON.parse(raw);
      const data = Array.isArray(parsed) ? parsed : parsed?.data;
      return Array.isArray(data) ? data.map((e: any) => ({ id: e.id, name: e.name })) : [];
    } catch {
      return [];
    }
  };

  let environments: { id: string; name: string }[] = [];
  try {
    environments = parse(await accountService.getActiveAccountEnvironments());
  } catch (err: any) {
    console.warn('Log Search: reading account environments failed:', err?.message || err);
  }
  if (environments.length === 0) {
    environments = parse(await context.secrets.get('anypoint.environments'));
  }

  let selectedEnvironmentId = environments[0]?.id || '';
  const storedSelected = await context.secrets.get('anypoint.selectedEnvironment');
  if (storedSelected) {
    try {
      const parsed = JSON.parse(storedSelected);
      if (parsed?.id && environments.some((e) => e.id === parsed.id)) {
        selectedEnvironmentId = parsed.id;
      }
    } catch {
      // ignore
    }
  }

  return { environments, selectedEnvironmentId };
}

function buildCriteria(message: any): LogSearchCriteria {
  const windowMs: number = message.windowMs || 60 * 60 * 1000;
  const end = Date.now();
  const start = end - windowMs;
  const app: SearchableApp | undefined = message.app;
  return {
    environmentId: message.environmentId,
    environmentName: message.environmentName,
    searchText: message.searchText || '',
    logLevel: message.logLevel || '',
    startTime: start,
    endTime: end,
    limit: message.limit || 500,
    scope: message.scope === 'all' ? 'all' : 'single',
    app
  };
}

/** Dedup key for tail merging (NormalizedLog has no stable id). */
function tailKey(l: NormalizedLog): string {
  return (l.timestampMs || 0) + '|' + l.appName + '|' + (l.message || '');
}

/**
 * Merge freshly-tailed logs into the accumulated result, newest first, deduped,
 * and capped so a long-running tail does not grow memory without bound.
 */
function mergeTail(prev: LogSearchResult | undefined, next: LogSearchResult): LogSearchResult {
  const MAX_TAIL_LOGS = 5000;
  const base = prev ? prev.logs : [];
  const seen = new Set(base.map(tailKey));
  const fresh = next.logs.filter((l) => !seen.has(tailKey(l)));
  let logs = fresh.concat(base).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  if (logs.length > MAX_TAIL_LOGS) { logs = logs.slice(0, MAX_TAIL_LOGS); }
  return {
    logs,
    perApp: next.perApp,
    appsSearched: next.appsSearched,
    totalHits: logs.length,
    usedOpenSearch: Boolean(prev?.usedOpenSearch) || next.usedOpenSearch,
    usedFallback: Boolean(prev?.usedFallback) || next.usedFallback,
    errors: next.errors,
    truncated: next.truncated
  };
}

async function exportLogs(result: LogSearchResult, format: 'csv' | 'json'): Promise<void> {
  let content: string;
  let ext: string;
  if (format === 'json') {
    content = JSON.stringify(result.logs, null, 2);
    ext = 'json';
  } else {
    const header = 'Timestamp,Level,App,Type,Source,Logger,Message';
    const rows = result.logs.map((l) => {
      const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        esc(l.timestamp),
        esc(l.level),
        esc(l.appName),
        esc(l.appType),
        esc(l.source),
        esc(l.logger),
        esc(l.message)
      ].join(',');
    });
    content = [header, ...rows].join('\n');
    ext = 'csv';
  }

  const uri = await vscode.window.showSaveDialog({
    filters: format === 'json' ? { JSON: ['json'] } : { CSV: ['csv'] },
    defaultUri: vscode.Uri.file(`anypoint-logs-${Date.now()}.${ext}`)
  });
  if (!uri) { return; }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  vscode.window.showInformationMessage(`Exported ${result.logs.length} logs to ${uri.fsPath}`);
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function getHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';`;
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Log Search</title>
<style nonce="${nonce}">
  :root {
    --bg: #0d0d0f;
    --panel: #16161a;
    --panel-2: #1c1c21;
    --border: #2a2a30;
    --text: #f2f2f3;
    --text-2: #9a9aa3;
    --accent: #4a8cff;
    --error: #ff5c5c;
    --warn: #f0b54a;
    --info: #4a8cff;
    --debug: #8a8a93;
    --ok: #4caf6e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }
  .header { padding: 28px 28px 6px; }
  .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--text-2); margin: 0 0 8px; }
  h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.3px; margin: 0 0 4px; }
  .sub { color: var(--text-2); margin: 0; }
  .layout { display: flex; gap: 0; }
  .sidebar { width: 240px; border-right: 1px solid var(--border); padding: 20px; min-height: calc(100vh - 90px); }
  .main { flex: 1; padding: 20px 28px; min-width: 0; position: relative; }
  .loading-overlay { position: absolute; inset: 0; background: rgba(13,13,15,.72); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; z-index: 20; }
  .spinner { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { color: var(--text-2); font-size: 12px; letter-spacing: .5px; }
  .skeleton { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .skeleton .bar-line { height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--panel) 25%, var(--panel-2) 37%, var(--panel) 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; }
  .skeleton .bar-line:nth-child(2) { width: 80%; }
  .skeleton .bar-line:nth-child(3) { width: 60%; }
  @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
  .sidebar h2 { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-2); margin: 0 0 12px; }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px 16px; margin-bottom: 18px; align-items: end; }
  .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .field label { font-size: 10px; font-weight: 600; letter-spacing: .8px; text-transform: uppercase; color: var(--text-2); }
  input, select {
    height: 36px; width: 100%;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 0 11px; font-size: 13px; outline: none;
    transition: border-color .15s, box-shadow .15s, background-color .15s;
  }
  input::placeholder { color: var(--text-2); }
  input:hover, select:hover { border-color: #3a3a44; }
  input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(74,140,255,.18); background-color: var(--panel); }
  select {
    appearance: none; -webkit-appearance: none; -moz-appearance: none; cursor: pointer;
    padding-right: 30px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a9aa3' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 11px center;
  }
  #searchText {
    height: 40px; padding-left: 36px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: 13px center;
  }
  .full { grid-column: 1 / -1; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
    transition: border-color .15s, background-color .15s, box-shadow .15s, transform .05s;
  }
  button:hover { border-color: var(--accent); background-color: var(--panel); }
  button:active { transform: translateY(1px); }
  .row button { height: 36px; padding: 0 16px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button.primary:hover { background-color: #5c98ff; border-color: #5c98ff; box-shadow: 0 4px 14px rgba(74,140,255,.28); }
  button.ghost { background: transparent; }
  button.ghost:hover { background-color: var(--panel-2); }
  .toggle { display: flex; width: 100%; height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); padding: 3px; gap: 3px; }
  .toggle button { flex: 1; height: 100%; border: none; border-radius: 6px; background: transparent; color: var(--text-2); padding: 0 8px; font-size: 12px; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; transition: background-color .15s, color .15s; }
  .toggle button:hover { background-color: var(--panel); color: var(--text); }
  .toggle button:active { transform: none; }
  .toggle button.active { background-color: var(--accent); color: #fff; font-weight: 600; box-shadow: 0 1px 4px rgba(74,140,255,.4); }
  .summary { color: var(--text-2); margin: 6px 0 12px; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; letter-spacing: .4px; border: 1px solid var(--border); }
  .badge.os { color: var(--ok); border-color: var(--ok); }
  .badge.cloudhub { color: var(--warn); border-color: var(--warn); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--text-2); padding: 8px 10px; border-bottom: 1px solid var(--border); position: sticky; top: 58px; background: var(--bg); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:hover td { background: var(--panel); }
  .lvl { font-weight: 600; font-size: 11px; }
  .lvl.ERROR { color: var(--error); }
  .lvl.WARN { color: var(--warn); }
  .lvl.INFO { color: var(--info); }
  .lvl.DEBUG, .lvl.TRACE { color: var(--debug); }
  .ts { color: var(--text-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .msg { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; word-break: break-word; white-space: pre-wrap; }
  .app { color: var(--text-2); white-space: nowrap; }
  .saved-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; }
  .saved-item .name { cursor: pointer; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .saved-item .name:hover { color: var(--accent); }
  .saved-item .del { color: var(--text-2); cursor: pointer; border: none; background: none; padding: 2px 6px; }
  .saved-item .del:hover { color: var(--error); }
  .empty { color: var(--text-2); font-size: 12px; }
  .hidden { display: none; }
  tr.log-row { cursor: pointer; }
  tr.log-row .caret { color: var(--text-2); display: inline-block; width: 12px; transition: transform .12s; }
  tr.log-row.open .caret { transform: rotate(90deg); }
  td.detail-cell { background: var(--panel); padding: 0; }
  .detail { padding: 14px 16px; border-left: 2px solid var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
  .chip:hover { border-color: var(--accent); }
  .chip .k { color: var(--text-2); text-transform: uppercase; letter-spacing: .4px; }
  .chip .v { font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .chip.key-field { border-color: var(--accent); }
  .chip.key-field .v { color: var(--accent); }
  .detail-actions { display: flex; gap: 8px; margin-bottom: 10px; }
  button.small { padding: 4px 9px; font-size: 11px; }
  .section-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-2); margin: 10px 0 6px; }
  .json, .stack { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
  .jrow { white-space: nowrap; }
  .jchildren { margin-left: 16px; border-left: 1px solid var(--border); padding-left: 8px; }
  .jchildren.collapsed { display: none; }
  .jheader { cursor: pointer; display: inline-flex; gap: 4px; align-items: baseline; }
  .jtoggle { color: var(--text-2); width: 10px; display: inline-block; }
  .jkey { color: var(--accent); }
  .jpunct { color: var(--text-2); }
  .jval.string { color: var(--ok); white-space: pre-wrap; }
  .jval.number { color: var(--warn); }
  .jval.boolean { color: var(--info); }
  .jval.object { color: var(--text-2); }
  .stack .shead { color: var(--error); white-space: pre-wrap; }
  .stack .scause { color: var(--warn); white-space: pre-wrap; }
  .stack .sframe { color: var(--text-2); white-space: pre-wrap; }
  .rawmsg { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .chart { margin: 2px 0 18px; }
  .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .chart-title { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-2); }
  .chart-caption { font-size: 11px; color: var(--text-2); }
  .chart-caption .clear { color: var(--accent); cursor: pointer; margin-left: 8px; }
  .chart-caption .clear:hover { text-decoration: underline; }
  .chart-bars { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 96px; border-bottom: 1px solid var(--border); }
  .bar { flex: 1 1 0; min-width: 2px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; cursor: pointer; }
  .bar .seg-rest { width: 100%; background: var(--accent); opacity: .55; border-radius: 2px 2px 0 0; transition: opacity .1s; }
  .bar .seg-err { width: 100%; background: var(--error); opacity: .75; border-radius: 2px 2px 0 0; }
  .bar:hover .seg-rest { opacity: .9; }
  .bar:hover .seg-err { opacity: 1; }
  .bar.active .seg-rest { opacity: 1; }
  .bar.zero { align-items: stretch; }
  .chart-axis { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .chart-tip { position: absolute; transform: translateX(-50%); bottom: 104px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; font-size: 11px; white-space: nowrap; pointer-events: none; display: none; z-index: 5; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
  .progress { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 12px; }
  .progress > div { height: 100%; width: 0; background: var(--accent); transition: width .2s; }
  .err { color: var(--error); font-size: 12px; margin: 8px 0; }
  mark { background: rgba(122,162,247,.32); color: var(--text); border-radius: 2px; padding: 0 1px; }
  .results-toolbar { position: sticky; top: 0; z-index: 6; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 0; margin-bottom: 4px; background: var(--bg); border-bottom: 1px solid var(--border); }
  .filter-input { flex: 1 1 240px; min-width: 180px; height: 34px; padding: 0 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12.5px; transition: border-color .15s, box-shadow .15s, background-color .15s; }
  .filter-input::placeholder { color: var(--text-2); }
  .filter-input:hover { border-color: #3a3a44; }
  .filter-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(74,140,255,.18); background-color: var(--panel); }
  .level-pills { display: flex; gap: 7px; flex-wrap: wrap; }
  .lvl-pill { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel-2); color: var(--text-2); font-size: 11px; font-weight: 500; cursor: pointer; transition: border-color .15s, background-color .15s, color .15s; }
  .lvl-pill:hover { border-color: #3a3a44; background-color: var(--panel); color: var(--text); }
  .lvl-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-2); transition: box-shadow .15s; }
  .lvl-pill .cnt { font-variant-numeric: tabular-nums; color: var(--text-2); font-weight: 600; }
  .lvl-pill.on { color: var(--text); }
  .lvl-pill.on .cnt { color: var(--text); }
  .lvl-pill.ERROR .dot { background: var(--error); }
  .lvl-pill.WARN .dot { background: var(--warn); }
  .lvl-pill.INFO .dot { background: var(--info); }
  .lvl-pill.DEBUG .dot, .lvl-pill.TRACE .dot { background: var(--debug); }
  .lvl-pill.ERROR.on { border-color: var(--error); background-color: rgba(255,92,92,.14); }
  .lvl-pill.WARN.on { border-color: var(--warn); background-color: rgba(240,181,74,.14); }
  .lvl-pill.INFO.on { border-color: var(--info); background-color: rgba(74,140,255,.14); }
  .lvl-pill.DEBUG.on, .lvl-pill.TRACE.on { border-color: var(--debug); background-color: rgba(138,138,147,.16); }
  .lvl-pill.on .dot { box-shadow: 0 0 0 3px rgba(255,255,255,.06); }
  .result-count { margin-left: auto; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .result-count strong { color: var(--text); font-weight: 600; }
  .active-chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .active-chips:not(:empty) { margin: 12px 0 4px; }
  .fchip { display: inline-flex; align-items: center; gap: 7px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 999px; padding: 4px 6px 4px 11px; font-size: 11px; color: var(--text); transition: border-color .15s; }
  .fchip:hover { border-color: #3a3a44; }
  .fchip .fk { color: var(--text-2); text-transform: uppercase; letter-spacing: .5px; font-weight: 600; font-size: 10px; }
  .fchip .fx { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; cursor: pointer; color: var(--text-2); font-size: 13px; line-height: 1; transition: background-color .15s, color .15s; }
  .fchip .fx:hover { background-color: rgba(255,92,92,.16); color: var(--error); }
  .empty-state { text-align: center; color: var(--text-2); padding: 40px 16px; font-size: 12px; }
  .empty-state .big { font-size: 13px; color: var(--text); margin-bottom: 4px; }
  .skel-row td { padding: 0; border-bottom: 1px solid var(--border); }
  .skel-bar { height: 12px; margin: 9px 10px; border-radius: 4px; background: linear-gradient(90deg, var(--panel) 25%, var(--panel-2) 37%, var(--panel) 63%); background-size: 400% 100%; animation: lsShimmer 1.2s ease-in-out infinite; }
  @keyframes lsShimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

  /* ---- Live Tail ---- */
  .tail-row { margin-top: -6px; }
  .tail-btn { display: inline-flex; align-items: center; gap: 8px; }
  .tail-btn.on { border-color: var(--accent); background-color: var(--panel); }
  .tail-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-2); flex: none; }
  .tail-btn.on .tail-dot { background: #36d399; box-shadow: 0 0 0 0 rgba(54,211,153,.6); animation: tailPulse 1.4s infinite; }
  .tail-btn.paused .tail-dot { background: #f5c451; animation: none; box-shadow: none; }
  @keyframes tailPulse {
    0% { box-shadow: 0 0 0 0 rgba(54,211,153,.55); }
    70% { box-shadow: 0 0 0 6px rgba(54,211,153,0); }
    100% { box-shadow: 0 0 0 0 rgba(54,211,153,0); }
  }
  .tail-opts { display: inline-flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .tail-opts.hidden { display: none; }
  .tail-int, .tail-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
  .tail-int select { height: 30px; width: auto; padding: 0 26px 0 9px; }
  .tail-check input { width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
  .tail-status { font-size: 12px; color: var(--text-2); min-height: 16px; }
  .tail-status .new { color: #36d399; font-weight: 600; }
  button.small { height: 30px; padding: 0 11px; font-size: 12.5px; }
  tr.log-row.flash > td { animation: rowFlash 1.4s ease-out; }
  tr.log-row.flash-error > td { animation: rowFlashError 1.6s ease-out; }
  @keyframes rowFlash {
    0% { background-color: rgba(99,179,237,.22); }
    100% { background-color: transparent; }
  }
  @keyframes rowFlashError {
    0% { background-color: rgba(255,92,92,.28); }
    100% { background-color: transparent; }
  }
</style>
</head>
<body>
  <div class="header">
    <p class="eyebrow">Anypoint Monitor &middot; Observability</p>
    <h1>Log Search</h1>
    <p class="sub">Search Anypoint Monitoring logs with automatic CloudHub fallback.</p>
  </div>
  <div class="layout">
    <div class="sidebar">
      <h2>Saved Searches</h2>
      <div id="savedList"><p class="empty">No saved searches yet.</p></div>
    </div>
    <div class="main">
      <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text">Loading environments&hellip;</div>
        <div class="skeleton">
          <div class="bar-line"></div>
          <div class="bar-line"></div>
          <div class="bar-line"></div>
        </div>
      </div>
      <div class="controls">
        <div class="field">
          <label>Environment</label>
          <select id="env"></select>
        </div>
        <div class="field">
          <label>Scope</label>
          <div class="toggle" id="scopeToggle">
            <button data-scope="single" class="active">Single app</button>
            <button data-scope="all">All apps</button>
          </div>
        </div>
        <div class="field" id="appField">
          <label>Application</label>
          <select id="app"><option value="">Loading...</option></select>
        </div>
        <div class="field">
          <label>Log level</label>
          <select id="level">
            <option value="">Any</option>
            <option value="ERROR">ERROR</option>
            <option value="WARN">WARN</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
            <option value="TRACE">TRACE</option>
          </select>
        </div>
        <div class="field">
          <label>Time window</label>
          <select id="window">
            <option value="900000">Last 15 minutes</option>
            <option value="3600000" selected>Last 1 hour</option>
            <option value="21600000">Last 6 hours</option>
            <option value="86400000">Last 24 hours</option>
            <option value="604800000">Last 7 days</option>
          </select>
        </div>
        <div class="field full">
          <label>Search text (free text, correlation id, deal id)</label>
          <input id="searchText" type="text" placeholder="e.g. order processing failed, or a correlation id" />
        </div>
      </div>
      <div class="row">
        <button class="primary" id="searchBtn">Search</button>
        <button class="ghost" id="saveBtn">Save search</button>
        <button class="ghost" id="exportCsv">Export CSV</button>
        <button class="ghost" id="exportJson">Export JSON</button>
      </div>
      <div class="row tail-row" id="tailRow">
        <button class="ghost tail-btn" id="tailBtn" title="Live-tail this app's logs (single app only)">
          <span class="tail-dot" id="tailDot"></span><span id="tailBtnLabel">Live Tail</span>
        </button>
        <div class="tail-opts hidden" id="tailOpts">
          <label class="tail-int">Every
            <select id="tailInterval">
              <option value="3000">3s</option>
              <option value="5000" selected>5s</option>
              <option value="10000">10s</option>
              <option value="30000">30s</option>
            </select>
          </label>
          <button class="ghost small" id="tailPause">Pause</button>
          <label class="tail-check"><input type="checkbox" id="tailAutoScrollCb" checked /> Auto-scroll</label>
          <span class="tail-status" id="tailStatus"></span>
        </div>
      </div>
      <div class="progress hidden" id="progress"><div id="progressBar"></div></div>
      <div id="errBox"></div>
      <div class="summary" id="summary"></div>
      <div class="chart hidden" id="chart"></div>
      <div class="results-toolbar hidden" id="resultsToolbar">
        <input id="filterInput" class="filter-input" type="text" placeholder="Filter these results (&#8984;K)" />
        <div class="level-pills" id="levelPills"></div>
        <span class="result-count" id="resultCount"></span>
      </div>
      <div class="active-chips" id="activeChips"></div>
      <div id="resultsWrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Level</th><th>App</th><th>Logger</th><th>Message</th></tr>
          </thead>
          <tbody id="resultsBody"></tbody>
        </table>
      </div>
    </div>
  </div>

<script nonce="${nonce}">
  // First statement: CSP/acquire-independent proof the script executes. If the
  // overlay never changes from "Loading environments..." the script is blocked.
  (function () {
    var o = document.getElementById('loadingOverlay');
    if (o) { var el = o.querySelector('.loading-text'); if (el) { el.textContent = 'Initializing\u2026'; } }
  })();

  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch (e) {
    var o2 = document.getElementById('loadingOverlay');
    if (o2) { var el2 = o2.querySelector('.loading-text'); if (el2) { el2.textContent = 'API error: ' + (e && e.message ? e.message : e); } }
    throw e;
  }

  let apps = [];
  let scope = 'single';
  let allLogs = [];
  let bucketFilter = null;
  let activeBarIndex = -1;
  let textFilter = '';
  let levelFilter = new Set();

  // ---- Live Tail state ----
  let tailing = false;
  let tailPaused = false;
  let tailTimer = null;
  let tailIntervalMs = 5000;
  let tailAutoScroll = true;
  let lastTailMs = 0;
  let tailSeen = new Set();
  let flashKeys = new Set();
  const TAIL_MAX_LOGS = 5000;

  const $ = (id) => document.getElementById(id);

  function clientTailKey(l) {
    return (l.timestampMs || 0) + '|' + l.appName + '|' + (l.message || '');
  }

  function setLoadingText(t) {
    const o = $('loadingOverlay');
    if (o) { const el = o.querySelector('.loading-text'); if (el) { el.textContent = t; } }
  }

  function setScope(next) {
    scope = next;
    document.querySelectorAll('#scopeToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.scope === next);
    });
    $('appField').classList.toggle('hidden', next === 'all');
    // Live Tail is single-app only.
    if (next === 'all') {
      if (tailing) { stopTail(); }
      $('tailBtn').disabled = true;
      $('tailBtn').title = 'Live Tail works on a single app. Switch scope to Single app.';
    } else {
      $('tailBtn').disabled = false;
      $('tailBtn').title = "Live-tail this app's logs (single app only)";
    }
  }

  document.querySelectorAll('#scopeToggle button').forEach(b => {
    b.addEventListener('click', () => setScope(b.dataset.scope));
  });

  $('env').addEventListener('change', () => loadApps());

  function loadApps() {
    const environmentId = $('env').value;
    if (!environmentId) { return; }
    $('app').innerHTML = '<option value="">Loading...</option>';
    vscode.postMessage({ command: 'loadApps', environmentId });
  }

  function selectedApp() {
    const name = $('app').value;
    return apps.find(a => a.name + '::' + a.type === name);
  }

  function currentCriteriaMsg() {
    const app = selectedApp();
    return {
      environmentId: $('env').value,
      environmentName: $('env').selectedOptions[0] ? $('env').selectedOptions[0].textContent : '',
      searchText: $('searchText').value.trim(),
      logLevel: $('level').value,
      windowMs: Number($('window').value),
      scope,
      app: scope === 'single' ? app : undefined
    };
  }

  $('searchBtn').addEventListener('click', () => {
    if (!$('env').value) { showError('Select an environment.'); return; }
    if (scope === 'single' && !selectedApp()) { showError('Select an application.'); return; }
    showError('');
    if (tailing) { stopTail(); }
    vscode.postMessage(Object.assign({ command: 'search' }, currentCriteriaMsg()));
  });

  // ---- Live Tail controls ----
  $('tailBtn').addEventListener('click', () => { tailing ? stopTail() : startTail(); });
  $('tailPause').addEventListener('click', () => {
    if (!tailing) { return; }
    tailPaused = !tailPaused;
    $('tailPause').textContent = tailPaused ? 'Resume' : 'Pause';
    $('tailBtn').classList.toggle('paused', tailPaused);
    setTailStatus(tailPaused ? 'Paused' : 'Live');
  });
  $('tailInterval').addEventListener('change', () => {
    tailIntervalMs = Number($('tailInterval').value) || 5000;
  });
  $('tailAutoScrollCb').addEventListener('change', () => {
    tailAutoScroll = $('tailAutoScrollCb').checked;
  });

  function setTailStatus(text, newCount) {
    const el = $('tailStatus');
    if (!el) { return; }
    el.innerHTML = '';
    if (newCount && newCount > 0) {
      const s = document.createElement('span');
      s.className = 'new';
      s.textContent = '+' + newCount + ' new';
      el.appendChild(s);
      el.appendChild(document.createTextNode(' \u00b7 ' + text));
    } else {
      el.appendChild(document.createTextNode(text));
    }
  }

  function startTail() {
    if (scope !== 'single') { showError('Live Tail works on a single app. Switch scope to Single app.'); return; }
    if (!$('env').value || !selectedApp()) { showError('Select an environment and application first.'); return; }
    showError('');
    tailing = true;
    tailPaused = false;
    tailIntervalMs = Number($('tailInterval').value) || 5000;
    tailAutoScroll = $('tailAutoScrollCb').checked;
    // Seed dedup + cursor from whatever is already on screen.
    tailSeen = new Set(allLogs.map(clientTailKey));
    lastTailMs = allLogs.reduce((m, l) => Math.max(m, l.timestampMs || 0), 0) || (Date.now() - 60000);
    $('tailBtn').classList.add('on');
    $('tailBtn').classList.remove('paused');
    $('tailBtnLabel').textContent = 'Stop Tail';
    $('tailOpts').classList.remove('hidden');
    $('tailPause').textContent = 'Pause';
    setTailStatus('Starting\u2026');
    doTailPoll();
  }

  function stopTail() {
    tailing = false;
    tailPaused = false;
    if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
    $('tailBtn').classList.remove('on', 'paused');
    $('tailBtnLabel').textContent = 'Live Tail';
    $('tailOpts').classList.add('hidden');
    setTailStatus('');
  }

  function scheduleTail() {
    if (!tailing) { return; }
    if (tailTimer) { clearTimeout(tailTimer); }
    tailTimer = setTimeout(() => {
      if (!tailing) { return; }
      if (tailPaused) { scheduleTail(); return; }
      doTailPoll();
    }, tailIntervalMs);
  }

  function doTailPoll() {
    const c = currentCriteriaMsg();
    if (!c.app) { stopTail(); showError('Application is no longer selected; tail stopped.'); return; }
    vscode.postMessage(Object.assign({ command: 'tailPoll', sinceMs: lastTailMs }, c));
  }

  function handleTailResults(result) {
    const incoming = (result && result.logs) || [];
    const fresh = [];
    for (const l of incoming) {
      const k = clientTailKey(l);
      if (tailSeen.has(k)) { continue; }
      tailSeen.add(k);
      fresh.push(l);
    }
    const now = new Date();
    const clock = now.toLocaleTimeString();
    if (!fresh.length) {
      setTailStatus((tailPaused ? 'Paused' : 'Live') + ' \u00b7 ' + clock);
      scheduleTail();
      return;
    }
    for (const l of fresh) {
      if ((l.timestampMs || 0) > lastTailMs) { lastTailMs = l.timestampMs; }
    }
    allLogs = fresh.concat(allLogs);
    if (allLogs.length > TAIL_MAX_LOGS) { allLogs = allLogs.slice(0, TAIL_MAX_LOGS); }
    tailSeen = new Set(allLogs.map(clientTailKey));
    flashKeys = new Set(fresh.map(clientTailKey));
    $('resultsToolbar').classList.remove('hidden');
    renderChart(allLogs);
    applyFilter();
    setTailStatus((tailPaused ? 'Paused' : 'Live') + ' \u00b7 ' + clock, fresh.length);
    if (tailAutoScroll) {
      const w = $('resultsWrap');
      if (w) { w.scrollTop = 0; }
    }
    setTimeout(() => {
      flashKeys.clear();
      document.querySelectorAll('.log-row.flash, .log-row.flash-error').forEach((r) => {
        r.classList.remove('flash', 'flash-error');
      });
    }, 1600);
    scheduleTail();
  }

  $('saveBtn').addEventListener('click', () => {
    if (!$('env').value) { showError('Select an environment before saving.'); return; }
    const c = currentCriteriaMsg();
    vscode.postMessage({
      command: 'saveSearch',
      criteria: {
        environmentId: c.environmentId,
        environmentName: c.environmentName,
        searchText: c.searchText,
        logLevel: c.logLevel,
        scope: c.scope,
        app: c.app,
        windowMs: c.windowMs
      }
    });
  });

  $('exportCsv').addEventListener('click', () => vscode.postMessage({ command: 'export', format: 'csv' }));
  $('exportJson').addEventListener('click', () => vscode.postMessage({ command: 'export', format: 'json' }));

  // Enter in the query box runs a server search.
  $('searchText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('searchBtn').click(); }
  });

  // Instant client-side filter over the already-fetched results.
  $('filterInput').addEventListener('input', () => {
    textFilter = $('filterInput').value.trim();
    applyFilter();
  });

  // Keyboard: Cmd/Ctrl+K focuses the instant filter, Esc clears it.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      const fi = $('filterInput');
      if (fi && !$('resultsToolbar').classList.contains('hidden')) {
        e.preventDefault(); fi.focus(); fi.select();
      }
    } else if (e.key === 'Escape') {
      const fi = $('filterInput');
      if (fi && document.activeElement === fi && fi.value) {
        fi.value = ''; textFilter = ''; applyFilter();
      }
    }
  });

  function showError(msg) {
    $('errBox').innerHTML = '';
    if (msg) {
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      $('errBox').appendChild(d);
    }
  }

  function fmtTime(ms, iso) {
    if (!ms) { return iso || ''; }
    const d = new Date(ms);
    return d.toLocaleString();
  }

  function copyToClipboard(text, label) {
    vscode.postMessage({ command: 'copy', text: text, label: label });
  }

  // ---- Payload parsing helpers (client-side, operate on the raw message) ----

  function tryParseJson(s) {
    try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
  }

  function extractJson(message) {
    if (!message) { return null; }
    const t = message.trim();
    let r = tryParseJson(t);
    if (r) { return r; }
    const fo = t.indexOf('{'), lo = t.lastIndexOf('}');
    if (fo >= 0 && lo > fo) { r = tryParseJson(t.slice(fo, lo + 1)); if (r) { return r; } }
    const fa = t.indexOf('['), la = t.lastIndexOf(']');
    if (fa >= 0 && la > fa) { r = tryParseJson(t.slice(fa, la + 1)); if (r) { return r; } }
    return null;
  }

  function deepFind(obj, keysLower, out, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) { return; }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const kl = k.toLowerCase();
      if (keysLower[kl] && out[keysLower[kl]] === undefined && (v === null || typeof v !== 'object')) {
        out[keysLower[kl]] = v === null ? 'null' : String(v);
      }
      if (v && typeof v === 'object') { deepFind(v, keysLower, out, depth + 1); }
    }
  }

  // Maps various raw key spellings to a normalized display key.
  const FIELD_MAP = {
    'correlationid': 'correlationId', 'correlation_id': 'correlationId',
    'tracepoint': 'tracePoint', 'elapsed': 'elapsed', 'priority': 'priority',
    'dealid': 'dealId', 'deal_id': 'dealId', 'traceid': 'traceId', 'trace_id': 'traceId',
    'apiname': 'apiName', 'flowname': 'flowName', 'flow': 'flow', 'processor': 'processor',
    'content': 'content', 'message': 'payloadMessage', 'errortype': 'errorType', 'error_type': 'errorType'
  };

  function extractFields(message, json) {
    const out = {};
    if (json) { deepFind(json, FIELD_MAP, out, 0); }
    const order = ['correlationId', 'tracePoint', 'elapsed', 'priority', 'dealId', 'traceId', 'apiName', 'flowName', 'errorType'];
    if (message) {
      for (const display of order) {
        if (out[display] !== undefined) { continue; }
        const re = new RegExp(display + '["\\s:=]+"?([\\w.:\\-/]+)', 'i');
        const m = message.match(re);
        if (m) { out[display] = m[1]; }
      }
    }
    const ordered = {};
    for (const k of order) { if (out[k] !== undefined) { ordered[k] = out[k]; } }
    for (const k of Object.keys(out)) { if (ordered[k] === undefined) { ordered[k] = out[k]; } }
    return ordered;
  }

  function looksLikeStack(message) {
    if (!message) { return false; }
    if (/^\\s*at\\s+[\\w$.]/m.test(message)) { return true; }
    if (/Caused by:/.test(message)) { return true; }
    if (/(Exception|Error|Throwable)[:\\s]/.test(message) && /\\bat\\b/.test(message)) { return true; }
    return false;
  }

  function addChip(container, key, value, isKeyField) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (isKeyField ? ' key-field' : '');
    const k = document.createElement('span'); k.className = 'k'; k.textContent = key;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = value;
    chip.appendChild(k); chip.appendChild(v);
    chip.title = 'Click to copy';
    chip.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(value, key); });
    container.appendChild(chip);
  }

  function renderJsonValue(value, key) {
    const row = document.createElement('div');
    row.className = 'jrow';
    if (value !== null && typeof value === 'object') {
      const isArr = Array.isArray(value);
      const entries = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const header = document.createElement('div');
      header.className = 'jheader';
      const toggle = document.createElement('span'); toggle.className = 'jtoggle'; toggle.textContent = '\u25be';
      header.appendChild(toggle);
      if (key !== null) { const kk = document.createElement('span'); kk.className = 'jkey'; kk.textContent = key + ': '; header.appendChild(kk); }
      const brace = document.createElement('span'); brace.className = 'jpunct';
      brace.textContent = isArr ? '[' + entries.length + ']' : '{' + entries.length + '}';
      header.appendChild(brace);
      const children = document.createElement('div'); children.className = 'jchildren';
      for (const [ck, cv] of entries) { children.appendChild(renderJsonValue(cv, ck)); }
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = children.classList.toggle('collapsed');
        toggle.textContent = hidden ? '\u25b8' : '\u25be';
      });
      row.appendChild(header); row.appendChild(children);
    } else {
      if (key !== null) { const kk = document.createElement('span'); kk.className = 'jkey'; kk.textContent = key + ': '; row.appendChild(kk); }
      const val = document.createElement('span');
      val.className = 'jval ' + (value === null ? 'object' : typeof value);
      val.textContent = value === null ? 'null' : (typeof value === 'string' ? '"' + value + '"' : String(value));
      row.appendChild(val);
    }
    return row;
  }

  function renderStack(message) {
    const box = document.createElement('div');
    box.className = 'stack';
    const lines = message.split(/\\r?\\n/);
    let frames = 0;
    let hiddenCount = 0;
    for (const ln of lines) {
      const div = document.createElement('div');
      const isFrame = /^\\s*at\\s/.test(ln) || /^\\s*\\.\\.\\.\\s/.test(ln);
      const isCause = /^\\s*Caused by:/.test(ln);
      div.className = isFrame ? 'sframe' : (isCause ? 'scause' : 'shead');
      div.textContent = ln;
      if (isFrame) { frames++; if (frames > 6) { div.classList.add('hidden'); hiddenCount++; } }
      box.appendChild(div);
    }
    if (hiddenCount > 0) {
      const btn = document.createElement('button');
      btn.className = 'ghost small';
      btn.textContent = 'Show ' + hiddenCount + ' more frames';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        box.querySelectorAll('.sframe.hidden').forEach((el) => el.classList.remove('hidden'));
        btn.remove();
      });
      box.appendChild(btn);
    }
    return box;
  }

  function buildDetail(log) {
    const wrap = document.createElement('div');
    wrap.className = 'detail';

    const json = extractJson(log.message);
    const fields = extractFields(log.message, json);

    const chips = document.createElement('div');
    chips.className = 'chips';
    addChip(chips, 'App', log.appName + ' (' + log.appType + ')', false);
    addChip(chips, 'Time', fmtTime(log.timestampMs, log.timestamp), false);
    addChip(chips, 'Level', log.level || 'INFO', false);
    if (log.logger) { addChip(chips, 'Logger', log.logger, false); }
    if (log.thread) { addChip(chips, 'Thread', log.thread, false); }
    if (log.worker) { addChip(chips, 'Worker', log.worker, false); }
    addChip(chips, 'Source', log.source, false);
    for (const k of Object.keys(fields)) { addChip(chips, k, fields[k], true); }
    wrap.appendChild(chips);

    const actions = document.createElement('div');
    actions.className = 'detail-actions';
    const copyMsg = document.createElement('button');
    copyMsg.className = 'small';
    copyMsg.textContent = 'Copy message';
    copyMsg.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(log.message || '', 'message'); });
    actions.appendChild(copyMsg);
    if (json) {
      const copyJson = document.createElement('button');
      copyJson.className = 'small';
      copyJson.textContent = 'Copy JSON';
      copyJson.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(JSON.stringify(json, null, 2), 'JSON'); });
      actions.appendChild(copyJson);
    }
    if (fields.correlationId) {
      const copyCid = document.createElement('button');
      copyCid.className = 'small';
      copyCid.textContent = 'Copy correlationId';
      copyCid.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(fields.correlationId, 'correlationId'); });
      actions.appendChild(copyCid);
    }
    wrap.appendChild(actions);

    if (json) {
      const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'Payload';
      wrap.appendChild(lbl);
      const view = document.createElement('div'); view.className = 'json';
      view.appendChild(renderJsonValue(json, null));
      wrap.appendChild(view);
    } else if (looksLikeStack(log.message)) {
      const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'Stack trace';
      wrap.appendChild(lbl);
      wrap.appendChild(renderStack(log.message || ''));
    } else {
      const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'Message';
      wrap.appendChild(lbl);
      const raw = document.createElement('div'); raw.className = 'rawmsg'; raw.textContent = log.message || '';
      wrap.appendChild(raw);
    }
    return wrap;
  }

  function toggleDetail(tr, log) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail-row')) {
      next.remove();
      tr.classList.remove('open');
      return;
    }
    tr.classList.add('open');
    const detailTr = document.createElement('tr');
    detailTr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'detail-cell';
    td.appendChild(buildDetail(log));
    detailTr.appendChild(td);
    tr.parentNode.insertBefore(detailTr, tr.nextSibling);
  }

  function renderResults(result) {
    $('progress').classList.add('hidden');
    const sourceParts = [];
    if (result.usedOpenSearch) { sourceParts.push('<span class="badge os">OpenSearch</span>'); }
    if (result.usedFallback) { sourceParts.push('<span class="badge cloudhub">CloudHub fallback</span>'); }
    $('summary').innerHTML = result.totalHits + ' logs from ' + result.appsSearched + ' app(s) ' + sourceParts.join(' ') +
      (result.truncated ? ' &middot; results truncated to first apps, narrow the scope' : '');

    if (result.errors && result.errors.length) {
      showError(result.errors.slice(0, 3).join(' | '));
    } else {
      showError('');
    }

    allLogs = result.logs || [];
    bucketFilter = null;
    activeBarIndex = -1;
    textFilter = '';
    levelFilter.clear();
    flashKeys.clear();
    // Reset tail cursor/dedup to the freshly searched set.
    tailSeen = new Set(allLogs.map(clientTailKey));
    lastTailMs = allLogs.reduce((m, l) => Math.max(m, l.timestampMs || 0), 0) || lastTailMs;
    if ($('filterInput')) { $('filterInput').value = ''; }
    $('resultsToolbar').classList.toggle('hidden', allLogs.length === 0);
    renderChart(allLogs);
    applyFilter();
  }

  function renderTable(logs) {
    const body = $('resultsBody');
    body.innerHTML = '';
    for (const log of logs) {
      const tr = document.createElement('tr');
      tr.className = 'log-row';
      const fk = clientTailKey(log);
      if (flashKeys.has(fk)) {
        tr.classList.add('flash');
        if ((log.level || '') === 'ERROR') { tr.classList.add('flash-error'); }
      }
      const tdTime = document.createElement('td');
      tdTime.className = 'ts';
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '\u203a';
      tdTime.appendChild(caret);
      tdTime.appendChild(document.createTextNode(' ' + fmtTime(log.timestampMs, log.timestamp)));
      const tdLevel = document.createElement('td');
      const sp = document.createElement('span');
      sp.className = 'lvl ' + (log.level || 'INFO');
      sp.textContent = log.level || 'INFO';
      tdLevel.appendChild(sp);
      const tdApp = document.createElement('td');
      tdApp.className = 'app';
      tdApp.textContent = log.appName + ' (' + log.appType + ')';
      const tdLogger = document.createElement('td');
      tdLogger.className = 'app';
      setHighlighted(tdLogger, (log.logger || '').split('.').pop() || '');
      tdLogger.title = log.logger || '';
      const tdMsg = document.createElement('td');
      tdMsg.className = 'msg';
      setHighlighted(tdMsg, log.message || '');
      tr.appendChild(tdTime); tr.appendChild(tdLevel); tr.appendChild(tdApp); tr.appendChild(tdLogger); tr.appendChild(tdMsg);
      tr.addEventListener('click', () => toggleDetail(tr, log));
      body.appendChild(tr);
    }
    if (logs.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      const es = document.createElement('div'); es.className = 'empty-state';
      const big = document.createElement('div'); big.className = 'big';
      const hint = document.createElement('div');
      if (allLogs.length > 0 && (textFilter || levelFilter.size || bucketFilter)) {
        big.textContent = 'No logs match your filters';
        hint.textContent = 'Clear the filter, level, or time selection to see more.';
      } else {
        big.textContent = 'No logs found';
        hint.textContent = 'Adjust the time window or search text and run the search again.';
      }
      es.appendChild(big); es.appendChild(hint);
      td.appendChild(es); tr.appendChild(td); body.appendChild(tr);
    }
  }

  // ---- Volume histogram (time-bucketed log counts) ----

  function fmtClock(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function showTip(barEl, text) {
    const tip = $('chartTip');
    if (!tip) { return; }
    const bars = barEl.parentNode;
    tip.textContent = text;
    tip.style.left = (bars.offsetLeft + barEl.offsetLeft + barEl.offsetWidth / 2) + 'px';
    tip.style.display = 'block';
  }
  function hideTip() {
    const tip = $('chartTip');
    if (tip) { tip.style.display = 'none'; }
  }

  function clearFilter() {
    bucketFilter = null;
    activeBarIndex = -1;
    document.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
    applyFilter();
  }

  function matchesText(l, q) {
    return (l.message || '').toLowerCase().indexOf(q) !== -1 ||
      (l.logger || '').toLowerCase().indexOf(q) !== -1 ||
      (l.appName || '').toLowerCase().indexOf(q) !== -1 ||
      (l.level || '').toLowerCase().indexOf(q) !== -1;
  }

  // Bucket + text filters (but not level): used for the table base and pill counts.
  function baseFiltered() {
    let logs = allLogs;
    if (bucketFilter) {
      logs = logs.filter((l) => { const t = l.timestampMs || 0; return t >= bucketFilter.start && t < bucketFilter.end; });
    }
    if (textFilter) {
      const q = textFilter.toLowerCase();
      logs = logs.filter((l) => matchesText(l, q));
    }
    return logs;
  }

  function getFilteredLogs() {
    let logs = baseFiltered();
    if (levelFilter.size) {
      logs = logs.filter((l) => levelFilter.has(l.level || 'INFO'));
    }
    return logs;
  }

  function applyFilter() {
    const logs = getFilteredLogs();
    renderTable(logs);
    updateCaption();
    renderLevelPills();
    renderActiveChips();
    updateResultsToolbar(logs.length);
  }

  function updateResultsToolbar(shown) {
    const rc = $('resultCount');
    if (!rc) { return; }
    const total = allLogs.length;
    rc.innerHTML = '';
    const strong = document.createElement('strong');
    if (shown === total) {
      strong.textContent = String(total);
      rc.appendChild(strong);
      rc.appendChild(document.createTextNode(' logs'));
    } else {
      strong.textContent = String(shown);
      rc.appendChild(strong);
      rc.appendChild(document.createTextNode(' of ' + total + ' logs'));
    }
  }

  function renderLevelPills() {
    const host = $('levelPills');
    if (!host) { return; }
    host.innerHTML = '';
    const base = baseFiltered();
    const counts = {};
    for (const l of base) { const lv = l.level || 'INFO'; counts[lv] = (counts[lv] || 0) + 1; }
    const order = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
    for (const lv of order) {
      if (!counts[lv]) { continue; }
      const pill = document.createElement('button');
      pill.className = 'lvl-pill ' + lv + (levelFilter.has(lv) ? ' on' : '');
      const dot = document.createElement('span'); dot.className = 'dot';
      const label = document.createElement('span'); label.textContent = lv;
      const cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.textContent = String(counts[lv]);
      pill.appendChild(dot); pill.appendChild(label); pill.appendChild(cnt);
      pill.title = 'Show only ' + lv + ' (toggle)';
      pill.addEventListener('click', () => {
        if (levelFilter.has(lv)) { levelFilter.delete(lv); } else { levelFilter.add(lv); }
        applyFilter();
      });
      host.appendChild(pill);
    }
  }

  function renderActiveChips() {
    const host = $('activeChips');
    if (!host) { return; }
    host.innerHTML = '';
    const addChipEl = (key, val, onRemove) => {
      const chip = document.createElement('span'); chip.className = 'fchip';
      const k = document.createElement('span'); k.className = 'fk'; k.textContent = key;
      const v = document.createElement('span'); v.textContent = val;
      const x = document.createElement('span'); x.className = 'fx'; x.textContent = '\u00d7';
      x.title = 'Remove';
      x.addEventListener('click', onRemove);
      chip.appendChild(k); chip.appendChild(v); chip.appendChild(x);
      host.appendChild(chip);
    };
    if (textFilter) {
      addChipEl('filter', textFilter, () => { textFilter = ''; if ($('filterInput')) { $('filterInput').value = ''; } applyFilter(); });
    }
    Array.from(levelFilter).forEach((lv) => {
      addChipEl('level', lv, () => { levelFilter.delete(lv); applyFilter(); });
    });
    if (bucketFilter) {
      addChipEl('time', bucketFilter.label, () => { clearFilter(); });
    }
  }

  function setHighlighted(el, text) {
    el.textContent = '';
    const t = text || '';
    const q = textFilter ? textFilter.toLowerCase() : '';
    if (!q) { el.textContent = t; return; }
    const lower = t.toLowerCase();
    let i = 0, idx;
    while ((idx = lower.indexOf(q, i)) !== -1) {
      if (idx > i) { el.appendChild(document.createTextNode(t.slice(i, idx))); }
      const mark = document.createElement('mark');
      mark.textContent = t.slice(idx, idx + q.length);
      el.appendChild(mark);
      i = idx + q.length;
    }
    if (i < t.length) { el.appendChild(document.createTextNode(t.slice(i))); }
  }

  function renderSkeleton() {
    const body = $('resultsBody');
    body.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const tr = document.createElement('tr'); tr.className = 'skel-row';
      const td = document.createElement('td'); td.colSpan = 5;
      const bar = document.createElement('div'); bar.className = 'skel-bar';
      bar.style.width = (55 + Math.round(Math.random() * 40)) + '%';
      td.appendChild(bar); tr.appendChild(td); body.appendChild(tr);
    }
  }

  function updateCaption() {
    const cap = $('chartCaption');
    if (!cap) { return; }
    cap.innerHTML = '';
    if (bucketFilter) {
      cap.appendChild(document.createTextNode('Filtered to ' + bucketFilter.label));
      const clr = document.createElement('span');
      clr.className = 'clear';
      clr.textContent = 'clear';
      clr.addEventListener('click', clearFilter);
      cap.appendChild(clr);
    } else {
      cap.textContent = 'Click a bar to filter by time';
    }
  }

  function renderChart(logs) {
    const host = $('chart');
    host.innerHTML = '';
    if (!logs.length) { host.classList.add('hidden'); return; }

    let min = Infinity, max = -Infinity;
    for (const l of logs) {
      const t = l.timestampMs || 0;
      if (t) { if (t < min) { min = t; } if (t > max) { max = t; } }
    }
    if (!isFinite(min)) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    if (max <= min) { max = min + 1000; }

    const N = 40;
    const size = (max - min) / N;
    const buckets = [];
    for (let i = 0; i < N; i++) { buckets.push({ total: 0, err: 0 }); }
    for (const l of logs) {
      const t = l.timestampMs || 0;
      if (!t) { continue; }
      let idx = Math.floor((t - min) / size);
      if (idx < 0) { idx = 0; }
      if (idx >= N) { idx = N - 1; }
      buckets[idx].total++;
      if ((l.level || '') === 'ERROR') { buckets[idx].err++; }
    }
    let peak = 1;
    for (const b of buckets) { if (b.total > peak) { peak = b.total; } }

    const head = document.createElement('div');
    head.className = 'chart-head';
    const title = document.createElement('span');
    title.className = 'chart-title';
    title.textContent = 'Volume \u00b7 ' + logs.length + ' logs';
    const caption = document.createElement('span');
    caption.className = 'chart-caption';
    caption.id = 'chartCaption';
    caption.textContent = 'Click a bar to filter by time';
    head.appendChild(title); head.appendChild(caption);
    host.appendChild(head);

    const barsEl = document.createElement('div');
    barsEl.className = 'chart-bars';
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.id = 'chartTip';
    barsEl.appendChild(tip);

    buckets.forEach((b, i) => {
      const bStart = min + i * size;
      const bEnd = min + (i + 1) * size;
      const bar = document.createElement('div');
      bar.className = 'bar';
      if (b.total === 0) { bar.classList.add('zero'); }
      const h = Math.round((b.total / peak) * 100);
      const errH = b.total ? (b.err / b.total) * h : 0;
      const restH = h - errH;
      const errSeg = document.createElement('div');
      errSeg.className = 'seg-err';
      errSeg.style.height = errH + '%';
      const restSeg = document.createElement('div');
      restSeg.className = 'seg-rest';
      restSeg.style.height = restH + '%';
      bar.appendChild(errSeg); bar.appendChild(restSeg);
      bar.addEventListener('mouseenter', () => showTip(bar, fmtClock(bStart) + '  \u00b7  ' + b.total + ' logs' + (b.err ? '  \u00b7  ' + b.err + ' error' : '')));
      bar.addEventListener('mouseleave', hideTip);
      bar.addEventListener('click', () => {
        document.querySelectorAll('.bar.active').forEach((x) => x.classList.remove('active'));
        if (activeBarIndex === i) {
          activeBarIndex = -1; bucketFilter = null;
        } else {
          activeBarIndex = i; bar.classList.add('active');
          bucketFilter = { start: bStart, end: bEnd, label: fmtClock(bStart) + '\u2013' + fmtClock(bEnd) };
        }
        applyFilter();
      });
      barsEl.appendChild(bar);
    });
    host.appendChild(barsEl);

    const axis = document.createElement('div');
    axis.className = 'chart-axis';
    const a1 = document.createElement('span'); a1.textContent = fmtClock(min);
    const a2 = document.createElement('span'); a2.textContent = fmtClock(min + (max - min) / 2);
    const a3 = document.createElement('span'); a3.textContent = fmtClock(max);
    axis.appendChild(a1); axis.appendChild(a2); axis.appendChild(a3);
    host.appendChild(axis);
  }

  function renderSaved(savedSearches) {
    const wrap = $('savedList');
    wrap.innerHTML = '';
    if (!savedSearches || savedSearches.length === 0) {
      wrap.innerHTML = '<p class="empty">No saved searches yet.</p>';
      return;
    }
    for (const s of savedSearches) {
      const row = document.createElement('div');
      row.className = 'saved-item';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      name.title = (s.criteria.searchText || '(no text)') + ' \u00b7 ' + s.criteria.scope;
      name.addEventListener('click', () => applySaved(s));
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '\u00d7';
      del.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ command: 'deleteSearch', id: s.id }); });
      row.appendChild(name); row.appendChild(del);
      wrap.appendChild(row);
    }
  }

  function applySaved(s) {
    const c = s.criteria;
    if (c.environmentId) { $('env').value = c.environmentId; }
    $('searchText').value = c.searchText || '';
    $('level').value = c.logLevel || '';
    if (c.windowMs) { $('window').value = String(c.windowMs); }
    setScope(c.scope === 'all' ? 'all' : 'single');
    loadApps();
    // Defer app selection until apps load.
    pendingAppSelect = c.app ? (c.app.name + '::' + c.app.type) : '';
  }

  let pendingAppSelect = '';

  function populateApps(list) {
    apps = list;
    const sel = $('app');
    sel.innerHTML = '';
    if (!list.length) {
      sel.innerHTML = '<option value="">No apps found</option>';
      return;
    }
    for (const a of list) {
      const opt = document.createElement('option');
      opt.value = a.name + '::' + a.type;
      opt.textContent = a.name + ' (' + a.type + ', ' + a.status + ')';
      sel.appendChild(opt);
    }
    if (pendingAppSelect) {
      sel.value = pendingAppSelect;
      pendingAppSelect = '';
    }
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.command) {
      case 'initData': {
        finishInit();
        const env = $('env');
        env.innerHTML = '';
        for (const e of m.environments) {
          const opt = document.createElement('option');
          opt.value = e.id; opt.textContent = e.name;
          env.appendChild(opt);
        }
        renderSaved(m.savedSearches);
        if (!m.environments || m.environments.length === 0) {
          $('app').innerHTML = '<option value="">No environment</option>';
          showRetry('No environments cached for this account.', 'Load environments', () => {
            startInit('fetchEnvironments', 'Loading environments\u2026');
          });
          break;
        }
        showError('');
        if (m.selectedEnvironmentId) { env.value = m.selectedEnvironmentId; }
        loadApps();
        break;
      }
      case 'apps': populateApps(m.apps); break;
      case 'searchStarted':
        $('progress').classList.remove('hidden');
        $('progressBar').style.width = '8%';
        $('summary').textContent = 'Searching...';
        $('chart').classList.add('hidden');
        $('resultsToolbar').classList.add('hidden');
        $('activeChips').innerHTML = '';
        renderSkeleton();
        break;
      case 'searchProgress':
        $('progressBar').style.width = Math.max(8, Math.round((m.done / Math.max(1, m.total)) * 100)) + '%';
        break;
      case 'results': renderResults(m.result); break;
      case 'tailResults': handleTailResults(m.result); break;
      case 'savedSearches': renderSaved(m.savedSearches); break;
      case 'error': {
        finishInit();
        showError(m.message);
        $('progress').classList.add('hidden');
        if ($('app').innerHTML.indexOf('Loading') !== -1) {
          $('app').innerHTML = '<option value="">Unavailable</option>';
        }
        // Keep the tail alive across transient poll errors.
        if (tailing) { setTailStatus('Retrying after error\u2026'); scheduleTail(); }
        break;
      }
    }
  });

  let initialized = false;
  let initTimer = null;

  function finishInit() {
    initialized = true;
    if (initTimer) { clearTimeout(initTimer); initTimer = null; }
    const overlay = $('loadingOverlay');
    if (overlay) { overlay.style.display = 'none'; }
  }

  function showRetry(message, buttonLabel, onClick) {
    const box = $('errBox');
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = message + ' ';
    const btn = document.createElement('button');
    btn.className = 'ghost small';
    btn.textContent = buttonLabel;
    btn.addEventListener('click', onClick);
    d.appendChild(btn);
    box.appendChild(d);
  }

  function startInit(command, text) {
    initialized = false;
    const overlay = $('loadingOverlay');
    if (overlay) { overlay.style.display = 'flex'; }
    setLoadingText(text || 'Loading\u2026');
    showError('');
    if (initTimer) { clearTimeout(initTimer); }
    initTimer = setTimeout(() => {
      if (!initialized) {
        finishInit();
        showRetry('Loading timed out (no response from extension).', 'Retry', () => startInit('fetchEnvironments', 'Loading environments\u2026'));
      }
    }, 8000);
    vscode.postMessage({ command: command });
  }

  startInit('init', 'Requesting environments\u2026');
</script>
</body>
</html>`;
}
