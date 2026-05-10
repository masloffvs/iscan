interface NotebookRuntimeModuleResultMap {
	"audit/vite-spa": NotebookAuditViteSpaModuleResult;
	"audit/vite-sourcemaps": NotebookAuditViteSourcemapsModuleResult;
	"audit/crawl": NotebookAuditCrawlModuleResult;
}

type NotebookAuditSeverity = "high" | "medium" | "low";

type NotebookAuditFetchMode = "http" | "browser";

interface NotebookAuditTraversalInputParams {
	url?: string;
	timeoutMs?: number;
	maxAssets?: number;
	maxAssetKb?: number;
	sameOriginOnly?: boolean;
	fetchMode?: NotebookAuditFetchMode;
	cloakProfileId?: string;
	renderMs?: number;
}

interface NotebookAuditViteSpaFinding {
	severity: NotebookAuditSeverity;
	kind: string;
	location: string;
	evidence: string;
	message: string;
}

interface NotebookAuditViteSpaAssetReport {
	kind: string;
	url: string;
	status: string;
	bytes?: number;
	contentType?: string;
	note?: string;
}

interface NotebookAuditViteSpaResult {
	url: string;
	auditedAt: string;
	findings: NotebookAuditViteSpaFinding[];
	assets: NotebookAuditViteSpaAssetReport[];
	assetsDiscovered: number;
	assetsScanned: number;
	assetsSkipped: number;
	inlineScriptsScanned: number;
}

interface NotebookAuditViteSourcemapsFinding {
	severity: NotebookAuditSeverity;
	kind: string;
	location: string;
	evidence: string;
	message: string;
}

interface NotebookAuditViteSourcemapReport {
	assetKind: string;
	assetUrl: string;
	mapUrl: string;
	status: string;
	sourcesCount?: number;
	sourcesContentCount?: number;
	note?: string;
}

interface NotebookAuditViteSourcemapsResult {
	url: string;
	auditedAt: string;
	findings: NotebookAuditViteSourcemapsFinding[];
	mapReports: NotebookAuditViteSourcemapReport[];
	assetsDiscovered: number;
	assetsScanned: number;
	assetsSkipped: number;
	sourceMapsDiscovered: number;
	sourceMapsFetched: number;
}

type NotebookAuditCrawlResourceKind =
	| "document"
	| "script"
	| "style"
	| "modulepreload"
	| "fetch"
	| "xhr"
	| "image"
	| "font"
	| "media"
	| "manifest"
	| "source-map"
	| "source-file"
	| "other";

type NotebookAuditCrawlDiscoveryKind = "document" | "html" | "network" | "sourcemap" | "bundle-import";

interface NotebookAuditCrawlFinding {
	severity: NotebookAuditSeverity;
	kind: string;
	location: string;
	evidence: string;
	rawEvidence?: string;
	message: string;
	resourceId?: string;
}

interface NotebookAuditCrawlResourceNode {
	id: string;
	kind: NotebookAuditCrawlResourceKind;
	url: string;
	label: string;
	status: string;
	discoveredBy: NotebookAuditCrawlDiscoveryKind;
	sameOrigin: boolean;
	scanned: boolean;
	isDynamic: boolean;
	contentType?: string;
	bytes?: number;
	parentUrl?: string;
	initiatorUrl?: string;
	note?: string;
	hasSourceMap: boolean;
	sourceMapUrl?: string;
}

type NotebookAuditCrawlEdgeKind = "loads" | "imports" | "references-source-map" | "contains-source";

interface NotebookAuditCrawlEdge {
	from: string;
	to: string;
	kind: NotebookAuditCrawlEdgeKind;
	note?: string;
}

interface NotebookAuditCrawlStats {
	resourcesDiscovered: number;
	resourcesScanned: number;
	resourcesSkipped: number;
	inlineScriptsScanned: number;
	sourceMapsDiscovered: number;
	sourceMapsFetched: number;
	externalResources: number;
	dynamicResources: number;
}

interface NotebookAuditCrawlResult {
	url: string;
	auditedAt: string;
	entryResourceId: string;
	findings: NotebookAuditCrawlFinding[];
	resources: NotebookAuditCrawlResourceNode[];
	edges: NotebookAuditCrawlEdge[];
	stats: NotebookAuditCrawlStats;
}

interface NotebookAuditViteSpaFindingTableRow extends NotebookPrimitiveTableRow {
	severity: string;
	kind: string;
	location: string;
	evidence: string;
	message: string;
}

interface NotebookAuditViteSpaFindingTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditViteSpaFindingTableRow[];
}

interface NotebookAuditViteSpaAssetTableRow extends NotebookPrimitiveTableRow {
	kind: string;
	status: string;
	url: string;
	bytes: NotebookPrimitiveCellValue;
	contentType: string;
	note: string;
}

interface NotebookAuditViteSpaAssetTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditViteSpaAssetTableRow[];
}

interface NotebookAuditViteSourcemapsFindingTableRow extends NotebookPrimitiveTableRow {
	severity: string;
	kind: string;
	location: string;
	evidence: string;
	message: string;
}

interface NotebookAuditViteSourcemapsFindingTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditViteSourcemapsFindingTableRow[];
}

interface NotebookAuditViteSourcemapReportTableRow extends NotebookPrimitiveTableRow {
	assetKind: string;
	status: string;
	assetUrl: string;
	mapUrl: string;
	sources: NotebookPrimitiveCellValue;
	sourcesContent: NotebookPrimitiveCellValue;
	note: string;
}

interface NotebookAuditViteSourcemapReportTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditViteSourcemapReportTableRow[];
}

interface NotebookAuditCrawlResourceTableRow extends NotebookPrimitiveTableRow {
	kind: string;
	status: string;
	dynamic: string;
	scanned: string;
	url: string;
	contentType: string;
	note: string;
}

interface NotebookAuditCrawlResourceTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditCrawlResourceTableRow[];
}

interface NotebookAuditCrawlFindingTableRow extends NotebookPrimitiveTableRow {
	severity: string;
	kind: string;
	location: string;
	evidence: string;
	message: string;
}

interface NotebookAuditCrawlFindingTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookAuditCrawlFindingTableRow[];
}

type NotebookAuditViteSpaModuleResult =
	| readonly [NotebookPrimitiveTextEntity, NotebookPrimitiveTextEntity]
	| readonly [NotebookPrimitiveTextEntity, NotebookAuditViteSpaFindingTableEntity, NotebookAuditViteSpaAssetTableEntity];

type NotebookAuditViteSourcemapsModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookAuditViteSourcemapsFindingTableEntity,
	NotebookAuditViteSourcemapReportTableEntity,
];

type NotebookAuditCrawlModuleResult =
	| readonly [NotebookPrimitiveTextEntity, NotebookAuditCrawlResourceTableEntity]
	| readonly [NotebookPrimitiveTextEntity, NotebookAuditCrawlResourceTableEntity, NotebookAuditCrawlFindingTableEntity];