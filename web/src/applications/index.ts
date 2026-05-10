import {
  exploitViewerApplication,
  EXPLOIT_VIEWER_APPLICATION_ID,
  createExploitViewerInstanceTitle,
  type ExploitViewerInput,
} from "./exploit-viewer";
import {
  aiAgentApplication,
  AI_AGENT_APPLICATION_ID,
  type AiAgentInput,
} from "./ai-agent";
import {
  postmanApplication,
  POSTMAN_APPLICATION_ID,
  type PostmanInput,
} from "./postman";
import {
	portScanApplication,
	PORT_SCAN_APPLICATION_ID,
	type PortScanInput,
} from "./port-scan";
import {
  zoomeyeApplication,
  ZOOMEYE_APPLICATION_ID,
  type ZoomEyeInput,
} from "./zoomeye";
import {
  zoomeyeHostApplication,
  ZOOMEYE_HOST_APPLICATION_ID,
  createZoomEyeHostInstanceTitle,
  type ZoomEyeHostInput,
} from "./zoomeye-host";
import {
  crawlAuditApplication,
  CRAWL_AUDIT_APPLICATION_ID,
  type CrawlAuditInput,
} from "./crawl-audit";
import {
  cloakBrowsersApplication,
  CLOAK_BROWSERS_APPLICATION_ID,
  createCloakBrowsersInstanceTitle,
  type CloakBrowsersInput,
} from "./cloak-browser-manager";
import {
  inspectorVmApplication,
  INSPECTOR_VM_APPLICATION_ID,
  createInspectorVmInstanceTitle,
  type InspectorVmInput,
} from "./inspector-vm";
import {
  settingsApplication,
  SETTINGS_APPLICATION_ID,
  type SettingsInput,
} from "./settings";
import type { ApplicationDefinition } from "./application";

const applicationRegistry = [
  aiAgentApplication,
  cloakBrowsersApplication,
  crawlAuditApplication,
  exploitViewerApplication,
  inspectorVmApplication,
  settingsApplication,
  postmanApplication,
	portScanApplication,
  zoomeyeApplication,
  zoomeyeHostApplication,
] as const satisfies readonly ApplicationDefinition<unknown>[];

const applicationRegistryById = new Map(
  applicationRegistry.map((application) => [application.id, application]),
);

export function listApplications(): readonly ApplicationDefinition<unknown>[] {
  return applicationRegistry;
}

export function getApplicationDefinition(
  applicationId: string,
): ApplicationDefinition<unknown> | null {
  return applicationRegistryById.get(applicationId) ?? null;
}

export {
  aiAgentApplication,
  AI_AGENT_APPLICATION_ID,
  cloakBrowsersApplication,
  CLOAK_BROWSERS_APPLICATION_ID,
  createCloakBrowsersInstanceTitle,
  crawlAuditApplication,
  CRAWL_AUDIT_APPLICATION_ID,
  exploitViewerApplication,
  EXPLOIT_VIEWER_APPLICATION_ID,
  inspectorVmApplication,
  INSPECTOR_VM_APPLICATION_ID,
  settingsApplication,
  SETTINGS_APPLICATION_ID,
  createInspectorVmInstanceTitle,
  createExploitViewerInstanceTitle,
  postmanApplication,
  POSTMAN_APPLICATION_ID,
	portScanApplication,
	PORT_SCAN_APPLICATION_ID,
  zoomeyeApplication,
  ZOOMEYE_APPLICATION_ID,
  zoomeyeHostApplication,
  ZOOMEYE_HOST_APPLICATION_ID,
  createZoomEyeHostInstanceTitle,
};
export type { AiAgentInput, CloakBrowsersInput, CrawlAuditInput, ExploitViewerInput, InspectorVmInput, PortScanInput, PostmanInput, SettingsInput, ZoomEyeInput, ZoomEyeHostInput };