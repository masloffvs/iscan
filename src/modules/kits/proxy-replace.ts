import { defineExecutor, defineModule } from "../module";
import { InvalidParamsError } from "../errors";
import { applyProxyBatchText, createProxyBatchReport } from "./proxy-import-shared";
import { ensureProxyKit, parseOptionalProxyType, parseOptionalString, PROXY_TYPE_VALUES } from "./proxy-shared";

export type ProxyReplaceParams = {
	text?: string;
	defaultType?: string;
};

const PROXY_REPLACE_CONSOLE_PARAMS = [
	{
		name: "text",
		detail: "Multiline free-form proxy input. The existing saved inventory will be replaced by the parsed result.",
		example: "http://user:pass@1.2.3.4:8080\\nsocks5h://5.6.7.8:1080",
		valueType: "string",
	},
	{
		name: "defaultType",
		detail: "Fallback proxy type for formats without an explicit protocol like ip:port or user:pass:ip:port.",
		example: "HTTP",
		valueType: "string",
		values: PROXY_TYPE_VALUES,
	},
] as const;

export const proxyReplaceModule = defineModule<ProxyReplaceParams>({
	id: "kits/proxy/replace",
	category: "kits",
	description: "Replace the saved proxy inventory with notebook-safe free-form batch parsing",
	consoleParams: PROXY_REPLACE_CONSOLE_PARAMS,
	executor: defineExecutor<ProxyReplaceParams>(async (context) => {
		const text = parseOptionalString(context.params.text, "text");
		if (!text) {
			throw new InvalidParamsError("text is required.");
		}

		const defaultType = parseOptionalProxyType(context.params.defaultType, "defaultType") ?? "HTTP";
		const kit = await ensureProxyKit(context, "Replacing Proxy batch");
		const result = await applyProxyBatchText(kit, text, {
			mode: "replace",
			defaultType,
		});
		return createProxyBatchReport(kit, result);
	}),
}).useDefault("text");