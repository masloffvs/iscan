import { BPKG_KIT_ID, BpkgKit } from "../kits";
import {
	parseNmapXmlReport,
	type NmapReport,
	type NmapReportAddress,
	type NmapReportHost,
	type NmapReportPort,
	type NmapReportRunStats,
	type NmapReportScript,
	type NmapReportService,
} from "../nmap/report";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureBpkgKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type NmapReadXmlParams = {
	boxId?: string;
	path?: string;
};

export type NmapParseXmlParams = {
	xml?: string;
};

function parseRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalized;
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return parseRequiredString(value, fieldName);
}

async function ensureBpkgKit(
	context: EnsureBpkgKitContext,
	reason = "module:nmap",
): Promise<BpkgKit> {
	const existingKit = context.getKit<BpkgKit>(BPKG_KIT_ID);
	if (existingKit) {
		if (!existingKit.isActive()) {
			await existingKit.start({ reason });
		}
		return existingKit;
	}

	return await context.runtime.attachKit(new BpkgKit(), { reason });
}
export {
	parseNmapXmlReport,
};
export type {
	NmapReportAddress,
	NmapReportHost,
	NmapReportPort,
	NmapReportRunStats,
	NmapReportScript,
	NmapReportService,
};

export const nmapParseXmlModule = defineModule<NmapParseXmlParams, NmapReport>({
	id: "nmap/parse-xml",
	category: "nmap",
	description: "Parse raw nmap XML output into a structured runtime object.",
	consoleParams: [
		{ name: "xml", detail: "Raw nmap XML document", required: true, valueType: "string" },
	],
	executor: defineExecutor(async (context) => parseNmapXmlReport(parseRequiredString(context.params.xml, "xml"))),
}).useDefault("xml");

export const nmapReadXmlModule = defineModule<NmapReadXmlParams, NmapReport>({
	id: "nmap/read-xml",
	category: "nmap",
	description: "Read an nmap XML report from a bpkg box and parse it into a structured runtime object.",
	consoleParams: [
		{ name: "path", detail: "Path to the nmap XML file inside the target box", example: "/root/nmap-scan.xml", required: true, valueType: "string" },
		{ name: "boxId", detail: "Optional bpkg box id; defaults to the selected box", example: "nmap", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:nmap/read-xml");
		const path = parseRequiredString(context.params.path, "path");
		const targetBoxId = parseOptionalString(context.params.boxId, "boxId") ?? kit.getDefaultBox()?.id;
		if (!targetBoxId) {
			throw new InvalidParamsError("boxId is required when no default bpkg box is selected.");
		}

		const result = await kit.executeBoxCommand(targetBoxId, {
			argv: ["cat", path],
		});
		return parseNmapXmlReport(result.stdout);
	}),
}).useDefault("path");