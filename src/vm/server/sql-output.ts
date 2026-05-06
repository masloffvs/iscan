import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import type { SqlExecutionResult } from "../../modules/sql/console";

function normalizeSqlOutputValue(value: unknown): string | number | boolean | null | undefined {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSqlElapsedMs(elapsedMs: number): string {
  return `${elapsedMs.toFixed(1)} ms`;
}

export function buildSqlNotebookOutput(result: SqlExecutionResult): OutputEntity[] {
  if (result.kind === "rows") {
    const summary = createTextEntity(
      `${result.rows.length}${result.truncated ? "+" : ""} row(s) • ${formatSqlElapsedMs(result.elapsedMs)}`,
      {
        tone: "muted",
        meta: {
          kind: result.kind,
          truncated: result.truncated,
          elapsedMs: result.elapsedMs,
        },
      },
    );

    if (result.rows.length === 0 || result.columns.length === 0) {
      return [summary];
    }

    return [
      summary,
      createTableEntity(
        result.columns.map((column) => ({ key: column, header: column })),
        result.rows.map((row) => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, normalizeSqlOutputValue(value)]),
        )),
        {
          meta: {
            kind: result.kind,
            truncated: result.truncated,
            elapsedMs: result.elapsedMs,
          },
        },
      ),
    ];
  }

  if (result.kind === "write") {
    return [createTextEntity(
      `OK • changes=${result.changes}${result.lastInsertRowid !== null ? ` • lastInsertRowid=${result.lastInsertRowid}` : ""} • ${formatSqlElapsedMs(result.elapsedMs)}`,
      {
        tone: "output",
        meta: {
          kind: result.kind,
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
          elapsedMs: result.elapsedMs,
        },
      },
    )];
  }

  return [createTextEntity(`${result.text} • ${formatSqlElapsedMs(result.elapsedMs)}`, {
    tone: "info",
    meta: {
      kind: result.kind,
      text: result.text,
      elapsedMs: result.elapsedMs,
    },
  })];
}
