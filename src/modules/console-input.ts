export type HistoryNavigationState = {
	indexes: number[];
	cursor: number;
	draft: string;
};

export type TabCompletionState = {
	suggestions: string[];
	index: number;
};

export type TerminalMouseEvent = {
	kind: "mouse";
	action: "press" | "release";
	button: "left" | "middle" | "right" | "other";
	x: number;
	y: number;
} | {
	kind: "wheel";
	direction: "up" | "down";
	x: number;
	y: number;
};

export function findOutputLineMatches(lines: readonly string[], query: string): number[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (normalizedQuery.length === 0) {
		return [];
	}

	return lines.reduce<number[]>((matches, line, index) => {
		if (line.toLocaleLowerCase().includes(normalizedQuery)) {
			matches.push(index);
		}

		return matches;
	}, []);
}

export function resolveAnchoredMatchIndex(matchLineIndexes: readonly number[], anchorLineIndex: number): number {
	if (matchLineIndexes.length === 0) {
		return -1;
	}

	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const [index, lineIndex] of matchLineIndexes.entries()) {
		const distance = Math.abs(lineIndex - anchorLineIndex);
		if (distance < bestDistance) {
			bestIndex = index;
			bestDistance = distance;
			continue;
		}

		if (distance === bestDistance && lineIndex <= anchorLineIndex) {
			bestIndex = index;
		}
	}

	return bestIndex;
}

export function moveSearchMatch(activeMatchIndex: number, matchCount: number, direction: "next" | "previous"): number {
	if (matchCount <= 0) {
		return -1;
	}

	const delta = direction === "next" ? 1 : -1;
	return (activeMatchIndex + delta + matchCount) % matchCount;
}

export function createHistoryNavigationState(history: readonly string[], prefix: string): HistoryNavigationState | null {
	const indexes = history.reduce<number[]>((matches, entry, index) => {
		if (prefix.length === 0 || entry.startsWith(prefix)) {
			matches.push(index);
		}

		return matches;
	}, []);

	if (indexes.length === 0) {
		return null;
	}

	return {
		indexes,
		cursor: indexes.length - 1,
		draft: prefix,
	};
}

export function resolveTabCompletion(
	inputValue: string,
	suggestions: readonly string[],
	tabCompletion: TabCompletionState | null,
): { completion: TabCompletionState | null; nextValue: string | null } {
	const activeSuggestions =
		tabCompletion && inputValue === tabCompletion.suggestions[tabCompletion.index]
			? tabCompletion.suggestions
			: [...suggestions];

	if (activeSuggestions.length === 0) {
		return {
			completion: null,
			nextValue: null,
		};
	}

	const nextIndex =
		tabCompletion && inputValue === tabCompletion.suggestions[tabCompletion.index]
			? (tabCompletion.index + 1) % activeSuggestions.length
			: 0;

	return {
		completion: {
			suggestions: [...activeSuggestions],
			index: nextIndex,
		},
		nextValue: activeSuggestions[nextIndex] ?? null,
	};
}

export function moveHistoryNavigation(
	history: readonly string[],
	inputValue: string,
	historyNavigation: HistoryNavigationState | null,
	direction: "up" | "down",
): { navigation: HistoryNavigationState | null; nextValue: string | null } {
	if (direction === "up") {
		const nextNavigation = historyNavigation ?? createHistoryNavigationState(history, inputValue);
		if (!nextNavigation) {
			return {
				navigation: null,
				nextValue: null,
			};
		}

		const nextCursor = historyNavigation ? Math.max(0, historyNavigation.cursor - 1) : nextNavigation.cursor;
		const navigation = { ...nextNavigation, cursor: nextCursor };
		const entryIndex = navigation.indexes[navigation.cursor];
		return {
			navigation,
			nextValue: entryIndex === undefined ? null : (history[entryIndex] ?? null),
		};
	}

	if (!historyNavigation) {
		return {
			navigation: null,
			nextValue: null,
		};
	}

	const nextCursor = historyNavigation.cursor + 1;
	if (nextCursor >= historyNavigation.indexes.length) {
		return {
			navigation: null,
			nextValue: historyNavigation.draft,
		};
	}

	const navigation = { ...historyNavigation, cursor: nextCursor };
	const entryIndex = navigation.indexes[navigation.cursor];
	return {
		navigation,
		nextValue: entryIndex === undefined ? null : (history[entryIndex] ?? null),
	};
}

export function parseTerminalMouseEvent(input: string): TerminalMouseEvent | null {
	const match = /^\[<(\d+);(\d+);(\d+)([Mm])$/u.exec(input);
	if (!match) {
		return null;
	}

	const buttonCode = Number(match[1]);
	const x = Number(match[2]);
	const y = Number(match[3]);
	if (!Number.isFinite(buttonCode) || !Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}

	if ((buttonCode & 64) === 64) {
		return {
			kind: "wheel",
			direction: (buttonCode & 1) === 1 ? "down" : "up",
			x,
			y,
		};
	}

	const baseButtonCode = buttonCode & 0b11;
	const button = baseButtonCode === 0
		? "left"
		: baseButtonCode === 1
			? "middle"
			: baseButtonCode === 2
				? "right"
				: "other";

	return {
		kind: "mouse",
		action: match[4] === "m" ? "release" : "press",
		button,
		x,
		y,
	};
}