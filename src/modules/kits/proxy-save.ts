import { defineExecutor, defineModule } from "../module";
import { InvalidParamsError } from "../errors";
import {
	PROXY_TYPE_VALUES,
	PROXY_NOTEBOOK_TYPE_OVERLAY,
	createProxySaveReport,
	ensureProxyKit,
	ensureUniqueProxyName,
	findProxyProfile,
	parseOptionalNumber,
	parseOptionalProxyType,
	parseOptionalString,
	resolveProxyProfile,
} from "./proxy-shared";

export type ProxySaveParams = {
	proxy?: string;
	id?: string;
	name?: string;
	host?: string;
	port?: number | string;
	username?: string;
	password?: string;
	type?: string;
};

const PROXY_SAVE_CONSOLE_PARAMS = [
	{
		name: "proxy",
		detail: "Existing proxy id or unique name to update. If omitted, creates a new profile unless id/name matches an existing one.",
		example: "office-socks",
		valueType: "string",
	},
	{
		name: "id",
		detail: "Stable proxy id. Defaults to the existing id or a generated uuid when creating a new profile.",
		example: "proxy-office",
		valueType: "string",
	},
	{
		name: "name",
		detail: "Human-readable proxy profile name.",
		example: "Office HTTP",
		valueType: "string",
	},
	{
		name: "host",
		detail: "Proxy hostname or IP address.",
		example: "127.0.0.1",
		valueType: "string",
	},
	{
		name: "port",
		detail: "Proxy port number.",
		example: "8080",
		valueType: "number",
	},
	{
		name: "username",
		detail: "Optional username. Pass an empty string to clear it during updates.",
		example: "alice",
		valueType: "string",
	},
	{
		name: "password",
		detail: "Optional password. Pass an empty string to clear it during updates.",
		example: "secret",
		valueType: "string",
	},
	{
		name: "type",
		detail: "Proxy protocol.",
		example: "HTTP",
		valueType: "string",
		values: PROXY_TYPE_VALUES,
	},
] as const;

function hasOwnParam<T extends object>(params: T, key: keyof T): boolean {
	return Object.prototype.hasOwnProperty.call(params, key);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		throw new InvalidParamsError(`${fieldName} is required.`);
	}

	return normalized;
}

function parsePort(value: unknown, fieldName: string): number | undefined {
	const parsed = parseOptionalNumber(value, fieldName);
	if (parsed === undefined) {
		return undefined;
	}

	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new InvalidParamsError(`${fieldName} must be an integer between 1 and 65535.`);
	}

	return parsed;
}

export const proxySaveModule = defineModule<ProxySaveParams>({
	id: "kits/proxy/save",
	aliases: ["kits/proxy/upsert"],
	category: "kits",
	description: "Create or update a saved proxy profile for notebook-safe proxy CRUD",
	notebookTypeOverlay: PROXY_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: PROXY_SAVE_CONSOLE_PARAMS,
	executor: defineExecutor<ProxySaveParams>(async (context) => {
		const kit = await ensureProxyKit(context, "Saving Proxy profile");
		const target = parseOptionalString(context.params.proxy, "proxy");
		const requestedId = parseOptionalString(context.params.id, "id");
		const requestedName = parseOptionalString(context.params.name, "name");
		const seed = target
			? resolveProxyProfile(kit, target)
			: findProxyProfile(kit, requestedId) ?? findProxyProfile(kit, requestedName);

		if (seed && requestedId && requestedId !== seed.id) {
			throw new InvalidParamsError(
				"Changing proxy ids during save/update is not supported. Create a new proxy instead.",
			);
		}

		const name = hasOwnParam(context.params, "name")
			? requireNonEmptyString(context.params.name, "name")
			: seed?.name;
		const host = hasOwnParam(context.params, "host")
			? requireNonEmptyString(context.params.host, "host")
			: seed?.host;
		const port = hasOwnParam(context.params, "port")
			? parsePort(context.params.port, "port")
			: seed?.port;
		const type = hasOwnParam(context.params, "type")
			? parseOptionalProxyType(context.params.type, "type")
			: seed?.type ?? "HTTP";
		const username = hasOwnParam(context.params, "username")
			? parseOptionalString(context.params.username, "username")
			: seed?.username;
		const password = hasOwnParam(context.params, "password")
			? parseOptionalString(context.params.password, "password")
			: seed?.password;

		if (!name) {
			throw new InvalidParamsError("name is required when creating a new proxy profile.");
		}

		if (!host) {
			throw new InvalidParamsError("host is required when creating a new proxy profile.");
		}

		if (port === undefined) {
			throw new InvalidParamsError("port is required when creating a new proxy profile.");
		}

		if (!type) {
			throw new InvalidParamsError("type is required when creating a new proxy profile.");
		}

		const nextProxy = {
			id: seed?.id ?? requestedId ?? crypto.randomUUID(),
			name,
			host,
			port,
			username,
			password,
			type,
		};

		ensureUniqueProxyName(kit, nextProxy.name, { excludeId: nextProxy.id });
		await kit.saveProxy(nextProxy);
		return createProxySaveReport(kit, nextProxy, seed ? "updated" : "created");
	}),
});