import { defineExecutor, defineModule } from "../module";
import { createProxyDeleteReport, ensureProxyKit, parseOptionalString, PROXY_NOTEBOOK_TYPE_OVERLAY, resolveProxyProfile } from "./proxy-shared";

export type ProxyDeleteParams = {
	proxy?: string;
};

export const proxyDeleteModule = defineModule<ProxyDeleteParams>({
	id: "kits/proxy/delete",
	category: "kits",
	description: "Delete a saved proxy profile by id or unique name",
	notebookTypeOverlay: PROXY_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: [
		{
			name: "proxy",
			detail: "Proxy id or unique name. Defaults to the only saved proxy when exactly one exists.",
			example: "office-socks",
			valueType: "string",
		},
	],
	executor: defineExecutor<ProxyDeleteParams>(async (context) => {
		const kit = await ensureProxyKit(context, "Deleting Proxy profile");
		const target = parseOptionalString(context.params.proxy, "proxy");
		const proxy = resolveProxyProfile(kit, target);
		await kit.deleteProxy(proxy.id);
		return createProxyDeleteReport(kit, proxy);
	}),
}).useDefault("proxy");