import type { AiKit } from "../../../kits";
import {
  buildAiSystemPrompt,
  parseOptionalNumber,
  parseOptionalString,
  requestAiTextReply,
  resolveChatConnection,
  type AiChatHistoryMessage,
  type AiChatRole,
} from "../../../modules/kits/ai-shared";
import {
  createJsonResponse,
  createMethodNotAllowedResponse,
  ensureRecordBody,
  readJsonBody,
  VmServerHttpError,
} from "../http";

type AiConnectionSummary = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  providerName: string | null;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  selected: boolean;
};

function isAiChatRole(value: unknown): value is AiChatRole {
  return value === "system" || value === "user" || value === "assistant";
}

function toAiConnectionSummary(kit: AiKit): AiConnectionSummary[] {
  const selectedConnectionId = kit.getSelectedConnectionId();
  return kit.listConnections().map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    model: connection.model,
    baseUrl: connection.baseUrl ?? null,
    providerName: connection.providerName ?? null,
    systemPrompt: connection.systemPrompt ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    selected: selectedConnectionId === connection.id,
  }));
}

function normalizeHistoryMessage(value: unknown, index: number): AiChatHistoryMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmServerHttpError(400, `AI chat message at index ${index} must be a JSON object.`);
  }

  const role = (value as Record<string, unknown>).role;
  if (!isAiChatRole(role)) {
    throw new VmServerHttpError(400, `AI chat message at index ${index} has an invalid role.`);
  }

  const text = parseOptionalString((value as Record<string, unknown>).text, `messages[${index}].text`);
  if (!text) {
    throw new VmServerHttpError(400, `AI chat message at index ${index} requires a non-empty text field.`);
  }

  return {
    role,
    text,
  };
}

function normalizeHistory(value: unknown): AiChatHistoryMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VmServerHttpError(400, "AI chat request requires a non-empty messages array.");
  }

  return value.map((entry, index) => normalizeHistoryMessage(entry, index));
}

export async function handleAiAgentRoutes(
  request: Request,
  url: URL,
  ensureAiKit: () => Promise<AiKit>,
): Promise<Response | null> {
  if (url.pathname === "/vm/kits/ai/connections") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureAiKit();
    return createJsonResponse({
      ok: true,
      result: {
        connections: toAiConnectionSummary(kit),
      },
    });
  }

  if (url.pathname !== "/vm/kits/ai/agent/chat") {
    return null;
  }

  if (request.method !== "POST") {
    return createMethodNotAllowedResponse(["POST"]);
  }

  const body = ensureRecordBody(await readJsonBody(request));
  const kit = await ensureAiKit();
  const connection = resolveChatConnection(
    kit,
    parseOptionalString(body.connectionId, "connectionId")
      ?? parseOptionalString(body.connection, "connection"),
  );
  const systemOverride = parseOptionalString(body.system, "system");
  const modelOverride = parseOptionalString(body.model, "model");
  const temperature = parseOptionalNumber(body.temperature, "temperature");
  const maxOutputTokens = parseOptionalNumber(body.maxOutputTokens, "maxOutputTokens");
  const messages = normalizeHistory(body.messages);
  const reply = await requestAiTextReply({
    kit,
    connection: connection.id,
    model: modelOverride,
    system: buildAiSystemPrompt(systemOverride ?? connection.systemPrompt, { enableTools: false }),
    history: messages,
    temperature,
    maxOutputTokens,
  });

  return createJsonResponse({
    ok: true,
    result: {
      connection: {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        model: modelOverride ?? connection.model,
        baseUrl: connection.baseUrl ?? null,
        providerName: connection.providerName ?? null,
        selected: kit.getSelectedConnectionId() === connection.id,
      },
      request: {
        system: systemOverride ?? connection.systemPrompt ?? null,
        temperature: temperature ?? null,
        maxOutputTokens: maxOutputTokens ?? null,
      },
      reply,
    },
  });
}