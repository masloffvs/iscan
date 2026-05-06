import { defineModule } from "../module";
import { $axios } from "../../axios";
import { AxiosKit } from "../../kits";
import type { CreateAxiosDefaults } from "axios";

export type AxiosParams = {
	instanceId?: string;
	headersJson?: string;
} & Omit<CreateAxiosDefaults, "headers">;

export const axiosModule = defineModule<AxiosParams, any>({
	id: "kits/axios",
	aliases: ["axios"],
	category: "kits",
	description: "Manage Axios instances and static registry",
	consoleParams: [
		{ name: "instanceId", detail: "Unique ID for the axios instance in the static registry", example: "my-api", valueType: "string" },
		{ name: "baseURL", detail: "Custom base URL for requests", example: "https://api.example.com", valueType: "string" },
		{ name: "timeout", detail: "Request timeout in milliseconds", example: "15000", valueType: "number" },
		{ name: "headersJson", detail: "Optional JSON object with HTTP headers", example: '{"X-Custom-Header":"value"}', valueType: "json" },
		{ name: "auth", detail: "Basic auth credentials", example: '{"username":"admin","password":"..."}', valueType: "json" },
		{ name: "proxy", detail: "Proxy configuration", example: '{"host":"127.0.0.1","port":8080}', valueType: "json" },
	],
	executor: async (ctx) => {
		if (!ctx.getAxiosKit()) {
			await ctx.runtime.attachKit(new AxiosKit(), {
				reason: "module:kits/axios",
			});
		}

		const { instanceId, headersJson, ...rest } = ctx.params;

		if (instanceId) {
			let headers = rest.headers;
			if (headersJson) {
				try {
					headers = { ...headers, ...JSON.parse(headersJson) };
				} catch (e) {
					throw new Error(`Invalid headersJson: ${headersJson}`);
				}
			}

			return $axios.with({
				instanceId,
				...rest,
				headers,
			} as { instanceId: string } & CreateAxiosDefaults);
		}
		return $axios;
	},
});
