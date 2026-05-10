import { defineModule, defineNotebookTypeOverlay } from "../module";
import { SQL_CONSOLE_PARAMS, sqlExecutor, type SqlModuleParams } from "./console";

const SQL_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/sql/sql.h.ts");

export function createSqlModule(id: string, description: string) {
	return defineModule<SqlModuleParams>({
		id,
		aliases: id === "sql" ? ["sqlite", "mysql"] : undefined,
		category: "sql",
		description,
		notebookTypeOverlay: id === "sql" ? SQL_NOTEBOOK_TYPE_OVERLAY : undefined,
		executor: sqlExecutor,
		consoleParams: SQL_CONSOLE_PARAMS,
	}).useDefault("query");
}

export const sqlModule = createSqlModule(
	"sql",
	"Interactive SQL console over StorageKit with optional direct query execution",
);