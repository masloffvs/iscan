import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import {
	getRemotePortScan,
	getRemotePortScanPolicy,
	listRemotePortScans,
	runRemotePortScan,
	type RemotePortScanPolicySnapshot,
	type RemotePortScanResult,
	type RemotePortScanSavedScan,
} from "../api/client";
import Modal from "../components/Modal";
import TableOutputRenderer from "../components/StructuredCellOutput/Renderers/TableOutputRenderer";
import type { PrimitiveTableEntity } from "../components/StructuredCellOutput/types";
import workbookTheme from "../theme.tsx";
import { useInterfaceStore } from "../store/ui";
import { defineApplication, type ApplicationViewProps } from "./application";
import {
	ApplicationActionButton,
	ApplicationAlert,
	ApplicationChoiceButton,
	ApplicationEmptyState,
	ApplicationHeader,
	ApplicationMetaRow,
	ApplicationMetric,
	ApplicationPanel,
	ApplicationSurface,
} from "./application-layout.tsx";

export const PORT_SCAN_APPLICATION_ID = "applications/port-scan";

type ScanMode = "ports" | "topPorts";
type PortScanAppTab = "scan" | "history" | "policy";

export type PortScanInput = {
	host?: string | null;
	mode?: ScanMode | null;
	ports?: string | null;
	topPorts?: number | null;
	concurrency?: number | null;
	connectTimeoutMs?: number | null;
	hostFilter?: string | null;
	selectedScanId?: string | null;
	lastScan?: RemotePortScanResult | null;
	error?: string | null;
};

function getPortScanApplicationTitle(host: string, scan: RemotePortScanSavedScan | RemotePortScanResult | null): string {
	const resolvedHost = scan?.host?.trim() || host.trim();
	return resolvedHost.length > 0
		? `Port Scan · ${resolvedHost}`
		: "Port Scan · compact console";
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1000) {
		return `${durationMs} ms`;
	}

	return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

function formatStartedAt(value: string): string {
	if (!value) {
		return "-";
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? value
		: parsed.toLocaleString();
}

function getSelectionSummary(scan: RemotePortScanResult | RemotePortScanSavedScan): string {
	return scan.selectionMode === "ports"
		? scan.ports ?? "custom ports"
		: `top ${scan.topPorts ?? 0}`;
}

function PolicyChip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "danger" | "ok" }) {
	const toneClass = tone === "danger"
		? "bg-rose-500/10 text-rose-200"
		: tone === "ok"
			? "bg-emerald-500/10 text-emerald-100"
			: `${workbookTheme.surface.softAccent} ${workbookTheme.text.tag}`;

	return <span className={`rounded-[10px] px-2.5 py-1 text-[10px] font-medium ${toneClass}`}>{label}</span>;
}

function ExampleBlock({ title, lines }: { title: string; lines: string[] }) {
	if (lines.length === 0) {
		return null;
	}

	return (
		<div className={`rounded-[14px] ${workbookTheme.surface.panel} p-3`}>
			<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>{title}</p>
			<div className="mt-2 space-y-2">
				{lines.map((line, index) => (
					<pre key={`${title}-${index}`} className={`overflow-x-auto whitespace-pre-wrap break-words rounded-[10px] ${workbookTheme.surface.panelStrong} px-3 py-2 text-[11px] leading-relaxed ${workbookTheme.text.body}`}>
						{line}
					</pre>
				))}
			</div>
		</div>
	);
}

function ActionButton({
	children,
	className,
	...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; className?: string }) {
	return (
		<ApplicationActionButton {...buttonProps} className={className}>
			{children}
		</ApplicationActionButton>
	);
}

function AppTabButton({
	label,
	isActive,
	onClick,
}: {
	label: string;
	isActive: boolean;
	onClick: () => void;
}) {
	return (
		<ApplicationChoiceButton onClick={onClick} isActive={isActive} className="px-3 font-medium">
			{label}
		</ApplicationChoiceButton>
	);
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return (
		<div className={`rounded-[14px] ${workbookTheme.surface.panel} px-3 py-3`}>
			<ApplicationMetric label={label} value={value} detail={detail} />
		</div>
	);
}

function EmptyState({ text }: { text: string }) {
	return <ApplicationEmptyState text={text} />;
}

function createHistoryTableEntity(history: readonly RemotePortScanSavedScan[]): PrimitiveTableEntity {
	return {
		id: "port-scan-history",
		createdAt: Date.now(),
		kind: "table",
		columns: [
			{ key: "host", header: "Host", width: 28, maxWidth: 44 },
			{ key: "mode", header: "Mode", width: 18, maxWidth: 22 },
			{ key: "open", header: "Open", align: "right", width: 6 },
			{ key: "scanned", header: "Scanned", align: "right", width: 8 },
			{ key: "started", header: "Started", width: 22, maxWidth: 24 },
		],
		rows: history.map((scan) => ({
			host: scan.host,
			mode: getSelectionSummary(scan),
			open: scan.openPortCount,
			scanned: scan.scannedPortCount,
			started: formatStartedAt(scan.startedAt),
		})),
		presentation: {
			kind: "ink-table",
			dense: true,
		},
	};
}

function PortScanResultPanels({
	scan,
	isLoading,
	emptyStateText,
}: {
	scan: RemotePortScanSavedScan | RemotePortScanResult | null;
	isLoading: boolean;
	emptyStateText: string;
}) {
	return (
		<div className="space-y-4">
			{scan?.errorMessage ? (
				<ApplicationAlert tone="warning">{scan.errorMessage}</ApplicationAlert>
			) : null}

			<ApplicationPanel
				title="Selected Result"
				subtitle="Loaded scan detail and execution metadata."
				action={isLoading ? <span className={`text-[10px] ${workbookTheme.text.secondary}`}>Loading detail...</span> : null}
			>
				{scan ? (
					<>
						<div>
							<p className={`text-[14px] font-semibold ${workbookTheme.text.primary}`}>{scan.host}</p>
							<p className={`mt-1 text-[10px] ${workbookTheme.text.secondary}`}>{getSelectionSummary(scan)} · {scan.scannedPortCount} scanned · {scan.openPortCount} open</p>
						</div>
						<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
							<MetricTile label="Started" value={formatStartedAt(scan.startedAt)} />
							<MetricTile label="Duration" value={formatDuration(scan.durationMs)} />
							<MetricTile label="Concurrency" value={String(scan.concurrency)} />
							<MetricTile label="Timeout" value={`${scan.connectTimeoutMs} ms`} />
							<MetricTile label="Scan ID" value={scan.scanId ?? "not persisted"} />
						</div>
					</>
				) : (
					<EmptyState text={emptyStateText} />
				)}
			</ApplicationPanel>

			<ApplicationPanel
				title="Open Ports"
				action={scan?.scanId ? <span className={`text-[10px] ${workbookTheme.text.secondary}`}>scanId {scan.scanId}</span> : null}
			>
				{scan ? (
					scan.openPorts.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{scan.openPorts.map((port) => (
								<span key={port} className="rounded-[11px] bg-[#d6f36a]/12 px-3 py-1.5 text-[11px] font-medium text-[#dffb81]">{port}</span>
							))}
						</div>
					) : (
						<EmptyState text="No open ports in this run." />
					)
				) : (
					<EmptyState text="No result selected." />
				)}
			</ApplicationPanel>
		</div>
	);
}

const inputClassName = `mt-2 w-full rounded-[12px] ${workbookTheme.surface.panel} px-3 py-2 text-[12px] ${workbookTheme.text.canvas} outline-none transition ${workbookTheme.text.placeholder} ${workbookTheme.interaction.panelHoverStrong}`;

function PortScanApp({ instance, setTitle }: ApplicationViewProps<PortScanInput>) {
	const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
	const [policySnapshot, setPolicySnapshot] = useState<RemotePortScanPolicySnapshot | null>(null);
	const [activeTab, setActiveTab] = useState<PortScanAppTab>(
		instance.input.selectedScanId?.trim()
			? "history"
			: "scan",
	);
	const [host, setHost] = useState(instance.input.host?.trim() ?? "127.0.0.1");
	const [mode, setMode] = useState<ScanMode>(instance.input.mode === "ports" ? "ports" : "topPorts");
	const [ports, setPorts] = useState(instance.input.ports?.trim() ?? "22,80,443");
	const [topPorts, setTopPorts] = useState<number>(instance.input.topPorts ?? 25);
	const [concurrency, setConcurrency] = useState<number>(instance.input.concurrency ?? 250);
	const [connectTimeoutMs, setConnectTimeoutMs] = useState<number>(instance.input.connectTimeoutMs ?? 250);
	const [hostFilter, setHostFilter] = useState(instance.input.hostFilter?.trim() ?? "");
	const [history, setHistory] = useState<RemotePortScanSavedScan[]>([]);
	const [selectedScan, setSelectedScan] = useState<RemotePortScanSavedScan | null>(
		instance.input.lastScan?.persisted === true && typeof instance.input.lastScan.scanId === "string"
			? instance.input.lastScan
			: null,
	);
	const [selectedScanId, setSelectedScanId] = useState<string | null>(instance.input.selectedScanId?.trim() ?? null);
	const [lastScan, setLastScan] = useState<RemotePortScanResult | null>(instance.input.lastScan ?? null);
	const [error, setError] = useState<string | null>(instance.input.error ?? null);
	const [isLoadingPolicy, setIsLoadingPolicy] = useState(true);
	const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
	const [isLoadingSelectedScan, setIsLoadingSelectedScan] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [isResultModalOpen, setIsResultModalOpen] = useState(false);

	const effectiveSelectedScan = selectedScan ?? (lastScan?.persisted === true ? lastScan : null);
	const applicationTitle = useMemo(
		() => getPortScanApplicationTitle(host, effectiveSelectedScan ?? lastScan),
		[effectiveSelectedScan, host, lastScan],
	);

	useEffect(() => {
		setTitle(applicationTitle);
	}, [applicationTitle, setTitle]);

	useEffect(() => {
		updateApplicationInstanceInput(instance.instanceId, {
			host,
			mode,
			ports,
			topPorts,
			concurrency,
			connectTimeoutMs,
			hostFilter,
			selectedScanId,
			lastScan,
			error,
		} satisfies PortScanInput);
	}, [concurrency, connectTimeoutMs, error, host, hostFilter, instance.instanceId, lastScan, mode, ports, selectedScanId, topPorts, updateApplicationInstanceInput]);

	async function refreshHistory(filterHost = hostFilter): Promise<void> {
		setIsRefreshingHistory(true);
		try {
			const nextHistory = await listRemotePortScans({ host: filterHost.trim() || null, limit: 40, offset: 0 });
			setHistory(nextHistory);
			if (selectedScanId && !nextHistory.some((entry) => entry.scanId === selectedScanId)) {
				setSelectedScan(null);
				setSelectedScanId(null);
			}
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		} finally {
			setIsRefreshingHistory(false);
		}
	}

	useEffect(() => {
		let disposed = false;
		setIsLoadingPolicy(true);
		void getRemotePortScanPolicy()
			.then((snapshot) => {
				if (disposed) {
					return;
				}

				setPolicySnapshot(snapshot);
				setTopPorts((current) => current > 0 ? current : Math.min(snapshot.defaults.topPorts, snapshot.maxTopPorts));
				setConcurrency((current) => current > 0 ? current : snapshot.defaults.concurrency);
				setConnectTimeoutMs((current) => current > 0 ? current : snapshot.defaults.connectTimeoutMs);
			})
			.catch((loadError) => {
				if (!disposed) {
					setError(loadError instanceof Error ? loadError.message : String(loadError));
				}
			})
			.finally(() => {
				if (!disposed) {
					setIsLoadingPolicy(false);
				}
			});

		void refreshHistory(hostFilter);

		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (!selectedScanId) {
			return;
		}

		let disposed = false;
		setIsLoadingSelectedScan(true);
		void getRemotePortScan(selectedScanId)
			.then((scan) => {
				if (!disposed) {
					setSelectedScan(scan);
				}
			})
			.catch((loadError) => {
				if (!disposed) {
					setError(loadError instanceof Error ? loadError.message : String(loadError));
				}
			})
			.finally(() => {
				if (!disposed) {
					setIsLoadingSelectedScan(false);
				}
			});

		return () => {
			disposed = true;
		};
	}, [selectedScanId]);

	async function handleRunScan(): Promise<void> {
		setIsScanning(true);
		setError(null);
		try {
			const result = await runRemotePortScan({
				host: host.trim(),
				ports: mode === "ports" ? ports.trim() : null,
				topPorts: mode === "topPorts" ? topPorts : null,
				concurrency,
				connectTimeoutMs,
				persist: true,
			});
			setLastScan(result);
			if (result.persisted && result.scanId) {
				setSelectedScan({
					...result,
					persisted: true,
					scanId: result.scanId,
				});
				setSelectedScanId(result.scanId);
			} else {
				setSelectedScan(null);
			}
			setActiveTab("result");
			await refreshHistory(hostFilter);
		} catch (scanError) {
			setError(scanError instanceof Error ? scanError.message : String(scanError));
		} finally {
			setIsScanning(false);
		}
	}

	const exampleLines = useMemo(() => {
		if (!policySnapshot) {
			return null;
		}

		return {
			scan: policySnapshot.examples.scan,
			list: policySnapshot.examples.list,
			get: policySnapshot.examples.get.map((line) => selectedScanId ? line.replace("SCAN_ID_HERE", selectedScanId) : line),
		};
	}, [policySnapshot, selectedScanId]);

	const visibleDetail = effectiveSelectedScan ?? lastScan;
	const historyTableEntity = useMemo(() => createHistoryTableEntity(history), [history]);
	const selectedHistoryRowIndex = useMemo(() => {
		if (!selectedScanId) {
			return null;
		}

		const rowIndex = history.findIndex((scan) => scan.scanId === selectedScanId);
		return rowIndex >= 0 ? rowIndex : null;
	}, [history, selectedScanId]);
	const tabItems: Array<{ id: PortScanAppTab; label: string }> = [
		{ id: "scan", label: "Scan" },
		{ id: "history", label: `History${history.length > 0 ? ` (${history.length})` : ""}` },
		{ id: "policy", label: "Policy" },
	];

	function openVisibleResultModal(): void {
		if (!visibleDetail) {
			return;
		}

		setIsResultModalOpen(true);
	}

	function handleHistoryRowSelect(rowIndex: number): void {
		const scan = history[rowIndex];
		if (!scan) {
			return;
		}

		setError(null);
		setSelectedScan(scan);
		setSelectedScanId(scan.scanId);
	}

	function handleHistoryRowActivate(rowIndex: number): void {
		handleHistoryRowSelect(rowIndex);
		setIsResultModalOpen(true);
	}

	return (
		<>
			<ApplicationSurface>
				<ApplicationHeader
					title="Port Scan"
					subtitle="Compact TCP connect scanner over $.kits.portScan with persisted history and backend host policy."
					actions={(
						<ActionButton onClick={() => { void handleRunScan(); }} disabled={isScanning} className="px-3 py-2 font-medium uppercase tracking-[0.14em]">
							{isScanning ? "Scanning..." : "Run scan"}
						</ActionButton>
					)}
					meta={(
						<ApplicationMetaRow>
							<span>Target {host.trim() || "-"}</span>
							<span>{mode === "ports" ? "Explicit ports" : `Top ${topPorts}`}</span>
							<span>{history.length} saved</span>
							{selectedScanId ? <span>Selected {selectedScanId}</span> : null}
						</ApplicationMetaRow>
					)}
					alert={error ? <ApplicationAlert>{error}</ApplicationAlert> : undefined}
				/>

				<div className="min-h-0 flex-1 pt-2">
					<div className={`mb-0 flex items-center gap-1 rounded-[12px] ${workbookTheme.surface.panel} p-1`}>
						{tabItems.map((tab) => (
							<AppTabButton
								key={tab.id}
								label={tab.label}
								isActive={activeTab === tab.id}
								onClick={() => setActiveTab(tab.id)}
							/>
						))}
					</div>

					{activeTab === "scan" ? (
						<div className="grid min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
							<ApplicationPanel title="Scan Profile" subtitle="Host, target set, and runtime limits.">
								<div className="grid grid-cols-1 gap-3">
								<label className="block">
									<span className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Host</span>
									<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="127.0.0.1" className={inputClassName} />
								</label>

								<div>
									<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Selection</p>
									<div className={`mt-2 flex items-center gap-1 rounded-[12px] ${workbookTheme.surface.panelStrong} p-1`}>
										{([
											["topPorts", "Top ports"],
											["ports", "Explicit"],
										] as const).map(([option, label]) => (
											<AppTabButton key={option} label={label} isActive={mode === option} onClick={() => setMode(option)} />
										))}
									</div>
								</div>

								{mode === "ports" ? (
									<label className="block">
										<span className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Ports</span>
										<input value={ports} onChange={(event) => setPorts(event.target.value)} placeholder="22,80,443,3000-3010" className={inputClassName} />
									</label>
								) : (
									<label className="block">
										<span className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Top ports</span>
										<input type="number" min={1} max={policySnapshot?.maxTopPorts ?? 100} value={topPorts} onChange={(event) => setTopPorts(Number(event.target.value || 0))} className={inputClassName} />
									</label>
								)}

								<div className="grid grid-cols-2 gap-3">
									<label className="block">
										<span className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Concurrency</span>
										<input type="number" min={1} max={1000} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value || 0))} className={inputClassName} />
									</label>
									<label className="block">
										<span className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Timeout ms</span>
										<input type="number" min={50} max={5000} value={connectTimeoutMs} onChange={(event) => setConnectTimeoutMs(Number(event.target.value || 0))} className={inputClassName} />
									</label>
								</div>
								</div>
							</ApplicationPanel>

							<div className="space-y-4">
								<ApplicationPanel title="Run Preview" subtitle="Current request shape before execution.">
									<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
									<MetricTile label="Host" value={host.trim() || "-"} />
									<MetricTile label="Mode" value={mode === "ports" ? "explicit ports" : `top ${topPorts}`} />
									<MetricTile label="Concurrency" value={String(concurrency)} />
									<MetricTile label="Timeout" value={`${connectTimeoutMs} ms`} />
								</div>
								<div className={`mt-4 rounded-[14px] ${workbookTheme.surface.panelStrong} p-3`}>
									<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Target set</p>
									<p className={`mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed ${workbookTheme.text.body}`}>
										{mode === "ports" ? (ports.trim() || "No explicit ports yet.") : `Top ${topPorts} of ${policySnapshot?.maxTopPorts ?? 100} curated ports`}
									</p>
								</div>
								</ApplicationPanel>

								<ApplicationPanel
									title="Current Selection"
									subtitle="Last executed or selected persisted result."
									action={visibleDetail ? (
										<ActionButton onClick={openVisibleResultModal} className="px-3 py-2">Open result</ActionButton>
									) : null}
								>
								{visibleDetail ? (
									<>
										<div>
											<p className={`text-[13px] font-semibold ${workbookTheme.text.primary}`}>{visibleDetail.host}</p>
											<p className={`mt-1 text-[10px] ${workbookTheme.text.secondary}`}>{getSelectionSummary(visibleDetail)} · {visibleDetail.scannedPortCount} scanned · {visibleDetail.openPortCount} open</p>
										</div>
										<div className="mt-4 flex flex-wrap gap-2">
											{visibleDetail.openPorts.slice(0, 20).map((port) => (
												<span key={port} className="rounded-[11px] bg-[#d6f36a]/12 px-3 py-1.5 text-[11px] font-medium text-[#dffb81]">{port}</span>
											))}
											{visibleDetail.openPorts.length > 20 ? <span className={`rounded-[11px] ${workbookTheme.surface.softAccent} px-3 py-1.5 text-[11px] ${workbookTheme.text.tag}`}>+{visibleDetail.openPorts.length - 20} more</span> : null}
										</div>
									</>
								) : (
									<EmptyState text="Run a scan or open a history row to inspect a result." />
								)}
								</ApplicationPanel>
							</div>
						</div>
					) : null}

					{activeTab === "history" ? (
						<ApplicationPanel
							
						>
							<div className="space-y-3">
								
								<TableOutputRenderer
									entity={historyTableEntity}
									selectedRowIndex={selectedHistoryRowIndex}
									onRowSelect={(rowIndex) => handleHistoryRowSelect(rowIndex)}
									onRowActivate={(rowIndex) => handleHistoryRowActivate(rowIndex)}
								/>
							</div>
						</ApplicationPanel>
					) : null}

					{activeTab === "policy" ? (
						<div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
							<ApplicationPanel title="Policy" subtitle="Resolved host access rules and scanner defaults.">
								{isLoadingPolicy ? (
									<EmptyState text="Loading policy..." />
								) : policySnapshot ? (
									<>
										<div className="flex flex-wrap gap-2">
											<PolicyChip label={policySnapshot.policy.allowLoopback ? "loopback allowed" : "loopback blocked"} tone={policySnapshot.policy.allowLoopback ? "ok" : "danger"} />
											<PolicyChip label={policySnapshot.policy.allowPrivateAddresses ? "private allowed" : "private blocked"} tone={policySnapshot.policy.allowPrivateAddresses ? "ok" : "danger"} />
											<PolicyChip label={policySnapshot.policy.denyPublicAddresses ? "public blocked" : "public allowed"} tone={policySnapshot.policy.denyPublicAddresses ? "danger" : "ok"} />
										</div>
										<div className={`mt-3 space-y-3 text-[11px] ${workbookTheme.text.bodyMuted}`}>
											<div>
												<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Allow hosts</p>
												<p className="mt-1 whitespace-pre-wrap break-words">{policySnapshot.policy.allowHosts.join(", ") || "none"}</p>
											</div>
											<div>
												<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Deny hosts</p>
												<p className="mt-1 whitespace-pre-wrap break-words">{policySnapshot.policy.denyHosts.join(", ") || "none"}</p>
											</div>
											<div>
												<p className={`text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Curated top ports</p>
												<p className="mt-1 whitespace-pre-wrap break-words">{policySnapshot.topPortsPreview.join(", ")}</p>
											</div>
											<p className={`text-[10px] ${workbookTheme.text.secondary}`}>Defaults: top {policySnapshot.defaults.topPorts}, concurrency {policySnapshot.defaults.concurrency}, timeout {policySnapshot.defaults.connectTimeoutMs} ms.</p>
										</div>
									</>
								) : (
									<EmptyState text="Policy data is unavailable." />
								)}
							</ApplicationPanel>

							<ApplicationPanel title="Notebook Calls" subtitle="Existing notebook entrypoints for scan, list, and get.">
								{exampleLines ? (
									<div className="space-y-4">
										<ExampleBlock title="$.kits.portScan.scan" lines={exampleLines.scan} />
										<ExampleBlock title="$.kits.portScan.list" lines={exampleLines.list} />
										<ExampleBlock title="$.kits.portScan.get" lines={exampleLines.get} />
									</div>
								) : (
									<EmptyState text={isLoadingPolicy ? "Loading notebook call examples..." : "Examples are unavailable."} />
								)}
							</ApplicationPanel>
						</div>
					) : null}
				</div>
			</ApplicationSurface>

			{isResultModalOpen ? (
				<Modal title={visibleDetail ? `Port Scan Result · ${visibleDetail.host}` : "Port Scan Result"} onClose={() => setIsResultModalOpen(false)}>
					<PortScanResultPanels
						scan={visibleDetail}
						isLoading={isLoadingSelectedScan}
						emptyStateText="Run a scan or select a persisted history row to inspect a result."
					/>
				</Modal>
			) : null}
		</>
	);
}

export const portScanApplication = defineApplication<PortScanInput>({
	id: PORT_SCAN_APPLICATION_ID,
	title: "Port Scan",
	View: PortScanApp,
	getInitialTitle: (input) => getPortScanApplicationTitle(input.host?.trim() ?? "", input.lastScan ?? null),
});