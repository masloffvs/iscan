import { defineExecutor, defineModule } from "../module";
import { createProxyProfilesReport, ensureProxyKit, PROXY_NOTEBOOK_TYPE_OVERLAY } from "./proxy-shared";

export const proxyListModule = defineModule({
	id: "kits/proxy/list",
	category: "kits",
	description: "List saved proxy profiles for the current Activity",
	notebookTypeOverlay: PROXY_NOTEBOOK_TYPE_OVERLAY,
	executor: defineExecutor(async (context) => {
		const kit = await ensureProxyKit(context, "Listing Proxy profiles");
		return createProxyProfilesReport(kit);
	}),
});