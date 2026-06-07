// Shared types for the Log Search feature (Anypoint Monitoring OpenSearch with
// CloudHub native log fallback).

export type AppType = 'CH1' | 'CH2';

export type LogSource = 'opensearch' | 'cloudhub';

export interface SearchableApp {
  name: string;
  type: AppType;
  status: string;
  /** CH1: short domain. */
  domain?: string;
  /** CH1: full cloudhub domain used as the OpenSearch appId. */
  fullDomain?: string;
  /** CH2: deployment UUID. */
  deploymentId?: string;
}

export interface LogSearchCriteria {
  environmentId: string;
  environmentName?: string;
  /** Free-text / correlation id / deal id. Empty means no text filter. */
  searchText?: string;
  /** ERROR | WARN | INFO | DEBUG | TRACE | '' (any). */
  logLevel?: string;
  /** Epoch millis. */
  startTime?: number;
  /** Epoch millis. */
  endTime?: number;
  /** Max records per app. */
  limit?: number;
  /** 'single' searches one app; 'all' discovers and searches every running app. */
  scope: 'single' | 'all';
  /** Required when scope === 'single'. */
  app?: SearchableApp;
}

export interface NormalizedLog {
  timestampMs: number;
  timestamp: string;
  level: string;
  logger: string;
  thread: string;
  message: string;
  appName: string;
  appType: AppType;
  worker?: string;
  source: LogSource;
}

export interface AppSearchResult {
  appName: string;
  appType: AppType;
  source: LogSource | 'none';
  totalHits: number;
  logs: NormalizedLog[];
  error?: string;
}

export interface LogSearchResult {
  logs: NormalizedLog[];
  perApp: AppSearchResult[];
  appsSearched: number;
  totalHits: number;
  usedOpenSearch: boolean;
  usedFallback: boolean;
  errors: string[];
  truncated?: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  createdAt: number;
  criteria: Omit<LogSearchCriteria, 'startTime' | 'endTime'> & {
    /** Persist a relative window (ms) instead of absolute times. */
    windowMs?: number;
  };
}
