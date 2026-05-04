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

export type ZoomEyeQueryHistoryKind = "pull" | "search";

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

		// Enable WAL mode for better concurrency across workers.
		this.getClient(db).exec("PRAGMA journal_mode = WAL;");

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
