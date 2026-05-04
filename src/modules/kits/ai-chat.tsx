import React, { useMemo, useState } from "react";
import { jsonSchema, stepCountIs, tool, type ModelMessage } from "ai";
import { Box, Text, useInput } from "ink";

import { formatAiConnectionLabel, type AiKit } from "../../kits";
import { createTextEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, getModuleCategory, type InteractiveApplicationProps, type ModuleExecutionContext } from "../module";
import {
	ensureAiKit,
	formatModuleResultAsText,
	parseJson,
	parseOptionalBoolean,
	parseOptionalNumber,
	parseOptionalString,
	resolveChatConnection,
} from "./ai-shared";

type ChatRole = "system" | "user" | "assistant";

type ChatTranscriptMessage = {
	role: ChatRole;
	text: string;
};

type AiChatParams = {
	connection?: string;
	prompt?: string;
	system?: string;
	temperature?: number | string;
	maxOutputTokens?: number | string;
	enableTools?: boolean | string;
};

type AiChatReply = {
	text: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
	finishReason?: string | null;
};

type AiChatAppProps = InteractiveApplicationProps & {
	connectionLabel: string;
	initialSystemPrompt?: string;
	onSendPrompt(history: readonly ChatTranscriptMessage[], prompt: string): Promise<AiChatReply>;
};

type RenderedChatLine = {
	text: string;
	color: string;
};

type ListModulesToolInput = {
	category?: string;
};

type ListModulesToolOutput = Array<{
	id: string;
	category: string;
	description: string;
	defaultParameterName: string | null;
}>;

type DescribeModuleToolInput = {
	id: string;
};

type DescribeModuleToolOutput = {
	id: string;
	category: string;
	description: string;
	defaultParameterName: string | null;
	consoleParams: readonly unknown[];
};

type RunModuleToolInput = {
	id: string;
	paramsJson?: string;
};

type RunModuleToolOutput = {
	moduleId: string;
	output: string;
};

function wrapText(text: string, width: number): string[] {
	const safeWidth = Math.max(8, width);
	const paragraphs = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const lines: string[] = [];

	for (const paragraph of paragraphs) {
		if (paragraph.length === 0) {
			lines.push("");
			continue;
		}

		let remaining = paragraph;
		while (remaining.length > safeWidth) {
			const slice = remaining.slice(0, safeWidth);
			const breakIndex = slice.lastIndexOf(" ");
			const splitIndex = breakIndex >= Math.floor(safeWidth / 3) ? breakIndex : safeWidth;
			lines.push(remaining.slice(0, splitIndex).trimEnd());
			remaining = remaining.slice(splitIndex).trimStart();
		}

		lines.push(remaining);
	}

	return lines.length > 0 ? lines : [""];
}

function flattenTranscript(messages: readonly ChatTranscriptMessage[], width: number): RenderedChatLine[] {
	const renderedLines: RenderedChatLine[] = [];
	const bodyWidth = Math.max(12, width - 2);

	for (const message of messages) {
		const prefix = message.role === "assistant"
			? "ai> "
			: message.role === "user"
				? "you> "
				: "sys> ";
		const color = message.role === "assistant"
			? "#7dd3fc"
			: message.role === "user"
				? "#f5f5f5"
				: "#9ca3af";
		const wrappedLines = wrapText(message.text, bodyWidth - prefix.length);

		wrappedLines.forEach((line, index) => {
			renderedLines.push({
				text: `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`,
				color,
			});
		});
	}

	return renderedLines;
}

function createInputViewport(value: string, cursorOffset: number, width: number): { left: string; cursor: string; right: string } {
	const safeWidth = Math.max(1, width);
	const boundedCursor = Math.max(0, Math.min(cursorOffset, value.length));
	let start = Math.max(0, boundedCursor - safeWidth + 1);
		let end = Math.min(value.length, start + safeWidth);

	if (end - start < safeWidth && start > 0) {
		start = Math.max(0, end - safeWidth);
	}

	const visible = value.slice(start, end);
	const visibleCursor = boundedCursor - start;
	const left = visible.slice(0, visibleCursor);
	const cursor = visible.slice(visibleCursor, visibleCursor + 1) || " ";
	const right = visible.slice(visibleCursor + 1);

	return { left, cursor, right };
}

function formatUsage(reply: AiChatReply): string {
	if (!reply.usage) {
		return reply.finishReason ? `Finish: ${reply.finishReason}` : "Ready";
	}

	return [
		`tokens in=${reply.usage.inputTokens ?? 0}`,
		`out=${reply.usage.outputTokens ?? 0}`,
		`total=${reply.usage.totalTokens ?? 0}`,
		reply.finishReason ? `finish=${reply.finishReason}` : undefined,
	].filter(Boolean).join(" • ");
}

function toModelMessages(messages: readonly ChatTranscriptMessage[]): ModelMessage[] {
	return messages
		.filter(message => message.role !== "system")
		.map(message => ({
			role: message.role,
			content: message.text,
		}));
}

function AiChatApplication({
	width,
	height,
	onExit,
	connectionLabel,
	initialSystemPrompt,
	onSendPrompt,
}: AiChatAppProps) {
	const [messages, setMessages] = useState<ChatTranscriptMessage[]>(
		initialSystemPrompt
			? [{ role: "system", text: initialSystemPrompt }]
			: [],
	);
	const [inputValue, setInputValue] = useState("");
	const [cursorOffset, setCursorOffset] = useState(0);
	const [busy, setBusy] = useState(false);
	const [statusText, setStatusText] = useState("Enter sends • Ctrl+L clears • Esc exits");

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit(0);
			return;
		}

		if (busy) {
			return;
		}

		if (key.ctrl && input.toLowerCase() === "l") {
			setMessages(initialSystemPrompt ? [{ role: "system", text: initialSystemPrompt }] : []);
			setStatusText("Conversation cleared");
			return;
		}

		if (key.leftArrow) {
			setCursorOffset(previous => Math.max(0, previous - 1));
			return;
		}

		if (key.rightArrow) {
			setCursorOffset(previous => Math.min(inputValue.length, previous + 1));
			return;
		}

		if (key.backspace || key.delete) {
			if (cursorOffset === 0) {
				return;
			}

			setInputValue(previous => `${previous.slice(0, cursorOffset - 1)}${previous.slice(cursorOffset)}`);
			setCursorOffset(previous => Math.max(0, previous - 1));
			return;
		}

		if (key.return) {
			const prompt = inputValue.trim();
			if (prompt.length === 0) {
				return;
			}

			const nextMessages = [...messages, { role: "user", text: prompt } satisfies ChatTranscriptMessage];
			setMessages(nextMessages);
			setInputValue("");
			setCursorOffset(0);
			setBusy(true);
			setStatusText("$ai is thinking...");

			void onSendPrompt(nextMessages, prompt)
				.then(reply => {
					setMessages([...nextMessages, { role: "assistant", text: reply.text }]);
					setStatusText(formatUsage(reply));
				})
				.catch(error => {
					const message = error instanceof Error ? error.message : String(error);
					setMessages([...nextMessages, { role: "system", text: `$ai error: ${message}` }]);
					setStatusText("Request failed");
				})
				.finally(() => {
					setBusy(false);
				});
			return;
		}

		if (input.length === 1 && !key.ctrl && !key.meta) {
			setInputValue(previous => `${previous.slice(0, cursorOffset)}${input}${previous.slice(cursorOffset)}`);
			setCursorOffset(previous => previous + 1);
		}
	});

	const reservedRows = 6;
	const bodyRows = Math.max(4, height - reservedRows);
	const transcriptLines = useMemo(() => flattenTranscript(messages, width), [messages, width]);
	const visibleTranscriptLines = transcriptLines.slice(-bodyRows);
	const inputViewport = createInputViewport(inputValue, cursorOffset, Math.max(12, width - 6));

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			<Text color="#7dd3fc" bold>$ai chat</Text>
			<Text color="#9ca3af">Connection: {connectionLabel}</Text>

			<Box flexDirection="column" flexGrow={1} marginTop={1}>
				{visibleTranscriptLines.length === 0 ? (
					<Text color="#6b7280">Start typing to talk with $ai. Tool access can inspect and run modules from this Activity.</Text>
				) : (
					visibleTranscriptLines.map((line, index) => (
						<Text key={`${index}:${line.text}`} color={line.color}>{line.text}</Text>
					))
				)}
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Text color="#6b7280">Prompt</Text>
				<Text>
					<Text color="#34d399">&gt; </Text>
					<Text color="#f5f5f5">{inputViewport.left}</Text>
					<Text inverse>{inputViewport.cursor}</Text>
					<Text color="#f5f5f5">{inputViewport.right}</Text>
				</Text>
				<Text color={busy ? "#fbbf24" : "#6b7280"}>{statusText}</Text>
			</Box>
		</Box>
	);
}

type AiToolRuntimeContext = Pick<ModuleExecutionContext<AiChatParams, object>, "listModules" | "runModule" | "runtime">;

function buildRuntimeTools(context: AiToolRuntimeContext) {
	return {
		list_modules: tool<ListModulesToolInput, ListModulesToolOutput>({
			description: "List available modules that can be inspected or executed from this Activity.",
			inputSchema: jsonSchema<ListModulesToolInput>({
				type: "object",
				properties: {
					category: { type: "string", description: "Optional category filter such as discovery or kits." },
				},
				additionalProperties: false,
			}),
			execute: async ({ category }) => context.listModules()
				.filter((moduleDefinition: ReturnType<typeof context.listModules>[number]) => !category || getModuleCategory(moduleDefinition) === category)
				.map((moduleDefinition: ReturnType<typeof context.listModules>[number]) => ({
					id: moduleDefinition.id,
					category: getModuleCategory(moduleDefinition),
					description: moduleDefinition.description ?? "",
					defaultParameterName: moduleDefinition.defaultParameterName ?? null,
				})),
		}),
		describe_module: tool<DescribeModuleToolInput, DescribeModuleToolOutput>({
			description: "Describe one module, including its console parameters and default parameter name.",
			inputSchema: jsonSchema<DescribeModuleToolInput>({
				type: "object",
				properties: {
					id: { type: "string", description: "The exact module id to describe." },
				},
				required: ["id"],
				additionalProperties: false,
			}),
			execute: async ({ id }) => {
				const moduleDefinition = context.listModules().find((candidate: ReturnType<typeof context.listModules>[number]) => candidate.id === id);
				if (!moduleDefinition) {
					throw new InvalidParamsError(`Unknown module: ${id}`);
				}

				return {
					id: moduleDefinition.id,
					category: getModuleCategory(moduleDefinition),
					description: moduleDefinition.description ?? "",
					defaultParameterName: moduleDefinition.defaultParameterName ?? null,
					consoleParams: moduleDefinition.consoleParams ?? [],
				};
			},
		}),
		run_module: tool<RunModuleToolInput, RunModuleToolOutput>({
			description: "Run a module. Pass paramsJson as a JSON object string when the module expects parameters.",
			inputSchema: jsonSchema<RunModuleToolInput>({
				type: "object",
				properties: {
					id: { type: "string", description: "Exact module id to run." },
					paramsJson: { type: "string", description: "Optional JSON string with module params." },
				},
				required: ["id"],
				additionalProperties: false,
			}),
			execute: async ({ id, paramsJson }) => {
				const previousModuleId = context.runtime.getCurrentModuleId();
				const params = paramsJson ? parseJson("paramsJson", paramsJson) : undefined;
				try {
					const result = await context.runModule(id, params);
					return {
						moduleId: id,
						output: formatModuleResultAsText(result),
					};
				} finally {
					if (previousModuleId) {
						context.runtime.useModule(previousModuleId);
					}
				}
			},
		}),
	};
}

async function requestAiReply(options: {
	kit: AiKit;
	context: AiToolRuntimeContext;
	connection: string;
	system: string | undefined;
	history: readonly ChatTranscriptMessage[];
	temperature: number | undefined;
	maxOutputTokens: number | undefined;
	enableTools: boolean;
}): Promise<AiChatReply> {
	const tools = options.enableTools ? buildRuntimeTools(options.context) : undefined;
	const result = await options.kit.generateText({
		connection: options.connection,
		system: options.system,
		messages: toModelMessages(options.history),
		temperature: options.temperature,
		maxOutputTokens: options.maxOutputTokens,
		tools,
		stopWhen: tools ? stepCountIs(6) : undefined,
	});

	return {
		text: result.text?.trim() || "<empty response>",
		usage: result.usage,
		finishReason: result.finishReason ? String(result.finishReason) : null,
	};
}

function buildSystemPrompt(systemPrompt: string | undefined): string {
	const defaultPrompt = [
		"You are $ai inside the iscan console.",
		"You can inspect modules and run them with tools when needed.",
		"Prefer list_modules and describe_module before run_module when the correct module or params are unclear.",
		"When you use run_module, summarize the result for the operator instead of dumping raw JSON unless they ask for it.",
	].join(" ");

	return systemPrompt ? `${defaultPrompt}\n\n${systemPrompt}` : defaultPrompt;
}

export { type AiChatParams };

export const aiChatModule = defineModule<AiChatParams>({
	id: "kits/ai/chat",
	category: "kits",
	description: "Talk to a saved $ai connection, optionally with tool access to other modules",
	consoleParams: [
		{ name: "connection", detail: "Connection id or unique name to use", example: "local-ollama", valueType: "string" },
		{ name: "prompt", detail: "Optional one-shot prompt. If omitted, opens the interactive chat app", example: "Find active modules for radar lookups", valueType: "string" },
		{ name: "system", detail: "Extra system prompt appended to the default $ai operator prompt", example: "Answer in Russian.", valueType: "string" },
		{ name: "temperature", detail: "Sampling temperature", example: "0.2", valueType: "number" },
		{ name: "maxOutputTokens", detail: "Maximum output tokens", example: "1200", valueType: "number" },
		{ name: "enableTools", detail: "Allow the model to inspect and run other modules", example: "true", valueType: "boolean" },
	],
	executor: defineExecutor<AiChatParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const connectionTarget = parseOptionalString(context.params.connection, "connection");
		const connection = resolveChatConnection(kit, connectionTarget);
		const systemPrompt = buildSystemPrompt(parseOptionalString(context.params.system, "system"));
		const temperature = parseOptionalNumber(context.params.temperature, "temperature");
		const maxOutputTokens = parseOptionalNumber(context.params.maxOutputTokens, "maxOutputTokens");
		const enableTools = parseOptionalBoolean(context.params.enableTools, "enableTools") ?? true;
		const prompt = parseOptionalString(context.params.prompt, "prompt");

		if (prompt) {
			const reply = await requestAiReply({
				kit,
				context,
				connection: connection.id,
				system: systemPrompt,
				history: [{ role: "user", text: prompt }],
				temperature,
				maxOutputTokens,
				enableTools,
			});

			return createTextEntity(
				[
					`$ai • ${formatAiConnectionLabel(connection)}`,
					"",
					reply.text,
					"",
					formatUsage(reply),
				],
				{ tone: "output" },
			);
		}

		const exitCode = await context.runInteractiveApplication(AiChatApplication, {
			connectionLabel: formatAiConnectionLabel(connection),
			initialSystemPrompt: parseOptionalString(context.params.system, "system"),
			onSendPrompt: async (history, nextPrompt) => await requestAiReply({
				kit,
				context,
				connection: connection.id,
				system: systemPrompt,
				history,
				temperature,
				maxOutputTokens,
				enableTools,
			}),
		});

		return { exitCode };
	}),
}).useDefault("prompt");