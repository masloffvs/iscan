interface NotebookRuntimeModuleResultMap {
	"kits/portScan/scan": NotebookPortScanResult;
	"kits/portScan/list": NotebookPortScanListResult;
	"kits/portScan/get": NotebookPortScanGetResult;
	"kits/portScan/policy": NotebookPortScanPolicySnapshot;
}

type NotebookPortScanSelectionMode = "ports" | "topPorts";

interface NotebookPortScanBaseResult {
	host: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	ports: string | null;
	topPorts: number | null;
	selectionMode: NotebookPortScanSelectionMode;
	concurrency: number;
	connectTimeoutMs: number;
	scannedPortCount: number;
	openPorts: number[];
	openPortCount: number;
	errorMessage: string | null;
}

interface NotebookPortScanEphemeralResult extends NotebookPortScanBaseResult {
	persisted: false;
	scanId: null;
}

interface NotebookPortScanSavedScan extends NotebookPortScanBaseResult {
	persisted: true;
	scanId: string;
}

type NotebookPortScanResult = NotebookPortScanEphemeralResult | NotebookPortScanSavedScan;

interface NotebookPortScanListFilters {
	host?: string;
	limit?: number;
	offset?: number;
}

interface NotebookPortScanListResult {
	filters: NotebookPortScanListFilters;
	scans: NotebookPortScanSavedScan[];
}

interface NotebookPortScanGetResult {
	scan: NotebookPortScanSavedScan | null;
}

interface NotebookPortScanHostPolicy {
	allowHosts: string[];
	denyHosts: string[];
	allowPrivateAddresses: boolean;
	allowLoopback: boolean;
	denyPublicAddresses: boolean;
}

interface NotebookPortScanCommandExamples {
	scan: string[];
	list: string[];
	get: string[];
}

interface NotebookPortScanPolicySnapshot {
	policy: NotebookPortScanHostPolicy;
	defaults: {
		topPorts: number;
		concurrency: number;
		connectTimeoutMs: number;
	};
	maxTopPorts: number;
	topPortsPreview: number[];
	examples: NotebookPortScanCommandExamples;
}