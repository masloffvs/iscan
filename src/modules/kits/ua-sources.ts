import { defineExecutor, defineModule } from "../module";
import { ensureUaKit, UA_NOTEBOOK_TYPE_OVERLAY } from "./ua-shared";

export const uaSourcesModule = defineModule({
  id: "kits/ua/status",
  aliases: ["kits/ua/sources"],
  category: "kits",
  description: "Show configured UA sources with fetch status, parsed row counts, and stale flags.",
  notebookTypeOverlay: UA_NOTEBOOK_TYPE_OVERLAY,
  executor: defineExecutor(async (context) => {
    const kit = await ensureUaKit(context, "Inspecting UA source status");
    return {
      sources: await kit.getSourceStatuses(),
    };
  }),
});