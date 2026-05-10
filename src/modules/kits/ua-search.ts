import { defineExecutor, defineModule } from "../module";
import { ensureUaKit, parseOptionalPositiveInteger, parseOptionalString, parseOptionalStringArray, UA_NOTEBOOK_TYPE_OVERLAY } from "./ua-shared";

export type UaSearchParams = {
  browserFamilies?: string | string[];
  browserVersions?: string | string[];
  categories?: string | string[];
  deviceClasses?: string | string[];
  dispositions?: string | string[];
  limit?: number | string;
  osFamilies?: string | string[];
  query?: string;
  sourceIds?: string | string[];
};

const UA_SEARCH_CONSOLE_PARAMS = [
  {
    name: "query",
    detail: "Optional substring to match against user agents, labels, descriptions, and source ids.",
    example: "Chrome",
    valueType: "string",
  },
  {
    name: "sourceIds",
    detail: "Optional comma-separated list of source ids.",
    example: "microlink,cloudflare-bot-directory",
    valueType: "string[]",
  },
  {
    name: "categories",
    detail: "Optional comma-separated list of normalized categories.",
    example: "user,ai-crawler",
    valueType: "string[]",
  },
  {
    name: "browserFamilies",
    detail: "Optional comma-separated list of parsed browser families.",
    example: "Chrome,Firefox",
    valueType: "string[]",
  },
  {
    name: "browserVersions",
    detail: "Optional comma-separated list of major browser versions.",
    example: "124,125",
    valueType: "string[]",
  },
  {
    name: "osFamilies",
    detail: "Optional comma-separated list of parsed operating-system families.",
    example: "Windows,macOS",
    valueType: "string[]",
  },
  {
    name: "deviceClasses",
    detail: "Optional comma-separated list of parsed device classes.",
    example: "desktop,mobile",
    valueType: "string[]",
  },
  {
    name: "dispositions",
    detail: "Optional comma-separated list of record dispositions.",
    example: "observed,declared",
    valueType: "string[]",
  },
  {
    name: "limit",
    detail: "Optional maximum number of exact UA rows to return.",
    example: "50",
    valueType: "number",
  },
] as const;

export const uaSearchModule = defineModule<UaSearchParams>({
  id: "kits/ua/search",
  category: "kits",
  description: "Search parsed exact UA rows by source, category, browser, OS, device class, and free-text query.",
  notebookTypeOverlay: UA_NOTEBOOK_TYPE_OVERLAY,
  consoleParams: UA_SEARCH_CONSOLE_PARAMS,
  executor: defineExecutor<UaSearchParams>(async (context) => {
    const kit = await ensureUaKit(context, "Searching parsed UA exact rows");
    const filters = {
      browserFamilies: parseOptionalStringArray(context.params.browserFamilies, "browserFamilies"),
      browserVersions: parseOptionalStringArray(context.params.browserVersions, "browserVersions"),
      categories: parseOptionalStringArray(context.params.categories, "categories"),
      deviceClasses: parseOptionalStringArray(context.params.deviceClasses, "deviceClasses"),
      dispositions: parseOptionalStringArray(context.params.dispositions, "dispositions"),
      limit: parseOptionalPositiveInteger(context.params.limit, "limit"),
      osFamilies: parseOptionalStringArray(context.params.osFamilies, "osFamilies"),
      search: parseOptionalString(context.params.query, "query"),
      sourceIds: parseOptionalStringArray(context.params.sourceIds, "sourceIds"),
    };

    return {
      exactAgents: await kit.listExactAgents(filters),
      filters,
      sources: await kit.getSourceStatuses(),
    };
  }),
}).useDefault("query");