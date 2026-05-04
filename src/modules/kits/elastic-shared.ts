import type { ElasticSearchAuth, ElasticSearchKitOptions } from "../../kits";

import { InvalidParamsError } from "../errors";

export type ElasticSearchConnectParams = {
	node?: string;
	index?: string;
	username?: string;
	password?: string;
	apiKey?: string;
	token?: string;
};

export function readRequiredNode(params: ElasticSearchConnectParams): string {
	if (typeof params.node !== "string" || params.node.trim().length === 0) {
		throw new InvalidParamsError("Param 'node' is required. Example: node=http://127.0.0.1:9200");
	}

	return params.node.trim();
}

export function readDefaultIndex(params: { index?: string }): ElasticSearchKitOptions["defaultIndex"] {
	if (typeof params.index !== "string" || params.index.trim().length === 0) {
		return undefined;
	}

	const indexes = params.index
		.split(",")
		.map(value => value.trim())
		.filter(value => value.length > 0);

	if (indexes.length === 0) {
		return undefined;
	}

	return indexes.length === 1 ? indexes[0] : indexes;
}

export function readAuth(params: ElasticSearchConnectParams): ElasticSearchAuth | undefined {
	const hasBasic = typeof params.username === "string" || typeof params.password === "string";
	const hasApiKey = typeof params.apiKey === "string" && params.apiKey.trim().length > 0;
	const hasBearer = typeof params.token === "string" && params.token.trim().length > 0;
	const authModes = [hasBasic, hasApiKey, hasBearer].filter(Boolean).length;

	if (authModes > 1) {
		throw new InvalidParamsError("Use only one auth mode: username/password, apiKey, or token.");
	}

	if (hasBasic) {
		if (typeof params.username !== "string" || params.username.trim().length === 0) {
			throw new InvalidParamsError("Param 'username' is required when using basic auth.");
		}

		if (typeof params.password !== "string" || params.password.length === 0) {
			throw new InvalidParamsError("Param 'password' is required when using basic auth.");
		}

		return {
			type: "basic",
			username: params.username,
			password: params.password,
		};
	}

	if (hasApiKey) {
		return {
			type: "api-key",
			apiKey: params.apiKey.trim(),
		};
	}

	if (hasBearer) {
		return {
			type: "bearer",
			token: params.token.trim(),
		};
	}

	return undefined;
}

export function formatElasticIndex(index: string | readonly string[] | undefined): string {
	if (!index) {
		return "<not set>";
	}

	return Array.isArray(index) ? index.join(",") : index;
}

export function stringifyElasticValue(value: unknown): string {
	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "undefined";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function truncateValue(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 1) {
		return value.slice(0, maxLength);
	}

	return `${value.slice(0, maxLength - 1)}…`;
}