export { registeredModules } from "./catalog";
export { AUDIT_SECRET_DETECTORS, auditViteSpaModule } from "./audit";
export { auditViteSourcemapsModule } from "./audit";
export type { AuditSecretDetection, AuditSecretDetector, AuditSeverity } from "./audit";
export type { AuditViteSpaAssetReport, AuditViteSpaFinding, AuditViteSpaParams, AuditViteSpaResult, AuditViteSpaSeverity } from "./audit";
export type { AuditViteSourcemapReport, AuditViteSourcemapsFinding, AuditViteSourcemapsParams, AuditViteSourcemapsResult, AuditViteSourcemapsSeverity } from "./audit";
export { readFlagValue, readFlagValues, parseInlineParams, parseModuleParams } from "./cli";
export { coreModulesModule } from "./core";
export { coreTaskManagerModule } from "./core";
export type { CoreModulesParams } from "./core";
export {
	dockerBuildModule,
	dockerCdModule,
	dockerExecModule,
	dockerImagesModule,
	dockerInspectModule,
	dockerPsModule,
	dockerComposeDownModule,
	dockerComposeLogsModule,
	dockerComposePsModule,
	dockerComposePullModule,
	dockerComposeRestartModule,
	dockerComposeUpModule,
	dockerPullModule,
	dockerPwdModule,
	dockerRunModule,
} from "./docker";
export type {
	DockerBuildParams,
	DockerCdParams,
	DockerExecParams,
	DockerImagesParams,
	DockerInspectParams,
	DockerPsParams,
	DockerComposeDownParams,
	DockerComposeLogsParams,
	DockerComposePsParams,
	DockerComposePullParams,
	DockerComposeRestartParams,
	DockerComposeUpParams,
	DockerPullParams,
	DockerPwdResult,
	DockerRunParams,
} from "./docker";
export {
	gitAddModule,
	gitBranchModule,
	gitBranchCreateModule,
	gitBranchDeleteModule,
	gitCdModule,
	gitCheckoutModule,
	gitCloneModule,
	gitCommitModule,
	gitDiffModule,
	gitFetchModule,
	gitInitModule,
	gitLogModule,
	gitMergeModule,
	gitPullModule,
	gitPwdModule,
	gitPushModule,
	gitRebaseModule,
	gitRestoreModule,
	gitStatusModule,
	gitSwitchModule,
	gitTagCreateModule,
	gitTagDeleteModule,
	gitTagModule,
} from "./git";
export type {
	GitAddParams,
	GitBranchParams,
	GitBranchCreateParams,
	GitBranchDeleteParams,
	GitCdParams,
	GitCheckoutParams,
	GitCloneParams,
	GitCommitParams,
	GitDiffParams,
	GitFetchParams,
	GitInitParams,
	GitLogParams,
	GitMergeParams,
	GitPullParams,
	GitPwdResult,
	GitPushParams,
	GitRebaseParams,
	GitRestoreParams,
	GitStatusParams,
	GitSwitchParams,
	GitTagCreateParams,
	GitTagDeleteParams,
	GitTagParams,
} from "./git";
export {
	pacmanCleanModule,
	pacmanConfigGetModule,
	pacmanConfigSetModule,
	pacmanDatabaseCheckModule,
	pacmanDatabaseCleanModule,
	pacmanDatabaseMarkDepsModule,
	pacmanInfoModule,
	pacmanInstallModule,
	pacmanListModule,
	pacmanQueryAllModule,
	pacmanQueryFindFileModule,
	pacmanQueryInfoModule,
	pacmanQueryOrphansModule,
	pacmanRemoveModule,
	pacmanRemovePurgeModule,
	pacmanRemoveRecursiveModule,
	pacmanRemoveSoftModule,
	pacmanSearchModule,
	pacmanSyncFullUpgradeModule,
	pacmanSyncInstallModule,
	pacmanSyncModule,
	pacmanSyncSearchModule,
	pacmanSyncUpdateModule,
} from "./pacman";
export type {
	PacmanCheckParams,
	PacmanConfigSetParams,
	PacmanFindFileParams,
	PacmanInfoParams,
	PacmanInstallParams,
	PacmanListParams,
	PacmanMarkDepsParams,
	PacmanRemoveParams,
	PacmanSearchParams,
} from "./pacman";
export {
	paruAurDownloadModule,
	paruAurInspectModule,
	paruAurSearchModule,
	paruConfigGetModule,
	paruConfigSetModule,
	paruInstallModule,
	paruRemoveModule,
	paruUpdateAurOnlyModule,
	paruUpdateSystemModule,
} from "./paru";
export type {
	ParuAurDownloadParams,
	ParuAurInspectParams,
	ParuAurSearchParams,
	ParuConfigSetParams,
	ParuInstallParams,
	ParuRemoveParams,
} from "./paru";
export {
	bpkgCreateModule,
	bpkgGeneratedPackageModules,
	bpkgGetModule,
	bpkgInstallModule,
	bpkgListModule,
	bpkgPackagesModule,
	bpkgSelectModule,
	bpkgUseExecModule,
} from "./bpkg";
export type {
	BpkgCreateParams,
	BpkgGetParams,
	BpkgInstallParams,
	BpkgSelectParams,
	BpkgUseExecParams,
} from "./bpkg";
export {
	nmapParseXmlModule,
	nmapReadXmlModule,
	parseNmapXmlReport,
} from "./nmap";
export type {
	NmapParseXmlParams,
	NmapReadXmlParams,
	NmapReport,
	NmapReportAddress,
	NmapReportHost,
	NmapReportPort,
	NmapReportRunStats,
	NmapReportScript,
	NmapReportService,
} from "./nmap";
export {
	apacheFilesModule,
	cloudflareRadarDomainsPullModule,
	cloudflareRadarDomainsSearchModule,
	discoveryHunterNowApacheIndexModule,
	domainLookupModule,
	zoomEyePullModule,
} from "./discovery";
export type {
	ApacheFilesParams,
	CloudflareRadarDomainsPullParams,
	CloudflareRadarDomainsSearchParams,
	DiscoveryHunterNowApacheIndexParams,
	DomainLookupParams,
	ZoomEyePullParams,
} from "./discovery";
export { EvalRuntimeError, InvalidParamsError, ModulePromptError, UnknownModuleError, isModulePromptError } from "./errors";
export { aiChatModule, aiConnectModule, aiListModule, elasticSearchConnectModule, elasticSearchExploreModule, elasticSearchSearchModule, kitsManagerModule, ollamaConnectModule, qemuConnectModule, qemuManagerModule } from "./kits";
export type { AiChatParams, AiConnectParams, AiListParams, ElasticSearchConnectParams, ElasticSearchExploreParams, ElasticSearchSearchParams, OllamaConnectParams, QemuConnectParams } from "./kits";
export { defineExecutor, defineModule, getModuleCategory } from "./module";
export type { ModuleDefinition, ModuleExecutionContext, ModuleExecutor } from "./module";
export {
	RecoverableVm,
	RecoverableVmError,
	RecoverableVmManager,
	RecoverableVmNotPreparedError,
	RecoverableVmUnsupportedSyntaxError,
} from "./recoverable-vm";
export {
	RecoverableVmFileSystem,
	RecoverableVmFsStats,
	isRecoverableVmFileSystemSnapshot,
} from "./recoverable-vm-fs";
export {
	createEmptyRecoverableVmSnapshot,
	loadRecoverableVmSnapshot,
	normalizeRecoverableVmSnapshotRelativePath,
	resolveRecoverableVmSnapshotFilePath,
	saveRecoverableVmSnapshot,
} from "./recoverable-vm-snapshot";
export type {
	RecoverableVmSnapshot,
	RecoverableVmSnapshotCell,
} from "./recoverable-vm-snapshot";
export type { RecoverableVmFileSystemSnapshot } from "./recoverable-vm-fs";
export { InteractiveApplicationUnavailableError, ModuleRuntime } from "./runtime";
export type { ModuleRuntimeOptions } from "./runtime";
export { ModuleSandbox } from "./sandbox";
export type { ModuleSandboxEnvironment, ModuleSandboxOptions } from "./sandbox";
export { consoleSessionStateManager, ConsoleSessionStateManager } from "./session-state";
export type { ConsoleSessionSnapshot, ConsoleSessionState } from "./session-state";
export { sqlModule } from "./sql";