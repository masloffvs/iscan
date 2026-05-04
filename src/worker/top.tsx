import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { InteractiveApplicationProps } from "../modules/module";

import type { BackgroundWorkerSnapshot } from "./types";

type WorkerTopProps = InteractiveApplicationProps & {
	getSnapshots: () => BackgroundWorkerSnapshot[] | Promise<BackgroundWorkerSnapshot[]>;
	refreshIntervalMs?: number;
	title?: string;
};

function truncate(text: string, width: number): string {
	if (width <= 0) {
		return "";
	}

	if (text.length <= width) {
		return text.padEnd(width, " ");
	}

	if (width === 1) {
		return text.slice(0, 1);
	}

	return `${text.slice(0, width - 1)}…`;
}

function formatLimits(snapshot: BackgroundWorkerSnapshot): string {
	if (!snapshot.resourceLimits) {
		return "";
	}

	return [
		snapshot.resourceLimits.maxYoungGenerationSizeMb !== undefined ? `Y:${snapshot.resourceLimits.maxYoungGenerationSizeMb}` : undefined,
		snapshot.resourceLimits.maxOldGenerationSizeMb !== undefined ? `O:${snapshot.resourceLimits.maxOldGenerationSizeMb}` : undefined,
		snapshot.resourceLimits.codeRangeSizeMb !== undefined ? `C:${snapshot.resourceLimits.codeRangeSizeMb}` : undefined,
		snapshot.resourceLimits.stackSizeMb !== undefined ? `S:${snapshot.resourceLimits.stackSizeMb}` : undefined,
	].filter(Boolean).join(" ");
}

function formatMemory(snapshot: BackgroundWorkerSnapshot): string {
	const memoryUsage = snapshot.lastMetrics?.memoryUsage;
	if (!memoryUsage) {
		return "";
	}

	return `rss:${memoryUsage.rssMb} heap:${memoryUsage.heapUsedMb}/${memoryUsage.heapTotalMb}`;
}

function createRow(snapshot: BackgroundWorkerSnapshot, width: number): string {
	const nameWidth = Math.min(16, Math.max(10, Math.floor(width * 0.14)));
	const statusWidth = 10;
	const memoryWidth = Math.min(24, Math.max(18, Math.floor(width * 0.2)));
	const limitsWidth = Math.min(24, Math.max(16, Math.floor(width * 0.18)));
	const eventWidth = Math.min(14, Math.max(10, Math.floor(width * 0.12)));
	const fixedWidth = nameWidth + statusWidth + memoryWidth + limitsWidth + eventWidth + 10;
	const payloadWidth = Math.max(12, width - fixedWidth);

	return [
		truncate(snapshot.name, nameWidth),
		truncate(snapshot.status, statusWidth),
		truncate(formatMemory(snapshot), memoryWidth),
		truncate(formatLimits(snapshot), limitsWidth),
		truncate(snapshot.lastEvent ?? "", eventWidth),
		truncate(snapshot.lastPayload ?? "", payloadWidth),
	].join("  ");
}

function createHeader(width: number): string {
	return createRow({
		id: "header",
		name: "NAME",
		scriptPath: "",
		relativeScriptPath: "",
		smol: true,
		status: "STATUS",
		startedAt: "",
		updatedAt: "",
		pid: 0,
		logs: [],
		lastEvent: "EVENT",
		lastPayload: "PAYLOAD",
		resourceLimits: {
			maxYoungGenerationSizeMb: 0,
			maxOldGenerationSizeMb: 0,
			codeRangeSizeMb: 0,
			stackSizeMb: 0,
		},
		lastMetrics: {
			memoryUsage: {
				rssMb: 0,
				heapTotalMb: 0,
				heapUsedMb: 0,
				externalMb: 0,
				arrayBuffersMb: 0,
			},
		},
	}, width).replace("rss:0 heap:0/0", "MEMORY").replace("Y:0 O:0 C:0 S:0", "LIMITS");
}

export function WorkerTop({
	getSnapshots,
	height,
	onExit,
	refreshIntervalMs = 1000,
	title = "worker top",
	width,
}: WorkerTopProps) {
	const [snapshots, setSnapshots] = useState<BackgroundWorkerSnapshot[]>([]);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(new Date().toISOString());
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		let disposed = false;

		const refresh = async () => {
			try {
				const nextSnapshots = await getSnapshots();
				if (disposed) {
					return;
				}

				setSnapshots(nextSnapshots);
				setLastUpdatedAt(new Date().toISOString());
				setErrorMessage(null);
			} catch (error) {
				if (disposed) {
					return;
				}

				setErrorMessage(error instanceof Error ? error.message : String(error));
			}
		};

		void refresh();
		const timer = setInterval(() => {
			void refresh();
		}, refreshIntervalMs);

		return () => {
			disposed = true;
			clearInterval(timer);
		};
	}, [getSnapshots, refreshIntervalMs]);

	useInput((input, key) => {
		if (input === "q" || key.escape || (key.ctrl && input === "c")) {
			onExit(0);
		}
	});

	const visibleRowCount = Math.max(3, height - 6);
	const visibleSnapshots = snapshots.slice(0, visibleRowCount);
	const contentWidth = Math.max(40, width - 2);

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Text color="#7dd3fc" bold>{title}</Text>
			<Text color="#9ca3af">Auto-refresh {refreshIntervalMs}ms • Workers: {snapshots.length} • Updated: {lastUpdatedAt} • Press q or Esc to exit</Text>
			{errorMessage ? <Text color="#fca5a5">{errorMessage}</Text> : null}
			<Text bold>{createHeader(contentWidth)}</Text>
			{visibleSnapshots.length === 0 ? (
				<Text color="#9ca3af">No workers available</Text>
			) : (
				visibleSnapshots.map((snapshot) => (
					<Text key={snapshot.id}>{createRow(snapshot, contentWidth)}</Text>
				))
			)}
			{snapshots.length > visibleSnapshots.length ? (
				<Text color="#9ca3af">Showing {visibleSnapshots.length} of {snapshots.length} workers</Text>
			) : null}
		</Box>
	);
}