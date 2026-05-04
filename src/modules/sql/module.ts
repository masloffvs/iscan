import { defineModule } from "../module";
import { SQL_CONSOLE_PARAMS, sqlExecutor, type SqlModuleParams } from "./console";

export function createSqlModule(id: string, description: string) {
	return defineModule<SqlModuleParams>({
		id,
		aliases: id === "sql" ? ["sqlite", "mysql"] : undefined,
		category: "sql",
		description,
		executor: sqlExecutor,
		consoleParams: SQL_CONSOLE_PARAMS,
	}).useDefault("query");
}

export const sqlModule = createSqlModule(
	"sql",
	"Interactive SQL console over StorageKit with optional direct query execution",
);