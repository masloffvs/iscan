export { auditViteSpaModule } from "./vite-spa";
export { auditViteSourcemapsModule } from "./vite-sourcemaps";
export { AUDIT_SECRET_DETECTORS } from "./datasets";
export type { AuditSecretDetection, AuditSecretDetector, AuditSeverity } from "./shared";
export type {
	AuditViteSpaAssetReport,
	AuditViteSpaFinding,
	AuditViteSpaParams,
	AuditViteSpaResult,
	AuditViteSpaSeverity,
} from "./vite-spa";
export type {
	AuditViteSourcemapReport,
	AuditViteSourcemapsFinding,
	AuditViteSourcemapsParams,
	AuditViteSourcemapsResult,
	AuditViteSourcemapsSeverity,
} from "./vite-sourcemaps";