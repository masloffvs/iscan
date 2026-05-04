import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, ThemeProvider, defaultTheme, extendTheme } from "@inkjs/ui";
import { Box, render, Text, useApp, useInput, useStdout, useWindowSize } from "ink";

import { attachLoggerOutputSink, runWithLoggerOutputSink } from "../logger";
import { createTextEntity, OutputStack, renderOutputEntities, type OutputEntity, type OutputTone } from "../primitives";
import {
	findOutputLineMatches,
	moveHistoryNavigation,
	moveSearchMatch,
	parseTerminalMouseEvent,
	resolveAnchoredMatchIndex,
	resolveTabCompletion,
	type HistoryNavigationState,
	type TabCompletionState,
} from "./console-input.ts";
import type { ModuleConsoleParam, ModuleDefinition } from "./module";
import type { ActivityConsoleSnapshot, ConsoleSessionSnapshot, ConsoleSessionState, ConsoleSessionStateManager } from "./session-state";
import type { ModuleConsoleCommandResult, ModuleConsoleSuggestionItem, ModuleRuntime } from "./runtime";

type RuntimeInkConsoleProps<THelpers extends object> = {
	activityId: string;
	activityTabs: ActivityTabMeta[];
	activityTitle: string;
	active: boolean;
	onActivityCommand(command: NonNullable<ModuleConsoleCommandResult["activityCommand"]>): void;
	onCloseActivity(activityId: string): void;
	onSelectActivity(activityId: string): void;
	onRunningChange(activityId: string, isRunning: boolean): void;
	onSessionCommand(command: NonNullable<ModuleConsoleCommandResult["sessionCommand"]>): Promise<void>;
	onSnapshotChange(activityId: string, snapshot: ActivityConsoleSnapshot): void;
	outputStack: OutputStack;
	runtime: ModuleRuntime<THelpers>;
	fullscreen: boolean;
	initialHistory: string[];
};

type ActivitiesInkConsoleProps<THelpers extends object> = {
	runtime: ModuleRuntime<THelpers>;
	fullscreen: boolean;
	initialSessionState: ConsoleSessionState | null;
	sessionStateManager: ConsoleSessionStateManager;
};

type ActivityTabMeta = {
	id: string;
	title: string;
	active: boolean;
	isRunning: boolean;
};

type ActivityTabHitbox = {
	kind: "select" | "close" | "create";
	activityId?: string;
	xStart: number;
	xEnd: number;
	y: number;
};

type SuggestionMenuAction =
	| {
		kind: "insert-input";
		cursorOffset?: number;
	}
	| {
		kind: "submit-command";
		command: string;
	};

type SuggestionMenuItem = ModuleConsoleSuggestionItem & {
	action?: SuggestionMenuAction;
};

type AnyModuleDefinition = ModuleDefinition<unknown, unknown, object>;

type ModulePickerItem = SuggestionMenuItem & {
	moduleDefinition: AnyModuleDefinition;
	moduleExpression: string;
	searchText: string;
};

type CommandPaletteItem = SuggestionMenuItem & {
	moduleDefinition?: AnyModuleDefinition;
	searchText: string;
	section: "quick" | "module";
	secondaryText?: string;
	valueText?: string;
};

type CommandPaletteState = {
	query: string;
	cursorOffset: number;
};

type SuggestionMenuHitbox = {
	index: number;
	xStart: number;
	xEnd: number;
	y: number;
};

type ActivityState<THelpers extends object> = {
	id: string;
	title: string;
	runtime: ModuleRuntime<THelpers>;
	outputStack: OutputStack;
	initialHistory: string[];
};

type ConsoleViewport = {
	visibleEntries: RenderedViewportLine[];
	hiddenAboveCount: number;
	hiddenBelowCount: number;
	pageSize: number;
};

type RenderedViewportLine = {
	sourceIndex: number;
	id: string;
	text: string;
	tone: OutputTone;
};

type OutputSearchState = {
	query: string;
	cursorOffset: number;
	inputDraftValue: string;
	inputDraftCursorOffset: number;
	activeMatchIndex: number;
};

const CONSOLE_PALETTE = {
	background: "#000000",
	text: "#f5f5f5",
	muted: "#8f8f8f",
	divider: "#3a3a3a",
	accent: "#7dd3fc",
	info: "#86efac",
	error: "#fca5a5",
	searchMatchBackground: "#0c1820",
} as const;

const consoleTheme = extendTheme(defaultTheme, {
	components: {
		Spinner: {
			styles: {
				container: () => ({
					gap: 1,
					backgroundColor: CONSOLE_PALETTE.background,
				}),
				frame: () => ({
					color: CONSOLE_PALETTE.accent,
					backgroundColor: CONSOLE_PALETTE.background,
				}),
				label: () => ({
					color: CONSOLE_PALETTE.muted,
					backgroundColor: CONSOLE_PALETTE.background,
				}),
			},
		},
	},
});

const TERMINAL_MOUSE_ENABLE = "\u001B[?1000h\u001B[?1006h";
const TERMINAL_MOUSE_DISABLE = "\u001B[?1000l\u001B[?1006l";
const SNAPSHOT_SYNC_DEBOUNCE_MS = 180;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;
const ACTIVITY_TAB_CLOSE_LABEL = " x ";
const ACTIVITY_TAB_CREATE_LABEL = " + ";

function truncateText(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) {
		return text;
	}

	if (maxWidth <= 1) {
		return text.slice(0, maxWidth);
	}

	return `${text.slice(0, maxWidth - 1)}…`;
}

function createSingleLineInputViewport(value: string, cursorOffset: number, maxWidth: number): {
	visibleValue: string;
	visibleCursorOffset: number;
	hasHiddenPrefix: boolean;
	hasHiddenSuffix: boolean;
} {
	const safeWidth = Math.max(1, maxWidth);
	const boundedCursorOffset = Math.max(0, Math.min(cursorOffset, value.length));

	if (value.length <= safeWidth) {
		return {
			visibleValue: value,
			visibleCursorOffset: boundedCursorOffset,
			hasHiddenPrefix: false,
			hasHiddenSuffix: false,
		};
	}

	const baseVisibleWidth = Math.max(1, safeWidth - 2);
	let start = Math.max(0, Math.min(boundedCursorOffset - Math.floor(baseVisibleWidth / 2), value.length - baseVisibleWidth));
	let end = Math.min(value.length, start + baseVisibleWidth);
	start = Math.max(0, end - baseVisibleWidth);

	const hasHiddenPrefix = start > 0;
	const hasHiddenSuffix = end < value.length;
	const visibleCore = value.slice(start, end);
	const visibleValue = `${hasHiddenPrefix ? "…" : ""}${visibleCore}${hasHiddenSuffix ? "…" : ""}`;
	const visibleCursorOffset = Math.max(
		0,
		Math.min(visibleValue.length, boundedCursorOffset - start + (hasHiddenPrefix ? 1 : 0)),
	);

	return {
		visibleValue,
		visibleCursorOffset,
		hasHiddenPrefix,
		hasHiddenSuffix,
	};
}

function toneFromConsoleKind(kind: "command" | "output" | "info" | "error"): OutputTone {
	switch (kind) {
		case "command":
			return "command";
		case "info":
			return "info";
		case "error":
			return "error";
		default:
			return "output";
	}
}

function suggestionKindColor(kind: ModuleConsoleSuggestionItem["kind"]): string {
	switch (kind) {
		case "module":
			return CONSOLE_PALETTE.info;
		case "session":
			return CONSOLE_PALETTE.error;
		case "activity":
			return CONSOLE_PALETTE.accent;
		default:
			return CONSOLE_PALETTE.muted;
	}
}

function normalizeSearchText(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.toLowerCase()
		.trim();
}

function tokenizeSearchQuery(value: string): string[] {
	return normalizeSearchText(value)
		.split(/\s+/u)
		.filter(Boolean);
}

function summarizeModuleParams(params: readonly ModuleConsoleParam[] | undefined): string {
	if (!params || params.length === 0) {
		return "";
	}

	const visibleNames = params.slice(0, 3).map(param => param.name);
	const remainingCount = params.length - visibleNames.length;
	const summary = visibleNames.join(", ");
	return remainingCount > 0
		? `params: ${summary} +${remainingCount}`
		: `params: ${summary}`;
}

function getConsoleParamPlaceholder(param: ModuleConsoleParam): { value: string; cursorOffset: number } {
	switch (param.valueType) {
		case "number":
			return { value: "0", cursorOffset: 0 };
		case "boolean":
			return { value: "true", cursorOffset: 0 };
		case "json":
			return { value: "{}", cursorOffset: 1 };
		case "string[]":
			return { value: "[]", cursorOffset: 1 };
		case "string":
		default:
			return { value: '""', cursorOffset: 1 };
	}
}

function getModulePickerInsertState(moduleDefinition: AnyModuleDefinition, moduleExpression: string): {
	value: string;
	cursorOffset?: number;
} {
	const firstParam = moduleDefinition.consoleParams?.[0];
	if (!firstParam) {
		return { value: moduleExpression };
	}

	const placeholder = getConsoleParamPlaceholder(firstParam);
	const prefix = `${moduleExpression}({ ${firstParam.name}: `;
	return {
		value: `${prefix}${placeholder.value} })`,
		cursorOffset: prefix.length + placeholder.cursorOffset,
	};
}

function formatModuleHint(moduleDefinition: AnyModuleDefinition): string {
	return [
		moduleDefinition.id,
		moduleDefinition.description ?? "",
		summarizeModuleParams(moduleDefinition.consoleParams),
	].filter(Boolean).join(" • ");
}

function isQuickCommandSuggestionComplete(value: string): boolean {
	return value.length > 0
		&& !value.endsWith(" ")
		&& value !== "$."
		&& value !== "await $.";
}

function scoreModulePickerItem(item: ModulePickerItem, queryTokens: readonly string[]): number {
	if (queryTokens.length === 0) {
		return 0;
	}

	const normalizedModuleId = normalizeSearchText(item.moduleDefinition.id);
	const normalizedExpression = normalizeSearchText(item.value);
	let score = 0;

	for (const token of queryTokens) {
		if (normalizedModuleId === token) {
			score += 60;
			continue;
		}

		if (normalizedModuleId.startsWith(token)) {
			score += 32;
			continue;
		}

		if (normalizedExpression.startsWith(token)) {
			score += 24;
			continue;
		}

		if (normalizedModuleId.includes(token)) {
			score += 16;
			continue;
		}

		if (item.searchText.includes(token)) {
			score += 8;
			continue;
		}

		return -1;
	}

	return score;
}

function scoreCommandPaletteItem(item: CommandPaletteItem, queryTokens: readonly string[]): number {
	if (queryTokens.length === 0) {
		return item.section === "quick" ? 8 : 0;
	}

	const normalizedLabel = normalizeSearchText(item.label ?? item.value);
	const normalizedValue = normalizeSearchText(item.valueText ?? item.value);
	let score = item.section === "quick" ? 4 : 0;

	for (const token of queryTokens) {
		if (normalizedLabel === token) {
			score += 60;
			continue;
		}

		if (normalizedLabel.startsWith(token)) {
			score += 32;
			continue;
		}

		if (normalizedValue.startsWith(token)) {
			score += 24;
			continue;
		}

		if (normalizedLabel.includes(token)) {
			score += 16;
			continue;
		}

		if (item.searchText.includes(token)) {
			score += 8;
			continue;
		}

		return -1;
	}

	return score;
}

function findFocusedModuleFromInput(inputValue: string, modulePickerItems: readonly ModulePickerItem[]): ModulePickerItem | null {
	const trimmedInputValue = inputValue.trimStart().replace(/^await\s+/u, "");
	if (trimmedInputValue.length === 0) {
		return null;
	}

	let bestMatch: ModulePickerItem | null = null;
	for (const item of modulePickerItems) {
		if (!trimmedInputValue.startsWith(item.moduleExpression)) {
			continue;
		}

		if (!bestMatch || item.moduleExpression.length > bestMatch.moduleExpression.length) {
			bestMatch = item;
		}
	}

	return bestMatch;
}

function isCommandPaletteShortcut(input: string, key: { ctrl: boolean }): boolean {
	return (key.ctrl && input === "k") || input === "\u0000";
}


function entryColor(entry: RenderedViewportLine): string | undefined {
	switch (entry.tone) {
		case "command":
			return CONSOLE_PALETTE.accent;
		case "info":
			return CONSOLE_PALETTE.info;
		case "error":
			return CONSOLE_PALETTE.error;
		case "accent":
			return CONSOLE_PALETTE.accent;
		case "muted":
			return CONSOLE_PALETTE.muted;
		default:
			return CONSOLE_PALETTE.text;
	}
}

function estimateEntryRows(text: string, width: number): number {
	const safeWidth = Math.max(1, width);
	return Math.max(1, Math.ceil(text.length / safeWidth));
}

function createViewport(entries: RenderedViewportLine[], maxRows: number, width: number, offset: number): ConsoleViewport {
	if (entries.length === 0) {
		return {
			visibleEntries: [],
			hiddenAboveCount: 0,
			hiddenBelowCount: 0,
			pageSize: 1,
		};
	}

	const cappedOffset = Math.max(0, Math.min(offset, entries.length - 1));
	const endIndex = Math.max(0, entries.length - cappedOffset);
	const candidateEntries = entries.slice(0, endIndex);
	const visibleEntries: RenderedViewportLine[] = [];
	let consumedRows = 0;

	for (let index = candidateEntries.length - 1; index >= 0; index -= 1) {
		const entry = candidateEntries[index];
		if (!entry) {
			continue;
		}

		const entryRows = estimateEntryRows(entry.text, width);
		if (visibleEntries.length > 0 && consumedRows + entryRows > maxRows) {
			break;
		}

		visibleEntries.unshift(entry);
		consumedRows += entryRows;
	}

	return {
		visibleEntries,
		hiddenAboveCount: candidateEntries.length - visibleEntries.length,
		hiddenBelowCount: entries.length - candidateEntries.length,
		pageSize: Math.max(1, visibleEntries.length),
	};
}

function clampOutputOffset(offset: number, renderedLineCount: number): number {
	if (renderedLineCount <= 0) {
		return 0;
	}

	return Math.max(0, Math.min(offset, renderedLineCount - 1));
}

function getOutputOffsetForLine(lineIndex: number, renderedLineCount: number): number {
	return clampOutputOffset(renderedLineCount - 1 - lineIndex, renderedLineCount);
}

function getInlineSuggestion(inputValue: string, suggestions: readonly string[]): string {
	if (inputValue.length === 0) {
		return "";
	}

	const suggestion = suggestions.find(candidate => candidate.startsWith(inputValue) && candidate !== inputValue);
	if (!suggestion) {
		return "";
	}

	return suggestion.slice(inputValue.length);
}

function isWordCharacter(value: string): boolean {
	return value.length > 0 && WORD_CHARACTER_PATTERN.test(value);
}

function getPreviousWordBoundary(value: string, cursorOffset: number): number {
	let index = Math.max(0, Math.min(cursorOffset, value.length));

	while (index > 0 && !isWordCharacter(value.slice(index - 1, index))) {
		index -= 1;
	}

	while (index > 0 && isWordCharacter(value.slice(index - 1, index))) {
		index -= 1;
	}

	return index;
}

function getNextWordBoundary(value: string, cursorOffset: number): number {
	let index = Math.max(0, Math.min(cursorOffset, value.length));

	while (index < value.length && !isWordCharacter(value.slice(index, index + 1))) {
		index += 1;
	}

	while (index < value.length && isWordCharacter(value.slice(index, index + 1))) {
		index += 1;
	}

	return index;
}

function createActivityId(): string {
	return `activity:${Date.now()}:${crypto.randomUUID()}`;
}

function createActivityTitle(number: number): string {
	return `Activity ${number}`;
}

function getActivityTabLabel(tab: ActivityTabMeta, index: number): string {
	return ` ${index + 1}:${truncateText(`${tab.title}${tab.isRunning ? "*" : ""}`, 20)} `;
}

function createActivityTabLayout(activityTabs: readonly ActivityTabMeta[], contentWidth: number): {
	hitboxes: ActivityTabHitbox[];
	rowCount: number;
} {
	const hitboxes: ActivityTabHitbox[] = [];
	const usableWidth = Math.max(1, contentWidth);
	const startColumn = 2;
	const startRow = 1;
	let row = startRow;
	let offset = 0;

	for (const [index, tab] of activityTabs.entries()) {
		const label = getActivityTabLabel(tab, index);
		const tabWidth = label.length + ACTIVITY_TAB_CLOSE_LABEL.length;

		if (offset > 0 && offset + tabWidth > usableWidth) {
			row += 1;
			offset = 0;
		}

		const xStart = startColumn + offset;
		hitboxes.push({
			kind: "select",
			activityId: tab.id,
			xStart,
			xEnd: xStart + label.length - 1,
			y: row,
		});
		hitboxes.push({
			kind: "close",
			activityId: tab.id,
			xStart: xStart + label.length,
			xEnd: xStart + tabWidth - 1,
			y: row,
		});

		offset += tabWidth + 1;
	}

	if (offset > 0 && offset + ACTIVITY_TAB_CREATE_LABEL.length > usableWidth) {
		row += 1;
		offset = 0;
	}

	const createButtonStart = startColumn + offset;
	hitboxes.push({
		kind: "create",
		xStart: createButtonStart,
		xEnd: createButtonStart + ACTIVITY_TAB_CREATE_LABEL.length - 1,
		y: row,
	});

	return {
		hitboxes,
		rowCount: Math.max(1, row - startRow + 1),
	};
}

function inferNextActivityNumber(activities: readonly { title: string }[]): number {
	const maxNumber = activities.reduce((currentMax, activity) => {
		const match = activity.title.match(/^Activity\s+(\d+)$/u);
		const nextNumber = match?.[1] ? Number(match[1]) : Number.NaN;
		if (!Number.isFinite(nextNumber)) {
			return currentMax;
		}

		return Math.max(currentMax, nextNumber);
	}, 0);

	return Math.max(activities.length + 1, maxNumber + 1);
}

function createActivitySessionEntity(text: string): OutputEntity {
	return createTextEntity(text, {
		tone: "info",
		meta: { persist: false },
	});
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

function areOutputEntityArraysEqual(left: readonly OutputEntity[], right: readonly OutputEntity[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

function areActivitySnapshotsEqual(left: ActivityConsoleSnapshot, right: ActivityConsoleSnapshot): boolean {
	return left.currentModuleId === right.currentModuleId
		&& areStringArraysEqual(left.history, right.history)
		&& areOutputEntityArraysEqual(left.outputItems, right.outputItems);
}

function createActivityState<THelpers extends object>(
	baseRuntime: ModuleRuntime<THelpers>,
	options: { id?: string; title: string; snapshot?: ActivityConsoleSnapshot | null },
): ActivityState<THelpers> {
	const outputStack = new OutputStack();
	const runtime = baseRuntime.fork({ outputStack });
	const initialHistory = runtime.restoreActivitySession(options.snapshot ?? null);

	return {
		id: options.id ?? createActivityId(),
		title: options.title,
		runtime,
		outputStack,
		initialHistory,
	};
}

function buildConsoleSessionSnapshot<THelpers extends object>(
	activities: readonly ActivityState<THelpers>[],
	activitySnapshots: Readonly<Record<string, ActivityConsoleSnapshot>>,
	activeActivityId: string | null,
): ConsoleSessionSnapshot {
	return {
		activeActivityId,
		activities: activities.map(activity => ({
			id: activity.id,
			title: activity.title,
			...(activitySnapshots[activity.id] ?? activity.runtime.createActivitySessionSnapshot(activity.initialHistory)),
		})),
	};
}

function initializeActivities<THelpers extends object>(
	baseRuntime: ModuleRuntime<THelpers>,
	initialSessionState: ConsoleSessionState | null,
): {
	activities: ActivityState<THelpers>[];
	activitySnapshots: Record<string, ActivityConsoleSnapshot>;
	activeActivityId: string | null;
	nextActivityNumber: number;
} {
	const savedActivities = initialSessionState?.activities ?? [];
	const activities = savedActivities.length > 0
		? savedActivities.map(savedActivity => createActivityState(baseRuntime, {
			id: savedActivity.id,
			title: savedActivity.title,
			snapshot: savedActivity,
		}))
		: [createActivityState(baseRuntime, { title: createActivityTitle(1) })];

	const activitySnapshots = Object.fromEntries(
		activities.map(activity => [activity.id, activity.runtime.createActivitySessionSnapshot(activity.initialHistory)]),
	) as Record<string, ActivityConsoleSnapshot>;

	const activeActivityId = initialSessionState?.activeActivityId
		&& activities.some(activity => activity.id === initialSessionState.activeActivityId)
		? initialSessionState.activeActivityId
		: (activities[0]?.id ?? null);

	return {
		activities,
		activitySnapshots,
		activeActivityId,
		nextActivityNumber: inferNextActivityNumber(activities),
	};
}

function RuntimeInkConsole<THelpers extends object>({
	activityId,
	activityTabs,
	activityTitle,
	active,
	onActivityCommand,
	onCloseActivity,
	onSelectActivity,
	onRunningChange,
	onSessionCommand,
	onSnapshotChange,
	outputStack,
	runtime,
	fullscreen,
	initialHistory,
}: RuntimeInkConsoleProps<THelpers>): React.JSX.Element | null {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const windowSize = useWindowSize();
	const [interactiveApp, setInteractiveApp] = useState<any>(() => runtime.getCurrentApplication());
	const [items, setItems] = useState<OutputEntity[]>(() => [...outputStack.snapshot()]);
	const [inputValue, setInputValue] = useState("");
	const [inputCursorOffset, setInputCursorOffset] = useState(0);
	const [history, setHistory] = useState<string[]>(() => [...initialHistory]);
	const [historyNavigation, setHistoryNavigation] = useState<HistoryNavigationState | null>(null);
	const [tabCompletion, setTabCompletion] = useState<TabCompletionState | null>(null);
	const [outputOffset, setOutputOffset] = useState(0);
	const [isRunning, setIsRunning] = useState(false);
	const [showSpinner, setShowSpinner] = useState(false);
	const [selectionMode, setSelectionMode] = useState(false);
	const [searchState, setSearchState] = useState<OutputSearchState | null>(null);
	const [commandPaletteState, setCommandPaletteState] = useState<CommandPaletteState | null>(null);
	const [suggestionSelectionIndex, setSuggestionSelectionIndex] = useState(0);
	const [suggestionsSuppressedByCursorMove, setSuggestionsSuppressedByCursorMove] = useState(false);
	const latestHistoryRef = useRef(history);

	const moduleDefinitions = useMemo(() => runtime.listModules(), [runtime]);
	const suggestionItems = useMemo(() => runtime.getConsoleSuggestionItems(inputValue), [runtime, inputValue]);
	const suggestions = useMemo(() => runtime.getConsoleSuggestions(inputValue), [runtime, inputValue]);
	const currentModule = runtime.getCurrentModule();
	const commandPaletteOpen = commandPaletteState !== null;
	const commandPaletteQuery = commandPaletteState?.query ?? "";
	const commandPaletteCursorOffset = commandPaletteState?.cursorOffset ?? 0;
	const modulePickerItems = useMemo<ModulePickerItem[]>(
		() => moduleDefinitions.map(moduleDefinition => {
			const moduleExpression = runtime.getModuleJsExpression(moduleDefinition.id);
			const insertState = getModulePickerInsertState(moduleDefinition, moduleExpression);
			return {
				value: insertState.value,
				label: moduleDefinition.id,
				detail: [
					moduleDefinition.category ?? "module",
					moduleDefinition.description ?? "",
					summarizeModuleParams(moduleDefinition.consoleParams),
				].filter(Boolean).join(" • "),
				kind: "module",
				action: {
					kind: "insert-input",
					cursorOffset: insertState.cursorOffset,
				},
				moduleDefinition,
				moduleExpression,
				searchText: normalizeSearchText([
					moduleDefinition.id,
					moduleDefinition.category ?? "module",
					moduleDefinition.description ?? "",
					moduleExpression,
					summarizeModuleParams(moduleDefinition.consoleParams),
				].join(" ")),
			};
		}),
		[moduleDefinitions, runtime],
	);
	const moduleContextPaletteItems = useMemo<CommandPaletteItem[]>(
		() => moduleDefinitions.map(moduleDefinition => ({
			value: `use ${moduleDefinition.id}`,
			label: moduleDefinition.id,
			detail: [
				"Enter module context",
				moduleDefinition.description ?? "",
				summarizeModuleParams(moduleDefinition.consoleParams),
			].filter(Boolean).join(" • "),
			kind: "module",
			action: {
				kind: "submit-command",
				command: `use ${moduleDefinition.id}`,
			},
			moduleDefinition,
			searchText: normalizeSearchText([
				moduleDefinition.id,
				"enter module context use",
				moduleDefinition.description ?? "",
				summarizeModuleParams(moduleDefinition.consoleParams),
			].join(" ")),
			section: "module",
			secondaryText: moduleDefinition.description ?? "",
			valueText: moduleDefinition.id,
		})),
		[moduleDefinitions],
	);
	const moduleRunPaletteItems = useMemo<CommandPaletteItem[]>(
		() => modulePickerItems.map(item => ({
			...item,
			label: `Run ${item.label}`,
			detail: ["Insert run template", item.detail ?? ""].filter(Boolean).join(" • "),
			searchText: normalizeSearchText([
				item.label ?? item.value,
				"run execute template",
				item.detail ?? "",
				item.moduleExpression,
			].join(" ")),
			section: "module",
			secondaryText: item.detail ?? "",
			valueText: item.moduleExpression,
		})),
		[modulePickerItems],
	);
	const quickCommandPaletteItems = useMemo<CommandPaletteItem[]>(
		() => {
			const items = runtime.getConsoleSuggestionItems("").map((item) => ({
				...item,
				action: isQuickCommandSuggestionComplete(item.value)
					? { kind: "submit-command" as const, command: item.value }
					: { kind: "insert-input" as const },
				searchText: normalizeSearchText([
					item.value,
					item.label ?? "",
					item.detail ?? "",
				].join(" ")),
				section: "quick" as const,
				secondaryText: item.detail ?? "",
				valueText: item.value,
			}));

			if (!currentModule) {
				return items;
			}

			return [{
				value: "use clear",
				label: `Exit ${currentModule.id}`,
				detail: "Leave the current module context",
				kind: "command",
				action: {
					kind: "submit-command",
					command: "use clear",
				},
				searchText: normalizeSearchText(`exit leave back root clear ${currentModule.id}`),
				section: "quick",
				secondaryText: "Leave the current module context",
				valueText: currentModule.id,
			}, ...items];
		},
		[currentModule, runtime],
	);
	const commandPaletteQueryTokens = useMemo(() => tokenizeSearchQuery(commandPaletteQuery), [commandPaletteQuery]);
	const commandPaletteItems = useMemo<CommandPaletteItem[]>(
		() => [
			...quickCommandPaletteItems,
			...moduleContextPaletteItems,
			...moduleRunPaletteItems,
		],
		[moduleContextPaletteItems, moduleRunPaletteItems, quickCommandPaletteItems],
	);
	const displaySuggestions = useMemo(
		() => commandPaletteOpen || suggestionsSuppressedByCursorMove || inputValue.endsWith(" ") ? [] : suggestions,
		[commandPaletteOpen, inputValue, suggestions, suggestionsSuppressedByCursorMove],
	);
	const consolePrompt = runtime.getConsolePrompt();
	const contentWidth = Math.max(1, windowSize.columns - 2);
	const tabLayout = useMemo(() => createActivityTabLayout(activityTabs, contentWidth), [activityTabs, contentWidth]);
	const headerRows = tabLayout.rowCount;
	const footerRows = 2;
	const reservedRows = headerRows + footerRows + 4;
	const outputRows = Math.max(6, windowSize.rows - reservedRows);
	const outputSectionRows = outputRows + 2;
	const outputWidth = Math.max(20, contentWidth);
	const commandPaletteVisibleLimit = Math.max(8, Math.min(14, outputRows + 2));
	const filteredCommandPaletteItems = useMemo(() => {
		if (commandPaletteQueryTokens.length === 0) {
			const quickLimit = Math.min(6, commandPaletteVisibleLimit);
			const moduleLimit = Math.max(0, commandPaletteVisibleLimit - quickLimit);
			return [
				...quickCommandPaletteItems.slice(0, quickLimit),
				...moduleContextPaletteItems.slice(0, moduleLimit),
			];
		}

		return commandPaletteItems
			.map(item => ({ item, score: scoreCommandPaletteItem(item, commandPaletteQueryTokens) }))
			.filter(entry => entry.score >= 0)
			.sort((left, right) => right.score - left.score || left.item.value.localeCompare(right.item.value))
			.slice(0, commandPaletteVisibleLimit)
			.map(entry => entry.item);
	}, [commandPaletteItems, commandPaletteQueryTokens, commandPaletteVisibleLimit, moduleContextPaletteItems, quickCommandPaletteItems]);
	const modulePickerVisibleLimit = Math.max(8, Math.min(20, outputRows - 1));
	const suggestionMenuItems = useMemo<SuggestionMenuItem[]>(
		() => {
			if (commandPaletteOpen) {
				return filteredCommandPaletteItems;
			}

			if (searchState || historyNavigation || suggestionsSuppressedByCursorMove || inputValue.trim().length === 0) {
				return [];
			}

			return suggestionItems;
		},
		[commandPaletteOpen, filteredCommandPaletteItems, historyNavigation, inputValue, searchState, suggestionItems, suggestionsSuppressedByCursorMove],
	);
	const modulePickerQueryTokens = useMemo(() => tokenizeSearchQuery(inputValue), [inputValue]);
	const filteredModulePickerItems = useMemo(() => {
		if (modulePickerQueryTokens.length === 0) {
			return modulePickerItems.slice(0, modulePickerVisibleLimit);
		}

		return modulePickerItems
			.map(item => ({ item, score: scoreModulePickerItem(item, modulePickerQueryTokens) }))
			.filter(entry => entry.score >= 0)
			.sort((left, right) => right.score - left.score || left.item.moduleDefinition.id.localeCompare(right.item.moduleDefinition.id))
			.slice(0, modulePickerVisibleLimit)
			.map(entry => entry.item);
	}, [modulePickerItems, modulePickerQueryTokens, modulePickerVisibleLimit]);
	const renderedLines = useMemo(
		() => renderOutputEntities(items, outputWidth).map((line, sourceIndex) => ({ ...line, sourceIndex })),
		[items, outputWidth],
	);
	const renderedLineTexts = useMemo(() => renderedLines.map(line => line.text), [renderedLines]);
	const inlineSuggestion = useMemo(() => getInlineSuggestion(inputValue, displaySuggestions), [displaySuggestions, inputValue]);
	const activeSuggestionIndex = suggestionMenuItems.length === 0
		? -1
		: Math.max(0, Math.min(suggestionSelectionIndex, suggestionMenuItems.length - 1));
	const activeSuggestionValue = activeSuggestionIndex >= 0
		? (suggestionMenuItems[activeSuggestionIndex]?.value ?? null)
		: null;
	const suggestionOverlayWidth = Math.min(outputWidth, Math.max(36, Math.floor(outputWidth * 0.76)));
	const suggestionOverlayLeft = Math.max(1, Math.min(consolePrompt.length + 2, Math.max(1, outputWidth - suggestionOverlayWidth + 1)));
	const suggestionOverlayBottom = 4;
	const commandPaletteWidth = Math.min(outputWidth, Math.max(52, Math.floor(outputWidth * 0.82)));
	const commandPaletteHeight = Math.min(windowSize.rows - 4, Math.max(6, filteredCommandPaletteItems.length + 4));
	const commandPaletteLeft = Math.max(1, Math.floor((outputWidth - commandPaletteWidth) / 2) + 1);
	const commandPaletteTop = Math.max(2, Math.floor((windowSize.rows - commandPaletteHeight) / 2));
	const commandPaletteInputWidth = Math.max(1, commandPaletteWidth - 4);
	const suggestionMenuHitboxes = useMemo<SuggestionMenuHitbox[]>(() => {
		if (suggestionMenuItems.length === 0) {
			return [];
		}

		if (commandPaletteOpen) {
			const xStart = Math.max(2, commandPaletteLeft + 1);
			const xEnd = Math.max(xStart, xStart + commandPaletteWidth - 3);
			const itemStartRow = commandPaletteTop + 3;

			return suggestionMenuItems.map((_, index) => ({
				index,
				xStart,
				xEnd,
				y: itemStartRow + index,
			}));
		}

		const overlayHeight = suggestionMenuItems.length + 3;
		const overlayBottomRow = Math.max(1, windowSize.rows - suggestionOverlayBottom);
		const overlayTopRow = Math.max(1, overlayBottomRow - overlayHeight + 1);
		const itemStartRow = overlayTopRow + 2;
		const xStart = Math.max(2, suggestionOverlayLeft + 1);
		const xEnd = Math.max(xStart, xStart + suggestionOverlayWidth - 3);

		return suggestionMenuItems.map((_, index) => ({
			index,
			xStart,
			xEnd,
			y: itemStartRow + index,
		}));
	}, [commandPaletteLeft, commandPaletteOpen, commandPaletteTop, commandPaletteWidth, suggestionMenuItems, suggestionOverlayBottom, suggestionOverlayLeft, suggestionOverlayWidth, windowSize.rows]);
	const searchMatchLineIndexes = useMemo(
		() => searchState ? findOutputLineMatches(renderedLineTexts, searchState.query) : [],
		[renderedLineTexts, searchState],
	);
	const activeSearchMatchIndex = searchState && searchMatchLineIndexes.length > 0
		? Math.min(searchState.activeMatchIndex, searchMatchLineIndexes.length - 1)
		: -1;
	const activeSearchLineIndex = activeSearchMatchIndex >= 0
		? (searchMatchLineIndexes[activeSearchMatchIndex] ?? null)
		: null;
	const searchMatchLineIndexSet = useMemo(() => new Set(searchMatchLineIndexes), [searchMatchLineIndexes]);
	const viewport = useMemo(
		() => createViewport(renderedLines, outputRows, outputWidth, outputOffset),
		[renderedLines, outputOffset, outputRows, outputWidth],
	);
	const divider = useMemo(() => "─".repeat(Math.max(8, windowSize.columns - 2)), [windowSize.columns]);

	useEffect(() => {
		setSuggestionSelectionIndex(previousIndex => {
			if (suggestionMenuItems.length === 0) {
				return 0;
			}

			return Math.max(0, Math.min(previousIndex, suggestionMenuItems.length - 1));
		});
	}, [suggestionMenuItems.length]);

	useEffect(() => {
		if (!searchState) {
			return;
		}

		if (searchMatchLineIndexes.length === 0) {
			if (searchState.activeMatchIndex === 0) {
				return;
			}

			setSearchState(previousState => previousState ? { ...previousState, activeMatchIndex: 0 } : previousState);
			return;
		}

		if (searchState.activeMatchIndex < searchMatchLineIndexes.length) {
			return;
		}

		setSearchState(previousState => previousState
			? { ...previousState, activeMatchIndex: searchMatchLineIndexes.length - 1 }
			: previousState);
	}, [searchMatchLineIndexes, searchState]);

	useEffect(() => {
		if (activeSearchLineIndex === null) {
			return;
		}

		setOutputOffset(previousOffset => {
			const nextOffset = getOutputOffsetForLine(activeSearchLineIndex, renderedLines.length);
			return previousOffset === nextOffset ? previousOffset : nextOffset;
		});
	}, [activeSearchLineIndex, renderedLines.length]);

	useEffect(() => {
		if (!active || !stdout.isTTY) {
			return;
		}

		stdout.write(selectionMode ? TERMINAL_MOUSE_DISABLE : TERMINAL_MOUSE_ENABLE);
		return () => {
			stdout.write(TERMINAL_MOUSE_DISABLE);
		};
	}, [active, selectionMode, stdout]);

	useEffect(() => {
		if (!isRunning) {
			setShowSpinner(false);
			return;
		}

		const timer = setTimeout(() => {
			setShowSpinner(true);
		}, 120);

		return () => {
			clearTimeout(timer);
		};
	}, [isRunning]);

	useEffect(() => {
		return outputStack.subscribe(nextItems => {
			setItems([...nextItems]);
		});
	}, [outputStack]);

	useEffect(() => {
		const unsubscribe = runtime.subscribeToApplication(setInteractiveApp);
		return () => {
			unsubscribe();
		};
	}, [runtime]);

	useEffect(() => {
		if (!active) {
			return;
		}

		return attachLoggerOutputSink(line => {
			if (line.length === 0) {
				return;
			}

			outputStack.appendText(line, { tone: "output" });
		});
	}, [active, outputStack]);

	useEffect(() => {
		latestHistoryRef.current = history;
	}, [history]);

	useEffect(() => {
		const timer = setTimeout(() => {
			onSnapshotChange(activityId, runtime.createActivitySessionSnapshot(history));
		}, SNAPSHOT_SYNC_DEBOUNCE_MS);

		return () => {
			clearTimeout(timer);
		};
	}, [activityId, currentModule, history, items, onSnapshotChange, runtime]);

	useEffect(() => {
		return () => {
			onSnapshotChange(activityId, runtime.createActivitySessionSnapshot(latestHistoryRef.current));
		};
	}, [activityId, onSnapshotChange, runtime]);

	useEffect(() => {
		onRunningChange(activityId, isRunning);
		return () => {
			onRunningChange(activityId, false);
		};
	}, [activityId, isRunning, onRunningChange]);

	const replaceInputValue = (nextValue: string, options: { cursorOffset?: number; suggestionSelectionIndex?: number } = {}): void => {
		setCommandPaletteState(null);
		setSuggestionsSuppressedByCursorMove(false);
		setInputValue(nextValue);
		setInputCursorOffset(Math.max(0, Math.min(options.cursorOffset ?? nextValue.length, nextValue.length)));
		setSuggestionSelectionIndex(Math.max(0, options.suggestionSelectionIndex ?? 0));
	};

	const clearInputNavigation = (): void => {
		setHistoryNavigation(null);
		setCommandPaletteState(null);
		setTabCompletion(null);
		setSuggestionSelectionIndex(0);
	};

	const closeCommandPalette = (): void => {
		setHistoryNavigation(null);
		setCommandPaletteState(null);
		setTabCompletion(null);
		setSuggestionSelectionIndex(0);
	};

	const openCommandPalette = (): void => {
		const nextQuery = inputValue.trim();
		setHistoryNavigation(null);
		setSearchState(null);
		setCommandPaletteState({
			query: nextQuery,
			cursorOffset: nextQuery.length,
		});
		setTabCompletion(null);
		setSuggestionSelectionIndex(0);
	};

	const replaceCommandPaletteQuery = (nextQuery: string, nextCursorOffset = nextQuery.length): void => {
		setCommandPaletteState(previousState => previousState
			? {
				query: nextQuery,
				cursorOffset: Math.max(0, Math.min(nextQuery.length, nextCursorOffset)),
			}
			: previousState);
		setSuggestionSelectionIndex(0);
	};

	const moveCommandPaletteCursor = (delta: number): void => {
		setCommandPaletteState(previousState => previousState
			? {
				...previousState,
				cursorOffset: Math.max(0, Math.min(previousState.query.length, previousState.cursorOffset + delta)),
			}
			: previousState);
	};

	const moveCommandPaletteCursorByWord = (direction: "previous" | "next"): void => {
		setCommandPaletteState(previousState => {
			if (!previousState) {
				return previousState;
			}

			const nextCursorOffset = direction === "previous"
				? getPreviousWordBoundary(previousState.query, previousState.cursorOffset)
				: getNextWordBoundary(previousState.query, previousState.cursorOffset);

			return nextCursorOffset === previousState.cursorOffset
				? previousState
				: {
					...previousState,
					cursorOffset: nextCursorOffset,
				};
		});
	};

	const insertCommandPaletteText = (text: string): void => {
		if (!commandPaletteState || text.length === 0) {
			return;
		}

		const nextQuery = commandPaletteState.query.slice(0, commandPaletteState.cursorOffset)
			+ text
			+ commandPaletteState.query.slice(commandPaletteState.cursorOffset);
		replaceCommandPaletteQuery(nextQuery, commandPaletteState.cursorOffset + text.length);
	};

	const deleteCommandPaletteCharacter = (direction: "backward" | "forward"): void => {
		if (!commandPaletteState) {
			return;
		}

		if (direction === "backward") {
			if (commandPaletteState.cursorOffset === 0) {
				return;
			}

			const nextQuery = commandPaletteState.query.slice(0, commandPaletteState.cursorOffset - 1)
				+ commandPaletteState.query.slice(commandPaletteState.cursorOffset);
			replaceCommandPaletteQuery(nextQuery, commandPaletteState.cursorOffset - 1);
			return;
		}

		if (commandPaletteState.cursorOffset >= commandPaletteState.query.length) {
			return;
		}

		const nextQuery = commandPaletteState.query.slice(0, commandPaletteState.cursorOffset)
			+ commandPaletteState.query.slice(commandPaletteState.cursorOffset + 1);
		replaceCommandPaletteQuery(nextQuery, commandPaletteState.cursorOffset);
	};

	const deleteCommandPaletteWord = (direction: "backward" | "forward"): void => {
		if (!commandPaletteState) {
			return;
		}

		if (direction === "backward") {
			const nextCursorOffset = getPreviousWordBoundary(commandPaletteState.query, commandPaletteState.cursorOffset);
			if (nextCursorOffset === commandPaletteState.cursorOffset) {
				return;
			}

			const nextQuery = commandPaletteState.query.slice(0, nextCursorOffset)
				+ commandPaletteState.query.slice(commandPaletteState.cursorOffset);
			replaceCommandPaletteQuery(nextQuery, nextCursorOffset);
			return;
		}

		const nextCursorOffset = getNextWordBoundary(commandPaletteState.query, commandPaletteState.cursorOffset);
		if (nextCursorOffset === commandPaletteState.cursorOffset) {
			return;
		}

		const nextQuery = commandPaletteState.query.slice(0, commandPaletteState.cursorOffset)
			+ commandPaletteState.query.slice(nextCursorOffset);
		replaceCommandPaletteQuery(nextQuery, commandPaletteState.cursorOffset);
	};

	const moveSuggestionSelection = (direction: "next" | "previous"): boolean => {
		if (suggestionMenuItems.length === 0) {
			return false;
		}

		setHistoryNavigation(null);
		setTabCompletion(null);
		setSuggestionSelectionIndex(previousIndex => {
			const safeIndex = Math.max(0, Math.min(previousIndex, suggestionMenuItems.length - 1));
			return moveSearchMatch(safeIndex, suggestionMenuItems.length, direction);
		});
		return true;
	};

	const applySuggestionItem = (selectedSuggestion: SuggestionMenuItem, selectionIndex: number): boolean => {
		if (selectedSuggestion.action?.kind === "submit-command") {
			if (isRunning) {
				return false;
			}

			closeCommandPalette();
			void submitCommand(selectedSuggestion.action.command);
			return true;
		}

		if (selectedSuggestion.action?.kind === "insert-input") {
			replaceInputValue(selectedSuggestion.value, {
				cursorOffset: selectedSuggestion.action.cursorOffset,
				suggestionSelectionIndex: selectionIndex,
			});
			appendTransientInfo(`Inserted ${selectedSuggestion.label ?? selectedSuggestion.value}`);
			closeCommandPalette();
			return true;
		}

		if (selectedSuggestion.value === inputValue) {
			return false;
		}

		setHistoryNavigation(null);
		setTabCompletion(null);
		replaceInputValue(selectedSuggestion.value, { suggestionSelectionIndex: selectionIndex });
		return true;
	};

	const applySelectedSuggestion = (): boolean => {
		const selectedSuggestion = activeSuggestionIndex >= 0
			? suggestionMenuItems[activeSuggestionIndex]
			: null;

		if (!selectedSuggestion) {
			return false;
		}

		return applySuggestionItem(selectedSuggestion, activeSuggestionIndex);
	};

	const openSearchMode = (): void => {
		clearInputNavigation();
		setSearchState(previousState => {
			if (previousState) {
				if (searchMatchLineIndexes.length === 0) {
					return previousState;
				}

				return {
					...previousState,
					activeMatchIndex: moveSearchMatch(activeSearchMatchIndex >= 0 ? activeSearchMatchIndex : 0, searchMatchLineIndexes.length, "next"),
				};
			}

			return {
				query: "",
				cursorOffset: 0,
				inputDraftValue: inputValue,
				inputDraftCursorOffset: inputCursorOffset,
				activeMatchIndex: 0,
			};
		});
	};

	const closeSearchMode = (): void => {
		if (!searchState) {
			return;
		}

		setInputValue(searchState.inputDraftValue);
		setInputCursorOffset(searchState.inputDraftCursorOffset);
		setSearchState(null);
	};

	const replaceSearchQuery = (nextQuery: string, nextCursorOffset = nextQuery.length): void => {
		if (!searchState) {
			return;
		}

		const anchorLineIndex = clampOutputOffset(renderedLines.length - 1 - outputOffset, renderedLines.length);
		const matchLineIndexes = findOutputLineMatches(renderedLineTexts, nextQuery);
		setSearchState(previousState => previousState
			? {
				...previousState,
				query: nextQuery,
				cursorOffset: Math.max(0, Math.min(nextQuery.length, nextCursorOffset)),
				activeMatchIndex: matchLineIndexes.length === 0 ? 0 : resolveAnchoredMatchIndex(matchLineIndexes, anchorLineIndex),
			}
			: previousState);
	};

	const moveSearchCursor = (delta: number): void => {
		setSearchState(previousState => previousState
			? {
				...previousState,
				cursorOffset: Math.max(0, Math.min(previousState.query.length, previousState.cursorOffset + delta)),
			}
			: previousState);
	};

	const moveSearchCursorByWord = (direction: "previous" | "next"): void => {
		setSearchState(previousState => {
			if (!previousState) {
				return previousState;
			}

			const nextCursorOffset = direction === "previous"
				? getPreviousWordBoundary(previousState.query, previousState.cursorOffset)
				: getNextWordBoundary(previousState.query, previousState.cursorOffset);

			return nextCursorOffset === previousState.cursorOffset
				? previousState
				: {
					...previousState,
					cursorOffset: nextCursorOffset,
				};
		});
	};

	const insertSearchText = (text: string): void => {
		if (!searchState || text.length === 0) {
			return;
		}

		const nextQuery = searchState.query.slice(0, searchState.cursorOffset) + text + searchState.query.slice(searchState.cursorOffset);
		replaceSearchQuery(nextQuery, searchState.cursorOffset + text.length);
	};

	const deleteSearchCharacter = (direction: "backward" | "forward"): void => {
		if (!searchState) {
			return;
		}

		if (direction === "backward") {
			if (searchState.cursorOffset === 0) {
				return;
			}

			const nextQuery = searchState.query.slice(0, searchState.cursorOffset - 1) + searchState.query.slice(searchState.cursorOffset);
			replaceSearchQuery(nextQuery, searchState.cursorOffset - 1);
			return;
		}

		if (searchState.cursorOffset >= searchState.query.length) {
			return;
		}

		const nextQuery = searchState.query.slice(0, searchState.cursorOffset) + searchState.query.slice(searchState.cursorOffset + 1);
		replaceSearchQuery(nextQuery, searchState.cursorOffset);
	};

	const deleteSearchWord = (direction: "backward" | "forward"): void => {
		if (!searchState) {
			return;
		}

		if (direction === "backward") {
			const nextCursorOffset = getPreviousWordBoundary(searchState.query, searchState.cursorOffset);
			if (nextCursorOffset === searchState.cursorOffset) {
				return;
			}

			const nextQuery = searchState.query.slice(0, nextCursorOffset) + searchState.query.slice(searchState.cursorOffset);
			replaceSearchQuery(nextQuery, nextCursorOffset);
			return;
		}

		const nextCursorOffset = getNextWordBoundary(searchState.query, searchState.cursorOffset);
		if (nextCursorOffset === searchState.cursorOffset) {
			return;
		}

		const nextQuery = searchState.query.slice(0, searchState.cursorOffset) + searchState.query.slice(nextCursorOffset);
		replaceSearchQuery(nextQuery, searchState.cursorOffset);
	};

	const advanceSearchMatch = (direction: "next" | "previous"): void => {
		if (!searchState || searchMatchLineIndexes.length === 0) {
			return;
		}

		setSearchState(previousState => previousState
			? {
				...previousState,
				activeMatchIndex: moveSearchMatch(activeSearchMatchIndex >= 0 ? activeSearchMatchIndex : 0, searchMatchLineIndexes.length, direction),
			}
			: previousState);
	};

	const insertInputText = (text: string): void => {
		if (text.length === 0) {
			return;
		}

		if (suggestionsSuppressedByCursorMove && inputCursorOffset === inputValue.length && text.endsWith(" ")) {
			setSuggestionsSuppressedByCursorMove(false);
		}

		setInputValue(previousValue => {
			const nextValue = previousValue.slice(0, inputCursorOffset) + text + previousValue.slice(inputCursorOffset);
			setInputCursorOffset(inputCursorOffset + text.length);
			return nextValue;
		});
		clearInputNavigation();
	};

	const moveInputCursor = (delta: number): void => {
		const nextOffset = Math.max(0, Math.min(inputValue.length, inputCursorOffset + delta));
		if (nextOffset === inputCursorOffset) {
			return;
		}

		setSuggestionsSuppressedByCursorMove(true);
		setInputCursorOffset(nextOffset);
	};

	const moveInputCursorByWord = (direction: "previous" | "next"): void => {
		const nextOffset = direction === "previous"
			? getPreviousWordBoundary(inputValue, inputCursorOffset)
			: getNextWordBoundary(inputValue, inputCursorOffset);

		if (nextOffset === inputCursorOffset) {
			return;
		}

		setSuggestionsSuppressedByCursorMove(true);
		setInputCursorOffset(nextOffset);
	};

	const deleteInputCharacter = (direction: "backward" | "forward"): void => {
		if (direction === "backward") {
			if (inputCursorOffset === 0) {
				return;
			}

			setInputValue(previousValue => previousValue.slice(0, inputCursorOffset - 1) + previousValue.slice(inputCursorOffset));
			setInputCursorOffset(previousOffset => Math.max(0, previousOffset - 1));
			clearInputNavigation();
			return;
		}

		if (inputCursorOffset >= inputValue.length) {
			return;
		}

		setInputValue(previousValue => previousValue.slice(0, inputCursorOffset) + previousValue.slice(inputCursorOffset + 1));
		clearInputNavigation();
	};

	const deleteInputWord = (direction: "backward" | "forward"): void => {
		if (direction === "backward") {
			const nextCursorOffset = getPreviousWordBoundary(inputValue, inputCursorOffset);
			if (nextCursorOffset === inputCursorOffset) {
				return;
			}

			setInputValue(previousValue => previousValue.slice(0, nextCursorOffset) + previousValue.slice(inputCursorOffset));
			setInputCursorOffset(nextCursorOffset);
			clearInputNavigation();
			return;
		}

		const nextCursorOffset = getNextWordBoundary(inputValue, inputCursorOffset);
		if (nextCursorOffset === inputCursorOffset) {
			return;
		}

		setInputValue(previousValue => previousValue.slice(0, inputCursorOffset) + previousValue.slice(nextCursorOffset));
		clearInputNavigation();
	};

	const appendCommandEntries = (entries: ModuleConsoleCommandResult["entries"]): void => {
		if (entries.length === 0) {
			return;
		}

		outputStack.push(entries.map(entry => ({
			id: `console:${Date.now()}:${crypto.randomUUID()}`,
			createdAt: Date.now(),
			kind: "text" as const,
			lines: [entry.text],
			tone: toneFromConsoleKind(entry.kind),
			presentation: { kind: "plain-text" as const },
		})));
		setOutputOffset(0);
	};

	const appendEntities = (entities: OutputEntity[]): void => {
		if (entities.length === 0) {
			return;
		}

		outputStack.push(entities);
		setOutputOffset(0);
	};

	const appendTransientInfo = (text: string): void => {
		outputStack.push(createActivitySessionEntity(text));
		setOutputOffset(0);
	};

	const handleSessionCommand = async (command: ModuleConsoleCommandResult["sessionCommand"]): Promise<boolean> => {
		if (!command) {
			return false;
		}

		await onSessionCommand(command);
		return true;
	};

	const handleActivityCommand = (command: ModuleConsoleCommandResult["activityCommand"]): boolean => {
		if (!command) {
			return false;
		}

		onActivityCommand(command);
		return true;
	};

	const applyCommandResult = (result: ModuleConsoleCommandResult): void => {
		appendCommandEntries(result.entries);
		appendEntities(result.entities ?? []);
		if (result.shouldExit) {
			exit(result.exitCode);
		}
	};

	const submitCommand = async (value: string): Promise<void> => {
		const command = value.trim();
		if (command.length === 0) {
			replaceInputValue("");
			clearInputNavigation();
			return;
		}

		appendCommandEntries([{ kind: "command", text: `${consolePrompt}${command}` }]);
		setHistory(previousHistory => {
			if (previousHistory[previousHistory.length - 1] === command) {
				return previousHistory;
			}

			return [...previousHistory, command];
		});
		clearInputNavigation();
		replaceInputValue("");
		setIsRunning(true);

		try {
			const result = await runWithLoggerOutputSink(
				line => outputStack.appendText(line, { tone: "output" }),
				async () => await runtime.executeConsoleLine(command),
			);
			const handled = await handleSessionCommand(result.sessionCommand);
			if (!handled && !handleActivityCommand(result.activityCommand)) {
			applyCommandResult(result);
			}
		} finally {
			setIsRunning(false);
		}
	};

	useInput((input, key) => {
		if (key.ctrl && input === "t") {
			onActivityCommand("new");
			return;
		}

		if (key.ctrl && input === "n") {
			onActivityCommand("next");
			return;
		}

		if (key.ctrl && input === "p") {
			onActivityCommand("previous");
			return;
		}

		if (key.ctrl && input === "f") {
			openSearchMode();
			return;
		}

		if (isCommandPaletteShortcut(input, key)) {
			if (commandPaletteOpen) {
				closeCommandPalette();
				return;
			}

			openCommandPalette();
			return;
		}

		if (key.ctrl && input === "y") {
			setSelectionMode(previousMode => !previousMode);
			return;
		}

		const mouseEvent = parseTerminalMouseEvent(input);
		if (mouseEvent?.kind === "wheel") {
			setOutputOffset(previousOffset => clampOutputOffset(
				previousOffset + (mouseEvent.direction === "up" ? 1 : -1),
				renderedLines.length,
			));
			return;
		}

		if (mouseEvent?.kind === "mouse") {
			if (mouseEvent.action === "press" && mouseEvent.button === "left") {
				const clickedTab = tabLayout.hitboxes.find(hitbox =>
					hitbox.y === mouseEvent.y
					&& mouseEvent.x >= hitbox.xStart
					&& mouseEvent.x <= hitbox.xEnd,
				);

				if (clickedTab?.kind === "create") {
					onActivityCommand("new");
					return;
				}

				if (clickedTab?.kind === "close" && clickedTab.activityId) {
					onCloseActivity(clickedTab.activityId);
					return;
				}

				if (clickedTab?.kind === "select" && clickedTab.activityId && clickedTab.activityId !== activityId) {
					onSelectActivity(clickedTab.activityId);
					return;
				}
			}

			if (mouseEvent.button === "left") {
				const clickedSuggestion = suggestionMenuHitboxes.find(hitbox =>
					hitbox.y === mouseEvent.y
					&& mouseEvent.x >= hitbox.xStart
					&& mouseEvent.x <= hitbox.xEnd,
				);

				if (clickedSuggestion && !isRunning) {
					const suggestion = suggestionMenuItems[clickedSuggestion.index];
					if (suggestion) {
						setSuggestionSelectionIndex(clickedSuggestion.index);
						const applied = applySuggestionItem(suggestion, clickedSuggestion.index);
						if (!applied && suggestion.value === inputValue) {
							void submitCommand(inputValue);
						}
						return;
					}
				}

				const clickedPrompt = !searchState
					&& mouseEvent.y >= promptHitbox.yStart
					&& mouseEvent.y <= promptHitbox.yEnd
					&& mouseEvent.x >= promptHitbox.xStart
					&& mouseEvent.x <= promptHitbox.xEnd;

				if (clickedPrompt && !isRunning) {
					openCommandPalette();
					return;
				}
			}

			return;
		}

		if (commandPaletteOpen) {
			if (key.escape) {
				closeCommandPalette();
				return;
			}

			if (key.return) {
				applySelectedSuggestion();
				return;
			}

			if (key.tab || key.downArrow) {
				moveSuggestionSelection("next");
				return;
			}

			if (key.upArrow) {
				moveSuggestionSelection("previous");
				return;
			}

			if (key.ctrl && key.leftArrow) {
				moveCommandPaletteCursorByWord("previous");
				return;
			}

			if (key.ctrl && key.rightArrow) {
				moveCommandPaletteCursorByWord("next");
				return;
			}

			if (key.leftArrow) {
				moveCommandPaletteCursor(-1);
				return;
			}

			if (key.rightArrow) {
				moveCommandPaletteCursor(1);
				return;
			}

			if (key.backspace) {
				if (key.ctrl) {
					deleteCommandPaletteWord("backward");
					return;
				}

				deleteCommandPaletteCharacter("backward");
				return;
			}

			if (key.delete) {
				if (key.ctrl) {
					deleteCommandPaletteWord("forward");
					return;
				}

				deleteCommandPaletteCharacter("forward");
				return;
			}

			if (key.ctrl && input === "w") {
				deleteCommandPaletteWord("backward");
				return;
			}

			if (key.ctrl && input === "c") {
				return;
			}

			if (input.length > 0) {
				insertCommandPaletteText(input);
			}
			return;
		}

		if (key.pageUp) {
			setOutputOffset(previousOffset => clampOutputOffset(previousOffset + viewport.pageSize, renderedLines.length));
			return;
		}

		if (key.pageDown) {
			setOutputOffset(previousOffset => clampOutputOffset(previousOffset - viewport.pageSize, renderedLines.length));
			return;
		}

		if (key.home) {
			setOutputOffset(clampOutputOffset(renderedLines.length - viewport.pageSize, renderedLines.length));
			return;
		}

		if (key.end) {
			setOutputOffset(0);
			return;
		}

		if (searchState) {
			if (key.escape) {
				closeSearchMode();
				return;
			}

			if (key.return) {
				advanceSearchMatch(key.shift ? "previous" : "next");
				return;
			}

			if (key.upArrow) {
				advanceSearchMatch("previous");
				return;
			}

			if (key.downArrow) {
				advanceSearchMatch("next");
				return;
			}

			if (key.ctrl && key.leftArrow) {
				moveSearchCursorByWord("previous");
				return;
			}

			if (key.ctrl && key.rightArrow) {
				moveSearchCursorByWord("next");
				return;
			}

			if (key.leftArrow) {
				moveSearchCursor(-1);
				return;
			}

			if (key.rightArrow) {
				moveSearchCursor(1);
				return;
			}

			if (key.backspace) {
				if (key.ctrl) {
					deleteSearchWord("backward");
					return;
				}

				deleteSearchCharacter("backward");
				return;
			}

			if (key.delete) {
				if (key.ctrl) {
					deleteSearchWord("forward");
					return;
				}

				deleteSearchCharacter("forward");
				return;
			}

			if (key.ctrl && input === "w") {
				deleteSearchWord("backward");
				return;
			}

			if (key.ctrl && input === "c") {
				return;
			}

			if (input.length > 0) {
				insertSearchText(input);
			}
			return;
		}

		if (isRunning) {
			return;
		}

		if (inputValue.length === 0 && key.leftArrow) {
			onActivityCommand("previous");
			return;
		}

		if (inputValue.length === 0 && key.rightArrow) {
			onActivityCommand("next");
			return;
		}

		if (key.escape) {
			replaceInputValue("");
			clearInputNavigation();
			return;
		}

		if (key.return) {
			if (applySelectedSuggestion()) {
				return;
			}

			void submitCommand(inputValue);
			return;
		}

		if (key.tab) {
			const nextCompletion = resolveTabCompletion(inputValue, suggestions, tabCompletion);
			if (nextCompletion.completion && nextCompletion.nextValue) {
				const nextSuggestionSelectionIndex = suggestionMenuItems.findIndex(
					suggestion => suggestion.value === nextCompletion.nextValue,
				);
				setTabCompletion(nextCompletion.completion);
				setHistoryNavigation(null);
				replaceInputValue(nextCompletion.nextValue, {
					suggestionSelectionIndex: nextSuggestionSelectionIndex >= 0 ? nextSuggestionSelectionIndex : 0,
				});
			}
			return;
		}

		if (key.upArrow) {
			const nextStep = moveHistoryNavigation(history, inputValue, historyNavigation, "up");
			if (historyNavigation || inputValue.trim().length === 0) {
				if (!nextStep.navigation || nextStep.nextValue === null) {
					return;
				}

				setHistoryNavigation(nextStep.navigation);
				setTabCompletion(null);
				replaceInputValue(nextStep.nextValue);
				return;
			}

			if (moveSuggestionSelection("previous")) {
				return;
			}

			if (!nextStep.navigation || !nextStep.nextValue) {
				return;
			}

			setHistoryNavigation(nextStep.navigation);
			setTabCompletion(null);
			replaceInputValue(nextStep.nextValue);
			return;
		}

		if (key.downArrow) {
			if (!historyNavigation) {
				if (moveSuggestionSelection("next")) {
					return;
				}

				return;
			}

			const nextStep = moveHistoryNavigation(history, inputValue, historyNavigation, "down");
			if (nextStep.nextValue === null) {
				return;
			}

			setHistoryNavigation(nextStep.navigation);
			setTabCompletion(null);
			replaceInputValue(nextStep.nextValue);
			return;
		}

		if (key.ctrl && key.leftArrow) {
			moveInputCursorByWord("previous");
			return;
		}

		if (key.ctrl && key.rightArrow) {
			moveInputCursorByWord("next");
			return;
		}

		if (key.leftArrow) {
			moveInputCursor(-1);
			return;
		}

		if (key.rightArrow) {
			moveInputCursor(1);
			return;
		}

		if (key.backspace) {
			if (key.ctrl) {
				deleteInputWord("backward");
				return;
			}

			deleteInputCharacter("backward");
			return;
		}

		if (key.delete) {
			if (key.ctrl) {
				deleteInputWord("forward");
				return;
			}

			deleteInputCharacter("forward");
			return;
		}

		if (key.ctrl && input === "w") {
			if (inputValue.length === 0) {
				onActivityCommand("close");
				return;
			}

			deleteInputWord("backward");
			return;
		}

		if (key.ctrl && input === "c") {
			return;
		}

		if (input.length > 0) {
			insertInputText(input);
		}
	}, { isActive: active });

	const activePrompt = searchState ? "find/> " : consolePrompt;
	const activeInputValue = searchState?.query ?? inputValue;
	const activeInputCursorOffset = searchState?.cursorOffset ?? inputCursorOffset;
	const inputAreaWidth = Math.max(1, outputWidth - activePrompt.length - 1);
	const inputViewport = createSingleLineInputViewport(activeInputValue, activeInputCursorOffset, inputAreaWidth);
	const commandPaletteViewport = createSingleLineInputViewport(commandPaletteQuery, commandPaletteCursorOffset, Math.max(1, commandPaletteInputWidth - 2));
	const activeInlineSuggestion = searchState
		? ""
		: truncateText(inlineSuggestion, Math.max(0, inputAreaWidth - inputViewport.visibleValue.length));
	const cursorCharacter = inputViewport.visibleValue[inputViewport.visibleCursorOffset] ?? " ";
	const inputPrefix = inputViewport.visibleValue.slice(0, inputViewport.visibleCursorOffset);
	const inputSuffix = inputViewport.visibleValue.slice(
		inputViewport.visibleCursorOffset + (inputViewport.visibleCursorOffset < inputViewport.visibleValue.length ? 1 : 0),
	);
	const showPlaceholder = activeInputValue.length === 0;
	const inputPlaceholder = searchState
		? "earch output..."
		: currentModule
			? "ype run(), use clear, or Ctrl+K"
			: "ype help, or press Ctrl+K for the command palette";
	const commandPaletteCursorCharacter = commandPaletteViewport.visibleValue[commandPaletteViewport.visibleCursorOffset] ?? " ";
	const commandPaletteInputPrefix = commandPaletteViewport.visibleValue.slice(0, commandPaletteViewport.visibleCursorOffset);
	const commandPaletteInputSuffix = commandPaletteViewport.visibleValue.slice(
		commandPaletteViewport.visibleCursorOffset + (commandPaletteViewport.visibleCursorOffset < commandPaletteViewport.visibleValue.length ? 1 : 0),
	);
	const showCommandPalettePlaceholder = commandPaletteQuery.length === 0;

	const viewportHint = [
		viewport.hiddenAboveCount > 0 ? `${viewport.hiddenAboveCount} older hidden` : null,
		viewport.hiddenBelowCount > 0 ? `${viewport.hiddenBelowCount} newer hidden` : null,
	].filter(Boolean).join(" • ");
	const promptHitbox = {
		xStart: 2,
		xEnd: Math.max(2, outputWidth + 1),
		yStart: Math.max(1, windowSize.rows),
		yEnd: Math.max(1, windowSize.rows),
	};
	const activityStatusLabel = showSpinner
		? "Running"
		: searchState
			? "Search"
			: commandPaletteOpen
				? "Command palette"
				: selectionMode
					? "Selection mode"
				: (inputValue.trim().length > 0 ? "Typing" : "Mouse mode");

	if (!active) {
		return null;
	}

	return (
		<ThemeProvider theme={consoleTheme}>
			<Box
				flexDirection="column"
				height={fullscreen ? windowSize.rows : undefined}
				width={windowSize.columns}
				paddingX={1}
				backgroundColor={CONSOLE_PALETTE.background}
			>
				<Box flexDirection="column" height={headerRows} overflow="hidden" backgroundColor={CONSOLE_PALETTE.background}>
					<Box flexWrap="wrap" backgroundColor={CONSOLE_PALETTE.background}>
						{activityTabs.map((tab, index) => (
							<Box key={tab.id} marginRight={1} backgroundColor={CONSOLE_PALETTE.background}>
								<Box backgroundColor={tab.active ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.divider}>
									<Text color={tab.active ? CONSOLE_PALETTE.background : CONSOLE_PALETTE.text} backgroundColor={tab.active ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.divider}>
										{getActivityTabLabel(tab, index)}
									</Text>
								</Box>
								<Box backgroundColor={tab.active ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.divider}>
									<Text color={CONSOLE_PALETTE.error} backgroundColor={tab.active ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.divider}>
										{ACTIVITY_TAB_CLOSE_LABEL}
									</Text>
								</Box>
							</Box>
						))}
						<Box backgroundColor={CONSOLE_PALETTE.divider}>
							<Text color={CONSOLE_PALETTE.accent} backgroundColor={CONSOLE_PALETTE.divider}>{ACTIVITY_TAB_CREATE_LABEL}</Text>
						</Box>
					</Box>
				</Box>
				<Text color={CONSOLE_PALETTE.divider} backgroundColor={CONSOLE_PALETTE.background}>{divider}</Text>

				<Box flexDirection="column" height={outputSectionRows} overflow="hidden" backgroundColor={CONSOLE_PALETTE.background}>
					<Box justifyContent="space-between" backgroundColor={CONSOLE_PALETTE.background}>
						<Text bold color={CONSOLE_PALETTE.text} backgroundColor={CONSOLE_PALETTE.background}>Output</Text>
						<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>{viewportHint || "Follow mode"}</Text>
					</Box>
					<Text color={CONSOLE_PALETTE.divider} backgroundColor={CONSOLE_PALETTE.background}>{divider}</Text>

					<Box flexDirection="column" height={outputRows} overflow="hidden" backgroundColor={CONSOLE_PALETTE.background}>
						{interactiveApp ? (
							<interactiveApp.Component
								{...interactiveApp.props}
								width={outputWidth}
								height={outputRows}
								onExit={(exitCode?: number) => runtime.closeInteractiveApplication(exitCode)}
							/>
						) : viewport.visibleEntries.length === 0 ? (
							<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>No output yet</Text>
						) : (
							viewport.visibleEntries.map((entry, index) => (
								<Text
									key={`${index}:${entry.id}:${entry.text}`}
									color={activeSearchLineIndex === entry.sourceIndex ? CONSOLE_PALETTE.background : entryColor(entry)}
									backgroundColor={activeSearchLineIndex === entry.sourceIndex
										? CONSOLE_PALETTE.accent
										: (searchMatchLineIndexSet.has(entry.sourceIndex) ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background)}
								>
									{entry.text}
								</Text>
							))
						)}
					</Box>
				</Box>

				<Text color={CONSOLE_PALETTE.divider} backgroundColor={CONSOLE_PALETTE.background}>{divider}</Text>

				<Box flexDirection="column" height={footerRows} overflow="hidden" backgroundColor={CONSOLE_PALETTE.background}>
					<Box backgroundColor={CONSOLE_PALETTE.background}>
						{showSpinner ? <Spinner label="Running..." /> : <Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>{activityStatusLabel}</Text>}
					</Box>

					<Box backgroundColor={CONSOLE_PALETTE.background}>
						<Text color={searchState ? CONSOLE_PALETTE.info : CONSOLE_PALETTE.accent} backgroundColor={CONSOLE_PALETTE.background}>{activePrompt}</Text>
						<Box flexGrow={1} marginLeft={1} backgroundColor={CONSOLE_PALETTE.background}>
							<Text color={CONSOLE_PALETTE.text} backgroundColor={CONSOLE_PALETTE.background}>
								{showPlaceholder ? (
									<>
										<Text color={CONSOLE_PALETTE.background} backgroundColor={CONSOLE_PALETTE.text}>{searchState ? "S" : "T"}</Text>
										<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>
											{truncateText(inputPlaceholder, Math.max(0, inputAreaWidth - 1))}
										</Text>
									</>
								) : (
									<>
										{inputPrefix}
										<Text color={CONSOLE_PALETTE.background} backgroundColor={CONSOLE_PALETTE.text}>{cursorCharacter}</Text>
										{inputSuffix}
										{activeInlineSuggestion.length > 0 ? <Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>{activeInlineSuggestion}</Text> : null}
									</>
								)}
							</Text>
						</Box>
					</Box>
				</Box>

				{commandPaletteOpen ? (
					<Box
						position="absolute"
						top={commandPaletteTop}
						left={commandPaletteLeft}
						width={commandPaletteWidth}
						flexDirection="column"
						borderStyle="round"
						borderColor={CONSOLE_PALETTE.divider}
						paddingX={1}
						backgroundColor={CONSOLE_PALETTE.background}
					>
						<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>
							Command Palette{commandPaletteQueryTokens.length > 0 ? ` • ${filteredCommandPaletteItems.length}/${commandPaletteItems.length}` : ""}
						</Text>
						<Box backgroundColor={CONSOLE_PALETTE.background}>
							<Text color={CONSOLE_PALETTE.accent} backgroundColor={CONSOLE_PALETTE.background}>&gt;</Text>
							<Box flexGrow={1} marginLeft={1} backgroundColor={CONSOLE_PALETTE.background}>
								<Text color={CONSOLE_PALETTE.text} backgroundColor={CONSOLE_PALETTE.background}>
									{showCommandPalettePlaceholder ? (
										<>
											<Text color={CONSOLE_PALETTE.background} backgroundColor={CONSOLE_PALETTE.text}>T</Text>
											<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>
												{truncateText("ype a command, module, or action", Math.max(0, commandPaletteInputWidth - 2))}
											</Text>
										</>
									) : (
										<>
											{commandPaletteInputPrefix}
											<Text color={CONSOLE_PALETTE.background} backgroundColor={CONSOLE_PALETTE.text}>{commandPaletteCursorCharacter}</Text>
											{commandPaletteInputSuffix}
										</>
									)}
								</Text>
							</Box>
						</Box>
						{filteredCommandPaletteItems.length === 0 ? (
							<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>No commands match</Text>
						) : (
							suggestionMenuItems.map((suggestion, index) => {
								const highlighted = index === activeSuggestionIndex;
								const label = suggestion.label ?? suggestion.value;
								const detailText = suggestion.detail
									? truncateText(suggestion.detail, Math.max(12, commandPaletteWidth - Math.floor(commandPaletteWidth * 0.42) - 4))
									: "";

								return (
									<Box key={`${suggestion.value}:${index}`} justifyContent="space-between" backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>
										<Text color={highlighted ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.text} backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>{truncateText(label, Math.max(10, Math.floor(commandPaletteWidth * 0.42)))}</Text>
										<Text color={suggestionKindColor(suggestion.kind)} backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>{detailText}</Text>
									</Box>
								);
							})
						)}
					</Box>
				) : suggestionMenuItems.length > 0 ? (
					<Box
						position="absolute"
						bottom={suggestionOverlayBottom}
						left={suggestionOverlayLeft}
						width={suggestionOverlayWidth}
						flexDirection="column"
						borderStyle="round"
						borderColor={CONSOLE_PALETTE.divider}
						paddingX={1}
						backgroundColor={CONSOLE_PALETTE.background}
					>
						<Text color={CONSOLE_PALETTE.muted} backgroundColor={CONSOLE_PALETTE.background}>Suggestions</Text>
						{suggestionMenuItems.map((suggestion, index) => {
							const highlighted = index === activeSuggestionIndex;
							const detailText = suggestion.detail
								? truncateText(suggestion.detail, Math.max(12, suggestionOverlayWidth - Math.floor(suggestionOverlayWidth * 0.42) - 4))
								: "";
							const label = suggestion.label ?? suggestion.value;

							return (
								<Box key={suggestion.value} justifyContent="space-between" backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>
									<Text color={highlighted ? CONSOLE_PALETTE.accent : CONSOLE_PALETTE.text} backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>{truncateText(label, Math.max(8, Math.floor(suggestionOverlayWidth * 0.42)))}</Text>
									<Text color={suggestionKindColor(suggestion.kind)} backgroundColor={highlighted ? CONSOLE_PALETTE.searchMatchBackground : CONSOLE_PALETTE.background}>{detailText}</Text>
								</Box>
							);
						})}
					</Box>
				) : null}
			</Box>
		</ThemeProvider>
	);
}

function ActivitiesInkConsole<THelpers extends object>({
	runtime,
	fullscreen,
	initialSessionState,
	sessionStateManager,
}: ActivitiesInkConsoleProps<THelpers>): React.JSX.Element {
	const initialState = useMemo(
		() => initializeActivities(runtime, initialSessionState),
		[initialSessionState, runtime],
	);
	const [activities, setActivities] = useState<ActivityState<THelpers>[]>(() => initialState.activities);
	const [activitySnapshots, setActivitySnapshots] = useState<Record<string, ActivityConsoleSnapshot>>(() => initialState.activitySnapshots);
	const [activeActivityId, setActiveActivityId] = useState<string | null>(() => initialState.activeActivityId);
	const [nextActivityNumber, setNextActivityNumber] = useState(() => initialState.nextActivityNumber);
	const [runningActivities, setRunningActivities] = useState<Record<string, boolean>>({});
	const latestActivitiesRef = useRef(activities);

	const sessionSnapshot = useMemo(
		() => buildConsoleSessionSnapshot(activities, activitySnapshots, activeActivityId),
		[activities, activitySnapshots, activeActivityId],
	);

	useEffect(() => {
		sessionStateManager.setState(sessionSnapshot);
	}, [sessionSnapshot, sessionStateManager]);

	useEffect(() => {
		latestActivitiesRef.current = activities;
	}, [activities]);

	useEffect(() => {
		return () => {
			for (const activity of latestActivitiesRef.current) {
				void activity.runtime.dispose();
			}
		};
	}, []);

	const createAndActivateActivity = (): void => {
		const activity = createActivityState(runtime, { title: createActivityTitle(nextActivityNumber) });
		setActivities(previousActivities => [...previousActivities, activity]);
		setActivitySnapshots(previousSnapshots => ({
			...previousSnapshots,
			[activity.id]: activity.runtime.createActivitySessionSnapshot(activity.initialHistory),
		}));
		setActiveActivityId(activity.id);
		setNextActivityNumber(previousNumber => previousNumber + 1);
	};

	const cycleActivity = (direction: "next" | "previous"): void => {
		if (activities.length <= 1 || !activeActivityId) {
			return;
		}

		const currentIndex = activities.findIndex(activity => activity.id === activeActivityId);
		if (currentIndex < 0) {
			return;
		}

		const delta = direction === "next" ? 1 : -1;
		const nextIndex = (currentIndex + delta + activities.length) % activities.length;
		const nextActivity = activities[nextIndex];
		if (nextActivity) {
			setActiveActivityId(nextActivity.id);
		}
	};

	const appendTransientInfo = (activityId: string | null, text: string): void => {
		if (!activityId) {
			return;
		}

		const activity = activities.find(candidate => candidate.id === activityId);
		activity?.outputStack.push(createActivitySessionEntity(text));
	};

	const closeActivity = (targetActivityId: string): void => {
		if (!targetActivityId) {
			return;
		}

		if (runningActivities[targetActivityId]) {
			appendTransientInfo(targetActivityId, "Wait for the running command before closing this activity.");
			return;
		}

		const activityToClose = activities.find(activity => activity.id === targetActivityId);
		if (activityToClose) {
			void activityToClose.runtime.dispose();
		}

		setActivities(previousActivities => {
			const currentIndex = previousActivities.findIndex(activity => activity.id === targetActivityId);
			if (currentIndex < 0) {
				return previousActivities;
			}

			const nextActivities = previousActivities.filter(activity => activity.id !== targetActivityId);

			if (nextActivities.length === 0) {
				const nextActivity = createActivityState(runtime, { title: createActivityTitle(1) });
				setActivitySnapshots({
					[nextActivity.id]: nextActivity.runtime.createActivitySessionSnapshot(nextActivity.initialHistory),
				});
				setActiveActivityId(nextActivity.id);
				setNextActivityNumber(2);
				return [nextActivity];
			}

			setActivitySnapshots(previousSnapshots => {
				const { [targetActivityId]: _removedSnapshot, ...remainingSnapshots } = previousSnapshots;
				return remainingSnapshots;
			});
			setRunningActivities(previousRunningActivities => {
				const { [targetActivityId]: _removedRunningState, ...remainingRunningActivities } = previousRunningActivities;
				return remainingRunningActivities;
			});

			const fallbackActivity = targetActivityId === activeActivityId
				? nextActivities[Math.max(0, Math.min(currentIndex, nextActivities.length - 1))]
				: (nextActivities.find(activity => activity.id === activeActivityId) ?? nextActivities[0]);
			setActiveActivityId(fallbackActivity?.id ?? null);
			return nextActivities;
		});
	};

	const handleActivityCommand = (command: NonNullable<ModuleConsoleCommandResult["activityCommand"]>): void => {
		switch (command) {
			case "new":
				createAndActivateActivity();
				return;
			case "next":
				cycleActivity("next");
				return;
			case "previous":
				cycleActivity("previous");
				return;
			case "close":
					if (activeActivityId) {
						closeActivity(activeActivityId);
					}
				return;
		}
	};

	const handleSelectActivity = (activityId: string): void => {
		if (!activities.some(activity => activity.id === activityId)) {
			return;
		}

		setActiveActivityId(activityId);
	};

	const handleCloseActivity = (activityId: string): void => {
		if (!activities.some(activity => activity.id === activityId)) {
			return;
		}

		closeActivity(activityId);
	};

	const handleRunningChange = useCallback((activityId: string, isRunning: boolean): void => {
		setRunningActivities(previousState => {
			if (previousState[activityId] === isRunning) {
				return previousState;
			}

			return {
				...previousState,
				[activityId]: isRunning,
			};
		});
	}, []);

	const handleSnapshotChange = useCallback((activityId: string, snapshot: ActivityConsoleSnapshot): void => {
		setActivitySnapshots(previousSnapshots => {
			const previousSnapshot = previousSnapshots[activityId];
			if (previousSnapshot && areActivitySnapshotsEqual(previousSnapshot, snapshot)) {
				return previousSnapshots;
			}

			return {
				...previousSnapshots,
				[activityId]: snapshot,
			};
		});
	}, []);

	const handleSessionCommand = async (command: NonNullable<ModuleConsoleCommandResult["sessionCommand"]>): Promise<void> => {
		if (command === "save") {
			await sessionStateManager.save(buildConsoleSessionSnapshot(activities, activitySnapshots, activeActivityId));
			appendTransientInfo(activeActivityId, `Session saved to ${sessionStateManager.getFilePath()}`);
			return;
		}

		if (Object.values(runningActivities).some(Boolean)) {
			appendTransientInfo(activeActivityId, "Cannot clear the session while activities are running.");
			return;
		}

		void Promise.allSettled(activities.map(activity => activity.runtime.dispose()));

		const nextActivity = createActivityState(runtime, { title: createActivityTitle(1) });
		const nextSnapshots = {
			[nextActivity.id]: nextActivity.runtime.createActivitySessionSnapshot(nextActivity.initialHistory),
		};
		nextActivity.outputStack.push(createActivitySessionEntity("Session cleared"));
		setActivities([nextActivity]);
		setActivitySnapshots(nextSnapshots);
		setRunningActivities({});
		setActiveActivityId(nextActivity.id);
		setNextActivityNumber(2);
		await sessionStateManager.save(buildConsoleSessionSnapshot([nextActivity], nextSnapshots, nextActivity.id));
	};

	const activityTabs = activities.map(activity => ({
		id: activity.id,
		title: activity.title,
		active: activity.id === activeActivityId,
		isRunning: runningActivities[activity.id] ?? false,
	}));

	return (
		<>
			{activities.map(activity => (
				<RuntimeInkConsole
					key={activity.id}
					activityId={activity.id}
					activityTabs={activityTabs}
					activityTitle={activity.title}
					active={activity.id === activeActivityId}
					onActivityCommand={handleActivityCommand}
					onCloseActivity={handleCloseActivity}
					onSelectActivity={handleSelectActivity}
					onRunningChange={handleRunningChange}
					onSessionCommand={handleSessionCommand}
					onSnapshotChange={handleSnapshotChange}
					outputStack={activity.outputStack}
					runtime={activity.runtime}
					fullscreen={fullscreen}
					initialHistory={activity.initialHistory}
				/>
			))}
		</>
	);
}

export async function runInkConsole<THelpers extends object>(
	runtime: ModuleRuntime<THelpers>,
	options: { fullscreen?: boolean; initialSessionState: ConsoleSessionState | null; sessionStateManager: ConsoleSessionStateManager },
): Promise<number> {
	const instance = render(
		<ActivitiesInkConsole
			runtime={runtime}
			fullscreen={options.fullscreen ?? true}
			initialSessionState={options.initialSessionState}
			sessionStateManager={options.sessionStateManager}
		/>,
		{
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr,
		alternateScreen: options.fullscreen ?? true,
		incrementalRendering: options.fullscreen ?? true,
		patchConsole: true,
		exitOnCtrlC: true,
		interactive: true,
		},
	);

	const result = await instance.waitUntilExit();
	await options.sessionStateManager.flush();
	instance.cleanup();

	return typeof result === "number" ? result : 0;
}