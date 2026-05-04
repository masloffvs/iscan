import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeOutputEntities, type OutputEntity } from "../primitives";

const SESSION_STATE_VERSION = 2;
const DEFAULT_SESSION_FILE_PATH = path.resolve(process.cwd(), ".iscan", "session.json");

export type ActivityConsoleSnapshot = {
	currentModuleId: string | null;
	history: string[];
	outputItems: OutputEntity[];
};

export type ConsoleActivitySnapshot = ActivityConsoleSnapshot & {
	id: string;
	title: string;
};

export type ConsoleSessionSnapshot = {
	activeActivityId: string | null;
	activities: ConsoleActivitySnapshot[];
};

export type ConsoleSessionState = ConsoleSessionSnapshot & {
	version: typeof SESSION_STATE_VERSION;
	savedAt: number;
};

function normalizeActivityConsoleSnapshot(value: unknown): ActivityConsoleSnapshot | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const outputItems = normalizeOutputEntities(candidate.outputItems);
	if (!outputItems) {
		return null;
	}

	const history = Array.isArray(candidate.history)
		? candidate.history.filter((entry): entry is string => typeof entry === "string").slice(-100)
		: [];

	return {
		currentModuleId: typeof candidate.currentModuleId === "string" ? candidate.currentModuleId : null,
		history,
		outputItems,
	};
}

function normalizeConsoleActivitySnapshot(value: unknown, fallbackIndex: number): ConsoleActivitySnapshot | null {
	const snapshot = normalizeActivityConsoleSnapshot(value);
	if (!snapshot) {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const id = typeof candidate.id === "string" && candidate.id.length > 0
		? candidate.id
		: `activity:${fallbackIndex + 1}`;
	const title = typeof candidate.title === "string" && candidate.title.length > 0
		? candidate.title
		: `Activity ${fallbackIndex + 1}`;

	return {
		id,
		title,
		...snapshot,
	};
}

function normalizeConsoleSessionSnapshot(value: unknown): ConsoleSessionSnapshot | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const activityCandidates = Array.isArray(candidate.activities)
		? candidate.activities
		: null;

	const activities = activityCandidates
		? activityCandidates
			.map((entry, index) => normalizeConsoleActivitySnapshot(entry, index))
			.filter((entry): entry is ConsoleActivitySnapshot => Boolean(entry))
		: (() => {
			const legacySnapshot = normalizeActivityConsoleSnapshot(candidate);
			if (!legacySnapshot) {
				return [];
			}

			return [{
				id: "activity:1",
				title: "Activity 1",
				...legacySnapshot,
			}];
		})();

	if (activities.length === 0) {
		return {
			activeActivityId: null,
			activities: [],
		};
	}

	const activeActivityId = typeof candidate.activeActivityId === "string"
		&& activities.some(activity => activity.id === candidate.activeActivityId)
		? candidate.activeActivityId
		: activities[0]?.id ?? null;

	return {
		activeActivityId,
		activities,
	};
}

function cloneSessionState(state: ConsoleSessionState): ConsoleSessionState {
	return structuredClone(state);
}

function toConsoleSessionState(snapshot: ConsoleSessionSnapshot): ConsoleSessionState {
	return {
		version: SESSION_STATE_VERSION,
		savedAt: Date.now(),
		activeActivityId: snapshot.activeActivityId,
		activities: snapshot.activities.map(activity => ({
			id: activity.id,
			title: activity.title,
			currentModuleId: activity.currentModuleId,
			history: [...activity.history].slice(-100),
			outputItems: structuredClone(activity.outputItems),
		})),
	};
}

export class ConsoleSessionStateManager {
	private pendingState: ConsoleSessionState | null = null;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private readonly filePath = DEFAULT_SESSION_FILE_PATH,
		private readonly debounceMs = 120,
	) {}

	async load(): Promise<ConsoleSessionState | null> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const snapshot = normalizeConsoleSessionSnapshot(parsed);
			if (!snapshot) {
				return null;
			}

			const state: ConsoleSessionState = {
				version: SESSION_STATE_VERSION,
				savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
				...snapshot,
			};

			this.pendingState = state;
			return cloneSessionState(state);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return null;
			}

			return null;
		}
	}

	setState(snapshot: ConsoleSessionSnapshot): void {
		this.pendingState = toConsoleSessionState(snapshot);
		this.scheduleFlush();
	}

	peek(): ConsoleSessionState | null {
		return this.pendingState ? cloneSessionState(this.pendingState) : null;
	}

	getFilePath(): string {
		return this.filePath;
	}

	async save(snapshot: ConsoleSessionSnapshot): Promise<void> {
		this.pendingState = toConsoleSessionState(snapshot);
		await this.flush();
	}

	async clear(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		this.pendingState = null;
		this.writeChain = this.writeChain
			.catch(() => undefined)
			.then(async () => {
				await rm(this.filePath, { force: true });
			});

		await this.writeChain;
	}

	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		const state = this.pendingState;
		if (!state) {
			return;
		}

		const payload = JSON.stringify(state, null, 2);
		this.writeChain = this.writeChain
			.catch(() => undefined)
			.then(async () => {
				await mkdir(path.dirname(this.filePath), { recursive: true });
				await writeFile(this.filePath, payload, "utf8");
			});

		await this.writeChain;
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
		}

		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, this.debounceMs);
	}
}

export const consoleSessionStateManager = new ConsoleSessionStateManager();