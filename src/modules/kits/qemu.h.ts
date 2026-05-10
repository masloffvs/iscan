interface NotebookRuntimeModuleResultMap {
	"kits/qemu/connect": NotebookPrimitiveTextEntity;
	"kits/qemu/list": NotebookQemuPresetListReport;
	"kits/qemu/get": NotebookQemuPresetDetailReport;
	"kits/qemu/preview": NotebookQemuPreviewReport;
	"kits/qemu/environment": NotebookQemuEnvironmentModuleResult;
	"kits/qemu/save": NotebookQemuPresetSaveReport;
	"kits/qemu/delete": NotebookQemuPresetDeleteReport;
	"kits/qemu/manager": NotebookQemuManagerModuleResult;
}

type NotebookQemuDiskInterface = "virtio" | "ide" | "scsi";

type NotebookQemuVmRole = "router";

interface NotebookQemuRouterNetworkConfig {
	hostname?: string;
	domain?: string;
	wanInterface?: string;
	lanInterface?: string;
	lanAddress?: string;
	lanPrefix?: number;
	dhcpStart?: string;
	dhcpEnd?: string;
	importDirectory?: string;
}

interface NotebookQemuVmPreset {
	id: string;
	name: string;
	role?: NotebookQemuVmRole;
	diskImage?: string;
	diskFormat?: string;
	diskInterface?: NotebookQemuDiskInterface;
	cdrom?: string;
	kernel?: string;
	initrd?: string;
	append?: string;
	memoryMb?: number;
	machine?: string;
	accelerator?: string;
	cpu?: string;
	smp?: number;
	useProxy?: boolean;
	headless?: boolean;
	snapshot?: boolean;
	daemonize?: boolean;
	enableKvm?: boolean;
	routerNetwork?: NotebookQemuRouterNetworkConfig;
	args?: readonly string[];
}

interface NotebookQemuCommandPreview {
	command: readonly string[];
	usesProxy: boolean;
}

interface NotebookManifestDependencyStatus {
	id: string;
	binary: string;
	aliases: readonly string[];
	required: boolean;
	description?: string;
	available: boolean;
	resolvedBinary: string | null;
	resolvedPath: string | null;
}

interface NotebookQemuManifestConfig {
	architecture: string;
	machine: string;
	accelerator?: string;
	memoryMb: number;
	useProxy: boolean;
	autoBootstrapRouterOnLaunch: boolean;
	bootstrapUsername: string;
	bootstrapPassword: string;
	systemDependencyId: string;
	imageDependencyId: string;
	proxyDependencyId: string;
	defaultArgs: readonly string[];
}

interface NotebookQemuKitEnvironmentReport {
	config: NotebookQemuManifestConfig;
	system: NotebookManifestDependencyStatus;
	imageTool: NotebookManifestDependencyStatus;
	proxy: NotebookManifestDependencyStatus;
	runningProcessCount: number;
}

interface NotebookQemuPresetListTableRow extends NotebookPrimitiveTableRow {
	name: string;
	role: string;
	presetId: string;
	disk: string;
	cdrom: string;
	memory: string;
	headless: string;
}

interface NotebookQemuPresetListTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookQemuPresetListTableRow[];
}

interface NotebookQemuKeyValueTableRow extends NotebookPrimitiveTableRow {
	property: string;
	value: string;
}

interface NotebookQemuKeyValueTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookQemuKeyValueTableRow[];
}

interface NotebookQemuArgsTableRow extends NotebookPrimitiveTableRow {
	index: NotebookPrimitiveCellValue;
	argument: string;
}

interface NotebookQemuArgsTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookQemuArgsTableRow[];
}

interface NotebookQemuDependencyTableRow extends NotebookPrimitiveTableRow {
	component: string;
	id: string;
	state: string;
	binary: string;
	path: string;
}

interface NotebookQemuDependencyTableEntity extends NotebookPrimitiveTableEntity {
	kind: "table";
	rows: NotebookQemuDependencyTableRow[];
}

type NotebookQemuPresetListReport =
	| readonly [NotebookPrimitiveTextEntity]
	| readonly [NotebookPrimitiveTextEntity, NotebookQemuPresetListTableEntity];

type NotebookQemuPresetDetailExtraEntity = NotebookQemuKeyValueTableEntity | NotebookQemuArgsTableEntity;

type NotebookQemuPresetDetailReport = readonly [
	NotebookPrimitiveTextEntity,
	NotebookQemuKeyValueTableEntity,
	...NotebookQemuPresetDetailExtraEntity[],
];

type NotebookQemuPreviewReport = readonly [
	NotebookPrimitiveTextEntity,
	NotebookPrimitiveTextEntity,
	NotebookQemuArgsTableEntity,
];

type NotebookQemuEnvironmentModuleResult = readonly [
	NotebookPrimitiveTextEntity,
	NotebookQemuDependencyTableEntity,
	NotebookQemuKeyValueTableEntity,
];

type NotebookQemuPresetSaveReport = readonly [
	NotebookPrimitiveTextEntity,
	...NotebookQemuPresetDetailReport,
	...NotebookQemuPresetListReport,
];

type NotebookQemuPresetDeleteReport = readonly [
	NotebookPrimitiveTextEntity,
	...NotebookQemuPresetListReport,
];

interface NotebookQemuManagerInteractiveResult {
	exitCode: number;
}

type NotebookQemuManagerModuleResult = NotebookQemuManagerInteractiveResult;