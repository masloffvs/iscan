import { logger } from "../logger";
import type { AiKit, AxiosKit, CloakKit, DomainLookupKit, ElasticSearchKit, Kit, OllamaKit, ProxyKit, QemuKit, StorageKit } from "../kits";
import type { ModuleRuntime } from "./runtime";

import type * as React from "react";

export type InteractiveApplicationProps = {
	width: number;
	height: number;
	onExit: (exitCode?: number) => void;
};

export type ModuleDefinitionMap = Record<string, ModuleDefinition<unknown, unknown, object>>;

export type ModuleExecutionContext<
	TParams = unknown,
	THelpers extends object = object,
> = {
	argv: string[];
	logger: typeof logger;
	module: ModuleDefinition<TParams, unknown, THelpers>;
	params: TParams;
	runtime: ModuleRuntime<THelpers>;
	listModules(): ModuleDefinition<unknown, unknown, object>[];
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
	runModule<TResult = unknown, TRunParams = unknown>(id: string, params?: TRunParams): Promise<TResult>;
	useModule(id: string): ModuleDefinition<unknown, unknown, object>;
	runInteractiveApplication<P extends InteractiveApplicationProps>(
		Component: React.ComponentType<P>,
		props?: Omit<P, keyof InteractiveApplicationProps>,
	): Promise<number>;
} & THelpers;

export type ModuleExecutor<
	TParams = unknown,
	TResult = unknown,
	THelpers extends object = object,
> = (context: ModuleExecutionContext<TParams, THelpers>) => TResult | Promise<TResult>;

export type ModuleDefaultResolver<TParams = unknown> = (value: unknown) => TParams;

export type ModuleConsoleParamValueType = "string" | "number" | "boolean" | "json" | "string[]";

export type ModuleConsoleParam = {
	name: string;
	detail?: string;
	example?: string;
	required?: boolean;
	values?: readonly string[];
	valueType?: ModuleConsoleParamValueType;
	jsDescriptorName?: string;
};

export type ConfigurableModuleDefinition<
	TParams = unknown,
	TResult = unknown,
	THelpers extends object = object,
> = ModuleDefinition<TParams, TResult, THelpers> & {
	useDefault(defaultValue: keyof TParams & string): ConfigurableModuleDefinition<TParams, TResult, THelpers>;
	useDefault(defaultValue: ModuleDefaultResolver<TParams>): ConfigurableModuleDefinition<TParams, TResult, THelpers>;
};

export type ModuleDefinition<
	TParams = unknown,
	TResult = unknown,
	THelpers extends object = object,
> = {
	id: string;
	aliases?: readonly string[];
	category?: string;
	description?: string;
	executor: ModuleExecutor<TParams, TResult, THelpers>;
	defaultResolver?: ModuleDefaultResolver<TParams>;
	defaultParameterName?: string;
	consoleParams?: readonly ModuleConsoleParam[];
};

export function defineExecutor<
	TParams = unknown,
	TResult = unknown,
	THelpers extends object = object,
>(executor: ModuleExecutor<TParams, TResult, THelpers>): ModuleExecutor<TParams, TResult, THelpers> {
	return executor;
}

export function defineModule<
	TParams = unknown,
	TResult = unknown,
	THelpers extends object = object,
>(definition: ModuleDefinition<TParams, TResult, THelpers>): ConfigurableModuleDefinition<TParams, TResult, THelpers> {
	const configurableDefinition = definition as ConfigurableModuleDefinition<TParams, TResult, THelpers>;

	configurableDefinition.useDefault = (
		defaultValue: (keyof TParams & string) | ModuleDefaultResolver<TParams>,
	): ConfigurableModuleDefinition<TParams, TResult, THelpers> => defineModule({
		...definition,
		defaultParameterName: typeof defaultValue === "function"
			? definition.defaultParameterName
			: defaultValue,
		defaultResolver: typeof defaultValue === "function"
			? defaultValue
			: ((value: unknown) => ({ [defaultValue]: value } as TParams)),
	});

	return configurableDefinition;
}

export function getModuleCategory(definition: ModuleDefinition<unknown, unknown, object>): string {
	if (definition.category && definition.category.length > 0) {
		return definition.category;
	}

	const [category] = definition.id.split("/");
	return category || "misc";
}