import { createTableEntity, type PrimitiveTableEntity } from "../../primitives";
import { defineExecutor, defineModule, getModuleCategory, type ModuleDefinition } from "../module";

export type CoreModulesParams = {
	category?: string;
	prefix?: string;
	search?: string;
};

function toModuleRows(definitions: readonly ModuleDefinition<unknown, unknown, object>[]) {
	return definitions.map(moduleDefinition => ({
		id: moduleDefinition.id,
		category: getModuleCategory(moduleDefinition),
		description: moduleDefinition.description ?? "",
	}));
}

export function createModulesTableEntity(
	definitions: readonly ModuleDefinition<unknown, unknown, object>[],
	options: { title?: string } = {},
): PrimitiveTableEntity {
	return createTableEntity(
		[
			{ key: "id", header: "Id", maxWidth: 28 },
			{ key: "category", header: "Category", maxWidth: 16 },
			{ key: "description", header: "Description", maxWidth: 48 },
		],
		toModuleRows(definitions),
		{
			title: options.title ?? "Registered modules",
		},
	);
}

const executor = defineExecutor<CoreModulesParams>(async ({ listModules, params }) => {
	const searchValue = params.search?.toLowerCase();

	const definitions = listModules()
		.filter(moduleDefinition => {
			if (params.category && getModuleCategory(moduleDefinition) !== params.category) {
				return false;
			}

			if (params.prefix && !moduleDefinition.id.startsWith(params.prefix)) {
				return false;
			}

			if (searchValue) {
				const haystack = `${moduleDefinition.id} ${moduleDefinition.description ?? ""}`.toLowerCase();
				return haystack.includes(searchValue);
			}

			return true;
		});

	return createModulesTableEntity(definitions, { title: "Registered modules" });
});

export const coreModulesModule = defineModule({
	id: "core/modules",
	category: "core",
	description: "List registered modules",
	executor,
});