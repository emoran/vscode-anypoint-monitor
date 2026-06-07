// Orchestrates log search: for each target app, try Anypoint Monitoring
// OpenSearch first, then fall back to the native CloudHub logs API. Supports
// single-app and environment-wide (all running apps) scopes.

import * as vscode from 'vscode';
import { AccountService } from '../../controllers/accountService.js';
import { searchOpenSearchLogs } from './monitoringClient.js';
import { discoverApps, filterRunning, fetchCh1CloudHubLogs, fetchCh2CloudHubLogs } from './cloudhubLogs.js';
import {
  AppSearchResult,
  LogSearchCriteria,
  LogSearchResult,
  NormalizedLog,
  SearchableApp
} from './types.js';

const MAX_APPS_ENV_WIDE = 20;
const APP_BATCH_SIZE = 5;

async function getOrgId(context: vscode.ExtensionContext): Promise<string> {
  const accountService = new AccountService(context);
  const activeAccount = await accountService.getActiveAccount();
  if (!activeAccount) {
    throw new Error('No active account found. Please log in first.');
  }
  return (await accountService.getEffectiveOrganizationId()) || activeAccount.organizationId;
}

function clientFilter(logs: NormalizedLog[], criteria: LogSearchCriteria): NormalizedLog[] {
  const text = (criteria.searchText || '').toLowerCase();
  const level = (criteria.logLevel || '').toUpperCase();
  const start = criteria.startTime || 0;
  const end = criteria.endTime || 0;
  return logs.filter((log) => {
    if (text && !log.message.toLowerCase().includes(text)) { return false; }
    if (level && log.level !== level) { return false; }
    if (start && log.timestampMs && log.timestampMs < start) { return false; }
    if (end && log.timestampMs && log.timestampMs > end) { return false; }
    return true;
  });
}

function resolveOpenSearchAppId(app: SearchableApp): { appId: string; exact: boolean } {
  if (app.type === 'CH1') {
    const full = app.fullDomain || '';
    if (full.includes('.cloudhub.io')) {
      return { appId: full, exact: true };
    }
    return { appId: app.domain || app.name, exact: false };
  }
  return { appId: app.name, exact: true };
}

async function searchSingleApp(
  context: vscode.ExtensionContext,
  orgId: string,
  app: SearchableApp,
  criteria: LogSearchCriteria
): Promise<AppSearchResult> {
  const limit = criteria.limit ?? 500;

  // 1. Try OpenSearch (Monitoring/Titanium backend).
  let openSearchFailed = false;
  try {
    const { appId, exact } = resolveOpenSearchAppId(app);
    const result = await searchOpenSearchLogs(context, {
      orgId,
      appId,
      appIdExact: exact,
      appName: app.name,
      appType: app.type,
      searchText: criteria.searchText,
      logLevel: criteria.logLevel,
      startTime: criteria.startTime,
      endTime: criteria.endTime,
      limit
    });
    if (result.logs.length > 0) {
      return {
        appName: app.name,
        appType: app.type,
        source: 'opensearch',
        totalHits: result.totalHits,
        logs: result.logs
      };
    }
  } catch (err: any) {
    openSearchFailed = true;
    console.warn(`Log Search: OpenSearch failed for ${app.name}:`, err?.message || err);
  }

  // 2. Fall back to native CloudHub logs (also used when OpenSearch had 0 hits).
  try {
    const end = criteria.endTime || Date.now();
    const start = criteria.startTime || end - 24 * 60 * 60 * 1000;
    let logs: NormalizedLog[];
    if (app.type === 'CH1') {
      logs = await fetchCh1CloudHubLogs(context, orgId, criteria.environmentId, app, start, end, limit);
    } else {
      logs = await fetchCh2CloudHubLogs(context, orgId, criteria.environmentId, app, limit);
    }
    const filtered = clientFilter(logs, criteria);
    return {
      appName: app.name,
      appType: app.type,
      source: filtered.length > 0 ? 'cloudhub' : 'none',
      totalHits: filtered.length,
      logs: filtered
    };
  } catch (err: any) {
    return {
      appName: app.name,
      appType: app.type,
      source: 'none',
      totalHits: 0,
      logs: [],
      error: openSearchFailed
        ? `OpenSearch and CloudHub both failed: ${err?.message || err}`
        : `CloudHub fallback failed: ${err?.message || err}`
    };
  }
}

async function resolveTargetApps(
  context: vscode.ExtensionContext,
  orgId: string,
  criteria: LogSearchCriteria
): Promise<{ apps: SearchableApp[]; truncated: boolean }> {
  if (criteria.scope === 'single') {
    if (!criteria.app) {
      throw new Error('No application selected.');
    }
    return { apps: [criteria.app], truncated: false };
  }

  const discovered = filterRunning(await discoverApps(context, orgId, criteria.environmentId));
  const truncated = discovered.length > MAX_APPS_ENV_WIDE;
  return { apps: discovered.slice(0, MAX_APPS_ENV_WIDE), truncated };
}

/**
 * Run a log search according to the criteria. Never throws for per-app failures;
 * those are collected into the result's errors array.
 */
export async function searchLogs(
  context: vscode.ExtensionContext,
  criteria: LogSearchCriteria,
  progress?: (done: number, total: number) => void
): Promise<LogSearchResult> {
  const orgId = await getOrgId(context);
  const { apps, truncated } = await resolveTargetApps(context, orgId, criteria);

  const perApp: AppSearchResult[] = [];
  let done = 0;

  for (let i = 0; i < apps.length; i += APP_BATCH_SIZE) {
    const batch = apps.slice(i, i + APP_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((app) => searchSingleApp(context, orgId, app, criteria))
    );
    perApp.push(...results);
    done += batch.length;
    progress?.(done, apps.length);
  }

  const logs = perApp
    .flatMap((r) => r.logs)
    .sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  return {
    logs,
    perApp,
    appsSearched: apps.length,
    totalHits: logs.length,
    usedOpenSearch: perApp.some((r) => r.source === 'opensearch'),
    usedFallback: perApp.some((r) => r.source === 'cloudhub'),
    errors: perApp.filter((r) => r.error).map((r) => `${r.appName}: ${r.error}`),
    truncated
  };
}

export { getOrgId };
