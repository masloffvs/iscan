import { PORT_SCAN_KIT_ID, PortScanKit, type PortScanRunOptions } from "../../kits";
import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleExecutionContext } from "../module";

export type PortScanScanParams = {
	host?: string;
	ports?: string;
	topPorts?: number | string;
	concurrency?: number | string;
	connectTimeoutMs?: number | string;
	persist?: boolean | string | number;
};

export type PortScanListParams = {
	host?: string;
	limit?: number | string;
	offset?: number | string;
};

export type PortScanGetParams = {
	scanId?: string;
};

export const PORT_SCAN_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/kits/port-scan.h.ts");

export async function ensurePortScanKit(
	context: ModuleExecutionContext<any, object>,
	reason: string,
): Promise<PortScanKit> {
	let kit = context.runtime.getKit<PortScanKit>(PORT_SCAN_KIT_ID);
	if (!kit) {
		kit = new PortScanKit();
		await context.runtime.attachKit(kit, { reason });
	}

	return kit;
}

export function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function parseOptionalPositiveInteger(
	value: unknown,
	fieldName: string,
	options: { min?: number; max?: number } = {},
): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue)) {
		throw new InvalidParamsError(`${fieldName} must be an integer.`);
	}

	const minimum = options.min ?? 1;
	const maximum = options.max ?? Number.MAX_SAFE_INTEGER;
	if (numericValue < minimum || numericValue > maximum) {
		throw new InvalidParamsError(`${fieldName} must be between ${minimum} and ${maximum}.`);
	}

	return numericValue;
}

export function parseOptionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue < 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-negative integer.`);
	}

	return numericValue;
}

export function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		if (value === 1) {
			return true;
		}
		if (value === 0) {
			return false;
		}
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["true", "1", "yes", "y", "on"].includes(normalized)) {
			return true;
		}
		if (["false", "0", "no", "n", "off"].includes(normalized)) {
			return false;
		}
	}

	throw new InvalidParamsError(`${fieldName} must be a boolean.`);
}

export function buildPortScanRunOptions(params: PortScanScanParams): PortScanRunOptions {
	const host = parseOptionalString(params.host, "host");
	if (!host) {
		throw new InvalidParamsError("host is required.");
	}

	return {
		host,
		ports: parseOptionalString(params.ports, "ports"),
		topPorts: parseOptionalPositiveInteger(params.topPorts, "topPorts"),
		concurrency: parseOptionalPositiveInteger(params.concurrency, "concurrency"),
		connectTimeoutMs: parseOptionalPositiveInteger(params.connectTimeoutMs, "connectTimeoutMs"),
		persist: parseOptionalBoolean(params.persist, "persist"),
	};
}