import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  listRemoteAiConnections,
  sendRemoteAiAgentChat,
  type RemoteAiAgentChatMessage,
  type RemoteAiAgentChatUsage,
  type RemoteAiConnectionSummary,
} from "../api/client";
import Modal from "../components/Modal";
import { useInterfaceStore } from "../store/ui";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";

export const AI_AGENT_APPLICATION_ID = "applications/ai-agent";

type AiAgentTranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  usage?: RemoteAiAgentChatUsage;
  finishReason?: string | null;
};

export type AiAgentInput = {
  connectionId?: string | null;
  model?: string | null;
  system?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  draft?: string | null;
  messages?: AiAgentTranscriptMessage[] | null;
  error?: string | null;
};

function normalizePersistedMessages(value: AiAgentInput["messages"]): AiAgentTranscriptMessage[] {
  return Array.isArray(value) ? value : [];
}

function createTranscriptMessage(
  role: "user" | "assistant",
  text: string,
  meta: { usage?: RemoteAiAgentChatUsage; finishReason?: string | null } = {},
): AiAgentTranscriptMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
    usage: meta.usage,
    finishReason: meta.finishReason ?? null,
  };
}

function formatUsage(usage: RemoteAiAgentChatUsage | undefined, finishReason: string | null | undefined): string | null {
  const parts = [
    typeof usage?.inputTokens === "number" ? `in ${usage.inputTokens}` : null,
    typeof usage?.outputTokens === "number" ? `out ${usage.outputTokens}` : null,
    typeof usage?.totalTokens === "number" ? `total ${usage.totalTokens}` : null,
    finishReason ? `finish ${finishReason}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatConnectionMeta(connection: RemoteAiConnectionSummary | null): string {
  if (!connection) {
    return "No saved AI connection selected.";
  }

  return [connection.provider, connection.model, connection.baseUrl].filter((value): value is string => Boolean(value)).join(" · ");
}

function clipTitle(value: string, maxLength = 42): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function getAiAgentApplicationTitle(messages: readonly AiAgentTranscriptMessage[], connection: RemoteAiConnectionSummary | null): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.text;
  if (firstUserMessage && firstUserMessage.trim().length > 0) {
    return `AI Agent · ${clipTitle(firstUserMessage)}`;
  }

  if (connection) {
    return `AI Agent · ${connection.name}`;
  }

  return "AI Agent · new chat";
}

function normalizeOptionalNumberInput(value: string, fieldName: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return numericValue;
}

function normalizeOptionalIntegerInput(value: string, fieldName: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numericValue = Number(trimmed);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return numericValue;
}

function MessageBubble({ message }: { message: AiAgentTranscriptMessage }) {
  const usageLabel = formatUsage(message.usage, message.finishReason);
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-[16px] px-4 py-3 ${isUser ? "bg-white/[0.08] text-white" : "bg-black/20 text-[#e9e9ee]"}`}>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">{message.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#8f8f97]">
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          {usageLabel ? <span>{usageLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

function AiAgentApp({
  instance,
  setTitle,
}: ApplicationViewProps<AiAgentInput>) {
  const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
  const [connections, setConnections] = useState<RemoteAiConnectionSummary[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState(instance.input.connectionId?.trim() ?? "");
  const [model, setModel] = useState(instance.input.model?.trim() ?? "");
  const [system, setSystem] = useState(instance.input.system?.trim() ?? "");
  const [temperature, setTemperature] = useState<number | null>(instance.input.temperature ?? null);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | null>(instance.input.maxOutputTokens ?? null);
  const [draft, setDraft] = useState(instance.input.draft ?? "");
  const [messages, setMessages] = useState<AiAgentTranscriptMessage[]>(normalizePersistedMessages(instance.input.messages));
  const [error, setError] = useState<string | null>(instance.input.error ?? null);
  const [isSending, setIsSending] = useState(false);
  const [settingsConnectionId, setSettingsConnectionId] = useState(connectionId);
  const [settingsModel, setSettingsModel] = useState(model);
  const [settingsSystem, setSettingsSystem] = useState(system);
  const [settingsTemperature, setSettingsTemperature] = useState(temperature === null ? "" : String(temperature));
  const [settingsMaxOutputTokens, setSettingsMaxOutputTokens] = useState(maxOutputTokens === null ? "" : String(maxOutputTokens));
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === connectionId) ?? null,
    [connectionId, connections],
  );

  useEffect(() => {
    setTitle(getAiAgentApplicationTitle(messages, activeConnection));
  }, [activeConnection, messages, setTitle]);

  useEffect(() => {
    updateApplicationInstanceInput(instance.instanceId, {
      connectionId,
      model: model || null,
      system: system || null,
      temperature,
      maxOutputTokens,
      draft,
      messages,
      error,
    } satisfies AiAgentInput);
  }, [
    connectionId,
    draft,
    error,
    instance.instanceId,
    maxOutputTokens,
    messages,
    model,
    system,
    temperature,
    updateApplicationInstanceInput,
  ]);

  useEffect(() => {
    let disposed = false;
    setIsLoadingConnections(true);

    void listRemoteAiConnections()
      .then((nextConnections) => {
        if (disposed) {
          return;
        }

        setConnections(nextConnections);
      })
      .catch((loadError) => {
        if (disposed) {
          return;
        }

        setConnections([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingConnections(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (connectionId || connections.length === 0) {
      return;
    }

    const preferredConnection = connections.find((connection) => connection.selected) ?? connections[0] ?? null;
    if (preferredConnection) {
      setConnectionId(preferredConnection.id);
    }
  }, [connectionId, connections]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!isLoadingConnections && connections.length === 0) {
      setIsSettingsOpen(true);
    }
  }, [connections.length, isLoadingConnections]);

  function openSettings(): void {
    setSettingsConnectionId(connectionId);
    setSettingsModel(model);
    setSettingsSystem(system);
    setSettingsTemperature(temperature === null ? "" : String(temperature));
    setSettingsMaxOutputTokens(maxOutputTokens === null ? "" : String(maxOutputTokens));
    setSettingsError(null);
    setIsSettingsOpen(true);
  }

  function closeSettings(): void {
    setSettingsError(null);
    setIsSettingsOpen(false);
  }

  function applySettings(): void {
    try {
      setConnectionId(settingsConnectionId.trim());
      setModel(settingsModel.trim());
      setSystem(settingsSystem.trim());
      setTemperature(normalizeOptionalNumberInput(settingsTemperature, "Temperature"));
      setMaxOutputTokens(normalizeOptionalIntegerInput(settingsMaxOutputTokens, "Max output tokens"));
      setSettingsError(null);
      setIsSettingsOpen(false);
    } catch (settingsParseError) {
      setSettingsError(settingsParseError instanceof Error ? settingsParseError.message : String(settingsParseError));
    }
  }

  function clearConversation(): void {
    setMessages([]);
    setError(null);
  }

  async function handleSend(): Promise<void> {
    const prompt = draft.trim();
    if (prompt.length === 0 || isSending) {
      return;
    }

    if (connectionId.trim().length === 0) {
      setError("Choose a saved AI connection in Settings before sending a prompt.");
      openSettings();
      return;
    }

    const userMessage = createTranscriptMessage("user", prompt);
    const nextMessages = [...messages, userMessage];
    const requestMessages: RemoteAiAgentChatMessage[] = nextMessages.map((message) => ({
      role: message.role,
      text: message.text,
    }));

    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const result = await sendRemoteAiAgentChat({
        connectionId,
        messages: requestMessages,
        system: system.trim() || null,
        model: model.trim() || null,
        temperature,
        maxOutputTokens,
      });

      setMessages([
        ...nextMessages,
        createTranscriptMessage("assistant", result.reply.text, {
          usage: result.reply.usage,
          finishReason: result.reply.finishReason,
        }),
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#121212] text-white">
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#7d7d86]">AI Agent</p>
            <h2 className="mt-1 truncate text-[15px] font-semibold text-[#ececf2]">{getAiAgentApplicationTitle(messages, activeConnection)}</h2>
            <p className="mt-1 truncate text-[10px] text-[#8e8e97]">{isLoadingConnections ? "Loading saved AI connections..." : formatConnectionMeta(activeConnection)}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSettings}
              className="rounded-[12px] bg-black/20 px-3 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.08]"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={clearConversation}
              disabled={messages.length === 0}
              className="rounded-[12px] bg-black/20 px-3 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.08] disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
        {error ? (
          <div className="mb-4 rounded-[14px] bg-rose-500/10 px-4 py-3 text-[12px] text-rose-100">
            {error}
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center rounded-[18px] bg-black/20 px-6 py-8 text-center">
            <div>
              <p className="text-[13px] font-medium text-[#ececf2]">Start a deep chat with your configured AI connection.</p>
              <p className="mt-2 text-[11px] leading-relaxed text-[#8e8e97]">
                Pick a saved `$ai` connection in Settings, tune the system prompt or limits if needed, then send your first message.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-5">
        <div className="rounded-[18px] bg-black/20 px-4 py-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask something detailed..."
            className="min-h-[120px] w-full resize-none bg-transparent text-[12px] leading-relaxed text-white outline-none placeholder:text-[#676770]"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] text-[#8e8e97]">Enter sends, Shift+Enter adds a new line.</p>
            <button
              type="button"
              onClick={() => { void handleSend(); }}
              disabled={isSending || draft.trim().length === 0 || isLoadingConnections}
              className="rounded-[12px] bg-white/[0.08] px-4 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              {isSending ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isSettingsOpen ? (
          <Modal title="AI Agent Settings" onClose={closeSettings}>
            <div className="space-y-4">
              <div className="rounded-[14px] bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">Connection</p>
                <select
                  value={settingsConnectionId}
                  onChange={(event) => setSettingsConnectionId(event.target.value)}
                  className="mt-3 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none"
                  disabled={connections.length === 0}
                >
                  <option value="">{connections.length === 0 ? "No saved connections" : "Choose saved connection"}</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.name} · {connection.provider} · {connection.model}</option>
                  ))}
                </select>
                <p className="mt-2 text-[10px] leading-relaxed text-[#8e8e97]">
                  AI Agent v1 reuses existing `$ai` connections only. Configure provider secrets separately through AiKit connection setup.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-[14px] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">Model override</p>
                  <input
                    value={settingsModel}
                    onChange={(event) => setSettingsModel(event.target.value)}
                    placeholder={activeConnection?.model ?? "Use connection default model"}
                    className="mt-3 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#66666f]"
                  />
                </div>

                <div className="rounded-[14px] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">Temperature</p>
                  <input
                    value={settingsTemperature}
                    onChange={(event) => setSettingsTemperature(event.target.value)}
                    placeholder="Use provider default"
                    inputMode="decimal"
                    className="mt-3 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#66666f]"
                  />
                </div>

                <div className="rounded-[14px] bg-black/20 p-4 md:col-span-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">System prompt</p>
                  <textarea
                    value={settingsSystem}
                    onChange={(event) => setSettingsSystem(event.target.value)}
                    placeholder={activeConnection?.systemPrompt ?? "Optional extra system prompt"}
                    className="mt-3 min-h-[120px] w-full resize-none rounded-[12px] bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-white outline-none placeholder:text-[#66666f]"
                  />
                </div>

                <div className="rounded-[14px] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">Max output tokens</p>
                  <input
                    value={settingsMaxOutputTokens}
                    onChange={(event) => setSettingsMaxOutputTokens(event.target.value)}
                    placeholder="Use provider default"
                    inputMode="numeric"
                    className="mt-3 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#66666f]"
                  />
                </div>

                <div className="rounded-[14px] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#777780]">Resolved base</p>
                  <p className="mt-3 text-[12px] leading-relaxed text-[#e4e4ea]">{activeConnection?.baseUrl ?? "Provider default"}</p>
                </div>
              </div>

              {settingsError ? (
                <div className="rounded-[14px] bg-rose-500/10 px-4 py-3 text-[12px] text-rose-100">
                  {settingsError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSettings}
                  className="rounded-[12px] bg-white/[0.04] px-4 py-2 text-[11px] font-medium text-[#d0d0d7] transition hover:bg-white/[0.08] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applySettings}
                  className="rounded-[12px] bg-white/[0.08] px-4 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.12]"
                >
                  Apply
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const aiAgentApplication = defineApplication<AiAgentInput>({
  id: AI_AGENT_APPLICATION_ID,
  title: "AI Agent",
  View: AiAgentApp,
  getInitialTitle: () => "AI Agent · new chat",
});