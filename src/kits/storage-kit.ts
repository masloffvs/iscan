import { Database } from "bun:sqlite";
import fs from "fs/promises";
import path from "path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type {
	BackgroundWorkerLogEntry,
	BackgroundWorkerLogLevel,
} from "../worker/types";
import { Kit, type KitLifecycleContext } from "./kit";
import { $config } from "../config";

export const STORAGE_KIT_ID = "storage";

const WORKER_LOG_READ_LIMIT = 500;

type PersistedWorkerLogRecord = {
	workerId: string;
	workerName: string;
	relativeScriptPath: string;
	scriptPath: string;
	workerStartedAt: string;
	entry: BackgroundWorkerLogEntry;
};

export type PersistedSettingValueRecord = {
	id: string;
	valueJson: string;
	updatedAt: string;
};

export type StoredSettingValueRow = {
	id: string;
	value_json: string;
	updated_at: string;
};

type PersistedWorkerLogRow = {
	kind: BackgroundWorkerLogEntry["kind"];
	at: string;
	message: string;
	level: BackgroundWorkerLogLevel | null;
	payload: string | null;
};

export type PersistedZoomEyeHostRecord = {
	ip: string;
	port: number;
	queryBase64: string;
	queryText: string | null;
	searchType: string;
	pageSize: number;
	fetchedAt: string;
	type: string | null;
	service: string | null;
	transport: string | null;
	product: string | null;
	hostname: string | null;
	os: string | null;
	title: string | null;
	extraInfo: string | null;
	body: string | null;
	header: string | null;
	banner: string | null;
	token: string | null;
	qid: string | null;
	zoomeyeTimestamp: string | null;
	countryCode: string | null;
	countryNameEn: string | null;
	countryNameCn: string | null;
	cityNameEn: string | null;
	cityNameCn: string | null;
	subdivisionNameEn: string | null;
	subdivisionNameCn: string | null;
	organization: string | null;
	asn: string | null;
	rawJson: string;
};

export type ZoomEyeHostUpsertSummary = {
	inserted: number;
	updated: number;
	total: number;
};

export type ZoomEyeHostSelectRow = {
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
};

export type ZoomEyeHostDetailRow = {
	id: number;
	ip: string;
	port: number;
	query_base64: string;
	query_text: string | null;
	search_type: string;
	page_size: number;
	match_type: string | null;
	service: string | null;
	transport: string | null;
	product: string | null;
	hostname: string | null;
	os: string | null;
	title: string | null;
	extra_info: string | null;
	body: string | null;
	header: string | null;
	banner: string | null;
	token: string | null;
	qid: string | null;
	zoomeye_timestamp: string | null;
	country_code: string | null;
	country_name_en: string | null;
	country_name_cn: string | null;
	city_name_en: string | null;
	city_name_cn: string | null;
	subdivision_name_en: string | null;
	subdivision_name_cn: string | null;
	organization: string | null;
	asn: string | null;
	raw_json: string;
	first_pulled_at: string;
	last_pulled_at: string;
};

export type ZoomEyeQueryHistoryKind = "pull" | "search" | "capture";

export type PersistedZoomEyeQueryHistoryRecord = {
	dedupeKey: string;
	kind: ZoomEyeQueryHistoryKind;
	label: string;
	queryText: string | null;
	queryBase64: string | null;
	searchField: string | null;
	searchType: string | null;
	pageSize: number | null;
	maxResults: number | null;
	startPage: number | null;
	limitRows: number | null;
	cloakProfileTarget: string | null;
	resultCount: number | null;
	usedAt: string;
};

export type ZoomEyeQueryHistoryRow = {
	id: number;
	dedupe_key: string;
	kind: ZoomEyeQueryHistoryKind;
	label: string;
	query_text: string | null;
	query_base64: string | null;
	search_field: string | null;
	search_type: string | null;
	page_size: number | null;
	max_results: number | null;
	start_page: number | null;
	limit_rows: number | null;
	cloak_profile_target: string | null;
	result_count: number | null;
	last_used_at: string;
	use_count: number;
};

export type MicrolinkUaSnapshotStatus = "success" | "error";

export type PersistedMicrolinkUaSnapshotRecord = {
	errorMessage: string | null;
	fetchStatus: MicrolinkUaSnapshotStatus;
	fetchedAt: string;
	microlinkUpdatedAt: number | null;
	payloadJson: string | null;
	sourceUrl: string;
};

export type MicrolinkUaSnapshotRow = {
	error_message: string | null;
	fetch_status: MicrolinkUaSnapshotStatus;
	fetched_at: string;
	microlink_updated_at: number | null;
	payload_json: string | null;
	snapshot_key: string;
	source_url: string;
};

export type UaSourceSyncStatus = "success" | "error";

export type PersistedUaSourceRecord = {
	enabled: boolean;
	errorMessage: string | null;
	exactAgentCount: number;
	fetchStatus: UaSourceSyncStatus | null;
	fetchedAt: string | null;
	metadataJson: string | null;
	patternCount: number;
	sourceId: string;
	sourceKind: string;
	sourceUrl: string;
};

export type UaSourceRow = {
	enabled: number;
	error_message: string | null;
	exact_agent_count: number;
	fetch_status: UaSourceSyncStatus | null;
	fetched_at: string | null;
	metadata_json: string | null;
	pattern_count: number;
	source_id: string;
	source_kind: string;
	source_url: string;
};

export type PersistedUaExactAgentRecord = {
	browserFamily: string | null;
	browserVersion: string | null;
	category: string;
	description: string | null;
	deviceClass: string | null;
	disposition: string;
	displayName: string | null;
	fetchedAt: string;
	label: string;
	metadataJson: string | null;
	osFamily: string | null;
	sourceId: string;
	sourceKind: string;
	sourceRecordId: string | null;
	sourceUrl: string;
	userAgent: string;
};

export type UaExactAgentRow = {
	browser_family: string | null;
	browser_version: string | null;
	category: string;
	description: string | null;
	device_class: string | null;
	disposition: string;
	display_name: string | null;
	fetched_at: string;
	id: number;
	label: string;
	metadata_json: string | null;
	os_family: string | null;
	source_id: string;
	source_kind: string;
	source_record_id: string | null;
	source_url: string;
	user_agent: string;
};

export type PersistedUaPatternRecord = {
	category: string;
	description: string | null;
	disposition: string;
	displayName: string | null;
	fetchedAt: string;
	metadataJson: string | null;
	pattern: string;
	sourceId: string;
	sourceKind: string;
	sourceRecordId: string | null;
	sourceUrl: string;
};

export type UaPatternRow = {
	category: string;
	description: string | null;
	disposition: string;
	display_name: string | null;
	fetched_at: string;
	id: number;
	metadata_json: string | null;
	pattern: string;
	source_id: string;
	source_kind: string;
	source_record_id: string | null;
	source_url: string;
};

export type ExploitDbSyncStatus = "success" | "error";

export type PersistedExploitDbSourceRecord = {
	sourceId: string;
	sourceUrl: string;
	enabled: boolean;
	fetchStatus: ExploitDbSyncStatus | null;
	errorMessage: string | null;
	fetchedAt: string | null;
	lastRecentSyncAt: string | null;
	lastBackfillSyncAt: string | null;
	nextBackfillStart: number;
	backfillComplete: boolean;
	recordsTotal: number;
	recordsFiltered: number;
	newestExploitId: string | null;
	metadataJson: string | null;
};

export type ExploitDbSourceRow = {
	source_id: string;
	source_url: string;
	enabled: number;
	fetch_status: ExploitDbSyncStatus | null;
	error_message: string | null;
	fetched_at: string | null;
	last_recent_sync_at: string | null;
	last_backfill_sync_at: string | null;
	next_backfill_start: number;
	backfill_complete: number;
	records_total: number;
	records_filtered: number;
	newest_exploit_id: string | null;
	metadata_json: string | null;
};

export type PersistedExploitDbEntryRecord = {
	exploitId: string;
	sourceId: string;
	sourceUrl: string;
	title: string;
	typeDisplay: string | null;
	typeName: string | null;
	platformDisplay: string | null;
	authorId: string | null;
	authorName: string | null;
	datePublished: string | null;
	verified: boolean;
	applicationPath: string | null;
	applicationMd5: string | null;
	port: number | null;
	screenshotPath: string | null;
	screenshotThumbPath: string | null;
	tagsJson: string | null;
	codesJson: string | null;
	downloadUrl: string;
	rawUrl: string;
	payloadHash: string;
	metadataJson: string | null;
	fetchedAt: string;
};

export type ExploitDbEntryRow = {
	id: number;
	exploit_id: string;
	source_id: string;
	source_url: string;
	title: string;
	type_display: string | null;
	type_name: string | null;
	platform_display: string | null;
	author_id: string | null;
	author_name: string | null;
	date_published: string | null;
	verified: number;
	application_path: string | null;
	application_md5: string | null;
	port: number | null;
	screenshot_path: string | null;
	screenshot_thumb_path: string | null;
	tags_json: string | null;
	codes_json: string | null;
	download_url: string;
	raw_url: string;
	payload_hash: string;
	metadata_json: string | null;
	fetched_at: string;
};

export type ExploitDbEntryUpsertSummary = {
	inserted: number;
	updated: number;
	unchanged: number;
	total: number;
};

export type PersistedExploitDbRawRecord = {
	exploitId: string;
	sourceId: string;
	rawUrl: string;
	fetchStatus: ExploitDbSyncStatus;
	errorMessage: string | null;
	bodyText: string | null;
	bodySha256: string | null;
	contentType: string | null;
	contentLength: number | null;
	fetchedAt: string;
	metadataJson: string | null;
};

export type ExploitDbRawRow = {
	exploit_id: string;
	source_id: string;
	raw_url: string;
	fetch_status: ExploitDbSyncStatus;
	error_message: string | null;
	body_text: string | null;
	body_sha256: string | null;
	content_type: string | null;
	content_length: number | null;
	fetched_at: string;
	metadata_json: string | null;
};

export type PersistedHttpClientSavedRequestRecord = {
	id: string;
	name: string;
	method: string;
	url: string;
	headersJson: string | null;
	queryJson: string | null;
	bodyText: string | null;
	bodyKind: string | null;
	lastStatusCode: number | null;
	lastDurationMs: number | null;
	lastResponseHeadersJson: string | null;
	lastResponseBodyPreview: string | null;
	lastResponseContentType: string | null;
	lastResponseSizeBytes: number | null;
	lastExecutedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type HttpClientSavedRequestRow = {
	id: string;
	name: string;
	method: string;
	url: string;
	headers_json: string | null;
	query_json: string | null;
	body_text: string | null;
	body_kind: string | null;
	last_status_code: number | null;
	last_duration_ms: number | null;
	last_response_headers_json: string | null;
	last_response_body_preview: string | null;
	last_response_content_type: string | null;
	last_response_size_bytes: number | null;
	last_executed_at: string | null;
	created_at: string;
	updated_at: string;
};

export type PersistedPortScanRunRecord = {
	scanId: string;
	host: string;
	requestedPorts: string | null;
	requestedTopPorts: number | null;
	selectionMode: string;
	scannedPortCount: number;
	openPortCount: number;
	concurrency: number;
	connectTimeoutMs: number;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	errorMessage: string | null;
};

export type PortScanRunRow = {
	scan_id: string;
	host: string;
	requested_ports: string | null;
	requested_top_ports: number | null;
	selection_mode: string;
	scanned_port_count: number;
	open_port_count: number;
	concurrency: number;
	connect_timeout_ms: number;
	started_at: string;
	finished_at: string;
	duration_ms: number;
	error_message: string | null;
};

export type PortScanOpenPortRow = {
	scan_id: string;
	port: number;
};

export type PersistedNoteRecord = {
	id: string;
	createdAt: string;
	text: string;
};

export type NoteRow = {
	id: string;
	created_at: string;
	text: string;
};

export type PersistedAuditCrawlFindingRecord = {
	entryUrl: string;
	auditedAt: string;
	resourceId: string | null;
	resourceKind: string | null;
	resourceLabel: string | null;
	resourceUrl: string | null;
	severity: string;
	kind: string;
	location: string;
	evidence: string;
	rawEvidence: string;
	message: string;
};

export type AuditCrawlFindingRow = {
	id: number;
	entry_url: string;
	audited_at: string;
	resource_id: string | null;
	resource_kind: string | null;
	resource_label: string | null;
	resource_url: string | null;
	severity: string;
	kind: string;
	location: string;
	evidence: string;
	raw_evidence: string;
	message: string;
};

/**
 * StorageKit provides a singleton persistence layer using Drizzle ORM and bun:sqlite.
 * It ensures that only one database connection is active to prevent SQLite locking issues.
 */
export class StorageKit extends Kit {
	private static instance: StorageKit | null = null;
	private _db: any = null;
	private workerLogStoreReady = false;
	private zoomeyeHostStoreReady = false;
	private zoomeyeQueryHistoryStoreReady = false;
	private microlinkUaStoreReady = false;
	private uaStoreReady = false;
	private exploitDbStoreReady = false;
	private httpClientStoreReady = false;
	private settingsStoreReady = false;
	private portScanStoreReady = false;
	private noteStoreReady = false;
	private auditCrawlFindingStoreReady = false;

	constructor() {
		super({
			id: STORAGE_KIT_ID,
			name: "Storage Kit",
			description: "Singleton persistence layer using Drizzle ORM and bun:sqlite",
		});
		
		if (StorageKit.instance) {
			return StorageKit.instance;
		}
		StorageKit.instance = this;
	}

	/**
	 * Returns the Drizzle database instance.
	 * Throws an error if the kit has not been started.
	 */
	get db() {
		if (!this._db) {
			// Auto-initialize if accessed but not started via lifecycle
			this._db = this.createDatabase();
		}
		return this._db;
	}

	getDatabasePath(): string {
		const dbUrl = $config.services.storage.databaseUrl;
		return path.isAbsolute(dbUrl)
			? dbUrl
			: path.join(process.cwd(), dbUrl);
	}

	appendBackgroundWorkerLog(record: PersistedWorkerLogRecord): void {
		this.ensureWorkerLogStore();
		this.getClient().query(
			`INSERT INTO worker_logs (
				worker_id,
				worker_name,
				relative_script_path,
				script_path,
				worker_started_at,
				kind,
				level,
				message,
				payload,
				at
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
		)
			.run(
				record.workerId,
				record.workerName,
				record.relativeScriptPath,
				record.scriptPath,
				record.workerStartedAt,
				record.entry.kind,
				record.entry.level ?? null,
				record.entry.message,
				record.entry.payload ?? null,
				record.entry.at,
			);
		this.pruneBackgroundWorkerLogs(record.relativeScriptPath);
	}

	readBackgroundWorkerLogs(
		relativeScriptPath: string,
		limit: number = WORKER_LOG_READ_LIMIT,
	): BackgroundWorkerLogEntry[] {
		this.ensureWorkerLogStore();
		const normalizedLimit = Number.isInteger(limit) && limit > 0
			? limit
			: WORKER_LOG_READ_LIMIT;
		const rows = this.getClient().query(
			`SELECT kind, at, message, level, payload
			FROM worker_logs
			WHERE relative_script_path = ?1
			ORDER BY id DESC
			LIMIT ?2`,
		)
			.all(relativeScriptPath, normalizedLimit) as PersistedWorkerLogRow[];

		return rows
			.slice()
			.reverse()
			.map((row) => ({
				kind: row.kind,
				at: row.at,
				message: row.message,
				level: row.level ?? undefined,
				payload: row.payload ?? undefined,
			}));
	}

	upsertSettingValue(record: PersistedSettingValueRecord): StoredSettingValueRow {
		this.ensureSettingsStore();
		this.getClient().query(
			`INSERT INTO settings_values (
				id,
				value_json,
				updated_at
			) VALUES (?1, ?2, ?3)
			ON CONFLICT(id) DO UPDATE SET
				value_json = excluded.value_json,
				updated_at = excluded.updated_at`,
		)
			.run(record.id, record.valueJson, record.updatedAt);

		return this.getClient().query(
			`SELECT id, value_json, updated_at
			 FROM settings_values
			 WHERE id = ?1
			 LIMIT 1`,
		)
			.get(record.id) as StoredSettingValueRow;
	}

	selectSettingValue(id: string): StoredSettingValueRow | null {
		this.ensureSettingsStore();
		return this.getClient().query(
			`SELECT id, value_json, updated_at
			 FROM settings_values
			 WHERE id = ?1
			 LIMIT 1`,
		)
			.get(id) as StoredSettingValueRow | null;
	}

	selectSettingValues(): StoredSettingValueRow[] {
		this.ensureSettingsStore();
		return this.getClient().query(
			`SELECT id, value_json, updated_at
			 FROM settings_values
			 ORDER BY id ASC`,
		)
			.all() as StoredSettingValueRow[];
	}

	deleteSettingValue(id: string): boolean {
		this.ensureSettingsStore();
		const result = this.getClient().query(
			`DELETE FROM settings_values
			 WHERE id = ?1`,
		)
			.run(id);

		return Number(result.changes ?? 0) > 0;
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		if (this._db) return;
		const dbUrl = $config.services.storage.databaseUrl;
		const dbDir = path.dirname(path.isAbsolute(dbUrl) ? dbUrl : path.join(process.cwd(), dbUrl));
		await fs.mkdir(dbDir, { recursive: true }).catch(() => {});
		this._db = this.createDatabase();
	}

	protected override async onStop(_context: KitLifecycleContext): Promise<void> {
		this._db = null;
		this.workerLogStoreReady = false;
		this.zoomeyeHostStoreReady = false;
		this.zoomeyeQueryHistoryStoreReady = false;
		this.microlinkUaStoreReady = false;
		this.uaStoreReady = false;
		this.exploitDbStoreReady = false;
		this.settingsStoreReady = false;
		this.portScanStoreReady = false;
		this.noteStoreReady = false;
		this.auditCrawlFindingStoreReady = false;
	}

	upsertExploitDbSource(record: PersistedExploitDbSourceRecord): ExploitDbSourceRow {
		this.ensureExploitDbStore();
		this.getClient().query(
			`INSERT INTO exploitdb_sources (
				source_id,
				source_url,
				enabled,
				fetch_status,
				error_message,
				fetched_at,
				last_recent_sync_at,
				last_backfill_sync_at,
				next_backfill_start,
				backfill_complete,
				records_total,
				records_filtered,
				newest_exploit_id,
				metadata_json
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
			ON CONFLICT(source_id) DO UPDATE SET
				source_url = excluded.source_url,
				enabled = excluded.enabled,
				fetch_status = excluded.fetch_status,
				error_message = excluded.error_message,
				fetched_at = excluded.fetched_at,
				last_recent_sync_at = excluded.last_recent_sync_at,
				last_backfill_sync_at = excluded.last_backfill_sync_at,
				next_backfill_start = excluded.next_backfill_start,
				backfill_complete = excluded.backfill_complete,
				records_total = excluded.records_total,
				records_filtered = excluded.records_filtered,
				newest_exploit_id = excluded.newest_exploit_id,
				metadata_json = excluded.metadata_json`,
		)
			.run(
				record.sourceId,
				record.sourceUrl,
				record.enabled ? 1 : 0,
				record.fetchStatus,
				record.errorMessage,
				record.fetchedAt,
				record.lastRecentSyncAt,
				record.lastBackfillSyncAt,
				record.nextBackfillStart,
				record.backfillComplete ? 1 : 0,
				record.recordsTotal,
				record.recordsFiltered,
				record.newestExploitId,
				record.metadataJson,
			);

		return this.getClient().query(
			`SELECT source_id, source_url, enabled, fetch_status, error_message,
			        fetched_at, last_recent_sync_at, last_backfill_sync_at,
			        next_backfill_start, backfill_complete, records_total,
			        records_filtered, newest_exploit_id, metadata_json
			 FROM exploitdb_sources
			 WHERE source_id = ?1
			 LIMIT 1`,
		)
			.get(record.sourceId) as ExploitDbSourceRow;
	}

	selectExploitDbSources(): ExploitDbSourceRow[] {
		this.ensureExploitDbStore();
		return this.getClient().query(
			`SELECT source_id, source_url, enabled, fetch_status, error_message,
			        fetched_at, last_recent_sync_at, last_backfill_sync_at,
			        next_backfill_start, backfill_complete, records_total,
			        records_filtered, newest_exploit_id, metadata_json
			 FROM exploitdb_sources
			 ORDER BY source_id ASC`,
		)
			.all() as ExploitDbSourceRow[];
	}

	upsertExploitDbEntries(records: readonly PersistedExploitDbEntryRecord[]): ExploitDbEntryUpsertSummary {
		this.ensureExploitDbStore();

		if (records.length === 0) {
			return {
				inserted: 0,
				updated: 0,
				unchanged: 0,
				total: 0,
			};
		}

		const client = this.getClient();
		const selectExisting = client.query(
			`SELECT payload_hash
			 FROM exploitdb_entries
			 WHERE exploit_id = ?1
			 LIMIT 1`,
		);
		const upsert = client.query(
			`INSERT INTO exploitdb_entries (
				exploit_id,
				source_id,
				source_url,
				title,
				type_display,
				type_name,
				platform_display,
				author_id,
				author_name,
				date_published,
				verified,
				application_path,
				application_md5,
				port,
				screenshot_path,
				screenshot_thumb_path,
				tags_json,
				codes_json,
				download_url,
				raw_url,
				payload_hash,
				metadata_json,
				fetched_at
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
			ON CONFLICT(exploit_id) DO UPDATE SET
				source_id = excluded.source_id,
				source_url = excluded.source_url,
				title = excluded.title,
				type_display = excluded.type_display,
				type_name = excluded.type_name,
				platform_display = excluded.platform_display,
				author_id = excluded.author_id,
				author_name = excluded.author_name,
				date_published = excluded.date_published,
				verified = excluded.verified,
				application_path = excluded.application_path,
				application_md5 = excluded.application_md5,
				port = excluded.port,
				screenshot_path = excluded.screenshot_path,
				screenshot_thumb_path = excluded.screenshot_thumb_path,
				tags_json = excluded.tags_json,
				codes_json = excluded.codes_json,
				download_url = excluded.download_url,
				raw_url = excluded.raw_url,
				payload_hash = excluded.payload_hash,
				metadata_json = excluded.metadata_json,
				fetched_at = excluded.fetched_at`,
		);

		let inserted = 0;
		let updated = 0;
		let unchanged = 0;

		client.exec("BEGIN IMMEDIATE TRANSACTION");
		try {
			for (const record of records) {
				const existing = selectExisting.get(record.exploitId) as { payload_hash: string } | null;
				if (!existing) {
					inserted += 1;
				} else if (existing.payload_hash === record.payloadHash) {
					unchanged += 1;
				} else {
					updated += 1;
				}

				upsert.run(
					record.exploitId,
					record.sourceId,
					record.sourceUrl,
					record.title,
					record.typeDisplay,
					record.typeName,
					record.platformDisplay,
					record.authorId,
					record.authorName,
					record.datePublished,
					record.verified ? 1 : 0,
					record.applicationPath,
					record.applicationMd5,
					record.port,
					record.screenshotPath,
					record.screenshotThumbPath,
					record.tagsJson,
					record.codesJson,
					record.downloadUrl,
					record.rawUrl,
					record.payloadHash,
					record.metadataJson,
					record.fetchedAt,
				);
			}
			client.exec("COMMIT");
		} catch (error) {
			client.exec("ROLLBACK");
			throw error;
		}

		return {
			inserted,
			updated,
			unchanged,
			total: records.length,
		};
	}

	selectExploitDbEntries(limit: number = 100, offset: number = 0): ExploitDbEntryRow[] {
		this.ensureExploitDbStore();
		const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
		const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
		return this.getClient().query(
			`SELECT id, exploit_id, source_id, source_url, title, type_display, type_name,
			        platform_display, author_id, author_name, date_published, verified,
			        application_path, application_md5, port, screenshot_path,
			        screenshot_thumb_path, tags_json, codes_json, download_url, raw_url,
			        payload_hash, metadata_json, fetched_at
			 FROM exploitdb_entries
			 ORDER BY date_published DESC, CAST(exploit_id AS INTEGER) DESC
			 LIMIT ?1 OFFSET ?2`,
		)
			.all(normalizedLimit, normalizedOffset) as ExploitDbEntryRow[];
	}

	selectExploitDbEntryByExploitId(exploitId: string): ExploitDbEntryRow | null {
		this.ensureExploitDbStore();
		return this.getClient().query(
			`SELECT id, exploit_id, source_id, source_url, title, type_display, type_name,
			        platform_display, author_id, author_name, date_published, verified,
			        application_path, application_md5, port, screenshot_path,
			        screenshot_thumb_path, tags_json, codes_json, download_url, raw_url,
			        payload_hash, metadata_json, fetched_at
			 FROM exploitdb_entries
			 WHERE exploit_id = ?1
			 LIMIT 1`,
		)
			.get(exploitId) as ExploitDbEntryRow | null;
	}

	selectExploitDbEntriesByExploitIds(exploitIds: readonly string[]): ExploitDbEntryRow[] {
		this.ensureExploitDbStore();
		if (exploitIds.length === 0) {
			return [];
		}

		const placeholders = exploitIds.map((_value, index) => `?${index + 1}`).join(", ");
		return this.getClient().query(
			`SELECT id, exploit_id, source_id, source_url, title, type_display, type_name,
			        platform_display, author_id, author_name, date_published, verified,
			        application_path, application_md5, port, screenshot_path,
			        screenshot_thumb_path, tags_json, codes_json, download_url, raw_url,
			        payload_hash, metadata_json, fetched_at
			 FROM exploitdb_entries
			 WHERE exploit_id IN (${placeholders})`,
		)
			.all(...exploitIds) as ExploitDbEntryRow[];
	}

	upsertExploitDbRaw(record: PersistedExploitDbRawRecord): ExploitDbRawRow {
		this.ensureExploitDbStore();
		this.getClient().query(
			`INSERT INTO exploitdb_raws (
				exploit_id,
				source_id,
				raw_url,
				fetch_status,
				error_message,
				body_text,
				body_sha256,
				content_type,
				content_length,
				fetched_at,
				metadata_json
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
			ON CONFLICT(exploit_id) DO UPDATE SET
				source_id = excluded.source_id,
				raw_url = excluded.raw_url,
				fetch_status = excluded.fetch_status,
				error_message = excluded.error_message,
				body_text = excluded.body_text,
				body_sha256 = excluded.body_sha256,
				content_type = excluded.content_type,
				content_length = excluded.content_length,
				fetched_at = excluded.fetched_at,
				metadata_json = excluded.metadata_json`,
		)
			.run(
				record.exploitId,
				record.sourceId,
				record.rawUrl,
				record.fetchStatus,
				record.errorMessage,
				record.bodyText,
				record.bodySha256,
				record.contentType,
				record.contentLength,
				record.fetchedAt,
				record.metadataJson,
			);

		return this.getClient().query(
			`SELECT exploit_id, source_id, raw_url, fetch_status, error_message,
			        body_text, body_sha256, content_type, content_length,
			        fetched_at, metadata_json
			 FROM exploitdb_raws
			 WHERE exploit_id = ?1
			 LIMIT 1`,
		)
			.get(record.exploitId) as ExploitDbRawRow;
	}

	selectExploitDbRawByExploitId(exploitId: string): ExploitDbRawRow | null {
		this.ensureExploitDbStore();
		return this.getClient().query(
			`SELECT exploit_id, source_id, raw_url, fetch_status, error_message,
			        body_text, body_sha256, content_type, content_length,
			        fetched_at, metadata_json
			 FROM exploitdb_raws
			 WHERE exploit_id = ?1
			 LIMIT 1`,
		)
			.get(exploitId) as ExploitDbRawRow | null;
	}

	selectExploitDbRawsByExploitIds(exploitIds: readonly string[]): ExploitDbRawRow[] {
		this.ensureExploitDbStore();
		if (exploitIds.length === 0) {
			return [];
		}

		const placeholders = exploitIds.map((_value, index) => `?${index + 1}`).join(", ");
		return this.getClient().query(
			`SELECT exploit_id, source_id, raw_url, fetch_status, error_message,
			        body_text, body_sha256, content_type, content_length,
			        fetched_at, metadata_json
			 FROM exploitdb_raws
			 WHERE exploit_id IN (${placeholders})`,
		)
			.all(...exploitIds) as ExploitDbRawRow[];
	}

	upsertHttpClientSavedRequest(record: PersistedHttpClientSavedRequestRecord): HttpClientSavedRequestRow {
		this.ensureHttpClientStore();
		this.getClient().query(
			`INSERT INTO http_client_saved_requests (
				id,
				name,
				method,
				url,
				headers_json,
				query_json,
				body_text,
				body_kind,
				last_status_code,
				last_duration_ms,
				last_response_headers_json,
				last_response_body_preview,
				last_response_content_type,
				last_response_size_bytes,
				last_executed_at,
				created_at,
				updated_at
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				method = excluded.method,
				url = excluded.url,
				headers_json = excluded.headers_json,
				query_json = excluded.query_json,
				body_text = excluded.body_text,
				body_kind = excluded.body_kind,
				last_status_code = excluded.last_status_code,
				last_duration_ms = excluded.last_duration_ms,
				last_response_headers_json = excluded.last_response_headers_json,
				last_response_body_preview = excluded.last_response_body_preview,
				last_response_content_type = excluded.last_response_content_type,
				last_response_size_bytes = excluded.last_response_size_bytes,
				last_executed_at = excluded.last_executed_at,
				updated_at = excluded.updated_at`,
		)
			.run(
				record.id,
				record.name,
				record.method,
				record.url,
				record.headersJson,
				record.queryJson,
				record.bodyText,
				record.bodyKind,
				record.lastStatusCode,
				record.lastDurationMs,
				record.lastResponseHeadersJson,
				record.lastResponseBodyPreview,
				record.lastResponseContentType,
				record.lastResponseSizeBytes,
				record.lastExecutedAt,
				record.createdAt,
				record.updatedAt,
			);

		return this.getClient().query(
			`SELECT id, name, method, url, headers_json, query_json, body_text,
			        body_kind, last_status_code, last_duration_ms,
			        last_response_headers_json, last_response_body_preview,
			        last_response_content_type, last_response_size_bytes,
			        last_executed_at, created_at, updated_at
			 FROM http_client_saved_requests
			 WHERE id = ?1
			 LIMIT 1`,
		)
			.get(record.id) as HttpClientSavedRequestRow;
	}

	selectHttpClientSavedRequests(limit: number = 100, offset: number = 0): HttpClientSavedRequestRow[] {
		this.ensureHttpClientStore();
		const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
		const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
		return this.getClient().query(
			`SELECT id, name, method, url, headers_json, query_json, body_text,
			        body_kind, last_status_code, last_duration_ms,
			        last_response_headers_json, last_response_body_preview,
			        last_response_content_type, last_response_size_bytes,
			        last_executed_at, created_at, updated_at
			 FROM http_client_saved_requests
			 ORDER BY updated_at DESC, id DESC
			 LIMIT ?1 OFFSET ?2`,
		)
			.all(normalizedLimit, normalizedOffset) as HttpClientSavedRequestRow[];
	}

	selectHttpClientSavedRequestById(id: string): HttpClientSavedRequestRow | null {
		this.ensureHttpClientStore();
		return this.getClient().query(
			`SELECT id, name, method, url, headers_json, query_json, body_text,
			        body_kind, last_status_code, last_duration_ms,
			        last_response_headers_json, last_response_body_preview,
			        last_response_content_type, last_response_size_bytes,
			        last_executed_at, created_at, updated_at
			 FROM http_client_saved_requests
			 WHERE id = ?1
			 LIMIT 1`,
		)
			.get(id) as HttpClientSavedRequestRow | null;
	}

	deleteHttpClientSavedRequest(id: string): boolean {
		this.ensureHttpClientStore();
		const result = this.getClient().query(
			`DELETE FROM http_client_saved_requests
			 WHERE id = ?1`,
		)
			.run(id) as { changes?: number };

		return (result.changes ?? 0) > 0;
	}

	upsertPortScanRun(record: PersistedPortScanRunRecord): PortScanRunRow {
		this.ensurePortScanStore();
		this.getClient().query(
			`INSERT INTO port_scan_runs (
				scan_id,
				host,
				requested_ports,
				requested_top_ports,
				selection_mode,
				scanned_port_count,
				open_port_count,
				concurrency,
				connect_timeout_ms,
				started_at,
				finished_at,
				duration_ms,
				error_message
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
			ON CONFLICT(scan_id) DO UPDATE SET
				host = excluded.host,
				requested_ports = excluded.requested_ports,
				requested_top_ports = excluded.requested_top_ports,
				selection_mode = excluded.selection_mode,
				scanned_port_count = excluded.scanned_port_count,
				open_port_count = excluded.open_port_count,
				concurrency = excluded.concurrency,
				connect_timeout_ms = excluded.connect_timeout_ms,
				started_at = excluded.started_at,
				finished_at = excluded.finished_at,
				duration_ms = excluded.duration_ms,
				error_message = excluded.error_message`,
		)
			.run(
				record.scanId,
				record.host,
				record.requestedPorts,
				record.requestedTopPorts,
				record.selectionMode,
				record.scannedPortCount,
				record.openPortCount,
				record.concurrency,
				record.connectTimeoutMs,
				record.startedAt,
				record.finishedAt,
				record.durationMs,
				record.errorMessage,
			);

		return this.getClient().query(
			`SELECT scan_id, host, requested_ports, requested_top_ports, selection_mode,
			        scanned_port_count, open_port_count, concurrency, connect_timeout_ms,
			        started_at, finished_at, duration_ms, error_message
			 FROM port_scan_runs
			 WHERE scan_id = ?1
			 LIMIT 1`,
		)
			.get(record.scanId) as PortScanRunRow;
	}

	replacePortScanOpenPorts(scanId: string, ports: readonly number[]): void {
		this.ensurePortScanStore();
		this.getClient().query(
			`DELETE FROM port_scan_open_ports
			 WHERE scan_id = ?1`,
		)
			.run(scanId);

		if (ports.length === 0) {
			return;
		}

		const insert = this.getClient().query(
			`INSERT INTO port_scan_open_ports (
				scan_id,
				port
			) VALUES (?1, ?2)`,
		);

		for (const port of ports) {
			insert.run(scanId, port);
		}
	}

	selectPortScanRuns(limit: number = 100, offset: number = 0, host?: string): PortScanRunRow[] {
		this.ensurePortScanStore();
		const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
		const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
		const normalizedHost = host?.trim();

		if (normalizedHost) {
			return this.getClient().query(
				`SELECT scan_id, host, requested_ports, requested_top_ports, selection_mode,
				        scanned_port_count, open_port_count, concurrency, connect_timeout_ms,
				        started_at, finished_at, duration_ms, error_message
				 FROM port_scan_runs
				 WHERE host = ?1
				 ORDER BY started_at DESC, scan_id DESC
				 LIMIT ?2 OFFSET ?3`,
			)
				.all(normalizedHost, normalizedLimit, normalizedOffset) as PortScanRunRow[];
		}

		return this.getClient().query(
			`SELECT scan_id, host, requested_ports, requested_top_ports, selection_mode,
			        scanned_port_count, open_port_count, concurrency, connect_timeout_ms,
			        started_at, finished_at, duration_ms, error_message
			 FROM port_scan_runs
			 ORDER BY started_at DESC, scan_id DESC
			 LIMIT ?1 OFFSET ?2`,
		)
			.all(normalizedLimit, normalizedOffset) as PortScanRunRow[];
	}

	selectPortScanRunById(scanId: string): PortScanRunRow | null {
		this.ensurePortScanStore();
		return this.getClient().query(
			`SELECT scan_id, host, requested_ports, requested_top_ports, selection_mode,
			        scanned_port_count, open_port_count, concurrency, connect_timeout_ms,
			        started_at, finished_at, duration_ms, error_message
			 FROM port_scan_runs
			 WHERE scan_id = ?1
			 LIMIT 1`,
		)
			.get(scanId) as PortScanRunRow | null;
	}

	selectPortScanOpenPortsByScanIds(scanIds: readonly string[]): PortScanOpenPortRow[] {
		this.ensurePortScanStore();
		if (scanIds.length === 0) {
			return [];
		}

		const placeholders = scanIds.map((_value, index) => `?${index + 1}`).join(", ");
		return this.getClient().query(
			`SELECT scan_id, port
			 FROM port_scan_open_ports
			 WHERE scan_id IN (${placeholders})
			 ORDER BY scan_id ASC, port ASC`,
		)
			.all(...scanIds) as PortScanOpenPortRow[];
	}

	insertNote(record: PersistedNoteRecord): NoteRow {
		this.ensureNoteStore();
		this.getClient().query(
			`INSERT INTO notes (
				id,
				created_at,
				text
			) VALUES (?1, ?2, ?3)`,
		)
			.run(
				record.id,
				record.createdAt,
				record.text,
			);

		return {
			id: record.id,
			created_at: record.createdAt,
			text: record.text,
		};
	}

	insertAuditCrawlFindings(records: readonly PersistedAuditCrawlFindingRecord[]): void {
		this.ensureAuditCrawlFindingStore();

		if (records.length === 0) {
			return;
		}

		const insert = this.getClient().query(
			`INSERT INTO crawl_audit_findings (
				entry_url,
				audited_at,
				resource_id,
				resource_kind,
				resource_label,
				resource_url,
				severity,
				kind,
				location,
				evidence,
				raw_evidence,
				message
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
		);

		for (const record of records) {
			insert.run(
				record.entryUrl,
				record.auditedAt,
				record.resourceId,
				record.resourceKind,
				record.resourceLabel,
				record.resourceUrl,
				record.severity,
				record.kind,
				record.location,
				record.evidence,
				record.rawEvidence,
				record.message,
			);
		}
	}

	upsertUaSource(record: PersistedUaSourceRecord): UaSourceRow {
		this.ensureUaStore();
		this.getClient().query(
			`INSERT INTO ua_sources (
				source_id,
				source_kind,
				source_url,
				enabled,
				fetch_status,
				error_message,
				fetched_at,
				exact_agent_count,
				pattern_count,
				metadata_json
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
			ON CONFLICT(source_id) DO UPDATE SET
				source_kind = excluded.source_kind,
				source_url = excluded.source_url,
				enabled = excluded.enabled,
				fetch_status = excluded.fetch_status,
				error_message = excluded.error_message,
				fetched_at = excluded.fetched_at,
				exact_agent_count = excluded.exact_agent_count,
				pattern_count = excluded.pattern_count,
				metadata_json = excluded.metadata_json`,
		)
			.run(
				record.sourceId,
				record.sourceKind,
				record.sourceUrl,
				record.enabled ? 1 : 0,
				record.fetchStatus,
				record.errorMessage,
				record.fetchedAt,
				record.exactAgentCount,
				record.patternCount,
				record.metadataJson,
			);

		return this.getClient().query(
			`SELECT source_id, source_kind, source_url, enabled, fetch_status,
			        error_message, fetched_at, exact_agent_count, pattern_count, metadata_json
			 FROM ua_sources
			 WHERE source_id = ?1
			 LIMIT 1`,
		)
			.get(record.sourceId) as UaSourceRow;
	}

	selectUaSources(): UaSourceRow[] {
		this.ensureUaStore();
		return this.getClient().query(
			`SELECT source_id, source_kind, source_url, enabled, fetch_status,
			        error_message, fetched_at, exact_agent_count, pattern_count, metadata_json
			 FROM ua_sources
			 ORDER BY source_id ASC`,
		)
			.all() as UaSourceRow[];
	}

	replaceUaExactAgentsForSource(sourceId: string, records: readonly PersistedUaExactAgentRecord[]): void {
		this.ensureUaStore();
		const client = this.getClient();
		const deleteStatement = client.query(
			`DELETE FROM ua_exact_agents
			 WHERE source_id = ?1`,
		);
		const insertStatement = client.query(
			`INSERT INTO ua_exact_agents (
				source_id,
				source_kind,
				source_url,
				source_record_id,
				display_name,
				description,
				category,
				disposition,
				user_agent,
				browser_family,
				browser_version,
				os_family,
				device_class,
				label,
				metadata_json,
				fetched_at
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
		);

		client.exec("BEGIN IMMEDIATE TRANSACTION");
		try {
			deleteStatement.run(sourceId);
			for (const record of records) {
				insertStatement.run(
					record.sourceId,
					record.sourceKind,
					record.sourceUrl,
					record.sourceRecordId,
					record.displayName,
					record.description,
					record.category,
					record.disposition,
					record.userAgent,
					record.browserFamily,
					record.browserVersion,
					record.osFamily,
					record.deviceClass,
					record.label,
					record.metadataJson,
					record.fetchedAt,
				);
			}
			client.exec("COMMIT");
		} catch (error) {
			client.exec("ROLLBACK");
			throw error;
		}
	}

	selectUaExactAgents(): UaExactAgentRow[] {
		this.ensureUaStore();
		return this.getClient().query(
			`SELECT id, source_id, source_kind, source_url, source_record_id, display_name,
			        description, category, disposition, user_agent, browser_family,
			        browser_version, os_family, device_class, label, metadata_json, fetched_at
			 FROM ua_exact_agents
			 ORDER BY source_id ASC, category ASC, label ASC, id ASC`,
		)
			.all() as UaExactAgentRow[];
	}

	replaceUaPatternsForSource(sourceId: string, records: readonly PersistedUaPatternRecord[]): void {
		this.ensureUaStore();
		const client = this.getClient();
		const deleteStatement = client.query(
			`DELETE FROM ua_patterns
			 WHERE source_id = ?1`,
		);
		const insertStatement = client.query(
			`INSERT INTO ua_patterns (
				source_id,
				source_kind,
				source_url,
				source_record_id,
				display_name,
				description,
				category,
				disposition,
				pattern,
				metadata_json,
				fetched_at
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
		);

		client.exec("BEGIN IMMEDIATE TRANSACTION");
		try {
			deleteStatement.run(sourceId);
			for (const record of records) {
				insertStatement.run(
					record.sourceId,
					record.sourceKind,
					record.sourceUrl,
					record.sourceRecordId,
					record.displayName,
					record.description,
					record.category,
					record.disposition,
					record.pattern,
					record.metadataJson,
					record.fetchedAt,
				);
			}
			client.exec("COMMIT");
		} catch (error) {
			client.exec("ROLLBACK");
			throw error;
		}
	}

	selectUaPatterns(): UaPatternRow[] {
		this.ensureUaStore();
		return this.getClient().query(
			`SELECT id, source_id, source_kind, source_url, source_record_id, display_name,
			        description, category, disposition, pattern, metadata_json, fetched_at
			 FROM ua_patterns
			 ORDER BY source_id ASC, category ASC, pattern ASC, id ASC`,
		)
			.all() as UaPatternRow[];
	}

	upsertMicrolinkUaSnapshot(record: PersistedMicrolinkUaSnapshotRecord): MicrolinkUaSnapshotRow {
		this.ensureMicrolinkUaStore();
		this.getClient().query(
			`INSERT INTO microlink_ua_snapshot (
				snapshot_key,
				source_url,
				payload_json,
				fetched_at,
				microlink_updated_at,
				fetch_status,
				error_message
			) VALUES (
				'latest', ?1, ?2, ?3, ?4, ?5, ?6
			)
			ON CONFLICT(snapshot_key) DO UPDATE SET
				source_url = excluded.source_url,
				payload_json = excluded.payload_json,
				fetched_at = excluded.fetched_at,
				microlink_updated_at = excluded.microlink_updated_at,
				fetch_status = excluded.fetch_status,
				error_message = excluded.error_message`,
		)
			.run(
				record.sourceUrl,
				record.payloadJson,
				record.fetchedAt,
				record.microlinkUpdatedAt,
				record.fetchStatus,
				record.errorMessage,
			);

		return this.getClient().query(
			`SELECT snapshot_key, source_url, payload_json, fetched_at,
			        microlink_updated_at, fetch_status, error_message
			FROM microlink_ua_snapshot
			WHERE snapshot_key = 'latest'
			LIMIT 1`,
		)
			.get() as MicrolinkUaSnapshotRow;
	}

	selectMicrolinkUaSnapshot(): MicrolinkUaSnapshotRow | null {
		this.ensureMicrolinkUaStore();
		return this.getClient().query(
			`SELECT snapshot_key, source_url, payload_json, fetched_at,
			        microlink_updated_at, fetch_status, error_message
			FROM microlink_ua_snapshot
			WHERE snapshot_key = 'latest'
			LIMIT 1`,
		)
			.get() as MicrolinkUaSnapshotRow | null;
	}

	upsertZoomEyeHosts(records: readonly PersistedZoomEyeHostRecord[]): ZoomEyeHostUpsertSummary {
		this.ensureZoomEyeHostStore();

		if (records.length === 0) {
			return {
				inserted: 0,
				updated: 0,
				total: 0,
			};
		}

		const client = this.getClient();
		const selectExisting = client.query(
			`SELECT 1
			FROM zoomeye_hosts
			WHERE ip = ?1 AND port = ?2
			LIMIT 1`,
		);
		const upsert = client.query(
			`INSERT INTO zoomeye_hosts (
				ip,
				port,
				query_base64,
				query_text,
				search_type,
				page_size,
				match_type,
				service,
				transport,
				product,
				hostname,
				os,
				title,
				extra_info,
				body,
				header,
				banner,
				token,
				qid,
				zoomeye_timestamp,
				country_code,
				country_name_en,
				country_name_cn,
				city_name_en,
				city_name_cn,
				subdivision_name_en,
				subdivision_name_cn,
				organization,
				asn,
				raw_json,
				first_pulled_at,
				last_pulled_at
			) VALUES (
				?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
				?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
				?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
				?31, ?32
			)
			ON CONFLICT(ip, port) DO UPDATE SET
				query_base64 = excluded.query_base64,
				query_text = excluded.query_text,
				search_type = excluded.search_type,
				page_size = excluded.page_size,
				match_type = excluded.match_type,
				service = excluded.service,
				transport = excluded.transport,
				product = excluded.product,
				hostname = excluded.hostname,
				os = excluded.os,
				title = excluded.title,
				extra_info = excluded.extra_info,
				body = excluded.body,
				header = excluded.header,
				banner = excluded.banner,
				token = excluded.token,
				qid = excluded.qid,
				zoomeye_timestamp = excluded.zoomeye_timestamp,
				country_code = excluded.country_code,
				country_name_en = excluded.country_name_en,
				country_name_cn = excluded.country_name_cn,
				city_name_en = excluded.city_name_en,
				city_name_cn = excluded.city_name_cn,
				subdivision_name_en = excluded.subdivision_name_en,
				subdivision_name_cn = excluded.subdivision_name_cn,
				organization = excluded.organization,
				asn = excluded.asn,
				raw_json = excluded.raw_json,
				last_pulled_at = excluded.last_pulled_at`,
		);

		let inserted = 0;
		let updated = 0;

		for (const record of records) {
			const exists = selectExisting.get(record.ip, record.port) as { 1: number } | null;
			if (exists) {
				updated += 1;
			} else {
				inserted += 1;
			}

			upsert.run(
				record.ip,
				record.port,
				record.queryBase64,
				record.queryText,
				record.searchType,
				record.pageSize,
				record.type,
				record.service,
				record.transport,
				record.product,
				record.hostname,
				record.os,
				record.title,
				record.extraInfo,
				record.body,
				record.header,
				record.banner,
				record.token,
				record.qid,
				record.zoomeyeTimestamp,
				record.countryCode,
				record.countryNameEn,
				record.countryNameCn,
				record.cityNameEn,
				record.cityNameCn,
				record.subdivisionNameEn,
				record.subdivisionNameCn,
				record.organization,
				record.asn,
				record.rawJson,
				record.fetchedAt,
				record.fetchedAt,
			);
		}

		return {
			inserted,
			updated,
			total: records.length,
		};
	}

	selectZoomEyeHosts(limit: number): ZoomEyeHostSelectRow[] {
		this.ensureZoomEyeHostStore();
		return this.getClient().query(
			`SELECT ip, port, query_text, service, transport, product,
			        hostname, os, title, body, header, banner,
			        organization, country_code, country_name_en, last_pulled_at
			FROM zoomeye_hosts
			ORDER BY last_pulled_at DESC
			LIMIT ?1`,
		).all(limit) as ZoomEyeHostSelectRow[];
	}

	selectZoomEyeHostsByBatch(queryBase64: string, lastPulledAt: string, limit: number): ZoomEyeHostSelectRow[] {
		this.ensureZoomEyeHostStore();

		const normalizedQueryBase64 = queryBase64.trim();
		const normalizedLastPulledAt = lastPulledAt.trim();
		const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 250;

		if (normalizedQueryBase64.length === 0 || normalizedLastPulledAt.length === 0) {
			return [];
		}

		return this.getClient().query(
			`SELECT ip, port, query_text, service, transport, product,
			        hostname, os, title, body, header, banner,
			        organization, country_code, country_name_en, last_pulled_at
			 FROM zoomeye_hosts
			 WHERE query_base64 = ?1
			   AND last_pulled_at = ?2
			 ORDER BY ip ASC, port ASC
			 LIMIT ?3`,
		)
			.all(normalizedQueryBase64, normalizedLastPulledAt, normalizedLimit) as ZoomEyeHostSelectRow[];
	}

	selectZoomEyeHostByEndpoint(ip: string, port: number): ZoomEyeHostDetailRow | null {
		this.ensureZoomEyeHostStore();

		const normalizedIp = ip.trim();
		const normalizedPort = Number.isInteger(port) ? port : 0;
		if (normalizedIp.length === 0 || normalizedPort <= 0) {
			return null;
		}

		return this.getClient().query(
			`SELECT id, ip, port, query_base64, query_text, search_type, page_size,
			        match_type, service, transport, product, hostname, os, title,
			        extra_info, body, header, banner, token, qid, zoomeye_timestamp,
			        country_code, country_name_en, country_name_cn, city_name_en, city_name_cn,
			        subdivision_name_en, subdivision_name_cn, organization, asn, raw_json,
			        first_pulled_at, last_pulled_at
			 FROM zoomeye_hosts
			 WHERE ip = ?1 AND port = ?2
			 LIMIT 1`,
		)
			.get(normalizedIp, normalizedPort) as ZoomEyeHostDetailRow | null;
	}

	upsertZoomEyeQueryHistory(record: PersistedZoomEyeQueryHistoryRecord): ZoomEyeQueryHistoryRow {
		this.ensureZoomEyeQueryHistoryStore();
		this.getClient().query(
			`INSERT INTO zoomeye_query_history (
				dedupe_key,
				kind,
				label,
				query_text,
				query_base64,
				search_field,
				search_type,
				page_size,
				max_results,
				start_page,
				limit_rows,
				cloak_profile_target,
				result_count,
				last_used_at,
				use_count
			) VALUES (
				?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1
			)
			ON CONFLICT(dedupe_key) DO UPDATE SET
				kind = excluded.kind,
				label = excluded.label,
				query_text = excluded.query_text,
				query_base64 = excluded.query_base64,
				search_field = excluded.search_field,
				search_type = excluded.search_type,
				page_size = excluded.page_size,
				max_results = excluded.max_results,
				start_page = excluded.start_page,
				limit_rows = excluded.limit_rows,
				cloak_profile_target = excluded.cloak_profile_target,
				result_count = excluded.result_count,
				last_used_at = excluded.last_used_at,
				use_count = zoomeye_query_history.use_count + 1`,
		)
			.run(
				record.dedupeKey,
				record.kind,
				record.label,
				record.queryText,
				record.queryBase64,
				record.searchField,
				record.searchType,
				record.pageSize,
				record.maxResults,
				record.startPage,
				record.limitRows,
				record.cloakProfileTarget,
				record.resultCount,
				record.usedAt,
			);

		return this.getClient().query(
			`SELECT id, dedupe_key, kind, label, query_text, query_base64, search_field,
			        search_type, page_size, max_results, start_page, limit_rows,
			        cloak_profile_target, result_count, last_used_at, use_count
			FROM zoomeye_query_history
			WHERE dedupe_key = ?1
			LIMIT 1`,
		)
			.get(record.dedupeKey) as ZoomEyeQueryHistoryRow;
	}

	selectZoomEyeQueryHistory(limit: number, kind?: ZoomEyeQueryHistoryKind): ZoomEyeQueryHistoryRow[] {
		this.ensureZoomEyeQueryHistoryStore();
		const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;

		if (kind) {
			return this.getClient().query(
				`SELECT id, dedupe_key, kind, label, query_text, query_base64, search_field,
				        search_type, page_size, max_results, start_page, limit_rows,
				        cloak_profile_target, result_count, last_used_at, use_count
				FROM zoomeye_query_history
				WHERE kind = ?1
				ORDER BY last_used_at DESC, id DESC
				LIMIT ?2`,
			)
				.all(kind, normalizedLimit) as ZoomEyeQueryHistoryRow[];
		}

		return this.getClient().query(
			`SELECT id, dedupe_key, kind, label, query_text, query_base64, search_field,
			        search_type, page_size, max_results, start_page, limit_rows,
			        cloak_profile_target, result_count, last_used_at, use_count
			FROM zoomeye_query_history
			ORDER BY last_used_at DESC, id DESC
			LIMIT ?1`,
		)
			.all(normalizedLimit) as ZoomEyeQueryHistoryRow[];
	}

	private createDatabase() {
		const absolutePath = this.getDatabasePath();
		const db = drizzle(absolutePath);
		const client = this.getClient(db);

		// Enable WAL mode for better concurrency across workers.
		client.exec("PRAGMA journal_mode = WAL;");
		client.exec("PRAGMA busy_timeout = 5000;");

		return db;
	}

	private ensureWorkerLogStore(): void {
		if (this.workerLogStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS worker_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				worker_id TEXT NOT NULL,
				worker_name TEXT NOT NULL,
				relative_script_path TEXT NOT NULL,
				script_path TEXT NOT NULL,
				worker_started_at TEXT NOT NULL,
				kind TEXT NOT NULL,
				level TEXT,
				message TEXT NOT NULL,
				payload TEXT,
				at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS worker_logs_relative_script_path_idx
			ON worker_logs(relative_script_path, id DESC);
		`);
		this.workerLogStoreReady = true;
	}

	private ensureZoomEyeHostStore(): void {
		if (this.zoomeyeHostStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS zoomeye_hosts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ip TEXT NOT NULL,
				port INTEGER NOT NULL,
				query_base64 TEXT NOT NULL,
				query_text TEXT,
				search_type TEXT NOT NULL,
				page_size INTEGER NOT NULL,
				match_type TEXT,
				service TEXT,
				transport TEXT,
				product TEXT,
				hostname TEXT,
				os TEXT,
				title TEXT,
				extra_info TEXT,
				body TEXT,
				header TEXT,
				banner TEXT,
				token TEXT,
				qid TEXT,
				zoomeye_timestamp TEXT,
				country_code TEXT,
				country_name_en TEXT,
				country_name_cn TEXT,
				city_name_en TEXT,
				city_name_cn TEXT,
				subdivision_name_en TEXT,
				subdivision_name_cn TEXT,
				organization TEXT,
				asn TEXT,
				raw_json TEXT NOT NULL,
				first_pulled_at TEXT NOT NULL,
				last_pulled_at TEXT NOT NULL,
				UNIQUE(ip, port)
			);

			CREATE INDEX IF NOT EXISTS zoomeye_hosts_last_pulled_at_idx
			ON zoomeye_hosts(last_pulled_at DESC);
		`);

		this.zoomeyeHostStoreReady = true;
	}

	private ensureZoomEyeQueryHistoryStore(): void {
		if (this.zoomeyeQueryHistoryStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS zoomeye_query_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				dedupe_key TEXT NOT NULL UNIQUE,
				kind TEXT NOT NULL,
				label TEXT NOT NULL,
				query_text TEXT,
				query_base64 TEXT,
				search_field TEXT,
				search_type TEXT,
				page_size INTEGER,
				max_results INTEGER,
				start_page INTEGER,
				limit_rows INTEGER,
				cloak_profile_target TEXT,
				result_count INTEGER,
				last_used_at TEXT NOT NULL,
				use_count INTEGER NOT NULL DEFAULT 1
			);

			CREATE INDEX IF NOT EXISTS zoomeye_query_history_last_used_at_idx
			ON zoomeye_query_history(last_used_at DESC, id DESC);

			CREATE INDEX IF NOT EXISTS zoomeye_query_history_kind_last_used_at_idx
			ON zoomeye_query_history(kind, last_used_at DESC, id DESC);
		`);

		this.zoomeyeQueryHistoryStoreReady = true;
	}

	private ensureMicrolinkUaStore(): void {
		if (this.microlinkUaStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS microlink_ua_snapshot (
				snapshot_key TEXT PRIMARY KEY,
				source_url TEXT NOT NULL,
				payload_json TEXT,
				fetched_at TEXT NOT NULL,
				microlink_updated_at INTEGER,
				fetch_status TEXT NOT NULL,
				error_message TEXT
			);

			CREATE INDEX IF NOT EXISTS microlink_ua_snapshot_fetched_at_idx
			ON microlink_ua_snapshot(fetched_at DESC);
		`);

		this.microlinkUaStoreReady = true;
	}

	private ensureUaStore(): void {
		if (this.uaStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS ua_sources (
				source_id TEXT PRIMARY KEY,
				source_kind TEXT NOT NULL,
				source_url TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				fetch_status TEXT,
				error_message TEXT,
				fetched_at TEXT,
				exact_agent_count INTEGER NOT NULL DEFAULT 0,
				pattern_count INTEGER NOT NULL DEFAULT 0,
				metadata_json TEXT
			);

			CREATE INDEX IF NOT EXISTS ua_sources_fetched_at_idx
			ON ua_sources(fetched_at DESC, source_id ASC);

			CREATE TABLE IF NOT EXISTS ua_exact_agents (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source_id TEXT NOT NULL,
				source_kind TEXT NOT NULL,
				source_url TEXT NOT NULL,
				source_record_id TEXT,
				display_name TEXT,
				description TEXT,
				category TEXT NOT NULL,
				disposition TEXT NOT NULL,
				user_agent TEXT NOT NULL,
				browser_family TEXT,
				browser_version TEXT,
				os_family TEXT,
				device_class TEXT,
				label TEXT NOT NULL,
				metadata_json TEXT,
				fetched_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS ua_exact_agents_source_idx
			ON ua_exact_agents(source_id, category, disposition, id DESC);

			CREATE INDEX IF NOT EXISTS ua_exact_agents_browser_idx
			ON ua_exact_agents(browser_family, browser_version, os_family, device_class, id DESC);

			CREATE INDEX IF NOT EXISTS ua_exact_agents_user_agent_idx
			ON ua_exact_agents(user_agent, source_id, id DESC);

			CREATE TABLE IF NOT EXISTS ua_patterns (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source_id TEXT NOT NULL,
				source_kind TEXT NOT NULL,
				source_url TEXT NOT NULL,
				source_record_id TEXT,
				display_name TEXT,
				description TEXT,
				category TEXT NOT NULL,
				disposition TEXT NOT NULL,
				pattern TEXT NOT NULL,
				metadata_json TEXT,
				fetched_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS ua_patterns_source_idx
			ON ua_patterns(source_id, category, disposition, id DESC);

			CREATE INDEX IF NOT EXISTS ua_patterns_pattern_idx
			ON ua_patterns(pattern, source_id, id DESC);
		`);

		this.uaStoreReady = true;
	}

	private ensureExploitDbStore(): void {
		if (this.exploitDbStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS exploitdb_sources (
				source_id TEXT PRIMARY KEY,
				source_url TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				fetch_status TEXT,
				error_message TEXT,
				fetched_at TEXT,
				last_recent_sync_at TEXT,
				last_backfill_sync_at TEXT,
				next_backfill_start INTEGER NOT NULL DEFAULT 0,
				backfill_complete INTEGER NOT NULL DEFAULT 0,
				records_total INTEGER NOT NULL DEFAULT 0,
				records_filtered INTEGER NOT NULL DEFAULT 0,
				newest_exploit_id TEXT,
				metadata_json TEXT
			);

			CREATE INDEX IF NOT EXISTS exploitdb_sources_fetched_at_idx
			ON exploitdb_sources(fetched_at DESC, source_id ASC);

			CREATE TABLE IF NOT EXISTS exploitdb_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				exploit_id TEXT NOT NULL UNIQUE,
				source_id TEXT NOT NULL,
				source_url TEXT NOT NULL,
				title TEXT NOT NULL,
				type_display TEXT,
				type_name TEXT,
				platform_display TEXT,
				author_id TEXT,
				author_name TEXT,
				date_published TEXT,
				verified INTEGER NOT NULL DEFAULT 0,
				application_path TEXT,
				application_md5 TEXT,
				port INTEGER,
				screenshot_path TEXT,
				screenshot_thumb_path TEXT,
				tags_json TEXT,
				codes_json TEXT,
				download_url TEXT NOT NULL,
				raw_url TEXT NOT NULL,
				payload_hash TEXT NOT NULL,
				metadata_json TEXT,
				fetched_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_date_published_idx
			ON exploitdb_entries(date_published DESC, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_type_idx
			ON exploitdb_entries(type_display, type_name, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_platform_idx
			ON exploitdb_entries(platform_display, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_author_idx
			ON exploitdb_entries(author_name, author_id, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_verified_idx
			ON exploitdb_entries(verified, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_entries_payload_hash_idx
			ON exploitdb_entries(payload_hash, exploit_id DESC);

			CREATE TABLE IF NOT EXISTS exploitdb_raws (
				exploit_id TEXT PRIMARY KEY,
				source_id TEXT NOT NULL,
				raw_url TEXT NOT NULL,
				fetch_status TEXT NOT NULL,
				error_message TEXT,
				body_text TEXT,
				body_sha256 TEXT,
				content_type TEXT,
				content_length INTEGER,
				fetched_at TEXT NOT NULL,
				metadata_json TEXT
			);

			CREATE INDEX IF NOT EXISTS exploitdb_raws_fetched_at_idx
			ON exploitdb_raws(fetched_at DESC, exploit_id DESC);

			CREATE INDEX IF NOT EXISTS exploitdb_raws_status_idx
			ON exploitdb_raws(fetch_status, fetched_at DESC, exploit_id DESC);
		`);

		this.exploitDbStoreReady = true;
	}

	private ensureHttpClientStore(): void {
		if (this.httpClientStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS http_client_saved_requests (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				method TEXT NOT NULL,
				url TEXT NOT NULL,
				headers_json TEXT,
				query_json TEXT,
				body_text TEXT,
				body_kind TEXT,
				last_status_code INTEGER,
				last_duration_ms INTEGER,
				last_response_headers_json TEXT,
				last_response_body_preview TEXT,
				last_response_content_type TEXT,
				last_response_size_bytes INTEGER,
				last_executed_at TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS http_client_saved_requests_updated_at_idx
			ON http_client_saved_requests(updated_at DESC, id DESC);

			CREATE INDEX IF NOT EXISTS http_client_saved_requests_name_idx
			ON http_client_saved_requests(name COLLATE NOCASE, updated_at DESC, id DESC);

			CREATE INDEX IF NOT EXISTS http_client_saved_requests_method_idx
			ON http_client_saved_requests(method, updated_at DESC, id DESC);
		`);

		this.httpClientStoreReady = true;
	}

	private ensureSettingsStore(): void {
		if (this.settingsStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS settings_values (
				id TEXT PRIMARY KEY,
				value_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS settings_values_updated_at_idx
			ON settings_values(updated_at DESC, id ASC);
		`);

		this.settingsStoreReady = true;
	}

	private ensureNoteStore(): void {
		if (this.noteStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS notes (
				id TEXT PRIMARY KEY,
				created_at TEXT NOT NULL,
				text TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS notes_created_at_idx
			ON notes(created_at DESC, id DESC);
		`);

		this.noteStoreReady = true;
	}

	private ensurePortScanStore(): void {
		if (this.portScanStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS port_scan_runs (
				scan_id TEXT PRIMARY KEY,
				host TEXT NOT NULL,
				requested_ports TEXT,
				requested_top_ports INTEGER,
				selection_mode TEXT NOT NULL,
				scanned_port_count INTEGER NOT NULL,
				open_port_count INTEGER NOT NULL,
				concurrency INTEGER NOT NULL,
				connect_timeout_ms INTEGER NOT NULL,
				started_at TEXT NOT NULL,
				finished_at TEXT NOT NULL,
				duration_ms INTEGER NOT NULL,
				error_message TEXT
			);

			CREATE TABLE IF NOT EXISTS port_scan_open_ports (
				scan_id TEXT NOT NULL,
				port INTEGER NOT NULL,
				PRIMARY KEY (scan_id, port)
			);

			CREATE INDEX IF NOT EXISTS port_scan_runs_started_at_idx
			ON port_scan_runs(started_at DESC, scan_id DESC);

			CREATE INDEX IF NOT EXISTS port_scan_runs_host_started_at_idx
			ON port_scan_runs(host, started_at DESC, scan_id DESC);

			CREATE INDEX IF NOT EXISTS port_scan_open_ports_port_idx
			ON port_scan_open_ports(port, scan_id);
		`);

		this.portScanStoreReady = true;
	}

	private ensureAuditCrawlFindingStore(): void {
		if (this.auditCrawlFindingStoreReady) {
			return;
		}

		this.getClient().exec(`
			CREATE TABLE IF NOT EXISTS crawl_audit_findings (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				entry_url TEXT NOT NULL,
				audited_at TEXT NOT NULL,
				resource_id TEXT,
				resource_kind TEXT,
				resource_label TEXT,
				resource_url TEXT,
				severity TEXT NOT NULL,
				kind TEXT NOT NULL,
				location TEXT NOT NULL,
				evidence TEXT NOT NULL,
				raw_evidence TEXT NOT NULL,
				message TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS crawl_audit_findings_audited_at_idx
			ON crawl_audit_findings(audited_at DESC, id DESC);

			CREATE INDEX IF NOT EXISTS crawl_audit_findings_entry_url_idx
			ON crawl_audit_findings(entry_url, audited_at DESC, id DESC);

			CREATE INDEX IF NOT EXISTS crawl_audit_findings_resource_id_idx
			ON crawl_audit_findings(resource_id, id DESC);
		`);

		this.auditCrawlFindingStoreReady = true;
	}

	private pruneBackgroundWorkerLogs(relativeScriptPath: string): void {
		const maxEntriesPerWorker = $config.runtime.backgroundWorkers.logRetention.maxEntriesPerWorker;
		this.getClient().query(
			`DELETE FROM worker_logs
			WHERE relative_script_path = ?1
			AND id NOT IN (
				SELECT id
				FROM worker_logs
				WHERE relative_script_path = ?1
				ORDER BY id DESC
				LIMIT ?2
			)`,
		)
			.run(relativeScriptPath, maxEntriesPerWorker);
	}

	private getClient(db: any = this.db): Database {
		return db.$client as Database;
	}
}

// Export a singleton instance for global access if needed
export const $storageKit = new StorageKit();
