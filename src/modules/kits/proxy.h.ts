interface NotebookRuntimeModuleResultMap {
	"kits/proxy/list": NotebookProxyProfilesReportResult;
	"kits/proxy/test": NotebookProxyTestReportResult;
	"kits/proxy/save": NotebookProxySaveReportResult;
	"kits/proxy/delete": NotebookProxyDeleteReportResult;
	"kits/proxy/import": NotebookProxyBatchReportResult;
	"kits/proxy/replace": NotebookProxyBatchReportResult;
	"kits/proxy/manager": NotebookProxyManagerModuleResult;
}

type NotebookProxyType = "HTTP" | "HTTPS" | "SOCKS4" | "SOCKS4A" | "SOCKS5" | "SOCKS5H";

interface NotebookProxyProfile {
	id: string;
	name: string;
	host: string;
	port: number;
	username?: string;
	password?: string;
	type: NotebookProxyType;
}

interface NotebookProxyTestResult {
	latencyMs: number;
	ip: string;
	country?: string;
	error?: string;
}

type NotebookProxyBatchMode = "append" | "replace";

interface NotebookProxyBatchApplyResult {
	mode: NotebookProxyBatchMode;
	parsedCount: number;
	ignoredCount: number;
	uniqueCount: number;
	createdCount: number;
	skippedCount: number;
	removedCount: number;
	totalCount: number;
}

interface NotebookProxyProfileTableRow extends NotebookPrimitiveTableRow {
	name: string;
	type: string;
	endpoint: string;
	auth: string;
	profileId: string;
}

interface NotebookProxyProfileTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookProxyProfileTableRow[];
}

interface NotebookProxyTestTableRow extends NotebookPrimitiveTableRow {
	name: string;
	status: string;
	type: string;
	endpoint: string;
	latencyMs: NotebookPrimitiveCellValue;
	ip: string;
	country: string;
	error: string;
}

interface NotebookProxyTestTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookProxyTestTableRow[];
}

type NotebookProxyProfilesReportResult =
	| readonly [NotebookPrimitiveTextEntity]
	| readonly [NotebookPrimitiveTextEntity, NotebookProxyProfileTableEntity];

type NotebookProxyTestReportResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookProxyTestTableEntity,
];

type NotebookProxySaveReportResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity,
	NotebookProxyProfileTableEntity,
];

type NotebookProxyDeleteReportResult =
	| readonly [NotebookPrimitiveTextEntity, NotebookPrimitiveTextEntity]
	| readonly [NotebookPrimitiveTextEntity, NotebookPrimitiveTextEntity, NotebookProxyProfileTableEntity];

type NotebookProxyBatchReportResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity,
	NotebookProxyProfileTableEntity,
];

interface NotebookProxyManagerInteractiveResult {
	exitCode: number;
}

type NotebookProxyManagerModuleResult = NotebookProxyProfilesReportResult | NotebookProxyManagerInteractiveResult;