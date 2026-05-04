import { defineExecutor, defineModule } from "../module";
import { InvalidParamsError } from "../errors";
import { applyProxyBatchText, createProxyBatchReport } from "./proxy-import-shared";
import { ensureProxyKit, parseOptionalProxyType, parseOptionalString, PROXY_TYPE_VALUES } from "./proxy-shared";

export type ProxyImportParams = {
	text?: string;
	defaultType?: string;
};

const PROXY_IMPORT_CONSOLE_PARAMS = [
	{
		name: "text",
		detail: "Multiline free-form proxy input. Supports URI, vendor list, curl, and proxychains formats.",
		example: "http://user:pass@1.2.3.4:8080\\nsocks5://5.6.7.8:1080",
		valueType: "string",
	},
	{
		name: "defaultType",
		detail: "Fallback proxy type for formats without an explicit protocol like ip:port or ip:port:user:pass.",
		example: "HTTP",
		valueType: "string",
		values: PROXY_TYPE_VALUES,
	},
] as const;

export const proxyImportModule = defineModule<ProxyImportParams>({
	id: "kits/proxy/import",
	category: "kits",
	description: "Append free-form proxy input to the saved inventory using notebook-safe batch parsing",
	consoleParams: PROXY_IMPORT_CONSOLE_PARAMS,
	executor: defineExecutor<ProxyImportParams>(async (context) => {
		const text = parseOptionalString(context.params.text, "text");
		if (!text) {
			throw new InvalidParamsError("text is required.");
		}

		const defaultType = parseOptionalProxyType(context.params.defaultType, "defaultType") ?? "HTTP";
		const kit = await ensureProxyKit(context, "Importing Proxy batch");
		const result = await applyProxyBatchText(kit, text, {
			mode: "append",
			defaultType,
		});
		return createProxyBatchReport(kit, result);
	}),
}).useDefault("text");