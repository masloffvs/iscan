import { defineExecutor, defineModule } from "../module";
import { createProxyProfilesReport, ensureProxyKit } from "./proxy-shared";

export const proxyListModule = defineModule({
	id: "kits/proxy/list",
	category: "kits",
	description: "List saved proxy profiles for the current Activity",
	executor: defineExecutor(async (context) => {
		const kit = await ensureProxyKit(context, "Listing Proxy profiles");
		return createProxyProfilesReport(kit);
	}),
});