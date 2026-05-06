import type * as React from "react";
import type { InteractiveApplicationProps } from "./module";
import { $axios, $axiosRegistry } from "../axios";
import { logger } from "../logger";
import { AI_KIT_ID, AXIOS_KIT_ID, CLOAK_KIT_ID, DOMAIN_LOOKUP_KIT_ID, ELASTICSEARCH_KIT_ID, OLLAMA_KIT_ID, PROXY_KIT_ID, QEMU_KIT_ID, STORAGE_KIT_ID, Kit, type AiKit, type AxiosKit, type CloakKit, type DomainLookupKit, type ElasticSearchKit, type OllamaKit, type ProxyKit, type QemuKit, type StorageKit } from "../kits";
import {
  createTableEntity,
  createTextEntity,
  normalizeOutputEntities,
  OutputStack,
  outputStack,
  type OutputEntity,
} from "../primitives";
import { BackgroundLifecycle, type BackgroundWorkerSnapshot } from "../worker";
import { WorkerTop } from "../worker/top";
import { createModulesTableEntity } from "./core/modules";
import {
  consoleSessionStateManager,
  type ActivityConsoleSnapshot,
  type ConsoleSessionState,
  type ConsoleSessionStateManager,
} from "./session-state";

import {
  EvalRuntimeError,
  InvalidParamsError,
  UnknownModuleError,
  isModulePromptError,
} from "./errors";
import type {
  ModuleConsoleParam,
  ModuleDefinition,
  ModuleExecutionContext,
  ModuleExecutor,
} from "./module";
import {
  ModuleSandbox,
  type ModuleSandboxEnvironment,
} from "./sandbox";
import {
  getRecoverableVmCompletionItems,
  RecoverableVm,
  RecoverableVmManager,
} from "./recoverable-vm";
import { runInkConsole } from "./runtime-ink";

type AnyModuleDefinition = ModuleDefinition<unknown, unknown, object>;

type JsModuleProxyState = {
  pathSegments: string[];
  descriptorFlags: string[];
  callValues: unknown[];
};

type JsChainSuggestionContext = {
  inputValue: string;
  leadingPrefix: string;
  pathSegments: string[];
  exactModule: AnyModuleDefinition | null;
  propertyPrefix: string;
  propertyPrefixStart: number | null;
  inCall: boolean;
  callText: string | null;
  objectKeyPrefix: string | null;
  objectKeyPrefixStart: number | null;
};

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackgroundWorkerSnapshot(value: unknown): value is BackgroundWorkerSnapshot {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.scriptPath === "string"
    && typeof value.relativeScriptPath === "string"
    && typeof value.status === "string"
    && typeof value.startedAt === "string"
    && typeof value.updatedAt === "string"
    && typeof value.smol === "boolean";
}

function formatModuleSuggestionDetail(moduleDefinition: AnyModuleDefinition): string {
  const details = [moduleDefinition.category ?? "module", moduleDefinition.description ?? ""];

  if (moduleDefinition.defaultParameterName) {
    details.push(`raw: ${moduleDefinition.defaultParameterName}`);
  }

  return details.filter(Boolean).join(" • ");
}

function formatConsoleParamDetail(param: ModuleConsoleParam): string {
  const details = [
    param.required ? "required" : "optional",
    param.valueType ? `type: ${param.valueType}` : "",
    param.detail ?? "",
    param.values && param.values.length > 0 ? `values: ${param.values.join(", ")}` : "",
    param.example ? `example: ${param.example}` : "",
  ];

  return details.filter(Boolean).join(" • ");
}

function toKebabCase(value: string): string {
  return value
    .replace(/_/gu, "-")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .toLowerCase();
}

function toJsPropertyName(segment: string): string {
  return segment.replace(/-+([A-Za-z0-9])/gu, (_, char: string) => char.toUpperCase());
}

function toJsPropertyAccessor(segment: string): string {
  const propertyName = toJsPropertyName(segment);
  if (JS_IDENTIFIER_PATTERN.test(propertyName)) {
    return `.${propertyName}`;
  }

  return `[${JSON.stringify(segment)}]`;
}

function moduleIdToJsExpression(moduleId: string): string {
  return `$${moduleId
    .split("/")
    .filter(Boolean)
    .map(segment => toJsPropertyAccessor(segment))
    .join("")}`;
}

function getModuleSegmentCandidates(rawProperty: string): string[] {
  const trimmed = rawProperty.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return [
    trimmed,
    trimmed.replace(/_/gu, "-"),
    toKebabCase(trimmed),
  ].filter((candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index);
}

function readUsedObjectParamNames(rawObjectText: string): Set<string> {
  const usedNames = new Set<string>();

  for (const match of rawObjectText.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gu)) {
    const paramName = match[1]?.trim();
    if (paramName) {
      usedNames.add(paramName);
    }
  }

  return usedNames;
}

function findMatchingParenthesis(inputValue: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let index = openIndex; index < inputValue.length; index += 1) {
    const char = inputValue[index];
    if (!char) {
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function readPendingObjectKeyContext(
  rawCallText: string,
  absoluteStart: number,
): { prefix: string; start: number } | null {
  const trimmedStartOffset = rawCallText.length - rawCallText.trimStart().length;
  const trimmed = rawCallText.trimStart();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  const lastCommaIndex = Math.max(trimmed.lastIndexOf(","), trimmed.lastIndexOf("{"));
  const rawTail = trimmed.slice(lastCommaIndex + 1);
  const tailStartOffset = rawTail.length - rawTail.trimStart().length;
  const tail = rawTail.trimStart();

  if (tail.includes(":")) {
    return null;
  }

  const match = tail.match(/^([A-Za-z_$][A-Za-z0-9_$]*)?$/u);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1] ?? "",
    start:
      absoluteStart
      + trimmedStartOffset
      + lastCommaIndex
      + 1
      + tailStartOffset,
  };
}

function isJsChainInput(inputValue: string): boolean {
  const trimmedStart = inputValue.trimStart();
  return trimmedStart.startsWith("$") || trimmedStart.startsWith("await $");
}

function isBooleanConsoleParam(param: ModuleConsoleParam): boolean {
  return param.valueType === "boolean";
}

function getConsoleParamJsDescriptorName(param: ModuleConsoleParam): string {
  return param.jsDescriptorName ?? toJsPropertyName(param.name);
}

function getConsoleParamExampleValue(param: ModuleConsoleParam): string | null {
  const examplePrefix = `${param.name}=`;
  if (!param.example) {
    return null;
  }

  const exampleValue = param.example.startsWith(examplePrefix)
    ? param.example.slice(examplePrefix.length).trim()
    : param.example.trim();

  return exampleValue.length > 0 ? exampleValue : null;
}

function getConsoleParamJsAssignment(param: ModuleConsoleParam): string {
  if (param.valueType !== "boolean" && param.values && param.values.length > 0) {
    const exampleValue = getConsoleParamExampleValue(param);
    const enumValue = exampleValue && param.values.includes(exampleValue)
      ? exampleValue
      : param.values[0];

    if (enumValue) {
      return `${param.name}: ${JSON.stringify(enumValue)}`;
    }
  }

  switch (param.valueType) {
    case "boolean":
      return `${param.name}: true`;
    case "number":
      return `${param.name}: 0`;
    case "string":
      return `${param.name}: ""`;
    case "json":
      return `${param.name}: {}`;
    case "string[]":
      return `${param.name}: []`;
    default:
      return `${param.name}: `;
  }
}

export type ModuleRuntimeOptions<THelpers extends object> = {
  argv?: string[];
  helpers?: THelpers;
  outputStack?: OutputStack;
  sandboxEnvironment?: ModuleSandboxEnvironment;
  allowInteractiveApplications?: boolean;
  prompt?: string;
  fullscreen?: boolean;
  sessionStateManager?: ConsoleSessionStateManager;
};

export type ModuleConsoleEntry = {
  kind: "command" | "output" | "info" | "error";
  text: string;
};

export type ModuleConsoleSuggestionItem = {
  value: string;
  label?: string;
  detail?: string;
  kind: "command" | "activity" | "session" | "module";
};

export type ModuleNotebookCompletionItem = Pick<
  ModuleConsoleSuggestionItem,
  "value" | "label" | "detail" | "kind"
>;

export class InteractiveApplicationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractiveApplicationUnavailableError";
    this.stack = undefined;
  }
}

export type ModuleConsoleCommandResult = {
  entries: ModuleConsoleEntry[];
  entities?: OutputEntity[];
  sessionCommand?: "save" | "clear";
  activityCommand?: "new" | "next" | "previous" | "close";
  shouldExit: boolean;
  exitCode: number;
};

type ModuleExecutionOptions = {
  allowInteractiveApplications?: boolean;
  interactiveUnavailableTarget?: string;
};

type ModuleEvalHostContext<THelpers extends object> = THelpers & {
  $: unknown;
  $axios: typeof $axios;
  $axiosRegistry: typeof $axiosRegistry;
  runtime: ModuleRuntime<THelpers>;
  logger: typeof logger;
  modules: AnyModuleDefinition[];
  currentModule: AnyModuleDefinition | null;
  listModules(): AnyModuleDefinition[];
  listKits(): Kit[];
  getKit<TKit extends Kit = Kit>(id: string): TKit | null;
  requireKit<TKit extends Kit = Kit>(id: string): TKit;
  getAiKit(): AiKit | null;
  requireAiKit(): AiKit;
  getCloakKit(): CloakKit | null;
  requireCloakKit(): CloakKit;
  getDomainLookupKit(): DomainLookupKit | null;
  requireDomainLookupKit(): DomainLookupKit;
  getProxyKit(): ProxyKit | null;
  requireProxyKit(): ProxyKit;
  getStorageKit(): StorageKit | null;
  requireStorageKit(): StorageKit;
  getElasticSearchKit(): ElasticSearchKit | null;
  requireElasticSearchKit(): ElasticSearchKit;
  getOllamaKit(): OllamaKit | null;
  requireOllamaKit(): OllamaKit;
  getQemuKit(): QemuKit | null;
  requireQemuKit(): QemuKit;
  getAxiosKit(): AxiosKit | null;
  requireAxiosKit(): AxiosKit;
  run(id?: string, params?: unknown): Promise<unknown>;

  runModule(id: string, params?: unknown): Promise<unknown>;
  use(id: string): AnyModuleDefinition;
  useModule(id: string): AnyModuleDefinition;
  help(): string;
};

type ModuleEvalContext<THelpers extends object> = ModuleEvalHostContext<THelpers> & {
  $vm: RecoverableVmManager;
  $axios: typeof $axios;
  $axiosRegistry: typeof $axiosRegistry;
};

export class ModuleRuntime<THelpers extends object = object> {
  private readonly modules = new Map<string, AnyModuleDefinition>();
  private readonly moduleAliases = new Map<string, string>();
  private readonly activeKits = new Map<string, Kit>();
  private readonly argv: string[];
  private readonly helpers: THelpers;
  private readonly prompt: string;
  private readonly fullscreen: boolean;
  private readonly allowInteractiveApplications: boolean;
  private readonly sessionStateManager: ConsoleSessionStateManager;
  private readonly sandbox: ModuleSandbox;
  private readonly outputStack: OutputStack;
  private currentModuleId: string | null = null;
  private currentApplication: {
    Component: React.ComponentType<any>;
    props: Record<string, unknown>;
    resolve: (exitCode: number) => void;
  } | null = null;
  private readonly applicationListeners = new Set<(app: any) => void>();

  constructor(
    definitions: readonly AnyModuleDefinition[],
    options: ModuleRuntimeOptions<THelpers> = {},
  ) {
    for (const definition of definitions) {
      if (this.modules.has(definition.id)) {
        throw new Error(`Module is already registered: ${definition.id}`);
      }

      this.modules.set(definition.id, definition);

    for (const alias of definition.aliases ?? []) {
    if (alias === definition.id) {
      continue;
    }

    if (this.modules.has(alias)) {
      throw new Error(`Module alias conflicts with an existing module id: ${alias}`);
    }

    const existingAliasTarget = this.moduleAliases.get(alias);
    if (existingAliasTarget && existingAliasTarget !== definition.id) {
      throw new Error(`Module alias is already registered: ${alias}`);
    }

    this.moduleAliases.set(alias, definition.id);
    }
    }

    this.argv = options.argv ?? Bun.argv.slice(2);
    this.outputStack = options.outputStack ?? outputStack;
    this.helpers = {
      ...(options.helpers ?? {}),
      output: this.outputStack,
    } as THelpers;
    this.prompt = options.prompt ?? "/> ";
    this.fullscreen = options.fullscreen ?? true;
    this.allowInteractiveApplications = options.allowInteractiveApplications ?? true;
    this.sessionStateManager =
      options.sessionStateManager ?? consoleSessionStateManager;
    this.sandbox = new ModuleSandbox({
      environment: options.sandboxEnvironment,
    });
  }

  getOutputStack(): OutputStack {
    return this.outputStack;
  }

  getHelpers(): THelpers {
    return this.helpers;
  }

  getCurrentApplication() {
    return this.currentApplication;
  }

  subscribeToApplication(listener: (app: any) => void) {
    this.applicationListeners.add(listener);
    listener(this.currentApplication);
    return () => this.applicationListeners.delete(listener);
  }

  runInteractiveApplication<P extends InteractiveApplicationProps>(
    Component: React.ComponentType<P>,
    props?: Omit<P, keyof InteractiveApplicationProps>,
  ): Promise<number> {
    if (!this.allowInteractiveApplications) {
      const componentName = Component.displayName || Component.name || "Interactive application";
      return Promise.reject(
        this.createInteractiveApplicationUnavailableError(componentName, "this module output window"),
      );
    }

    return new Promise((resolve) => {
      this.currentApplication = { Component, props: props ?? {}, resolve };
      for (const listener of this.applicationListeners) {
        listener(this.currentApplication);
      }
    });
  }

  closeInteractiveApplication(exitCode: number = 0): void {
    if (!this.currentApplication) {
      return;
    }

    const { resolve } = this.currentApplication;
    this.currentApplication = null;
    for (const listener of this.applicationListeners) {
      listener(this.currentApplication);
    }
    resolve(exitCode);
  }

  private createInteractiveApplicationUnavailableError(
    componentName: string,
    target: string,
  ): InteractiveApplicationUnavailableError {
    return new InteractiveApplicationUnavailableError(
      `${componentName} is not available in ${target}. Run this module from the interactive console instead.`,
    );
  }

  listKits(): Kit[] {
    return [...this.activeKits.values()];
  }

  getKit<TKit extends Kit = Kit>(id: string): TKit | null {
    return (this.activeKits.get(id) as TKit | undefined) ?? null;
  }

  requireKit<TKit extends Kit = Kit>(id: string): TKit {
    const kit = this.getKit<TKit>(id);
    if (!kit) {
      throw new InvalidParamsError(
        `Kit '${id}' is not attached to the current Activity.`,
      );
    }

    return kit;
  }

  getAiKit(): AiKit | null {
    return this.getKit<AiKit>(AI_KIT_ID);
  }

  requireAiKit(): AiKit {
    const kit = this.getAiKit();
    if (!kit) {
      throw new InvalidParamsError(
        "AiKit is not connected in this Activity. Use $.kits.ai.connect({ name: \"local\", provider: \"openai-compatible\", model: \"llama3.1\" }) first.",
      );
    }

    return kit;
  }

  getCloakKit(): CloakKit | null {
    return this.getKit<CloakKit>(CLOAK_KIT_ID);
  }

  requireCloakKit(): CloakKit {
    const kit = this.getCloakKit();
    if (!kit) {
      throw new InvalidParamsError(
        "CloakKit is not connected in this Activity. Use $.kits.cloak.manager() first.",
      );
    }

    return kit;
  }

  getDomainLookupKit(): DomainLookupKit | null {
    return this.getKit<DomainLookupKit>(DOMAIN_LOOKUP_KIT_ID);
  }

  requireDomainLookupKit(): DomainLookupKit {
    const kit = this.getDomainLookupKit();
    if (!kit) {
      throw new InvalidParamsError(
        "DomainLookupKit is not connected in this Activity. Use $.discovery.domainLookup({ domain: \"example.com\" }) first.",
      );
    }

    return kit;
  }

  getProxyKit(): ProxyKit | null {
    return this.getKit<ProxyKit>(PROXY_KIT_ID);
  }

  requireProxyKit(): ProxyKit {
    const kit = this.getProxyKit();
    if (!kit) {
      throw new InvalidParamsError(
        "ProxyKit is not connected in this Activity. Use $.kits.proxy.manager() first.",
      );
    }

    return kit;
  }

  getStorageKit(): StorageKit | null {
    return this.getKit<StorageKit>(STORAGE_KIT_ID);
  }

  requireStorageKit(): StorageKit {
    const kit = this.getStorageKit();
    if (!kit) {
      throw new InvalidParamsError(
        "StorageKit is not connected in this Activity.",
      );
    }

    return kit;
  }

  getElasticSearchKit(): ElasticSearchKit | null {
    return this.getKit<ElasticSearchKit>(ELASTICSEARCH_KIT_ID);
  }

  requireElasticSearchKit(): ElasticSearchKit {
    const kit = this.getElasticSearchKit();
    if (!kit) {
      throw new InvalidParamsError(
        "ElasticSearchKit is not connected in this Activity. Use $.kits.elastic.connect({ node: \"http://127.0.0.1:9200\" }) first.",
      );
    }

    return kit;
  }

  getOllamaKit(): OllamaKit | null {
    return this.getKit<OllamaKit>(OLLAMA_KIT_ID);
  }

  requireOllamaKit(): OllamaKit {
    const kit = this.getOllamaKit();
    if (!kit) {
      throw new InvalidParamsError(
        "OllamaKit is not connected in this Activity. Use $.kits.ollamaConnect({ url: \"http://127.0.0.1:11434\" }) first.",
      );
    }

    return kit;
  }

  getQemuKit(): QemuKit | null {
    return this.getKit<QemuKit>(QEMU_KIT_ID);
  }

  requireQemuKit(): QemuKit {
    const kit = this.getQemuKit();
    if (!kit) {
      throw new InvalidParamsError(
        "QemuKit is not connected in this Activity. Use $.kits.qemu.manager() or $.kits.qemu.connect({ architecture: \"x86_64\" }) first.",
      );
    }

    return kit;
  }

  getAxiosKit(): AxiosKit | null {
    return this.getKit<AxiosKit>(AXIOS_KIT_ID);
  }

  requireAxiosKit(): AxiosKit {
    const kit = this.getAxiosKit();
    if (!kit) {
      throw new InvalidParamsError(
        "AxiosKit is not connected in this Activity. Use $.kits.axios.with({ instanceId: \"default\" }) first.",
      );
    }

    return kit;
  }

  async attachKit<TKit extends Kit>(
    kit: TKit,
    context: { reason?: string } = {},
  ): Promise<TKit> {
    const currentKit = this.activeKits.get(kit.id);
    if (currentKit && currentKit !== kit) {
      this.activeKits.delete(kit.id);
      await currentKit.stop({ reason: context.reason ?? "replaced" });
    }

    this.activeKits.set(kit.id, kit);
    if (!kit.isActive()) {
      await kit.start({ reason: context.reason ?? "attached" });
    }

    return kit;
  }

  async detachKit(
    id: string,
    context: { reason?: string } = {},
  ): Promise<boolean> {
    const kit = this.activeKits.get(id);
    if (!kit) {
      return false;
    }

    this.activeKits.delete(id);
    await kit.stop({ reason: context.reason ?? "detached" });
    return true;
  }

  async dispose(): Promise<void> {
    const kits = [...this.activeKits.values()];
    this.activeKits.clear();
    await Promise.allSettled(
      kits.map(async kit => {
        await kit.stop({ reason: "runtime disposed" });
      }),
    );
  }

  fork(options: { outputStack?: OutputStack; allowInteractiveApplications?: boolean } = {}): ModuleRuntime<THelpers> {
    return new ModuleRuntime(this.listModules(), {
      argv: [...this.argv],
      helpers: this.helpers,
      outputStack: options.outputStack ?? new OutputStack(),
      sandboxEnvironment: this.getSandboxEnvironment(),
      allowInteractiveApplications: options.allowInteractiveApplications ?? this.allowInteractiveApplications,
      prompt: this.prompt,
      fullscreen: this.fullscreen,
      sessionStateManager: this.sessionStateManager,
    });
  }

  listModules(): AnyModuleDefinition[] {
    return [...this.modules.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  useModule(id: string): AnyModuleDefinition {
	const moduleDefinition = this.resolveModuleDefinition(id);
    if (!moduleDefinition) {
      throw new UnknownModuleError(id);
    }

	this.currentModuleId = moduleDefinition.id;
    return moduleDefinition;
  }

  getCurrentModule(): AnyModuleDefinition | null {
    return this.currentModuleId
      ? (this.modules.get(this.currentModuleId) ?? null)
      : null;
  }

  getCurrentModuleId(): string | null {
    return this.currentModuleId;
  }

  clearCurrentModule(): AnyModuleDefinition | null {
    const previousModule = this.getCurrentModule();
    this.currentModuleId = null;
    return previousModule;
  }

  getModuleJsExpression(moduleId: string): string {
    return moduleIdToJsExpression(moduleId);
  }

  private getModuleDefinitionBySegments(pathSegments: readonly string[]): AnyModuleDefinition | null {
    if (pathSegments.length === 0) {
      return null;
    }

	return this.resolveModuleDefinition(pathSegments.join("/"));
  }

  private hasModulePrefix(pathSegments: readonly string[]): boolean {
    if (pathSegments.length === 0) {
      return this.modules.size > 0;
    }

    const exactPath = pathSegments.join("/");
    const prefix = `${exactPath}/`;
    for (const moduleId of this.modules.keys()) {
      if (moduleId === exactPath || moduleId.startsWith(prefix)) {
        return true;
      }
    }

    for (const alias of this.moduleAliases.keys()) {
      if (alias === exactPath || alias.startsWith(prefix)) {
      return true;
      }
    }

    return false;
  }

    private resolveModuleDefinition(id: string): AnyModuleDefinition | null {
      const moduleDefinition = this.modules.get(id);
      if (moduleDefinition) {
      return moduleDefinition;
      }

      const canonicalId = this.moduleAliases.get(id);
      return canonicalId ? this.modules.get(canonicalId) ?? null : null;
    }

  private resolveJsModuleSegment(pathSegments: readonly string[], rawProperty: string): string | null {
    for (const candidate of getModuleSegmentCandidates(rawProperty)) {
      if (this.hasModulePrefix([...pathSegments, candidate])) {
        return candidate;
      }
    }

    return null;
  }

  private materializeJsModuleParams(
    moduleDefinition: AnyModuleDefinition,
    state: JsModuleProxyState,
  ): unknown {
    const flagsRecord = Object.fromEntries(
      state.descriptorFlags.map(flagName => [flagName, true] as const),
    );
    const hasFlags = Object.keys(flagsRecord).length > 0;

    if (state.callValues.length === 0) {
      return hasFlags ? flagsRecord : undefined;
    }

    if (state.callValues.length === 1) {
      const singleValue = state.callValues[0];
      if (isRecord(singleValue)) {
        return {
          ...singleValue,
          ...flagsRecord,
        };
      }

      if (!hasFlags) {
        return singleValue;
      }

      return {
        value: singleValue,
        ...flagsRecord,
      };
    }

    if (state.callValues.every(isRecord)) {
      const mergedRecord = state.callValues.reduce<Record<string, unknown>>(
        (accumulator, value) => ({
          ...accumulator,
          ...(value as Record<string, unknown>),
        }),
        {},
      );
      return {
        ...mergedRecord,
        ...flagsRecord,
      };
    }

    if (moduleDefinition.defaultParameterName) {
      return {
        [moduleDefinition.defaultParameterName]: state.callValues.length === 1
          ? state.callValues[0]
          : [...state.callValues],
        ...flagsRecord,
      };
    }

    return hasFlags
      ? {
        args: [...state.callValues],
        ...flagsRecord,
      }
      : [...state.callValues];
  }

  private async executeJsModuleProxy(
    state: JsModuleProxyState,
    executionOptions: ModuleExecutionOptions = {},
  ): Promise<unknown> {
    const moduleDefinition = this.getModuleDefinitionBySegments(state.pathSegments);
    if (!moduleDefinition) {
      if (state.pathSegments.length === 0) {
        throw new InvalidParamsError("No module selected in $ chain. Use $.category.module(...).");
      }

      throw new InvalidParamsError(
        `Unknown or incomplete $ chain: ${state.pathSegments.join("/")}`,
      );
    }

    return await this.runModuleWithExecutionOptions(
      moduleDefinition.id,
      this.materializeJsModuleParams(moduleDefinition, state),
      executionOptions,
    );
  }

  private createJsModuleProxy(
    state: JsModuleProxyState = {
      pathSegments: [],
      descriptorFlags: [],
      callValues: [],
    },
    executionOptions: ModuleExecutionOptions = {},
  ): unknown {
    const target = (...inputArgs: unknown[]) => this.createJsModuleProxy({
      ...state,
      callValues: [...state.callValues, ...inputArgs],
    }, executionOptions);

    return new Proxy(target, {
      get: (_target, property) => {
        if (property === "then") {
          return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
            void this.executeJsModuleProxy(state, executionOptions).then(resolve, reject);
          };
        }

        if (property === "with") {
          return (config: unknown) => this.createJsModuleProxy({
            ...state,
            callValues: [...state.callValues, config],
          }, executionOptions);
        }

        if (property === Symbol.toPrimitive) {
          return () => state.pathSegments.join("/");
        }

        if (typeof property !== "string") {
          return Reflect.get(target, property);
        }

        if (state.descriptorFlags.length === 0) {
          const resolvedSegment = this.resolveJsModuleSegment(state.pathSegments, property);
          if (resolvedSegment) {
            return this.createJsModuleProxy({
              ...state,
              pathSegments: [...state.pathSegments, resolvedSegment],
            }, executionOptions);
          }
        }

        return this.createJsModuleProxy({
          ...state,
          descriptorFlags: [...state.descriptorFlags, property],
        }, executionOptions);
      },
      apply: (_target, _thisArg, inputArgs) => this.createJsModuleProxy({
        ...state,
        callValues: [...state.callValues, ...inputArgs],
      }, executionOptions),
    });
  }

  private parseJsChainSuggestionContext(inputValue: string): JsChainSuggestionContext | null {
    if (!isJsChainInput(inputValue)) {
      return null;
    }

    const dollarIndex = inputValue.indexOf("$");
    if (dollarIndex < 0) {
      return null;
    }

    const leadingPrefix = inputValue.slice(0, dollarIndex);
    const trimmedLeading = leadingPrefix.trim();
    if (trimmedLeading.length > 0 && trimmedLeading !== "await") {
      return null;
    }

    const pathSegments: string[] = [];
    let exactModule: AnyModuleDefinition | null = null;
    let encounteredFlags = false;
    let index = dollarIndex + 1;

    while (index < inputValue.length) {
      const char = inputValue[index];
      if (!char) {
        break;
      }

      if (/\s/u.test(char)) {
        index += 1;
        continue;
      }

      if (char === ".") {
        index += 1;
        const propertyStart = index;

        while (index < inputValue.length) {
          const propertyChar = inputValue[index];
          if (!propertyChar || !/[A-Za-z0-9_$]/u.test(propertyChar)) {
            break;
          }
          index += 1;
        }

        if (propertyStart >= inputValue.length) {
          return {
            inputValue,
            leadingPrefix,
            pathSegments,
            exactModule,
            propertyPrefix: "",
            propertyPrefixStart: propertyStart,
            inCall: false,
            callText: null,
            objectKeyPrefix: null,
            objectKeyPrefixStart: null,
          };
        }

        const rawProperty = inputValue.slice(propertyStart, index);
        const nextChar = inputValue[index];

        if (index >= inputValue.length) {
          if (!encounteredFlags) {
            const resolvedSegment = this.resolveJsModuleSegment(pathSegments, rawProperty);
            if (resolvedSegment) {
              const resolvedPathSegments = [...pathSegments, resolvedSegment];
              return {
                inputValue,
                leadingPrefix,
                pathSegments: resolvedPathSegments,
                exactModule: this.getModuleDefinitionBySegments(resolvedPathSegments),
                propertyPrefix: "",
                propertyPrefixStart: null,
                inCall: false,
                callText: null,
                objectKeyPrefix: null,
                objectKeyPrefixStart: null,
              };
            }
          }

          return {
            inputValue,
            leadingPrefix,
            pathSegments,
            exactModule,
            propertyPrefix: rawProperty,
            propertyPrefixStart: propertyStart,
            inCall: false,
            callText: null,
            objectKeyPrefix: null,
            objectKeyPrefixStart: null,
          };
        }

        if (rawProperty === "with" && exactModule && nextChar === "(") {
          const closeIndex = findMatchingParenthesis(inputValue, index);
          if (closeIndex < 0) {
            const callText = inputValue.slice(index + 1);
            const objectKeyContext = readPendingObjectKeyContext(callText, index + 1);
            return {
              inputValue,
              leadingPrefix,
              pathSegments,
              exactModule,
              propertyPrefix: "",
              propertyPrefixStart: null,
              inCall: true,
              callText,
              objectKeyPrefix: objectKeyContext?.prefix ?? null,
              objectKeyPrefixStart: objectKeyContext?.start ?? null,
            };
          }

          index = closeIndex + 1;
          continue;
        }

        if (!encounteredFlags) {
          const resolvedSegment = this.resolveJsModuleSegment(pathSegments, rawProperty);
          if (resolvedSegment) {
            pathSegments.push(resolvedSegment);
            exactModule = this.getModuleDefinitionBySegments(pathSegments);
            continue;
          }
        }

        encounteredFlags = true;
        continue;
      }

      if (char === "[") {
        const quote = inputValue[index + 1];
        if (quote !== '"' && quote !== "'") {
          return null;
        }

        let propertyIndex = index + 2;
        let propertyValue = "";
        let escaped = false;

        while (propertyIndex < inputValue.length) {
          const propertyChar = inputValue[propertyIndex];
          if (!propertyChar) {
            break;
          }

          if (escaped) {
            propertyValue += propertyChar;
            escaped = false;
            propertyIndex += 1;
            continue;
          }

          if (propertyChar === "\\") {
            escaped = true;
            propertyIndex += 1;
            continue;
          }

          if (propertyChar === quote) {
            break;
          }

          propertyValue += propertyChar;
          propertyIndex += 1;
        }

        if (propertyIndex >= inputValue.length) {
          return {
            inputValue,
            leadingPrefix,
            pathSegments,
            exactModule,
            propertyPrefix: propertyValue,
            propertyPrefixStart: index + 2,
            inCall: false,
            callText: null,
            objectKeyPrefix: null,
            objectKeyPrefixStart: null,
          };
        }

        const closingBracketIndex = propertyIndex + 1;
        if (inputValue[closingBracketIndex] !== "]") {
          return {
            inputValue,
            leadingPrefix,
            pathSegments,
            exactModule,
            propertyPrefix: propertyValue,
            propertyPrefixStart: index + 2,
            inCall: false,
            callText: null,
            objectKeyPrefix: null,
            objectKeyPrefixStart: null,
          };
        }

        if (!encounteredFlags) {
          const resolvedSegment = this.resolveJsModuleSegment(pathSegments, propertyValue);
          if (resolvedSegment) {
            pathSegments.push(resolvedSegment);
            exactModule = this.getModuleDefinitionBySegments(pathSegments);
            index = closingBracketIndex + 1;
            continue;
          }
        }

        encounteredFlags = true;
        index = closingBracketIndex + 1;
        continue;
      }

      if (char === "(") {
        const closeIndex = findMatchingParenthesis(inputValue, index);
        if (closeIndex < 0) {
          const callText = inputValue.slice(index + 1);
          const objectKeyContext = readPendingObjectKeyContext(callText, index + 1);
          return {
            inputValue,
            leadingPrefix,
            pathSegments,
            exactModule,
            propertyPrefix: "",
            propertyPrefixStart: null,
            inCall: true,
            callText,
            objectKeyPrefix: objectKeyContext?.prefix ?? null,
            objectKeyPrefixStart: objectKeyContext?.start ?? null,
          };
        }

        index = closeIndex + 1;
        continue;
      }

      return null;
    }

    return {
      inputValue,
      leadingPrefix,
      pathSegments,
      exactModule: this.getModuleDefinitionBySegments(pathSegments),
      propertyPrefix: "",
      propertyPrefixStart: null,
      inCall: false,
      callText: null,
      objectKeyPrefix: null,
      objectKeyPrefixStart: null,
    };
  }

  private createJsSuggestionItem(
    value: string,
    detail: string,
    kind: ModuleConsoleSuggestionItem["kind"] = "module",
    label?: string,
  ): ModuleConsoleSuggestionItem {
    return { value, label, detail, kind };
  }

  private getJsModuleSegmentSuggestionItems(
    context: JsChainSuggestionContext,
  ): ModuleConsoleSuggestionItem[] {
    const suggestions: ModuleConsoleSuggestionItem[] = [];
    const nextSegments = new Map<string, AnyModuleDefinition | null>();
    const prefixDepth = context.pathSegments.length;

    for (const moduleDefinition of this.listModules()) {
      const segments = moduleDefinition.id.split("/");
      if (segments.length <= prefixDepth) {
        continue;
      }

      const matchesPrefix = context.pathSegments.every(
        (segment, segmentIndex) => segments[segmentIndex] === segment,
      );
      if (!matchesPrefix) {
        continue;
      }

      const nextSegment = segments[prefixDepth];
      if (!nextSegment) {
        continue;
      }

      const jsPropertyName = toJsPropertyName(nextSegment);
      if (
        context.propertyPrefix.length > 0
        && !jsPropertyName.startsWith(context.propertyPrefix)
        && !nextSegment.startsWith(toKebabCase(context.propertyPrefix))
      ) {
        continue;
      }

      const exactPath = [...context.pathSegments, nextSegment].join("/");
      nextSegments.set(nextSegment, this.modules.get(exactPath) ?? null);
    }

    for (const [segment, moduleDefinition] of nextSegments) {
      const moduleExpression = `${context.leadingPrefix}${moduleIdToJsExpression(
        [...context.pathSegments, segment].join("/"),
      )}`;
      suggestions.push(this.createJsSuggestionItem(
        moduleExpression,
        moduleDefinition
          ? formatModuleSuggestionDetail(moduleDefinition)
          : `module group • ${[...context.pathSegments, segment].join("/")}`,
      ));
    }

    return suggestions;
  }

  private getJsParamAccessorSuggestionItems(
    context: JsChainSuggestionContext,
  ): ModuleConsoleSuggestionItem[] {
    const moduleDefinition = context.exactModule;
    if (!moduleDefinition || context.propertyPrefixStart === null) {
      return [];
    }

    const replacementBase = context.inputValue.slice(0, context.propertyPrefixStart);
    return (moduleDefinition.consoleParams ?? [])
      .filter(isBooleanConsoleParam)
      .filter(param => (
        context.propertyPrefix.length === 0
        || getConsoleParamJsDescriptorName(param).startsWith(context.propertyPrefix)
      ))
      .map(param => this.createJsSuggestionItem(
        `${replacementBase}${getConsoleParamJsDescriptorName(param)}`,
        `${formatConsoleParamDetail(param)} • getter => { ${param.name}: true }`,
      ));
  }

  private getJsParamCallSuggestionItems(
    context: JsChainSuggestionContext,
  ): ModuleConsoleSuggestionItem[] {
    const moduleDefinition = context.exactModule;
    if (!moduleDefinition) {
      return [];
    }

    const moduleExpression = `${context.leadingPrefix}${moduleIdToJsExpression(moduleDefinition.id)}`;
    const propertyPrefix = context.propertyPrefix.trim();

    return (moduleDefinition.consoleParams ?? [])
      .filter(param => propertyPrefix.length === 0 || param.name.startsWith(propertyPrefix))
      .map(param => this.createJsSuggestionItem(
        `${moduleExpression}({ ${getConsoleParamJsAssignment(param)} })`,
        `${formatConsoleParamDetail(param)} • execute with typed argument`,
      ));
  }

  private getJsObjectParamSuggestionItems(
    context: JsChainSuggestionContext,
  ): ModuleConsoleSuggestionItem[] {
    const moduleDefinition = context.exactModule;
    if (
      !moduleDefinition
      || !context.callText
      || context.objectKeyPrefixStart === null
      || context.objectKeyPrefix === null
    ) {
      return [];
    }

    const usedParamNames = readUsedObjectParamNames(context.callText);
    const replacementBase = context.inputValue.slice(0, context.objectKeyPrefixStart);
    const objectKeyPrefix = context.objectKeyPrefix;
    return (moduleDefinition.consoleParams ?? [])
      .filter(param => !usedParamNames.has(param.name))
      .filter(param => objectKeyPrefix.length === 0 || param.name.startsWith(objectKeyPrefix))
      .map(param => this.createJsSuggestionItem(
        `${replacementBase}${getConsoleParamJsAssignment(param)}`,
        formatConsoleParamDetail(param),
      ));
  }

  private getJsModuleExecutionSuggestionItems(
    context: JsChainSuggestionContext,
  ): ModuleConsoleSuggestionItem[] {
    const moduleDefinition = context.exactModule;
    if (!moduleDefinition || context.inCall) {
      return [];
    }

    if (context.propertyPrefixStart !== null) {
      const booleanAccessorSuggestions = this.getJsParamAccessorSuggestionItems(context);
      const paramCallSuggestions = this.getJsParamCallSuggestionItems(context);
      const moduleExpression = `${context.leadingPrefix}${moduleIdToJsExpression(moduleDefinition.id)}`;
      const firstParam = (moduleDefinition.consoleParams ?? [])[0];
      const builderSuggestions = context.propertyPrefix.length === 0 || "with".startsWith(context.propertyPrefix)
        ? [
          this.createJsSuggestionItem(
            firstParam
              ? `${moduleExpression}.with({ ${getConsoleParamJsAssignment(firstParam)} })`
              : `${moduleExpression}.with({})`,
            `Execute ${moduleDefinition.id} with config builder`,
          ),
        ]
        : [];

      return [
        ...booleanAccessorSuggestions,
        ...paramCallSuggestions,
        ...builderSuggestions,
      ];
    }

    const moduleExpression = `${context.leadingPrefix}${moduleIdToJsExpression(moduleDefinition.id)}`;
    const suggestions: ModuleConsoleSuggestionItem[] = [
      this.createJsSuggestionItem(
        `${moduleExpression}()`,
        `Execute ${moduleDefinition.id}`,
        "command",
        "Run",
      ),
    ];
    const firstParam = (moduleDefinition.consoleParams ?? [])[0];
    if (firstParam) {
      suggestions.push(
        this.createJsSuggestionItem(
          `${moduleExpression}({ ${getConsoleParamJsAssignment(firstParam)} })`,
          `Execute ${moduleDefinition.id} with params object`,
        ),
      );
      suggestions.push(
        this.createJsSuggestionItem(
          `${moduleExpression}.with({ ${getConsoleParamJsAssignment(firstParam)} })`,
          `Execute ${moduleDefinition.id} with config builder`,
        ),
      );
    }

    return suggestions;
  }

  private getJsChainSuggestionItems(inputValue: string): ModuleConsoleSuggestionItem[] {
    const context = this.parseJsChainSuggestionContext(inputValue);
    if (!context) {
      return [];
    }

    const suggestions = [
      ...this.getJsObjectParamSuggestionItems(context),
      ...this.getJsModuleSegmentSuggestionItems(context),
      ...this.getJsModuleExecutionSuggestionItems(context),
    ];
    const uniqueSuggestions = new Map<string, ModuleConsoleSuggestionItem>();

    for (const suggestion of suggestions) {
      if (!uniqueSuggestions.has(suggestion.value)) {
        uniqueSuggestions.set(suggestion.value, suggestion);
      }
    }

    return [...uniqueSuggestions.values()].slice(0, 10);
  }

  getNotebookCompletionItems(inputValue: string): ModuleNotebookCompletionItem[] {
    const suggestions = [
      ...this.getJsChainSuggestionItems(inputValue),
      ...getRecoverableVmCompletionItems(inputValue),
    ];
    const uniqueSuggestions = new Map<string, ModuleNotebookCompletionItem>();

    for (const suggestion of suggestions) {
      if (!uniqueSuggestions.has(suggestion.value)) {
        uniqueSuggestions.set(suggestion.value, {
          value: suggestion.value,
          label: suggestion.label,
          detail: suggestion.detail,
          kind: suggestion.kind,
        });
      }
    }

    return [...uniqueSuggestions.values()].slice(0, 10);
  }

  getConsolePrompt(): string {
    return this.currentModuleId
      ? `${this.currentModuleId}${this.prompt}`
      : this.prompt;
  }

  async runModule<TResult = unknown, TParams = unknown>(
    id: string,
    params?: TParams,
  ): Promise<TResult> {
    return await this.runModuleWithExecutionOptions(id, params);
  }

  private async runModuleWithExecutionOptions<TResult = unknown, TParams = unknown>(
    id: string,
    params?: TParams,
    executionOptions: ModuleExecutionOptions = {},
  ): Promise<TResult> {
    const moduleDefinition = this.useModule(id);
    const normalizedParams = this.normalizeModuleParams(
      moduleDefinition as ModuleDefinition<TParams, TResult, THelpers>,
      params,
    );
    const allowInteractiveApplications = executionOptions.allowInteractiveApplications ?? this.allowInteractiveApplications;
    const interactiveUnavailableTarget = executionOptions.interactiveUnavailableTarget ?? "this runtime context";
    const context: ModuleExecutionContext<TParams, THelpers> = {
      ...this.helpers,
      argv: this.argv,
      logger,
      module: moduleDefinition as ModuleDefinition<TParams, TResult, THelpers>,
      params: (normalizedParams ?? {}) as TParams,
      runtime: this,
      listModules: () => this.listModules(),
      listKits: () => this.listKits(),
      getKit: <TKit extends Kit = Kit>(id: string) => this.getKit<TKit>(id),
      requireKit: <TKit extends Kit = Kit>(id: string) =>
        this.requireKit<TKit>(id),
      getAiKit: () => this.getAiKit(),
      requireAiKit: () => this.requireAiKit(),
      getCloakKit: () => this.getCloakKit(),
      requireCloakKit: () => this.requireCloakKit(),
      getDomainLookupKit: () => this.getDomainLookupKit(),
      requireDomainLookupKit: () => this.requireDomainLookupKit(),
      getProxyKit: () => this.getProxyKit(),
      requireProxyKit: () => this.requireProxyKit(),
      getStorageKit: () => this.getStorageKit(),
      requireStorageKit: () => this.requireStorageKit(),
      getElasticSearchKit: () => this.getElasticSearchKit(),
      requireElasticSearchKit: () => this.requireElasticSearchKit(),
      getOllamaKit: () => this.getOllamaKit(),
      requireOllamaKit: () => this.requireOllamaKit(),
      getQemuKit: () => this.getQemuKit(),
      requireQemuKit: () => this.requireQemuKit(),
      getAxiosKit: () => this.getAxiosKit(),
      requireAxiosKit: () => this.requireAxiosKit(),
      runModule: async <TInnerResult = unknown, TInnerParams = unknown>(
        nextId: string,
        nextParams?: TInnerParams,
      ) => await this.runModuleWithExecutionOptions<TInnerResult, TInnerParams>(
        nextId,
        nextParams,
        executionOptions,
      ),
      useModule: (nextId: string) => this.useModule(nextId),
      runInteractiveApplication: async <P extends InteractiveApplicationProps>(
        Component: React.ComponentType<P>,
        props?: Omit<P, keyof InteractiveApplicationProps>,
      ) => {
        if (!allowInteractiveApplications) {
          const componentName = Component.displayName || Component.name || "Interactive application";
          throw this.createInteractiveApplicationUnavailableError(
            componentName,
            interactiveUnavailableTarget,
          );
        }

        return await this.runInteractiveApplication(Component, props);
      },
    };

    return await (
      moduleDefinition.executor as ModuleExecutor<TParams, TResult, THelpers>
    )(context);
  }

  async evaluate(code: string): Promise<unknown> {
    try {
      return await this.sandbox.execute(
        code,
        this.createEvalContext() as ModuleSandboxEnvironment,
      );
    } catch (error) {
      if (isModulePromptError(error)) {
        throw error;
      }

      throw new EvalRuntimeError(code, error);
    }
  }

  getSandboxEnvironment(): ModuleSandboxEnvironment {
    return this.sandbox.getEnvironment();
  }

  setSandboxEnvironment(environment: ModuleSandboxEnvironment): void {
    this.sandbox.setEnvironment(environment);
  }

  extendSandboxEnvironment(environment: ModuleSandboxEnvironment): void {
    this.sandbox.extendEnvironment(environment);
  }

  async startConsole(): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stdout.write(
        "Interactive console requires a TTY. Use --eval or --module instead.\n",
      );
      return 1;
    }

    return await runInkConsole(this, {
      fullscreen: this.fullscreen,
      initialSessionState: await this.sessionStateManager.load(),
      sessionStateManager: this.sessionStateManager,
    });
  }

  async executeConsoleLine(line: string): Promise<ModuleConsoleCommandResult> {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return {
        entries: [],
        shouldExit: false,
        exitCode: 0,
      };
    }

    try {
      if (trimmed === "exit" || trimmed === "quit") {
        return {
          entries: [],
          shouldExit: true,
          exitCode: 0,
        };
      }

      if (trimmed === "help") {
        return {
          entries: this.createEntries("info", this.getHelpText()),
          entities: [],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "session save") {
        return {
          entries: [],
          entities: [],
          sessionCommand: "save",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "session clear") {
        return {
          entries: [],
          entities: [],
          sessionCommand: "clear",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "activity new") {
        return {
          entries: [],
          entities: [],
          activityCommand: "new",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "activity next") {
        return {
          entries: [],
          entities: [],
          activityCommand: "next",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "activity prev" || trimmed === "activity previous") {
        return {
          entries: [],
          entities: [],
          activityCommand: "previous",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "activity close") {
        return {
          entries: [],
          entities: [],
          activityCommand: "close",
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "list") {
        return {
          entries: [],
          entities: [
            createModulesTableEntity(this.listModules(), {
              title: "Registered modules",
            }),
          ],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "kits") {
        await this.runModule("kits/manager");
        return {
          entries: [],
          entities: [],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed === "workers") {
        return {
          entries: [],
          entities: await this.createWorkersEntities(),
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed.startsWith("worker ")) {
        return await this.executeWorkerCommand(trimmed.slice("worker ".length).trim());
      }

      if (trimmed === "use" || trimmed === "use clear" || trimmed === "use root" || trimmed === "use /") {
        const previousModule = this.clearCurrentModule();
        return {
          entries: [{
            kind: "info",
            text: previousModule
              ? `Left ${previousModule.id}`
              : "No module context selected",
          }],
          entities: [],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      if (trimmed.startsWith("use ")) {
        const id = trimmed.slice(4).trim();
        const moduleDefinition = this.useModule(id);
        return {
          entries: [{ kind: "info", text: `Using ${moduleDefinition.id}` }],
          entities: [],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      const result = await this.evaluate(trimmed);
      const entities = normalizeOutputEntities(result);
      return {
        entries:
          entities || result === undefined
            ? []
            : this.createEntries("output", this.formatValue(result)),
        entities: entities ?? [],
        sessionCommand: undefined,
        shouldExit: false,
        exitCode: 0,
      };
    } catch (error) {
      return {
        entries: this.createEntries("error", this.formatError(error)),
        entities: [],
        sessionCommand: undefined,
        shouldExit: false,
        exitCode: 0,
      };
    }
  }

  getConsoleSuggestionItems(inputValue: string): ModuleConsoleSuggestionItem[] {
    const jsSuggestions = this.getJsChainSuggestionItems(inputValue);
    if (jsSuggestions.length > 0 || isJsChainInput(inputValue)) {
      return jsSuggestions;
    }

    const commands: ModuleConsoleSuggestionItem[] = [
      { value: "$.", detail: "Start a runtime-backed JS module chain", kind: "command" },
      { value: "await $.", detail: "Start an explicit awaited JS module chain", kind: "command" },
      { value: "help", detail: "Show available commands and runtime helpers", kind: "command" },
      { value: "list", detail: "List registered modules", kind: "command" },
      { value: "kits", detail: "Open the Activity kits launcher TUI", kind: "command" },
      { value: "worker ls", detail: "List background workers", kind: "command" },
      { value: "worker ps", detail: "Show background workers", kind: "command" },
      { value: "worker top", detail: "Live worker dashboard", kind: "command" },
      { value: "worker watch", detail: "Live worker watcher", kind: "command" },
      { value: "worker logs ", detail: "Show worker event/log history", kind: "command" },
      { value: "worker stop ", detail: "Stop a background worker by name", kind: "command" },
      { value: "worker restart ", detail: "Restart a background worker by name", kind: "command" },
      { value: "activity ", detail: "Manage Activity tabs", kind: "activity" },
      { value: "use ", detail: "Legacy current-module selector during JS migration", kind: "command" },
      { value: "use clear", detail: "Leave the current module context", kind: "command" },
      { value: "session ", detail: "Persist or reset Activity state", kind: "session" },
      { value: "$.kits.cloak.manager()", detail: "Open CloakBrowser profile manager", kind: "command" },
      { value: "$.kits.proxy.manager()", detail: "Open Proxy service manager", kind: "command" },
      { value: "$.kits.qemu.manager()", detail: "Open QEMU VM preset manager", kind: "command" },
      { value: "$.games.tictactoe()", detail: "Play Tic-Tac-Toe", kind: "command" },
      { value: "$.games.hangman()", detail: "Play Hangman", kind: "command" },
      { value: "exit", detail: "Close the console", kind: "command" },
      { value: "quit", detail: "Close the console", kind: "command" },
    ];
    const activityCommands: ModuleConsoleSuggestionItem[] = [
      { value: "activity new", detail: "Create a new independent Activity tab", kind: "activity" },
      { value: "activity next", detail: "Switch to the next Activity", kind: "activity" },
      { value: "activity prev", detail: "Switch to the previous Activity", kind: "activity" },
      { value: "activity close", detail: "Close the current Activity", kind: "activity" },
    ];
    const sessionCommands: ModuleConsoleSuggestionItem[] = [
      { value: "session save", detail: "Save all Activity tabs to the session file", kind: "session" },
      { value: "session clear", detail: "Reset the session to a single fresh Activity", kind: "session" },
    ];
    const trimmedStart = inputValue.trimStart();
    const completeCommands = new Set([
      "$.",
      "await $.",
      "help",
      "list",
      "kits",
      "workers",
      "worker ls",
      "worker ps",
      "worker top",
      "worker watch",
      "exit",
      "quit",
      "session save",
      "session clear",
      "activity new",
      "activity next",
      "activity prev",
      "activity close",
      "use clear",
      "$.kits.cloak.manager()",
      "$.kits.proxy.manager()",
      "$.kits.qemu.manager()",
      "$.games.tictactoe()",
      "$.games.hangman()",
    ]);

    if (trimmedStart.length === 0) {
      return commands;
    }

    if (!trimmedStart.endsWith(" ") && completeCommands.has(trimmedStart)) {
      return [];
    }

    if (trimmedStart === "session" || trimmedStart.startsWith("session ")) {
      return sessionCommands
        .filter((command) => command.value.startsWith(trimmedStart))
        .slice(0, 10);
    }

    if (trimmedStart === "activity" || trimmedStart.startsWith("activity ")) {
      return activityCommands
        .filter((command) => command.value.startsWith(trimmedStart))
        .slice(0, 10);
    }

    if (trimmedStart === "worker" || trimmedStart.startsWith("worker ")) {
      return commands
        .filter((command) => command.value.startsWith(trimmedStart))
        .slice(0, 10);
    }

    if (trimmedStart.startsWith("use ")) {
      return this.getModuleSelectionSuggestionItems(trimmedStart.slice("use ".length));
    }

    return commands
      .filter((command) => command.value.startsWith(trimmedStart))
      .slice(0, 10);
  }

  getConsoleSuggestions(inputValue: string): string[] {
    return this.getConsoleSuggestionItems(inputValue).map((item) => item.value);
  }

  private getModuleSelectionSuggestionItems(rawPrefix: string): ModuleConsoleSuggestionItem[] {
    const prefix = rawPrefix.trim();
    const suggestions: ModuleConsoleSuggestionItem[] = [
      {
        value: "use clear",
        detail: "Leave the current module context",
        kind: "command",
      },
      ...this.listModules()
      .map((moduleDefinition) => ({
        value: `use ${moduleDefinition.id}`,
        detail: formatModuleSuggestionDetail(moduleDefinition),
        kind: "module" as const,
      })),
    ];

    return suggestions.filter(
      (suggestion) =>
        suggestion.value.startsWith(`use ${prefix}`) ||
        suggestion.value.startsWith(`use ${rawPrefix}`),
    );
  }

  createActivitySessionSnapshot(
    history: readonly string[],
  ): ActivityConsoleSnapshot {
    return {
      currentModuleId: this.currentModuleId,
      history: [...history].slice(-100),
      outputItems: this.outputStack
        .snapshot()
        .filter((item) => item.meta?.persist !== false),
    };
  }

  createConsoleSessionSnapshot(history: readonly string[]): ActivityConsoleSnapshot {
    return this.createActivitySessionSnapshot(history);
  }

  clearConsoleSession(): void {
    this.currentModuleId = null;
    this.outputStack.clear();
  }

  restoreActivitySession(snapshot: ActivityConsoleSnapshot | null): string[] {
    if (!snapshot) {
      this.currentModuleId = null;
      this.outputStack.clear();
      return [];
    }

    this.currentModuleId =
      snapshot.currentModuleId && this.modules.has(snapshot.currentModuleId)
        ? snapshot.currentModuleId
        : null;
    this.outputStack.replace(snapshot.outputItems);
    return [...snapshot.history];
  }

  restoreConsoleSession(snapshot: ActivityConsoleSnapshot | null): string[] {
    return this.restoreActivitySession(snapshot);
  }

  createRecoverableVm(snapshotPath: string): RecoverableVm {
    return new RecoverableVm(snapshotPath, {
      createHostContext: () => this.createEvalHostContext({
        allowInteractiveApplications: false,
        interactiveUnavailableTarget: "recoverable VM notebook cells",
      }) as Record<string, unknown>,
    });
  }

  private createEvalContext(): ModuleEvalContext<THelpers> {
    return {
      ...this.createEvalHostContext(),
      $axios,
      $axiosRegistry,
      $vm: new RecoverableVmManager((snapshotPath) =>
        this.createRecoverableVm(snapshotPath),
      ),
    };
  }

  private createEvalHostContext(
    executionOptions: ModuleExecutionOptions = {},
  ): ModuleEvalHostContext<THelpers> {
    return {
      ...this.helpers,
      $: this.createJsModuleProxy(undefined, executionOptions),
      $axios,
      $axiosRegistry,
      output: this.outputStack,
      runtime: this,
      logger,
      modules: this.listModules(),
      currentModule: this.getCurrentModule(),
      listModules: () => this.listModules(),
      listKits: () => this.listKits(),
      getKit: <TKit extends Kit = Kit>(id: string) => this.getKit<TKit>(id),
      requireKit: <TKit extends Kit = Kit>(id: string) =>
        this.requireKit<TKit>(id),
      getAiKit: () => this.getAiKit(),
      requireAiKit: () => this.requireAiKit(),
      getCloakKit: () => this.getCloakKit(),
      requireCloakKit: () => this.requireCloakKit(),
      getDomainLookupKit: () => this.getDomainLookupKit(),
      requireDomainLookupKit: () => this.requireDomainLookupKit(),
      getProxyKit: () => this.getProxyKit(),
      requireProxyKit: () => this.requireProxyKit(),
      getStorageKit: () => this.getStorageKit(),
      requireStorageKit: () => this.requireStorageKit(),
      getElasticSearchKit: () => this.getElasticSearchKit(),
      requireElasticSearchKit: () => this.requireElasticSearchKit(),
      getOllamaKit: () => this.getOllamaKit(),
      requireOllamaKit: () => this.requireOllamaKit(),
      getQemuKit: () => this.getQemuKit(),
      requireQemuKit: () => this.requireQemuKit(),
      getAxiosKit: () => this.getAxiosKit(),
      requireAxiosKit: () => this.requireAxiosKit(),
      run: async (id?: string, params?: unknown) => {
        const moduleId = id ?? this.currentModuleId;
        if (!moduleId) {
          throw new InvalidParamsError(
            "No module selected. Use $.<category>.<module>(), use(id), or pass run(id, params).",
          );
        }

        return await this.runModuleWithExecutionOptions(moduleId, params, executionOptions);
      },
      runModule: async (id: string, params?: unknown) =>
        await this.runModuleWithExecutionOptions(id, params, executionOptions),
      use: (id: string) => this.useModule(id),
      useModule: (id: string) => this.useModule(id),
      help: () => this.getHelpText(),
    };
  }

  private getHelpText(): string {
    return [
      "Commands:",
      "$.",
      "await $.",
      "const vm = $vm.createOrLoad(\"session.bin\")",
      "await vm.prepare()",
      "await vm.eval(\"1 + 1\")",
      "list",
      "kits",
      "worker ls",
      "worker ps",
      "worker top",
      "worker watch",
      "worker logs <name>",
      "worker stop <name>",
      "worker restart <name>",
      "activity new",
      "activity next",
      "activity prev",
      "activity close",
      "session save",
      "session clear",
      "$.<category>.<module>()",
      "$.<category>.<module>({ key: value })",
      "$.<category>.<module>.with({ key: value })",
      "$.<category>.<module>.flagName",
      "use <id> (legacy)",
      "exit",
      "",
      "Mouse and shortcuts:",
      "Click prompt: open module picker",
      "Click tab: switch Activity",
      "Click +: create Activity",
      "Click x on tab: close that Activity",
      "Click suggestion: insert it, or execute if the exact chain is already selected",
      "Ctrl+T: create Activity",
      "Ctrl+N / Ctrl+P: next / previous Activity",
      "Left / Right on empty prompt: previous / next Activity",
      "Ctrl+Left / Ctrl+Right: move cursor by word",
      "Ctrl+W or Ctrl+Backspace / Ctrl+Delete: delete word",
      "Ctrl+F: search output",
      "Tab: autocomplete and cycle suggestions",
      "JS chains: the console auto-awaits $.module() expressions",
      "PgUp / PgDn: scroll output",
      "Ctrl+Y: toggle selection mode for mouse text selection",
      "Selection mode lets mouse drag select output text; press Ctrl+Y again to return to wheel scrolling.",
      "",
      "JS runtime syntax examples: $.kits.ai.list(), $.kits.ai.chat({ prompt: 'hi' }), $.kits.ai.chat.with({ connection: 'local' }), $.kits.ai.chat.enableTools",
      "JS runtime syntax examples: $axios.with({ instanceId: 'api', baseURL: 'https://example.com' }).get('/')",
      "JS runtime syntax examples: $.discovery.hunternow.apacheIndex({ maxDepth: 1 }), $.discovery.apacheFiles('https://example.com')",
      "Interactive kits launcher: kits",
      "Interactive QEMU workflow: $.kits.qemu.manager()",
      "Legacy use <id> still works during migration, but new hints prefer $.<category>.<module>().",
      "Any other input is evaluated as async JavaScript inside the sandbox with helpers like $, $axios, listModules(), listKits(), workers(), use(id), run(id, params), getAiKit(), requireAiKit(), getElasticSearchKit(), requireElasticSearchKit(), getDomainLookupKit(), getQemuKit(), and requireQemuKit().",
    ].join("\n");
  }

  private async createWorkersEntities(): Promise<OutputEntity[]> {
    const workerSnapshots = await this.readWorkerSnapshots();
    if (workerSnapshots.length === 0) {
      return [createTextEntity("No background workers discovered.", { tone: "muted" })];
    }

    return [
      createTextEntity(
        [
          "Background workers",
          `Count: ${workerSnapshots.length}`,
        ],
        { tone: "info" },
      ),
      createTableEntity(
        [
          { key: "name", header: "Name", maxWidth: 20 },
          { key: "status", header: "Status", maxWidth: 12 },
          { key: "script", header: "Script", maxWidth: 40 },
          { key: "memory", header: "Memory", maxWidth: 28 },
          { key: "limits", header: "Limits", maxWidth: 40 },
          { key: "lastEvent", header: "Last Event", maxWidth: 28 },
          { key: "lastPayload", header: "Payload", maxWidth: 28 },
          { key: "lastError", header: "Last Error", maxWidth: 48 },
          { key: "updatedAt", header: "Updated At", maxWidth: 30 },
        ],
        workerSnapshots.map((snapshot) => ({
          name: snapshot.name,
          status: snapshot.status,
          script: snapshot.relativeScriptPath,
          memory: snapshot.lastMetrics?.memoryUsage
            ? `rss=${snapshot.lastMetrics.memoryUsage.rssMb}MB heap=${snapshot.lastMetrics.memoryUsage.heapUsedMb}/${snapshot.lastMetrics.memoryUsage.heapTotalMb}MB`
            : "",
          limits: snapshot.resourceLimits
            ? [
              snapshot.resourceLimits.maxYoungGenerationSizeMb !== undefined ? `young=${snapshot.resourceLimits.maxYoungGenerationSizeMb}` : undefined,
              snapshot.resourceLimits.maxOldGenerationSizeMb !== undefined ? `old=${snapshot.resourceLimits.maxOldGenerationSizeMb}` : undefined,
              snapshot.resourceLimits.codeRangeSizeMb !== undefined ? `code=${snapshot.resourceLimits.codeRangeSizeMb}` : undefined,
              snapshot.resourceLimits.stackSizeMb !== undefined ? `stack=${snapshot.resourceLimits.stackSizeMb}` : undefined,
            ].filter(Boolean).join(" ")
            : "",
          lastEvent: snapshot.lastEvent ?? "",
          lastPayload: snapshot.lastPayload ?? "",
          lastError: snapshot.lastError ?? "",
          updatedAt: snapshot.updatedAt,
        })),
        { title: "Background worker status" },
      ),
    ];
  }

  private async executeWorkerCommand(raw: string): Promise<ModuleConsoleCommandResult> {
    const [action, ...targetParts] = raw.split(/\s+/).filter(Boolean);
    const target = targetParts.join(" ").trim();

    if (action === "ls" || action === "ps") {
      return {
        entries: [],
        entities: await this.createWorkersEntities(),
        sessionCommand: undefined,
        shouldExit: false,
        exitCode: 0,
      };
    }

    if (action === "top" || action === "watch") {
      const lifecycle = this.readBackgroundLifecycle();
      if (!process.stdin.isTTY || !process.stdout.isTTY || !lifecycle) {
        return {
          entries: [],
          entities: await this.createWorkersEntities(),
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      const exitCode = await this.runInteractiveApplication(WorkerTop, {
        getSnapshots: async () => await this.readWorkerSnapshots(),
        refreshIntervalMs: lifecycle.getWatchRefreshMs(),
        title: `worker ${action}`,
      });

      return {
        entries: [],
        entities: [],
        sessionCommand: undefined,
        shouldExit: false,
        exitCode,
      };
    }

    if (action !== "stop" && action !== "restart" && action !== "logs") {
      throw new InvalidParamsError("Unknown worker command. Use 'worker ls', 'worker ps', 'worker top', 'worker watch', 'worker logs <name>', 'worker stop <name>' or 'worker restart <name>'.");
    }

    if (target.length === 0) {
      throw new InvalidParamsError(`Worker name is required. Example: worker ${action} clock`);
    }

    const lifecycle = this.readBackgroundLifecycle();
    if (!lifecycle) {
      throw new InvalidParamsError("BackgroundLifecycle is not available in this runtime.");
    }

    if (action === "logs") {
      const logs = lifecycle.getWorkerLogs(target);
      if (logs.length === 0) {
        return {
          entries: [],
          entities: [createTextEntity(`Worker '${target}' has no buffered logs yet.`, { tone: "muted" })],
          sessionCommand: undefined,
          shouldExit: false,
          exitCode: 0,
        };
      }

      return {
        entries: [],
        entities: [
          createTableEntity(
            [
              { key: "at", header: "At", maxWidth: 30 },
              { key: "kind", header: "Kind", maxWidth: 10 },
              { key: "level", header: "Level", maxWidth: 8 },
              { key: "message", header: "Message", maxWidth: 36 },
              { key: "payload", header: "Payload", maxWidth: 64 },
            ],
            logs.map((entry) => ({
              at: entry.at,
              kind: entry.kind,
              level: entry.level ?? "",
              message: entry.message,
              payload: entry.payload ?? "",
            })),
            { title: `Worker logs: ${target}` },
          ),
        ],
        sessionCommand: undefined,
        shouldExit: false,
        exitCode: 0,
      };
    }

    const snapshot = action === "stop"
      ? await lifecycle.stopWorker(target)
      : await lifecycle.restartWorker(target);

    return {
      entries: [],
      entities: [
        createTextEntity(
          [
            `Worker ${action} completed`,
            `Name: ${snapshot.name}`,
            `Status: ${snapshot.status}`,
            `Script: ${snapshot.relativeScriptPath}`,
          ],
          { tone: "info" },
        ),
      ],
      sessionCommand: undefined,
      shouldExit: false,
      exitCode: 0,
    };
  }

  private async readWorkerSnapshots(): Promise<BackgroundWorkerSnapshot[]> {
    const helperRecord = this.helpers as Record<string, unknown>;
    const workersHelper = helperRecord.workers;
    if (typeof workersHelper !== "function") {
      return [];
    }

    const workerSnapshots = await workersHelper();
    if (!Array.isArray(workerSnapshots)) {
      return [];
    }

    return workerSnapshots.filter(isBackgroundWorkerSnapshot);
  }

  private readBackgroundLifecycle(): BackgroundLifecycle | null {
    const helperRecord = this.helpers as Record<string, unknown>;
    const lifecycle = helperRecord.backgroundLifecycle;
    return lifecycle instanceof BackgroundLifecycle ? lifecycle : null;
  }

  private normalizeModuleParams<TParams, TResult>(
    moduleDefinition: ModuleDefinition<TParams, TResult, THelpers>,
    params: TParams | undefined,
  ): TParams | undefined {
    if (params === undefined || isRecord(params) || !moduleDefinition.defaultResolver) {
      return params;
    }

    return moduleDefinition.defaultResolver(params);
  }

  private formatValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value, null, 2);
  }

  private formatError(error: unknown): string {
    if (isModulePromptError(error)) {
      return error.message;
    }

    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    return `Error: ${String(error)}`;
  }

  private createEntries(
    kind: ModuleConsoleEntry["kind"],
    text: string,
  ): ModuleConsoleEntry[] {
    return text.split(/\r?\n/u).map((line) => ({ kind, text: line }));
  }
}
