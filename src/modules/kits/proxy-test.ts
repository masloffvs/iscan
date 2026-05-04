import { defineExecutor, defineModule } from "../module";
import {
	createProxyTestReport,
	ensureProxyKit,
	parseOptionalString,
	resolveProxyProfile,
} from "./proxy-shared";

export type ProxyTestParams = {
	proxy?: string;
};

export const proxyTestModule = defineModule<ProxyTestParams>({
	id: "kits/proxy/test",
	category: "kits",
	description: "Test a saved proxy profile and report latency or connection errors",
	consoleParams: [
		{
			name: "proxy",
			detail: "Proxy id or unique name. Defaults to the only saved proxy when exactly one exists.",
			example: "office-socks",
			valueType: "string",
		},
	],
	executor: defineExecutor<ProxyTestParams>(async (context) => {
		const kit = await ensureProxyKit(context, "Testing Proxy profile");
		const target = parseOptionalString(context.params.proxy, "proxy");
		const proxy = resolveProxyProfile(kit, target);
		const result = await kit.testProxy(proxy.id);
		return createProxyTestReport(proxy, result);
	}),
}).useDefault("proxy");