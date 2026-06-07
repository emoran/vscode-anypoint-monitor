// CloudHub native log access + app discovery. Used as the fallback path when the
// Anypoint Monitoring OpenSearch backend is unavailable / not entitled / returns
// no hits, and to discover running apps for environment-wide search.

import * as vscode from 'vscode';
import { ApiHelper } from '../../controllers/apiHelper.js';
import { getBaseUrl } from '../../constants.js';
import { getCH2Deployments } from '../cloudhub2Applications.js';
import { AppType, NormalizedLog, SearchableApp } from './types.js';

function isRunning(status: string): boolean {
  const s = (status || '').toUpperCase();
  return s === 'STARTED' || s === 'RUNNING' || s === 'APPLIED' || s === 'DEPLOYED';
}

/**
 * Discover CH1 + CH2 applications in an environment for the app picker and for
 * environment-wide search. CH1 failures are tolerated (org may be CH2-only).
 */
export async function discoverApps(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string
): Promise<SearchableApp[]> {
  const baseUrl = await getBaseUrl(context);
  const apiHelper = new ApiHelper(context);
  const apps: SearchableApp[] = [];

  // CH1
  try {
    const resp = await apiHelper.get(`${baseUrl}/cloudhub/api/applications`, {
      headers: { 'X-ANYPNT-ENV-ID': envId, 'X-ANYPNT-ORG-ID': orgId }
    });
    const list: any[] = Array.isArray(resp.data) ? resp.data : resp.data?.data || [];
    for (const app of list) {
      apps.push({
        name: app.domain || app.fullDomain || '',
        type: 'CH1',
        status: app.status || 'UNKNOWN',
        domain: app.domain || '',
        fullDomain: app.fullDomain || app.domain || ''
      });
    }
  } catch (err: any) {
    console.warn('Log Search: CH1 discovery failed:', err?.message || err);
  }

  // CH2
  try {
    const deployments = await getCH2Deployments(context, orgId, envId);
    for (const dep of deployments) {
      apps.push({
        name: dep.name || dep.application?.name || 'Unknown',
        type: 'CH2',
        status: dep.application?.status || dep.status || 'UNKNOWN',
        deploymentId: dep.id || dep.deploymentId || ''
      });
    }
  } catch (err: any) {
    console.warn('Log Search: CH2 discovery failed:', err?.message || err);
  }

  return apps;
}

export function filterRunning(apps: SearchableApp[]): SearchableApp[] {
  return apps.filter((a) => isRunning(a.status));
}

function toEpochMs(value: any): number {
  if (value === null || value === undefined) { return 0; }
  if (typeof value === 'number') { return value; }
  const str = String(value);
  if (/^\d+$/.test(str)) { return Number(str); }
  const parsed = Date.parse(str);
  return isNaN(parsed) ? 0 : parsed;
}

function inferLevel(item: any): string {
  const explicit = item.level || item.logLevel || item.priority || item.event?.priority || item.event?.logLevel;
  if (explicit) { return String(explicit).toUpperCase(); }
  const msg = String(item.message || item.event?.message || item.line || '');
  if (/ERROR|Exception/i.test(msg)) { return 'ERROR'; }
  if (/WARN/i.test(msg)) { return 'WARN'; }
  if (/DEBUG/i.test(msg)) { return 'DEBUG'; }
  return 'INFO';
}

function normalizeCloudHubItem(item: any, appName: string, appType: AppType): NormalizedLog {
  const ev = item.event || {};
  const tsRaw = item.timestamp ?? item.time ?? ev['@timestamp'] ?? ev.timestamp ?? null;
  const tsMs = toEpochMs(tsRaw);
  return {
    timestampMs: tsMs,
    timestamp: tsMs ? new Date(tsMs).toISOString() : String(tsRaw ?? ''),
    level: inferLevel(item),
    logger: String(item.loggerName || item.logger || ev.loggerName || ''),
    thread: String(item.threadName || item.thread || ev.threadName || ''),
    message: String(item.message || ev.message || item.line || ''),
    appName,
    appType,
    worker: item.instanceId || item.replica || item.workerId || undefined,
    source: 'cloudhub' as const
  };
}

/**
 * Fetch CloudHub 1.0 logs via the deployments logs API (latest deployment).
 */
export async function fetchCh1CloudHubLogs(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  app: SearchableApp,
  startTime: number,
  endTime: number,
  limit: number
): Promise<NormalizedLog[]> {
  const baseUrl = await getBaseUrl(context);
  const apiHelper = new ApiHelper(context);
  const headers = { 'X-ANYPNT-ENV-ID': envId, 'X-ANYPNT-ORG-ID': orgId };
  const domain = app.domain || app.name;

  const depResp = await apiHelper.get(
    `${baseUrl}/cloudhub/api/v2/applications/${domain}/deployments?orderByDate=DESC`,
    { headers }
  );
  const deploymentId = depResp.data?.data?.[0]?.deploymentId;
  if (!deploymentId) { return []; }

  const logsResp = await apiHelper.get(
    `${baseUrl}/cloudhub/api/v2/applications/${domain}/deployments/${deploymentId}/logs?startTime=${startTime}&endTime=${endTime}&limit=${limit}`,
    { headers }
  );
  const data = logsResp.data;
  const items: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return items.map((it) => normalizeCloudHubItem(it, app.name, 'CH1'));
}

/**
 * Fetch CloudHub 2.0 logs via the deployment spec logs API.
 */
export async function fetchCh2CloudHubLogs(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  app: SearchableApp,
  limit: number
): Promise<NormalizedLog[]> {
  const deploymentId = app.deploymentId;
  if (!deploymentId) { return []; }

  const baseUrl = await getBaseUrl(context);
  const apiHelper = new ApiHelper(context);
  const headers = { 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': envId };
  const base = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;

  const detailResp = await apiHelper.get(base, { headers });
  const dep = detailResp.data || {};
  const specId =
    dep.lastSuccessfulRuntimeVersion ||
    dep.lastSuccessfulSpec?.id ||
    dep.currentSpec?.id ||
    dep.desiredVersion ||
    dep.configuration?.id ||
    '';
  if (!specId) { return []; }

  const logsResp = await apiHelper.get(`${base}/specs/${specId}/logs?limit=${limit}`, { headers });
  const data = logsResp.data;
  const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((it) => normalizeCloudHubItem(it, app.name, 'CH2'));
}
