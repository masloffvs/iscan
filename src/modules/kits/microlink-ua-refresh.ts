import { defineExecutor, defineModule } from "../module";
import { MICROLINK_UA_KIT_ID, MicrolinkUaKit } from "../../kits";

export const microlinkUaRefreshModule = defineModule({
	id: "kits/microlinkUA/refresh",
	aliases: ["kits/microlink-ua/refresh"],
	category: "kits",
	description: "Refresh the cached Microlink browser user-agent snapshot.",
	executor: defineExecutor(async (context) => {
		let kit = context.runtime.getKit<MicrolinkUaKit>(MICROLINK_UA_KIT_ID);
		if (!kit) {
			kit = new MicrolinkUaKit();
			await context.runtime.attachKit(kit, { reason: "Refreshing Microlink user agents" });
		}

		return await kit.refresh();
	}),
});