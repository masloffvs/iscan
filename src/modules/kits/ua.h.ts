interface NotebookRuntimeModuleResultMap {
  "kits/ua/list": NotebookUaListResult;
  "kits/ua/search": NotebookUaSearchResult;
  "kits/ua/patterns": NotebookUaPatternsResult;
  "kits/ua/status": NotebookUaStatusResult;
  "kits/ua/refresh": NotebookUaRefreshResult;
}

interface NotebookUaExactAgent {
  browserFamily: string | null;
  browserVersion: string | null;
  category: string;
  description: string | null;
  deviceClass: string | null;
  disposition: string;
  displayName: string | null;
  fetchedAt: string;
  id: number;
  label: string;
  metadata: NotebookAnyRecord | null;
  osFamily: string | null;
  sourceId: string;
  sourceKind: string;
  sourceRecordId: string | null;
  sourceUrl: string;
  userAgent: string;
}

interface NotebookUaPattern {
  category: string;
  description: string | null;
  disposition: string;
  displayName: string | null;
  fetchedAt: string;
  metadata: NotebookAnyRecord | null;
  pattern: string;
  id: number;
  sourceId: string;
  sourceKind: string;
  sourceRecordId: string | null;
  sourceUrl: string;
}

interface NotebookUaSourceStatus {
  enabled: boolean;
  errorMessage: string | null;
  exactAgentCount: number;
  fetchStatus: "empty" | "success" | "error";
  fetchedAt: string | null;
  isStale: boolean;
  metadata: NotebookAnyRecord | null;
  patternCount: number;
  sourceId: string;
  sourceKind: string;
  sourceUrl: string;
}

interface NotebookUaExactAgentFilters {
  browserFamilies?: string[];
  browserVersions?: string[];
  categories?: string[];
  deviceClasses?: string[];
  dispositions?: string[];
  limit?: number;
  osFamilies?: string[];
  search?: string;
  sourceIds?: string[];
}

interface NotebookUaPatternFilters {
  categories?: string[];
  dispositions?: string[];
  limit?: number;
  search?: string;
  sourceIds?: string[];
}

interface NotebookUaListResult {
  exactAgents: NotebookUaExactAgent[];
  sources: NotebookUaSourceStatus[];
}

interface NotebookUaSearchResult {
  exactAgents: NotebookUaExactAgent[];
  filters: NotebookUaExactAgentFilters;
  sources: NotebookUaSourceStatus[];
}

interface NotebookUaPatternsResult {
  filters: NotebookUaPatternFilters;
  patterns: NotebookUaPattern[];
  sources: NotebookUaSourceStatus[];
}

interface NotebookUaStatusResult {
  sources: NotebookUaSourceStatus[];
}

interface NotebookUaRefreshResult {
  exactAgentCount: number;
  patternCount: number;
  refreshedAt: string;
  refreshedSourceIds: string[];
  sources: NotebookUaSourceStatus[];
}