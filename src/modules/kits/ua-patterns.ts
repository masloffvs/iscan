import { defineExecutor, defineModule } from "../module";
import { ensureUaKit, parseOptionalPositiveInteger, parseOptionalString, parseOptionalStringArray, UA_NOTEBOOK_TYPE_OVERLAY } from "./ua-shared";

export type UaPatternsParams = {
  categories?: string | string[];
  dispositions?: string | string[];
  limit?: number | string;
  query?: string;
  sourceIds?: string | string[];
};

const UA_PATTERNS_CONSOLE_PARAMS = [
  {
    name: "query",
    detail: "Optional substring to match inside patterns, labels, descriptions, and source ids.",
    example: "bing",
    valueType: "string",
  },
  {
    name: "sourceIds",
    detail: "Optional comma-separated list of source ids.",
    example: "cloudflare-bot-directory,crawler-user-agents",
    valueType: "string[]",
  },
  {
    name: "categories",
    detail: "Optional comma-separated list of normalized categories.",
    example: "ai-crawler,monitoring",
    valueType: "string[]",
  },
  {
    name: "dispositions",
    detail: "Optional comma-separated list of record dispositions such as declared, accepted, or forbidden.",
    example: "declared",
    valueType: "string[]",
  },
  {
    name: "limit",
    detail: "Optional maximum number of pattern rows to return.",
    example: "50",
    valueType: "number",
  },
] as const;

export const uaPatternsModule = defineModule<UaPatternsParams>({
  id: "kits/ua/patterns",
  category: "kits",
  description: "List parsed UA pattern records from all configured sources.",
  notebookTypeOverlay: UA_NOTEBOOK_TYPE_OVERLAY,
  consoleParams: UA_PATTERNS_CONSOLE_PARAMS,
  executor: defineExecutor<UaPatternsParams>(async (context) => {
    const kit = await ensureUaKit(context, "Listing parsed UA patterns");
    const filters = {
      categories: parseOptionalStringArray(context.params.categories, "categories"),
      dispositions: parseOptionalStringArray(context.params.dispositions, "dispositions"),
      limit: parseOptionalPositiveInteger(context.params.limit, "limit"),
      search: parseOptionalString(context.params.query, "query"),
      sourceIds: parseOptionalStringArray(context.params.sourceIds, "sourceIds"),
    };

    return {
      filters,
      patterns: await kit.listPatterns(filters),
      sources: await kit.getSourceStatuses(),
    };
  }),
}).useDefault("query");