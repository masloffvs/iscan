import { defineExecutor, defineModule } from "../module";
import { MICROLINK_UA_KIT_ID, MicrolinkUaKit } from "../../kits";

export const microlinkUaListModule = defineModule({
	id: "kits/microlinkUA/list",
	aliases: ["kits/microlink-ua/list"],
	category: "kits",
	description: "List cached browser user agents from the Microlink feed.",
	executor: defineExecutor(async (context) => {
		let kit = context.runtime.getKit<MicrolinkUaKit>(MICROLINK_UA_KIT_ID);
		if (!kit) {
			kit = new MicrolinkUaKit();
			await context.runtime.attachKit(kit, { reason: "Listing Microlink user agents" });
		}

		return {
			status: await kit.getStatus(),
			userAgents: await kit.listUserAgents(),
		};
	}),
});