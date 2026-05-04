import { Buffer } from "node:buffer";
import { $config } from "./config";
import type { ResolvedHunterServiceConfig } from "./config";
import { logger } from "./logger";

const HUNTER_API_KEY_SEARCH_URL = "https://api.hunter.how/search";
const HUNTER_BEARER_SEARCH_URL = "https://hunter.how/api/search";
const HUNTER_RATE_LIMIT_MS = 2_000;
const HUNTER_ALLOWED_PAGE_SIZES = [10, 20, 50, 100, 1000] as const;
const DEFAULT_HUNTER_FIELDS = [
  "ip",
  "port",
  "domain",
  "protocol",
  "transport_protocol",
  "web_title",
  "country",
  "province",
  "city",
  "url",
  "updated_at",
] as const;

export type HunterSearchField =
  | "ip"
  | "port"
  | "domain"
  | "protocol"
  | "transport_protocol"
  | "web_title"
  | "country"
  | "province"
  | "city"
  | "url"
  | "asn"
  | "as_org"
  | "as_name"
  | "status_code"
  | "cert"
  | "os"
  | "header"
  | "header_server"
  | "banner"
  | "product"
  | "updated_at"
  | "body";

export type HunterSearchPageSize = (typeof HUNTER_ALLOWED_PAGE_SIZES)[number];

export type HunterProduct = {
  name: string;
  version: string;
};

export type HunterSearchResult = {
  as_name: string;
  as_org: string;
  asn: string;
  banner: string;
  body: string;
  cert: string;
  city: string;
  country: string;
  domain: string;
  header: string;
  header_server: string;
  ip: string;
  os: string;
  port: string;
  product: HunterProduct[] | null;
  protocol: string;
  province: string;
  status_code: string | number | null;
  transport_protocol: string;
  updated_at: string;
  url: string;
  web_title: string;
};

export type RawHunterSearchResponse = {
  code: number;
  data: {
    query_limit: number;
    query_count: number;
    results_limit: number;
    results_count: number;
    h_points: number;
    total: number;
    list: HunterSearchResult[];
  };
  message: string;
};

export class HunterSearchResponse {
  public readonly code: number;
  public readonly data: RawHunterSearchResponse["data"];
  public readonly message: string;

  constructor(payload: RawHunterSearchResponse) {
    this.code = payload.code;
    this.data = payload.data;
    this.message = payload.message;
  }

  unpack(): HunterSearchResult[] {
    return this.data?.list || [];
  }
}

export type HunterSearchParams = {
  query: string;
  startTime: string;
  endTime: string;
  page?: number;
  pageSize?: HunterSearchPageSize;
  fields?: HunterSearchField[];
};

type HunterErrorResponse = {
  code?: number;
  message?: string;
};

type HunterAuthConfig =
  | {
      method: "api-key";
      apiKey: string;
    }
  | {
      method: "bearer";
      token: string;
    };

class Hunter {
  private auth: HunterAuthConfig;
  private lastRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(config: ResolvedHunterServiceConfig) {
    if (config.authMethod === "api-key") {
      if (!config.apiKey) {
        throw new Error("Hunter API key is missing in the configuration.");
      }

      this.auth = {
        method: "api-key",
        apiKey: config.apiKey,
      };

      return;
    }

    if (!config.bearerToken) {
      throw new Error("Hunter bearer token is missing in the configuration.");
    }

    this.auth = {
      method: "bearer",
      token: config.bearerToken,
    };
  }

  async search({
    query,
    startTime,
    endTime,
    page = 1,
    pageSize = 10,
    fields = [...DEFAULT_HUNTER_FIELDS],
  }: HunterSearchParams): Promise<HunterSearchResponse> {
    this.validateDate(startTime, "startTime");
    this.validateDate(endTime, "endTime");

    if (!query.trim()) {
      throw new Error("Hunter query must not be empty.");
    }

    if (!Number.isInteger(page) || page < 1) {
      throw new Error("Hunter page must be an integer greater than or equal to 1.");
    }

    if (!HUNTER_ALLOWED_PAGE_SIZES.includes(pageSize)) {
      throw new Error(
        `Hunter pageSize must be one of: ${HUNTER_ALLOWED_PAGE_SIZES.join(", ")}.`,
      );
    }

    if (!fields.length) {
      throw new Error("Hunter fields must contain at least one field.");
    }

    await this.enforceRateLimit();

    let response: Response;

    if (this.auth.method === "api-key") {
      const params = new URLSearchParams({
        query: this.encodeQuery(query),
        page: String(page),
        page_size: String(pageSize),
        start_time: startTime,
        end_time: endTime,
        fields: fields.join(","),
      });
      params.set("api-key", this.auth.apiKey);

      response = await fetch(`${HUNTER_API_KEY_SEARCH_URL}?${params.toString()}`);
    } else {
      const body = {
        search: this.encodeQuery(query),
        end_time: endTime,
        start_time: startTime,
        page,
        page_size: pageSize,
        is_web: 0,
        status_code: null,
        syntax_condition: null,
      };

      response = await fetch(HUNTER_BEARER_SEARCH_URL, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
    }

    const payload = await this.parseResponse<RawHunterSearchResponse | HunterErrorResponse>(response);

    if (!response.ok) {
      const message = payload?.message ?? response.statusText;
      throw new Error(`Hunter search failed with ${response.status}: ${message}`);
    }

    if (!payload || !("data" in payload)) {
      throw new Error("Hunter search returned an unexpected response body.");
    }

    return new HunterSearchResponse(payload as RawHunterSearchResponse);
  }

  private buildHeaders(): HeadersInit | undefined {
    if (this.auth.method !== "bearer") {
      return undefined;
    }

    return {
      Authorization: `Bearer ${this.auth.token}`,
      "Content-Type": "application/json",
      Origin: "https://hunter.how",
      Referer: "https://hunter.how/",
    };
  }

  async searchDomain(
    domain: string,
    params: Omit<HunterSearchParams, "query">,
  ): Promise<HunterSearchResponse> {
    const normalizedDomain = domain.trim();

    if (!normalizedDomain) {
      throw new Error("Hunter domain must not be empty.");
    }

    return this.search({
      ...params,
      query: `domain="${normalizedDomain}"`,
    });
  }

  private async enforceRateLimit(): Promise<void> {
    const nextTurn = this.requestQueue.then(async () => {
      const waitMs = Math.max(
        0,
        HUNTER_RATE_LIMIT_MS - (Date.now() - this.lastRequestAt),
      );

      if (waitMs > 0) {
        await Bun.sleep(waitMs);
      }

      this.lastRequestAt = Date.now();
    });

    this.requestQueue = nextTurn.catch(() => undefined);
    await nextTurn;
  }

  private encodeQuery(query: string): string {
    return Buffer.from(query, "utf8")
      .toString("base64")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
  }

  private validateDate(value: string, fieldName: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      throw new Error(`Hunter ${fieldName} must be in yyyy-mm-dd format.`);
    }
  }

  private async parseResponse<T>(response: Response): Promise<T | undefined> {
    const body = await response.text();

    if (!body) {
      return undefined;
    }

    return JSON.parse(body) as T;
  }
}

const hunterInstance = new Hunter($config.services.hunter);

export const $hunter = new Proxy(hunterInstance, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === "function") {
      return async function (...args: any[]) {
        const method = String(prop);
        logger.info({ method, args }, `executing ${method}`);
        try {
          const result = await value.apply(target, args);
          logger.info({ method }, `${method} resolved`);
          return result;
        } catch (error) {
          logger.error({ method, error }, `${method} rejected`);
          throw error;
        }
      };
    }
    return value;
  },
});