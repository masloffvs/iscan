interface NotebookRuntimeModuleResultMap {
	"discovery/domain-lookup": NotebookDomainLookupModuleResult;
	"cloudflare/radar/domains/pull": NotebookCloudflareRadarDomainsPullModuleResult;
	"cloudflare/radar/domains/search": NotebookCloudflareRadarDomainsSearchModuleResult;
}

interface NotebookDomainLookupRecord {
	type: string;
	value: string;
	details?: string;
}

interface NotebookDomainLookupSectionError {
	source: "dns" | "rdap" | "reverse";
	scope: string;
	message: string;
	code?: string;
}

interface NotebookDomainRdapEvent {
	action: string;
	timestamp?: string;
	actor?: string;
}

interface NotebookDomainRdapEntitySummary {
	handle?: string;
	name?: string;
	email?: string;
	roles: string[];
}

interface NotebookDomainRdapInfo {
	handle?: string;
	ldhName?: string;
	unicodeName?: string;
	status: string[];
	nameservers: string[];
	entities: NotebookDomainRdapEntitySummary[];
	registrar?: NotebookDomainRdapEntitySummary;
	events: NotebookDomainRdapEvent[];
	notices: string[];
	secureDns?: string;
	url?: string;
}

interface NotebookDomainLookupResult {
	domain: string;
	queriedAt: string;
	records: NotebookDomainLookupRecord[];
	rdap: NotebookDomainRdapInfo | null;
	errors: NotebookDomainLookupSectionError[];
}

interface NotebookCloudflareRadarDomainEntry {
	rank: number | null;
	domain: string;
}

type NotebookCloudflareRadarFetchMode = "auto" | "http" | "browser";

interface NotebookCloudflareRadarDownloadResult {
	entries: NotebookCloudflareRadarDomainEntry[];
	dateEnd: string;
	top: number;
	sourceUrl: string;
	fetchMode: Exclude<NotebookCloudflareRadarFetchMode, "auto">;
	contentType?: string;
	fetchedAt: string;
	usedBrowserFallback: boolean;
}

interface NotebookCloudflareRadarSavedArtifacts {
	directoryPath: string;
	jsonPath: string;
	textPath: string;
}

interface NotebookDomainLookupRecordTableRow extends NotebookPrimitiveTableRow {
	type: string;
	value: string;
	details: string;
}

interface NotebookDomainLookupRecordTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookDomainLookupRecordTableRow[];
}

interface NotebookDomainRdapEntityTableRow extends NotebookPrimitiveTableRow {
	roles: string;
	name: string;
	handle: string;
	email: string;
}

interface NotebookDomainRdapEntityTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookDomainRdapEntityTableRow[];
}

interface NotebookDomainRdapEventTableRow extends NotebookPrimitiveTableRow {
	action: string;
	timestamp: string;
	actor: string;
}

interface NotebookDomainRdapEventTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookDomainRdapEventTableRow[];
}

interface NotebookDomainRdapNoticeTableRow extends NotebookPrimitiveTableRow {
	notice: string;
}

interface NotebookDomainRdapNoticeTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookDomainRdapNoticeTableRow[];
}

interface NotebookDomainLookupErrorTableRow extends NotebookPrimitiveTableRow {
	source: string;
	scope: string;
	code: string;
	message: string;
}

interface NotebookDomainLookupErrorTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookDomainLookupErrorTableRow[];
}

interface NotebookCloudflareRadarDomainTableRow extends NotebookPrimitiveTableRow {
	rank: NotebookPrimitiveCellValue;
	domain: string;
}

interface NotebookCloudflareRadarDomainTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookCloudflareRadarDomainTableRow[];
}

type NotebookDomainLookupModuleExtraEntity =
	| NotebookPrimitiveTextEntity
	| NotebookDomainRdapEntityTableEntity
	| NotebookDomainRdapEventTableEntity
	| NotebookDomainRdapNoticeTableEntity
	| NotebookDomainLookupErrorTableEntity;

type NotebookDomainLookupModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookDomainLookupRecordTableEntity,
	...NotebookDomainLookupModuleExtraEntity[],
];

type NotebookCloudflareRadarDomainsPullModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookCloudflareRadarDomainTableEntity,
];

type NotebookCloudflareRadarDomainsSearchModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookCloudflareRadarDomainTableEntity,
];