import { defineExecutor, defineModule } from "../module";
import { ensureUaKit, UA_NOTEBOOK_TYPE_OVERLAY } from "./ua-shared";

export const uaListModule = defineModule({
  id: "kits/ua/list",
  category: "kits",
  description: "List parsed exact user-agent records from all configured UA sources.",
  notebookTypeOverlay: UA_NOTEBOOK_TYPE_OVERLAY,
  executor: defineExecutor(async (context) => {
    const kit = await ensureUaKit(context, "Listing parsed UA exact records");
    return {
      exactAgents: await kit.listExactAgents(),
      sources: await kit.getSourceStatuses(),
    };
  }),
});