interface NotebookRuntimeModuleResultMap {
	"sql": NotebookSqlModuleResult;
}

type NotebookSqlScalarValue = string | number | boolean | null | undefined;

type NotebookSqlRow = Record<string, NotebookSqlScalarValue>;

type NotebookSqlModuleMeta =
	| {
		kind: "rows";
		elapsedMs: number;
		truncated: boolean;
	}
	| {
		kind: "write";
		elapsedMs: number;
		changes: number;
		lastInsertRowid?: number | null;
	}
	| {
		kind: "message";
		elapsedMs: number;
		text: string;
	};

interface NotebookSqlModuleResult {
	rows: NotebookSqlRow[];
	columns: string[];
	meta: NotebookSqlModuleMeta;
}