interface NotebookRuntimeModuleResultMap {
	"discovery/zoomeye/pull": NotebookZoomEyePullModuleResult;
	"discovery/zoomeye/select": NotebookZoomEyeSelectModuleResult;
}

type NotebookZoomEyeSearchType = "v4+v6+web" | "web" | "v4" | "v6";

type NotebookZoomEyeSearchableField =
	| "ip"
	| "hostname"
	| "service"
	| "transport"
	| "product"
	| "os"
	| "title"
	| "body"
	| "header"
	| "banner"
	| "organization"
	| "country_code"
	| "country_name_en"
	| "query_text";

interface NotebookZoomEyeMatch {
	ip?: string;
	body?: string;
	banner?: string;
	header?: string;
	token?: string;
	qid?: string;
	timestamp?: string;
	type?: string;
	os?: string;
	portinfo?: {
		product?: string;
		hostname?: string;
		os?: string;
		port?: number;
		service?: string;
		transport?: string;
		title?: string | null;
		extrainfo?: string;
	};
	geoinfo?: {
		organization?: string;
		asn?: string;
		country?: {
			code?: string;
			names?: {
				en?: string;
				cn?: string;
			};
		};
		city?: {
			names?: {
				en?: string;
				cn?: string;
			};
		};
		subdivisions?: {
			names?: {
				en?: string;
				cn?: string;
			};
		};
	};
}

interface NotebookZoomEyePullExecutionResult {
	queryBase64: string;
	queryText: string | null;
	searchType: NotebookZoomEyeSearchType;
	startPage: number;
	pageSize: number;
	maxResults: number;
	authTimeoutMs: number;
	expectedUserText?: string;
	requestedCloakProfileId?: string;
	authenticatedUser: string;
	cloakProfileLabel: string;
	fetchedAt: string;
	pagesFetched: number;
	rawMatches: number;
	uniqueMatches: number;
	inserted: number;
	updated: number;
	previewMatches: NotebookZoomEyeMatch[];
}

interface NotebookZoomEyeHostSelectRow {
	ip: string;
	port: number;
	query_text: string | null;
	service: string | null;
	transport: string | null;
	product: string | null;
	hostname: string | null;
	os: string | null;
	title: string | null;
	body: string | null;
	header: string | null;
	banner: string | null;
	organization: string | null;
	country_code: string | null;
	country_name_en: string | null;
	last_pulled_at: string;
}

interface NotebookZoomEyeSelectExecutionResult {
	pattern: string;
	field: NotebookZoomEyeSearchableField | null;
	scanLimit: number;
	scannedRows: number;
	matches: NotebookZoomEyeHostSelectRow[];
}

interface NotebookZoomEyePullPreviewTableRow extends NotebookPrimitiveTableRow {
	endpoint: string;
	service: string;
	product: string;
	organization: string;
	location: string;
	body: string;
}

interface NotebookZoomEyePullPreviewTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookZoomEyePullPreviewTableRow[];
}

interface NotebookZoomEyeSelectTableRow extends NotebookPrimitiveTableRow {
	endpoint: string;
	service: string;
	product: string;
	hostname: string;
	organization: string;
	title: string;
}

interface NotebookZoomEyeSelectTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookZoomEyeSelectTableRow[];
}

type NotebookZoomEyePullModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookZoomEyePullPreviewTableEntity,
];

type NotebookZoomEyeSelectModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity | NotebookZoomEyeSelectTableEntity,
];