// Anypoint Monitoring OpenSearch client (the "monitoring-x-api" backend that
// powers Titanium/Monitoring log search in the Anypoint UI). Ported from the
// mcp-log-analyzer Mule flows (monitoring-x-subflow.xml).
//
// Two calls:
//   1. Resolve the data-stream index pattern + dataSourceId from the saved-objects API.
//   2. POST an OpenSearch bool query to the internal search endpoint.

import * as vscode from 'vscode';
import { ApiHelper } from '../../controllers/apiHelper.js';
import { getBaseUrl } from '../../constants.js';
import { AppType, NormalizedLog } from './types.js';

const OSD_HEADERS = { 'osd-xsrf': 'osd-fetch' };
const DATASOURCE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface OpenSearchDataSource {
  indexPattern: string;
  dataSourceId: string | null;
}

interface DataSourceCacheEntry extends OpenSearchDataSource {
  resolvedAt: number;
}

const dataSourceCache = new Map<string, DataSourceCacheEntry>();

export interface OpenSearchQueryInput {
  orgId: string;
  appId: string;
  appIdExact: boolean;
  appName: string;
  appType: AppType;
  searchText?: string;
  logLevel?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface OpenSearchSearchResult {
  totalHits: number;
  logs: NormalizedLog[];
}

/**
 * Resolve (and cache) the OpenSearch index pattern + dataSourceId for an org by
 * querying the saved-objects API and matching the data-stream-{orgId} pattern.
 */
export async function resolveOpenSearchDataSource(
  context: vscode.ExtensionContext,
  orgId: string
): Promise<OpenSearchDataSource> {
  const cached = dataSourceCache.get(orgId);
  if (cached && Date.now() - cached.resolvedAt < DATASOURCE_TTL_MS) {
    return { indexPattern: cached.indexPattern, dataSourceId: cached.dataSourceId };
  }

  const baseUrl = await getBaseUrl(context);
  const apiHelper = new ApiHelper(context);

  const resp = await apiHelper.get(`${baseUrl}/monitoring-x-api/logs/api/saved_objects/_find`, {
    headers: OSD_HEADERS,
    params: {
      fields: 'title',
      per_page: '10000',
      type: 'index-pattern'
    }
  });

  const savedObjects: any[] = resp.data?.saved_objects || [];
  const patterns = savedObjects.filter((o) => (o?.type || '') === 'index-pattern');

  const titleOf = (o: any): string => String(o?.attributes?.title || '');
  const orgScoped = patterns.find((p) => titleOf(p).startsWith(`data-stream-${orgId}`));
  const anyDataStream = patterns.find((p) => titleOf(p).startsWith('data-stream-'));
  const chosen = orgScoped || anyDataStream || patterns[0];

  const dsRef = (chosen?.references || []).find((r: any) => (r?.type || '') === 'data-source');

  const resolved: OpenSearchDataSource = {
    indexPattern: titleOf(chosen) || `data-stream-${orgId}*`,
    dataSourceId: dsRef?.id ?? null
  };

  dataSourceCache.set(orgId, { ...resolved, resolvedAt: Date.now() });
  return resolved;
}

export function clearOpenSearchDataSourceCache(orgId?: string): void {
  if (orgId) {
    dataSourceCache.delete(orgId);
  } else {
    dataSourceCache.clear();
  }
}

function buildQueryBody(input: OpenSearchQueryInput, indexPattern: string, dataSourceId: string | null) {
  const now = Date.now();
  const defaultWindowMs = 43200000; // 12h
  const startMs = input.startTime && input.startTime > 0 ? Math.floor(input.startTime) : now - defaultWindowMs;
  const endMs = input.endTime && input.endTime > 0 ? Math.floor(input.endTime) : now;
  const size = Math.min(input.limit ?? 500, 500);

  const searchText = (input.searchText || '').trim();
  const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(searchText);
  const isNumericId = /^\d{5,}$/.test(searchText);
  const isExactTerm = isUUID || isNumericId;
  const luceneText = !searchText ? '' : isExactTerm ? `"${searchText}"` : `*${searchText}*`;

  const appField = 'appId';
  const levelField = 'log-level';

  const mustClauses = luceneText
    ? [{ query_string: { query: luceneText, analyze_wildcard: true } }]
    : [];

  const appFilter = !input.appId
    ? []
    : input.appIdExact
      ? [{ match_phrase: { [appField]: input.appId } }]
      : [{ query_string: { query: `${appField}:*${input.appId}*`, analyze_wildcard: true } }];

  const levelFilter = input.logLevel
    ? [{ match_phrase: { [levelField]: input.logLevel.toUpperCase() } }]
    : [];

  const timeFilter = [{ range: { timestamp: { gte: startMs, lte: endMs, format: 'epoch_millis' } } }];

  return {
    params: {
      index: indexPattern,
      body: {
        sort: [{ timestamp: { order: 'desc', unmapped_type: 'boolean' } }],
        size,
        version: true,
        stored_fields: ['*'],
        script_fields: {},
        docvalue_fields: [{ field: 'timestamp', format: 'date_time' }],
        _source: { excludes: [] },
        query: {
          bool: {
            must: mustClauses,
            filter: [...appFilter, ...levelFilter, ...timeFilter],
            should: [],
            must_not: []
          }
        }
      },
      preference: now
    },
    dataSourceId
  };
}

function toEpochMs(value: any): number {
  if (value === null || value === undefined) { return 0; }
  if (typeof value === 'number') { return value; }
  const str = String(value);
  if (/^\d+$/.test(str)) { return Number(str); }
  const parsed = Date.parse(str);
  return isNaN(parsed) ? 0 : parsed;
}

function normalizeHits(hits: any[], appName: string, appType: AppType): NormalizedLog[] {
  return hits.map((hit) => {
    const src = hit?._source || {};
    const tsRaw = src.timestamp ?? src.original_timestamp ?? null;
    const tsMs = toEpochMs(tsRaw);
    return {
      timestampMs: tsMs,
      timestamp: tsMs ? new Date(tsMs).toISOString() : String(tsRaw ?? ''),
      level: String(src['log-level'] || src['log level'] || 'INFO').toUpperCase(),
      logger: String(src.logger || ''),
      thread: String(src.class || src.thread || ''),
      message: String(src.message || ''),
      appName,
      appType,
      worker: src.workerId || src.worker || undefined,
      source: 'opensearch' as const
    };
  });
}

/**
 * Execute an OpenSearch log search for a single app. Throws on transport errors
 * so callers can fall back to the CloudHub logs API.
 */
export async function searchOpenSearchLogs(
  context: vscode.ExtensionContext,
  input: OpenSearchQueryInput
): Promise<OpenSearchSearchResult> {
  const baseUrl = await getBaseUrl(context);
  const apiHelper = new ApiHelper(context);

  const ds = await resolveOpenSearchDataSource(context, input.orgId);
  const body = buildQueryBody(input, ds.indexPattern, ds.dataSourceId);

  const resp = await apiHelper.post(
    `${baseUrl}/monitoring-x-api/logs/internal/search/opensearch-with-long-numerals`,
    body,
    { headers: OSD_HEADERS, timeout: 30000 }
  );

  const raw = resp.data?.rawResponse || {};
  const rawTotal = raw?.hits?.total ?? 0;
  const totalHits = typeof rawTotal === 'object' ? (rawTotal.value ?? 0) : rawTotal;
  const hits: any[] = raw?.hits?.hits || [];

  return {
    totalHits,
    logs: normalizeHits(hits, input.appName, input.appType)
  };
}
