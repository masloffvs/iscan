import { load } from "cheerio";

import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
} from "../../primitives";
import { defineExecutor, defineModule } from "../module";
import {
	AUDIT_TRAVERSAL_CONSOLE_PARAMS,
	collectAuditPatternMatches,
	collectAuditSecretDetections,
	fetchTextResource,
	maskAuditSecret,
	pushAuditFinding as pushFinding,
	resolveAuditTraversalParams,
	sortAuditFindings as sortFindings,
	traverseAuditDocument,
	type AuditSeverity,
	type AuditTraversalInputParams,
} from "./shared";
import { AUDIT_SECRET_DETECTORS } from "./datasets";

const MAX_MATCHES_PER_PATTERN = 5;

export type AuditViteSpaParams = AuditTraversalInputParams;

export type AuditViteSpaSeverity = AuditSeverity;

export type AuditViteSpaFinding = {
	severity: AuditViteSpaSeverity;
	kind: string;
	location: string;
	evidence: string;
	message: string;
};

export type AuditViteSpaAssetReport = {
	kind: string;
	url: string;
	status: string;
	bytes?: number;
	contentType?: string;
	note?: string;
};

export type AuditViteSpaResult = {
	url: string;
	auditedAt: string;
	findings: AuditViteSpaFinding[];
	assets: AuditViteSpaAssetReport[];
	assetsDiscovered: number;
	assetsScanned: number;
	assetsSkipped: number;
	inlineScriptsScanned: number;
};

type ContentScanContext = {
	location: string;
	baseUrl: string;
	content: string;
	findings: AuditViteSpaFinding[];
	seenFindings: Set<string>;
};

const DEV_ARTIFACT_PATTERNS: Array<{
	kind: string;
	severity: AuditViteSpaSeverity;
	message: string;
	regex: RegExp;
}> = [
	{
		kind: "vite-dev-client",
		severity: "high",
		message: "Vite dev client reference leaked into the deployed application.",
		regex: /\/@vite\/client\b/gu,
	},
	{
		kind: "vite-hmr",
		severity: "high",
		message: "Hot Module Replacement code leaked into the deployed application.",
		regex: /\bimport\.meta\.hot\b/gu,
	},
	{
		kind: "vite-ping",
		severity: "high",
		message: "Vite HMR runtime marker leaked into the deployed application.",
		regex: /\b__vite_ping\b/gu,
	},
	{
		kind: "source-path",
		severity: "medium",
		message: "Raw /src/ file paths are still referenced by the deployed application.",
		regex: /\/src\/[A-Za-z0-9_./@-]+\.(?:[cm]?[jt]sx?|vue|s?css|less)/gu,
	},
	{
		kind: "node-modules-path",
		severity: "medium",
		message: "node_modules paths are referenced by the deployed bundle.",
		regex: /\/node_modules\/[A-Za-z0-9_./@-]+/gu,
	},
];

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 3) {
		return value.slice(0, maxLength);
	}

	return `${value.slice(0, maxLength - 3)}...`;
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

	const [first = -1, second = -1] = octets;

	return first === 10
		|| (first === 192 && second === 168)
		|| (first === 172 && second >= 16 && second <= 31);
}

function isInternalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized.endsWith(".local")
		|| normalized.endsWith(".internal")
		|| normalized.endsWith(".lan")
		|| normalized.endsWith(".corp")
		|| normalized.endsWith(".home");
}

function scanDevArtifacts(context: ContentScanContext): void {
	for (const pattern of DEV_ARTIFACT_PATTERNS) {
		for (const match of collectAuditPatternMatches(pattern.regex, context.content, MAX_MATCHES_PER_PATTERN)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: pattern.severity,
				kind: pattern.kind,
				location: context.location,
				evidence: truncate(match, 88),
				message: pattern.message,
			});
		}
	}
}

function scanSourceMaps(context: ContentScanContext): void {
	for (const match of context.content.matchAll(/sourceMappingURL=([^\s*]+)/gu)) {
		const rawValue = match[1]?.trim().replace(/["'`)]$/u, "");
		if (!rawValue) {
			continue;
		}

		let resolved = rawValue;
		try {
			resolved = new URL(rawValue, context.baseUrl).href;
		} catch {
			// Keep the raw reference if URL resolution fails.
		}

		pushFinding(context.findings, context.seenFindings, {
			severity: "medium",
			kind: "source-map-reference",
			location: context.location,
			evidence: truncate(resolved, 88),
			message: "Bundle references a source map that may expose original source files in production.",
		});
	}
}

function scanLeakedUrls(context: ContentScanContext): void {
	for (const leakedUrl of collectAuditPatternMatches(/(?:https?|wss?):\/\/[^\s"'`<>)]+/gu, context.content, MAX_MATCHES_PER_PATTERN)) {
		let parsed: URL;
		try {
			parsed = new URL(leakedUrl);
		} catch {
			continue;
		}

		const hostname = parsed.hostname.toLowerCase();
		if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
			pushFinding(context.findings, context.seenFindings, {
				severity: "high",
				kind: "localhost-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references localhost, which usually indicates a bad Vite dev/proxy configuration in production.",
			});
			continue;
		}

		if (isPrivateIpv4Host(hostname)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: "high",
				kind: "private-network-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references a private-network address.",
			});
			continue;
		}

		if (isInternalHostname(hostname)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: "medium",
				kind: "internal-host-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references an internal hostname.",
			});
		}
	}
}

function scanViteEnvKeys(context: ContentScanContext): void {
	const seenKeys = new Set<string>();
	for (const match of context.content.matchAll(/\bVITE_[A-Z0-9_]{2,}\b/gu)) {
		const key = match[0];
		if (!key || seenKeys.has(key)) {
			continue;
		}

		seenKeys.add(key);
		const suspiciousName = /(?:SECRET|TOKEN|PASSWORD|AUTH|PRIVATE|KEY)/u.test(key);
		pushFinding(context.findings, context.seenFindings, {
			severity: suspiciousName ? "medium" : "low",
			kind: suspiciousName ? "vite-env-sensitive-name" : "vite-env-key",
			location: context.location,
			evidence: key,
			message: suspiciousName
				? "Suspicious Vite client env key name suggests sensitive data may have been exposed to the client bundle."
				: "Vite client env key name appears in the deployed bundle.",
		});

		if (seenKeys.size >= MAX_MATCHES_PER_PATTERN) {
			break;
		}
	}
}

function scanKnownSecrets(context: ContentScanContext): void {
	const detections = collectAuditSecretDetections(
		context.content,
		AUDIT_SECRET_DETECTORS,
		MAX_MATCHES_PER_PATTERN,
	);
	const detectedSecrets = new Set(detections.map((detection) => detection.value));

	for (const detection of detections) {
			pushFinding(context.findings, context.seenFindings, {
				severity: detection.severity,
				kind: detection.kind,
				location: context.location,
				evidence: maskAuditSecret(detection.value),
				message: detection.message,
			});
	}

	for (const match of context.content.matchAll(/(?:api[_-]?key|secret|token|password|bearer|authorization)[^\n]{0,40}?["'`]([A-Za-z0-9._~+\-/=:@]{12,})["'`]/giu)) {
		const secretValue = match[1];
		if (!secretValue || detectedSecrets.has(secretValue)) {
			continue;
		}

		pushFinding(context.findings, context.seenFindings, {
			severity: "medium",
			kind: "secret-like-literal",
			location: context.location,
			evidence: maskAuditSecret(secretValue),
			message: "Secret-like literal is embedded near a sensitive key name in the client bundle.",
		});
		break;
	}
}

function scanContent(context: ContentScanContext): void {
	scanSourceMaps(context);
	scanDevArtifacts(context);
	scanLeakedUrls(context);
	scanViteEnvKeys(context);
	scanKnownSecrets(context);
}

function createDocumentScanContent(html: string): string {
	const $ = load(html);
	$("script:not([src])").remove();
	return $.html();
}

function renderAuditResult(result: AuditViteSpaResult): OutputEntity[] {
	const highCount = result.findings.filter((finding) => finding.severity === "high").length;
	const mediumCount = result.findings.filter((finding) => finding.severity === "medium").length;
	const lowCount = result.findings.filter((finding) => finding.severity === "low").length;

	const entities: OutputEntity[] = [
		createTextEntity(
			[
				"Vite SPA audit",
				`URL: ${result.url}`,
				`Audited at: ${result.auditedAt}`,
				`Findings: ${result.findings.length} (high=${highCount} medium=${mediumCount} low=${lowCount})`,
				`Assets discovered: ${result.assetsDiscovered}`,
				`Assets scanned: ${result.assetsScanned}`,
				`Assets skipped: ${result.assetsSkipped}`,
				`Inline scripts scanned: ${result.inlineScriptsScanned}`,
			],
			{ tone: result.findings.length > 0 ? "info" : "muted" },
		),
	];

	if (result.findings.length === 0) {
		entities.push(
			createTextEntity(
				"No obvious Vite production leakage patterns were detected in the fetched document and assets.",
				{ tone: "info" },
			),
		);
		return entities;
	}

	entities.push(
		createTableEntity(
			[
				{ key: "severity", header: "Severity", maxWidth: 8 },
				{ key: "kind", header: "Kind", maxWidth: 24 },
				{ key: "location", header: "Location", maxWidth: 42 },
				{ key: "evidence", header: "Evidence", maxWidth: 36 },
				{ key: "message", header: "Message", maxWidth: 72 },
			],
			sortFindings(result.findings).map((finding) => ({
				severity: finding.severity,
				kind: finding.kind,
				location: finding.location,
				evidence: finding.evidence,
				message: finding.message,
			})),
			{ title: "Audit findings" },
		),
	);

	entities.push(
		createTableEntity(
			[
				{ key: "kind", header: "Kind", maxWidth: 14 },
				{ key: "status", header: "Status", maxWidth: 10 },
				{ key: "url", header: "URL", maxWidth: 64 },
				{ key: "bytes", header: "Bytes", maxWidth: 12 },
				{ key: "contentType", header: "Content-Type", maxWidth: 28 },
				{ key: "note", header: "Note", maxWidth: 40 },
			],
			result.assets.map((asset) => ({
				kind: asset.kind,
				status: asset.status,
				url: asset.url,
				bytes: asset.bytes ?? "",
				contentType: asset.contentType ?? "",
				note: asset.note ?? "",
			})),
			{ title: "Fetched assets" },
		),
	);

	return entities;
}

const executor = defineExecutor<AuditViteSpaParams, OutputEntity[]>(async ({ params, logger, runtime, getCloakKit }) => {
	const resolved = resolveAuditTraversalParams(params);
	const findings: AuditViteSpaFinding[] = [];
	const seenFindings = new Set<string>();
	const assetReports: AuditViteSpaAssetReport[] = [];

	const traversal = await traverseAuditDocument(
		{ runtime, getCloakKit, logger },
		resolved,
		{ reason: "audit/vite-spa traversal" },
	);

	assetReports.push({
		kind: "document",
		url: traversal.document.url,
		status: String(traversal.document.status),
		bytes: traversal.document.bytes,
		contentType: traversal.document.contentType,
	});

	scanContent({
		location: traversal.document.url,
		baseUrl: traversal.document.url,
		content: createDocumentScanContent(traversal.document.content),
		findings,
		seenFindings,
	});

	for (const [index, inlineScript] of traversal.inlineScripts.entries()) {
		scanContent({
			location: `${traversal.document.url}#inline-script-${index + 1}`,
			baseUrl: traversal.document.url,
			content: inlineScript,
			findings,
			seenFindings,
		});
	}

	for (const asset of traversal.assets) {
		try {
			const resource = await fetchTextResource(
				asset.url,
				resolved.timeoutMs,
				resolved.maxAssetBytes,
			);

			assetReports.push({
				kind: asset.kind,
				url: asset.url,
				status: String(resource.status),
				bytes: resource.bytes,
				contentType: resource.contentType,
			});

			logger.info({ url: asset.url, kind: asset.kind, status: resource.status }, "Fetched Vite audit asset");

			scanContent({
				location: asset.url,
				baseUrl: asset.url,
				content: resource.content,
				findings,
				seenFindings,
			});
		} catch (error) {
			const note = error instanceof Error ? error.message : String(error);
			assetReports.push({
				kind: asset.kind,
				url: asset.url,
				status: "failed",
				note,
			});
			logger.warn({ url: asset.url, kind: asset.kind, error: note }, "Failed to fetch Vite audit asset");
		}
	}

	const scannedAssets = assetReports.filter((asset) => asset.status !== "failed" && asset.kind !== "asset-limit").length;
	const result: AuditViteSpaResult = {
		url: traversal.document.url,
		auditedAt: new Date().toISOString(),
		findings,
		assets: assetReports,
		assetsDiscovered: traversal.assetsDiscovered,
		assetsScanned: scannedAssets,
		assetsSkipped: traversal.assetsSkipped,
		inlineScriptsScanned: traversal.inlineScripts.length,
	};

	return renderAuditResult(result);
});

export const auditViteSpaModule = defineModule({
	id: "audit/vite-spa",
	category: "audit",
	description: "Audit a deployed SPA for common Vite production leakage artifacts",
	consoleParams: AUDIT_TRAVERSAL_CONSOLE_PARAMS,
	executor,
}).useDefault("url");