import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
} from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";
import {
	AUDIT_TRAVERSAL_CONSOLE_PARAMS,
	collectAuditSecretDetections,
	fetchTextResource,
	maskAuditSecret,
	pushAuditFinding as pushFinding,
	resolveAuditTraversalParams,
	sortAuditFindings as sortFindings,
	traverseAuditDocument,
	type AuditSeverity,
	type AuditTraversalInputParams,
	type ResolvedAuditTraversalParams,
} from "./shared";
import { AUDIT_SECRET_DETECTORS } from "./datasets";

const DEFAULT_MAX_MAP_KB = 4096;
const MAX_FINDINGS_PER_RULE = 5;

export type AuditViteSourcemapsParams = AuditTraversalInputParams & {
	maxMapKb?: number;
};

export type AuditViteSourcemapsSeverity = AuditSeverity;

export type AuditViteSourcemapsFinding = {
	severity: AuditViteSourcemapsSeverity;
	kind: string;
	location: string;
	evidence: string;
	message: string;
};

export type AuditViteSourcemapReport = {
	assetKind: string;
	assetUrl: string;
	mapUrl: string;
	status: string;
	sourcesCount?: number;
	sourcesContentCount?: number;
	note?: string;
};

export type AuditViteSourcemapsResult = {
	url: string;
	auditedAt: string;
	findings: AuditViteSourcemapsFinding[];
	mapReports: AuditViteSourcemapReport[];
	assetsDiscovered: number;
	assetsScanned: number;
	assetsSkipped: number;
	sourceMapsDiscovered: number;
	sourceMapsFetched: number;
};

const AUDIT_VITE_SOURCEMAPS_CONSOLE_PARAMS = [
	...AUDIT_TRAVERSAL_CONSOLE_PARAMS,
	{
		name: "maxMapKb",
		detail: "Maximum downloaded source map size in kilobytes.",
		valueType: "number",
		example: "maxMapKb=4096",
	},
] as const;

type ResolvedParams = {
	traversal: ResolvedAuditTraversalParams;
	maxMapBytes: number;
};

type SourceMapReference = {
	rawValue: string;
	resolvedUrl: string;
};

type ParsedSourceMap = {
	version?: number;
	file?: string;
	sourceRoot?: string;
	sources: string[];
	sourcesContentCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalPositiveInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a positive integer.`);
	}

	return value;
}

function resolveParams(params: AuditViteSourcemapsParams): ResolvedParams {
	return {
		traversal: resolveAuditTraversalParams(params),
		maxMapBytes: (readOptionalPositiveInteger(params.maxMapKb, "maxMapKb") ?? DEFAULT_MAX_MAP_KB) * 1024,
	};
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 3) {
		return value.slice(0, maxLength);
	}

	return `${value.slice(0, maxLength - 3)}...`;
}

function maskSecret(value: string): string {
	if (value.length <= 8) {
		return "********";
	}

	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isPrivateIpv4Host(hostname: string): boolean {
	const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
	if (!match) {
		return false;
	}

	const octets = match.slice(1).map((value) => Number(value));
	if (octets.some((value) => value < 0 || value > 255)) {
		return false;
	}

	return octets[0] === 10
		|| (octets[0] === 192 && octets[1] === 168)
		|| (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function isInternalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized.endsWith(".local")
		|| normalized.endsWith(".internal")
		|| normalized.endsWith(".lan")
		|| normalized.endsWith(".corp")
		|| normalized.endsWith(".home");
}

function extractSourceMapReferences(content: string, baseUrl: string): SourceMapReference[] {
	const references: SourceMapReference[] = [];
	const seenUrls = new Set<string>();

	for (const match of content.matchAll(/sourceMappingURL=([^\s*]+)/gu)) {
		const rawValue = match[1]?.trim().replace(/["'`)]$/u, "");
		if (!rawValue || rawValue.startsWith("data:")) {
			continue;
		}

		let resolved: URL;
		try {
			resolved = new URL(rawValue, baseUrl);
		} catch {
			continue;
		}

		if (seenUrls.has(resolved.href)) {
			continue;
		}

		seenUrls.add(resolved.href);
		references.push({ rawValue, resolvedUrl: resolved.href });
	}

	return references;
}

function parseSourceMap(content: string): ParsedSourceMap {
	const parsed = JSON.parse(content) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("Source map payload must be an object.");
	}

	const sources = Array.isArray(parsed.sources)
		? parsed.sources.filter((value): value is string => typeof value === "string" && value.length > 0)
		: [];
	const sourcesContentCount = Array.isArray(parsed.sourcesContent)
		? parsed.sourcesContent.filter((value) => typeof value === "string" && value.length > 0).length
		: 0;

	return {
		version: typeof parsed.version === "number" ? parsed.version : undefined,
		file: typeof parsed.file === "string" ? parsed.file : undefined,
		sourceRoot: typeof parsed.sourceRoot === "string" ? parsed.sourceRoot : undefined,
		sources,
		sourcesContentCount,
	};
}

function scanSourceMapSecrets(
	mapUrl: string,
	content: string,
	findings: AuditViteSourcemapsFinding[],
	seenFindings: Set<string>,
): void {
	for (const detection of collectAuditSecretDetections(content, AUDIT_SECRET_DETECTORS, MAX_FINDINGS_PER_RULE)) {
		pushFinding(findings, seenFindings, {
			severity: detection.severity,
			kind: detection.kind,
			location: mapUrl,
			evidence: maskAuditSecret(detection.value),
			message: detection.message,
		});
	}
}

function scanSourceRoot(
	mapUrl: string,
	sourceRoot: string | undefined,
	findings: AuditViteSourcemapsFinding[],
	seenFindings: Set<string>,
): void {
	if (!sourceRoot) {
		return;
	}

	let resolvedUrl: URL | null = null;
	try {
		resolvedUrl = new URL(sourceRoot, mapUrl);
	} catch {
		resolvedUrl = null;
	}

	if (!resolvedUrl) {
		if (/^(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/var\/|\/srv\/|\/opt\/)/u.test(sourceRoot)) {
			pushFinding(findings, seenFindings, {
				severity: "high",
				kind: "source-root-filesystem-path",
				location: mapUrl,
				evidence: truncate(sourceRoot, 88),
				message: "Source map exposes an absolute filesystem sourceRoot.",
			});
		}
		return;
	}

	const hostname = resolvedUrl.hostname.toLowerCase();
	if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
		pushFinding(findings, seenFindings, {
			severity: "high",
			kind: "source-root-localhost",
			location: mapUrl,
			evidence: truncate(resolvedUrl.href, 88),
			message: "Source map sourceRoot points at localhost.",
		});
		return;
	}

	if (isPrivateIpv4Host(hostname)) {
		pushFinding(findings, seenFindings, {
			severity: "high",
			kind: "source-root-private-network",
			location: mapUrl,
			evidence: truncate(resolvedUrl.href, 88),
			message: "Source map sourceRoot points at a private-network host.",
		});
		return;
	}

	if (isInternalHostname(hostname)) {
		pushFinding(findings, seenFindings, {
			severity: "medium",
			kind: "source-root-internal-host",
			location: mapUrl,
			evidence: truncate(resolvedUrl.href, 88),
			message: "Source map sourceRoot points at an internal host.",
		});
	}
}

function scanSources(
	mapUrl: string,
	sources: readonly string[],
	findings: AuditViteSourcemapsFinding[],
	seenFindings: Set<string>,
): void {
	let flagged = 0;
	for (const source of sources) {
		if (flagged >= MAX_FINDINGS_PER_RULE) {
			break;
		}

		const evidence = truncate(source, 88);
		if (/^(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/var\/|\/srv\/|\/opt\/|\/private\/)/u.test(source)) {
			pushFinding(findings, seenFindings, {
				severity: "high",
				kind: "absolute-source-path",
				location: mapUrl,
				evidence,
				message: "Source map reveals an absolute filesystem path from the build environment.",
			});
			flagged += 1;
			continue;
		}

		if (/(?:^|[\\/])(?:\.env(?:\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12))$/iu.test(source) || /(secret|credential|private)/iu.test(source)) {
			pushFinding(findings, seenFindings, {
				severity: "high",
				kind: "sensitive-source-path",
				location: mapUrl,
				evidence,
				message: "Source map references a path that looks sensitive.",
			});
			flagged += 1;
			continue;
		}

		if (/(?:^|[\\/])src[\\/].+\.(?:[cm]?[jt]sx?|vue|s?css|less|html)$/iu.test(source) || /(?:^|[\\/])src\//u.test(source)) {
			pushFinding(findings, seenFindings, {
				severity: "medium",
				kind: "app-source-path",
				location: mapUrl,
				evidence,
				message: "Source map exposes original application source paths.",
			});
			flagged += 1;
			continue;
		}

		if (/node_modules[\\/]/iu.test(source)) {
			pushFinding(findings, seenFindings, {
				severity: "low",
				kind: "dependency-source-path",
				location: mapUrl,
				evidence,
				message: "Source map exposes dependency source paths from node_modules.",
			});
			flagged += 1;
		}
	}
}

function scanParsedSourceMap(
	mapUrl: string,
	parsed: ParsedSourceMap,
	findings: AuditViteSourcemapsFinding[],
	seenFindings: Set<string>,
): void {
	pushFinding(findings, seenFindings, {
		severity: "medium",
		kind: "public-source-map",
		location: mapUrl,
		evidence: truncate(mapUrl, 88),
		message: "A production source map is publicly reachable.",
	});

	if (parsed.sourcesContentCount > 0) {
		pushFinding(findings, seenFindings, {
			severity: "high",
			kind: "embedded-sources-content",
			location: mapUrl,
			evidence: `${parsed.sourcesContentCount} embedded source bodies`,
			message: "Source map embeds original source contents, not just filenames.",
		});
	}

	scanSourceRoot(mapUrl, parsed.sourceRoot, findings, seenFindings);
	scanSources(mapUrl, parsed.sources, findings, seenFindings);

	for (const source of parsed.sources.slice(0, MAX_FINDINGS_PER_RULE)) {
		for (const match of source.matchAll(/(?:api[_-]?key|secret|token|password|bearer|authorization)[A-Za-z0-9._~+\-/=:@]*/giu)) {
			pushFinding(findings, seenFindings, {
				severity: "medium",
				kind: "secret-like-source-name",
				location: mapUrl,
				evidence: maskSecret(match[0]),
				message: "Source map path name hints at secret-bearing source files.",
			});
			break;
		}
	}
}

function renderResult(result: AuditViteSourcemapsResult): OutputEntity[] {
	const highCount = result.findings.filter((finding) => finding.severity === "high").length;
	const mediumCount = result.findings.filter((finding) => finding.severity === "medium").length;
	const lowCount = result.findings.filter((finding) => finding.severity === "low").length;

	const entities: OutputEntity[] = [
		createTextEntity(
			[
				"Vite sourcemap audit",
				`URL: ${result.url}`,
				`Audited at: ${result.auditedAt}`,
				`Findings: ${result.findings.length} (high=${highCount} medium=${mediumCount} low=${lowCount})`,
				`Assets discovered: ${result.assetsDiscovered}`,
				`Assets scanned: ${result.assetsScanned}`,
				`Assets skipped: ${result.assetsSkipped}`,
				`Source maps discovered: ${result.sourceMapsDiscovered}`,
				`Source maps fetched: ${result.sourceMapsFetched}`,
			],
			{ tone: result.findings.length > 0 ? "info" : "muted" },
		),
	];

	if (result.findings.length === 0) {
		entities.push(
			createTextEntity(
				"No publicly reachable source maps were confirmed from the fetched SPA assets.",
				{ tone: "info" },
			),
		);
	} else {
		entities.push(
			createTableEntity(
				[
					{ key: "severity", header: "Severity", maxWidth: 8 },
					{ key: "kind", header: "Kind", maxWidth: 24 },
					{ key: "location", header: "Location", maxWidth: 42 },
					{ key: "evidence", header: "Evidence", maxWidth: 40 },
					{ key: "message", header: "Message", maxWidth: 72 },
				],
				sortFindings(result.findings).map((finding) => ({
					severity: finding.severity,
					kind: finding.kind,
					location: finding.location,
					evidence: finding.evidence,
					message: finding.message,
				})),
				{ title: "Sourcemap findings" },
			),
		);
	}

	entities.push(
		createTableEntity(
			[
				{ key: "assetKind", header: "Asset", maxWidth: 12 },
				{ key: "status", header: "Status", maxWidth: 10 },
				{ key: "assetUrl", header: "Asset URL", maxWidth: 52 },
				{ key: "mapUrl", header: "Map URL", maxWidth: 52 },
				{ key: "sources", header: "Sources", maxWidth: 10 },
				{ key: "sourcesContent", header: "Embedded", maxWidth: 10 },
				{ key: "note", header: "Note", maxWidth: 40 },
			],
			result.mapReports.map((report) => ({
				assetKind: report.assetKind,
				status: report.status,
				assetUrl: report.assetUrl,
				mapUrl: report.mapUrl,
				sources: report.sourcesCount ?? "",
				sourcesContent: report.sourcesContentCount ?? "",
				note: report.note ?? "",
			})),
			{ title: "Discovered source maps" },
		),
	);

	return entities;
}

const executor = defineExecutor<AuditViteSourcemapsParams, OutputEntity[]>(async ({ params, logger, runtime, getCloakKit }) => {
	const resolved = resolveParams(params);
	const findings: AuditViteSourcemapsFinding[] = [];
	const seenFindings = new Set<string>();
	const mapReports: AuditViteSourcemapReport[] = [];

	const traversal = await traverseAuditDocument(
		{ runtime, getCloakKit, logger },
		resolved.traversal,
		{ reason: "audit/vite-sourcemaps traversal" },
	);
	let sourceMapsDiscovered = 0;
	let sourceMapsFetched = 0;

	for (const asset of traversal.assets) {
		try {
			const resource = await fetchTextResource(
				asset.url,
				resolved.traversal.timeoutMs,
				resolved.traversal.maxAssetBytes,
			);

			logger.info({ url: asset.url, kind: asset.kind, status: resource.status }, "Fetched Vite sourcemap audit asset");

			const references = extractSourceMapReferences(resource.content, asset.url);
			if (references.length === 0) {
				mapReports.push({
					assetKind: asset.kind,
					assetUrl: asset.url,
					mapUrl: "",
					status: "none",
					note: "No sourceMappingURL reference found.",
				});
				continue;
			}

			for (const reference of references) {
				sourceMapsDiscovered += 1;
				try {
					const mapResource = await fetchTextResource(
						reference.resolvedUrl,
						resolved.traversal.timeoutMs,
						resolved.maxMapBytes,
					);
					const parsed = parseSourceMap(mapResource.content);
					sourceMapsFetched += 1;
					mapReports.push({
						assetKind: asset.kind,
						assetUrl: asset.url,
						mapUrl: reference.resolvedUrl,
						status: String(mapResource.status),
						sourcesCount: parsed.sources.length,
						sourcesContentCount: parsed.sourcesContentCount,
						note: parsed.file ? `file=${parsed.file}` : undefined,
					});

					logger.info({ assetUrl: asset.url, mapUrl: reference.resolvedUrl, sources: parsed.sources.length }, "Fetched Vite source map");
					scanSourceMapSecrets(reference.resolvedUrl, mapResource.content, findings, seenFindings);
					scanParsedSourceMap(reference.resolvedUrl, parsed, findings, seenFindings);
				} catch (error) {
					const note = error instanceof Error ? error.message : String(error);
					mapReports.push({
						assetKind: asset.kind,
						assetUrl: asset.url,
						mapUrl: reference.resolvedUrl,
						status: "failed",
						note,
					});
					logger.warn({ assetUrl: asset.url, mapUrl: reference.resolvedUrl, error: note }, "Failed to fetch or parse Vite source map");
				}
			}
		} catch (error) {
			const note = error instanceof Error ? error.message : String(error);
			mapReports.push({
				assetKind: asset.kind,
				assetUrl: asset.url,
				mapUrl: "",
				status: "failed",
				note,
			});
			logger.warn({ url: asset.url, kind: asset.kind, error: note }, "Failed to fetch Vite sourcemap audit asset");
		}
	}

	const result: AuditViteSourcemapsResult = {
		url: traversal.document.url,
		auditedAt: new Date().toISOString(),
		findings,
		mapReports,
		assetsDiscovered: traversal.assetsDiscovered,
		assetsScanned: traversal.assets.length,
		assetsSkipped: traversal.assetsSkipped,
		sourceMapsDiscovered,
		sourceMapsFetched,
	};

	return renderResult(result);
});

export const auditViteSourcemapsModule = defineModule({
	id: "audit/vite-sourcemaps",
	category: "audit",
	description: "Confirm public Vite source maps and surface what they expose",
	consoleParams: AUDIT_VITE_SOURCEMAPS_CONSOLE_PARAMS,
	executor,
}).useDefault("url");