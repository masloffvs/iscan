import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
} from "../../primitives";
import { defineExecutor, defineModule } from "../module";
import { AUDIT_NOTEBOOK_TYPE_OVERLAY, AUDIT_TRAVERSAL_CONSOLE_PARAMS } from "./shared";
import {
	executeAuditCrawl,
	type AuditCrawlParams,
	type AuditCrawlResult,
} from "./crawl.shared";

function renderAuditCrawlResult(result: AuditCrawlResult): OutputEntity[] {
	const highCount = result.findings.filter((finding) => finding.severity === "high").length;
	const mediumCount = result.findings.filter((finding) => finding.severity === "medium").length;
	const lowCount = result.findings.filter((finding) => finding.severity === "low").length;

	const entities: OutputEntity[] = [
		createTextEntity(
			[
				"Crawl audit",
				`URL: ${result.url}`,
				`Audited at: ${result.auditedAt}`,
				`Resources: ${result.resources.length} (dynamic=${result.stats.dynamicResources} external=${result.stats.externalResources})`,
				`Findings: ${result.findings.length} (high=${highCount} medium=${mediumCount} low=${lowCount})`,
				`Resources scanned: ${result.stats.resourcesScanned}`,
				`Resources skipped: ${result.stats.resourcesSkipped}`,
				`Source maps: ${result.stats.sourceMapsFetched}/${result.stats.sourceMapsDiscovered}`,
			],
			{ tone: result.findings.length > 0 ? "info" : "muted" },
		),
	];

	entities.push(
		createTableEntity(
			[
				{ key: "kind", header: "Kind", maxWidth: 14 },
				{ key: "status", header: "Status", maxWidth: 10 },
				{ key: "dynamic", header: "Dyn", maxWidth: 6 },
				{ key: "scanned", header: "Scan", maxWidth: 6 },
				{ key: "url", header: "URL", maxWidth: 64 },
				{ key: "contentType", header: "Content-Type", maxWidth: 24 },
				{ key: "note", header: "Note", maxWidth: 42 },
			],
			result.resources.map((resource) => ({
				kind: resource.kind,
				status: resource.status,
				dynamic: resource.isDynamic ? "yes" : "no",
				scanned: resource.scanned ? "yes" : "no",
				url: resource.url,
				contentType: resource.contentType ?? "",
				note: resource.note ?? "",
			})),
			{ title: "Resource graph nodes" },
		),
	);

	if (result.findings.length > 0) {
		entities.push(
			createTableEntity(
				[
					{ key: "severity", header: "Severity", maxWidth: 8 },
					{ key: "kind", header: "Kind", maxWidth: 24 },
					{ key: "location", header: "Location", maxWidth: 42 },
					{ key: "evidence", header: "Evidence", maxWidth: 34 },
					{ key: "message", header: "Message", maxWidth: 68 },
				],
				result.findings.map((finding) => ({
					severity: finding.severity,
					kind: finding.kind,
					location: finding.location,
					evidence: finding.rawEvidence ?? finding.evidence,
					message: finding.message,
				})),
				{ title: "Security findings" },
			),
		);
	}

	return entities;
}

const executor = defineExecutor<AuditCrawlParams, OutputEntity[]>(async ({ params, runtime, logger, getCloakKit, getStorageKit }) => {
	const result = await executeAuditCrawl(
		{
			attachKit: runtime.attachKit.bind(runtime),
			getCloakKit,
			getStorageKit,
		},
		logger,
		params,
	);

	return renderAuditCrawlResult(result);
});

export const auditCrawlModule = defineModule({
	id: "audit/crawl",
	category: "audit",
	description: "Crawl a deployed web app and map runtime resources, chunks, and sourcemap-linked source files",
	notebookTypeOverlay: AUDIT_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: AUDIT_TRAVERSAL_CONSOLE_PARAMS,
	executor,
}).useDefault("url");

export type {
	AuditCrawlEdge,
	AuditCrawlEdgeKind,
	AuditCrawlFinding,
	AuditCrawlDiscoveryKind,
	AuditCrawlParams,
	AuditCrawlResourceKind,
	AuditCrawlResourceNode,
	AuditCrawlResult,
	AuditCrawlSeverity,
	AuditCrawlStats,
} from "./crawl.shared";