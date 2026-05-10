import { defineExecutor, defineModule } from "../module";
import { ensureUaKit, parseOptionalStringArray, UA_NOTEBOOK_TYPE_OVERLAY } from "./ua-shared";

export type UaRefreshParams = {
  sourceIds?: string | string[];
};

const UA_REFRESH_CONSOLE_PARAMS = [
  {
    name: "sourceIds",
    detail: "Optional comma-separated list of source ids to refresh. If omitted, refreshes all enabled UA sources.",
    example: "microlink,cloudflare-bot-directory",
    valueType: "string[]",
  },
] as const;

export const uaRefreshModule = defineModule<UaRefreshParams>({
  id: "kits/ua/refresh",
  category: "kits",
  description: "Refresh parsed UA sources into SQLite without replacing last-good rows on source failure.",
  notebookTypeOverlay: UA_NOTEBOOK_TYPE_OVERLAY,
  consoleParams: UA_REFRESH_CONSOLE_PARAMS,
  executor: defineExecutor<UaRefreshParams>(async (context) => {
    const kit = await ensureUaKit(context, "Refreshing parsed UA sources");
    return await kit.refresh(parseOptionalStringArray(context.params.sourceIds, "sourceIds"));
  }),
}).useDefault("sourceIds");