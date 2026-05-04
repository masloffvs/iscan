import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import {
	AI_KIT_ID,
	CLOAK_KIT_ID,
	ELASTICSEARCH_KIT_ID,
	PROXY_KIT_ID,
	QEMU_KIT_ID,
} from "../../kits";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";

type KitsManagerProps = InteractiveApplicationProps & {
	activeKitIds: readonly string[];
	onLaunchModule(moduleId: string): void;
};

type KitLauncherItem = {
	id: string;
	title: string;
	description: string;
	kitId?: string;
	launchModuleId?: string;
	commandHint: string;
	actionLabel: string;
	disabledReason?: string;
};

const KIT_LAUNCHER_ITEMS: readonly KitLauncherItem[] = [
	{
		id: "cloak",
		title: "Cloak Browser",
		description: "Manage browser profiles, fingerprints, locale, proxy binding, and launch settings.",
		kitId: CLOAK_KIT_ID,
		launchModuleId: "kits/cloak/manager",
		commandHint: "$.kits.cloak.manager()",
		actionLabel: "Open profile manager",
	},
	{
		id: "proxy",
		title: "Proxy Service",
		description: "Manage proxy endpoints, test latency, and reuse proxy profiles inside the current Activity.",
		kitId: PROXY_KIT_ID,
		launchModuleId: "kits/proxy/manager",
		commandHint: "$.kits.proxy.manager()",
		actionLabel: "Open proxy manager",
	},
	{
		id: "qemu",
		title: "QEMU",
		description: "Manage VM presets, router topology, installer preparation, and launch workflows.",
		kitId: QEMU_KIT_ID,
		launchModuleId: "kits/qemu/manager",
		commandHint: "$.kits.qemu.manager()",
		actionLabel: "Open QEMU manager",
	},
	{
		id: "elastic",
		title: "ElasticSearch",
		description: "Activity-scoped search kit. Connect it from the console, then reuse it across Elastic modules.",
		kitId: ELASTICSEARCH_KIT_ID,
		commandHint: "$.kits.elastic.connect({ node: 'http://127.0.0.1:9200' })",
		actionLabel: "CLI workflow",
		disabledReason: "No dedicated TUI yet. Use $.kits.elastic.connect(...) from the console.",
	},
	{
		id: "ai",
		title: "$ai",
		description: "Attach a saved multi-provider AI connection to the Activity and open a module-aware chat workflow.",
		kitId: AI_KIT_ID,
		commandHint: "$.kits.ai.connect({ id: 'local-ollama', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1' })",
		actionLabel: "CLI workflow",
		disabledReason: "No dedicated TUI yet. Use $.kits.ai.connect(...), $.kits.ai.list(), and $.kits.ai.chat() from the console.",
	},
];

function KitsManager({ width, height, onExit, activeKitIds, onLaunchModule }: KitsManagerProps) {
	const [cursor, setCursor] = useState(0);
	const [flashMessage, setFlashMessage] = useState<string | null>(null);

	const activeKitIdSet = useMemo(() => new Set(activeKitIds), [activeKitIds]);
	const selectedItem = KIT_LAUNCHER_ITEMS[cursor] ?? KIT_LAUNCHER_ITEMS[0] ?? null;

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit(0);
			return;
		}

		if (key.upArrow) {
			setCursor(previousCursor => Math.max(0, previousCursor - 1));
			setFlashMessage(null);
			return;
		}

		if (key.downArrow) {
			setCursor(previousCursor => Math.min(KIT_LAUNCHER_ITEMS.length - 1, previousCursor + 1));
			setFlashMessage(null);
			return;
		}

		if (!key.return || !selectedItem) {
			return;
		}

		if (!selectedItem.launchModuleId) {
			setFlashMessage(selectedItem.disabledReason ?? selectedItem.commandHint);
			return;
		}

		onLaunchModule(selectedItem.launchModuleId);
		onExit(0);
	});

	const footerMessage = flashMessage
		?? (selectedItem?.launchModuleId
			? `Enter launches ${selectedItem.title} • Esc closes`
			: `${selectedItem?.commandHint ?? "Select a kit"}`);

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			<Text color="#7dd3fc" bold>Kit Activity Launcher</Text>
			<Text color="#9ca3af">Choose a kit workflow for the current Activity.</Text>

			<Box flexDirection="row" marginTop={1} flexGrow={1}>
				<Box flexDirection="column" width={Math.max(36, Math.floor(width * 0.42))} marginRight={2}>
					<Text bold color="#e5e7eb">Available Kits</Text>
					{KIT_LAUNCHER_ITEMS.map((item, index) => {
						const selected = index === cursor;
						const attached = item.kitId ? activeKitIdSet.has(item.kitId) : false;
						const statusColor = attached ? "#34d399" : (item.launchModuleId ? "#7dd3fc" : "#fbbf24");
						const statusLabel = attached ? "attached" : (item.launchModuleId ? "ready" : "cli-only");

						return (
							<Box key={item.id} flexDirection="column" marginTop={1} paddingX={1}>
								<Text color={selected ? "#34d399" : "#e5e7eb"}>
									{selected ? "> " : "  "}
									{item.title}
									<Text color={statusColor}> [{statusLabel}]</Text>
								</Text>
								<Text color="#6b7280">{item.actionLabel}</Text>
							</Box>
						);
					})}
				</Box>

				<Box flexDirection="column" flexGrow={1}>
					<Text bold color="#e5e7eb">Details</Text>
					{selectedItem ? (
						<Box flexDirection="column" marginTop={1}>
							<Text color="#f5f5f5">{selectedItem.title}</Text>
							<Text color="#9ca3af">{selectedItem.description}</Text>
							<Box marginTop={1} flexDirection="column">
								<Text color="#7dd3fc">Action: {selectedItem.actionLabel}</Text>
								<Text color="#9ca3af">Command: {selectedItem.commandHint}</Text>
								<Text color={selectedItem.kitId && activeKitIdSet.has(selectedItem.kitId) ? "#34d399" : "#9ca3af"}>
									Status: {selectedItem.kitId && activeKitIdSet.has(selectedItem.kitId) ? "already attached in this Activity" : "not attached yet"}
								</Text>
							</Box>
							{selectedItem.disabledReason ? (
								<Box marginTop={1}>
									<Text color="#fbbf24">{selectedItem.disabledReason}</Text>
								</Box>
							) : null}
						</Box>
					) : (
						<Text color="#9ca3af">No kit workflows available.</Text>
					)}
				</Box>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text color="#9ca3af">Up/Down to navigate • Enter to launch • Esc to exit</Text>
				<Text color={flashMessage ? "#fbbf24" : "#6b7280"}>{footerMessage}</Text>
			</Box>
		</Box>
	);
}

export const kitsManagerModule = defineModule({
	id: "kits/manager",
	category: "kits",
	description: "Open a TUI launcher for Activity-scoped kit workflows and managers",
	executor: defineExecutor(async (context) => {
		let selectedModuleId: string | null = null;
		const exitCode = await context.runInteractiveApplication(KitsManager, {
			activeKitIds: context.runtime.listKits().map(kit => kit.id),
			onLaunchModule: (moduleId: string) => {
				selectedModuleId = moduleId;
			},
		});

		if (selectedModuleId) {
			await context.runModule(selectedModuleId);
			return undefined;
		}

		return { exitCode };
	}),
});