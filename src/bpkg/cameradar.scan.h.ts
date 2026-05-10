interface NotebookRuntimeModuleResultMap {
	"pkg/cameradar/scan": NotebookCameradarScanResult;
}

interface NotebookCameradarScanStream {
	address?: string;
	hasCredentials?: boolean;
	password?: string;
	port?: number;
	route?: string;
	scheme?: string;
	title?: string;
	url: string;
	username?: string;
}

interface NotebookCameradarScanResult {
	attackInterval?: string;
	bindingId: "scan";
	bootstrapVersion: string;
	customCredentials?: string;
	customRoutes?: string;
	debug: boolean;
	exitCode: number;
	kind: "cameradar-scan";
	outputContent?: string;
	outputPath?: string;
	ports: string[];
	processTimeout: string;
	raw: string;
	reason?: "no-stream-found" | "timed-out";
	scanner: "nmap" | "masscan";
	scanSpeed: number;
	skipScan: boolean;
	status: "completed" | "streams-found";
	stderr: string;
	streamCount: number;
	streams: NotebookCameradarScanStream[];
	targets: string[];
	timeout: string;
	ui: "auto" | "plain" | "tui";
}