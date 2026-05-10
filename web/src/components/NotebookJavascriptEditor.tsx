import { useEffect, useMemo, useRef, useState } from "react";
import { Workspace, init } from "modern-monaco";
import {
  getRemoteNotebookCompletions,
  getRemoteNotebookTypeSource,
  type RemoteNotebookCompletionItem,
} from "../api/client";

const NOTEBOOK_MONACO_THEME = "github-dark";
const NOTEBOOK_MODERN_MONACO_EDITOR_CORE_URL = new URL("../modern-monaco/editor-core.ts", import.meta.url).href;
const NOTEBOOK_MODERN_MONACO_LSP_URL = new URL("../modern-monaco/lsp.ts", import.meta.url).href;
const NOTEBOOK_TSCONFIG_PATH = "/tsconfig.json";
const NOTEBOOK_RUNTIME_TYPES_PATH = "/iscan/notebook-runtime.d.ts";
const NOTEBOOK_DEFAULT_RUNTIME_TYPES_SOURCE = [
  "interface NotebookRuntimeModuleResultMap {}",
  "type NotebookRuntimeRoot = any;",
  "type NotebookCellValue = unknown;",
  "type NotebookSessionHelpers = {",
  "  prev: NotebookCellValue;",
  "  last: NotebookCellValue;",
  "  get(cellId: string): NotebookCellValue;",
  "  has(cellId: string): boolean;",
  "  keys(): string[];",
  "};",
  "declare const $: NotebookRuntimeRoot;",
  "declare const $vm: any;",
  "declare const $axios: any;",
  "declare const $axiosRegistry: any;",
  "declare const $prev: NotebookCellValue;",
  "declare const $last: NotebookCellValue;",
  "declare const $notebook: NotebookSessionHelpers;",
  "declare const $isb: NotebookSessionHelpers;",
  "declare const $libs: Record<string, unknown>;",
  "",
].join("\n");
const RUNTIME_COMPLETION_WINDOW = 512;
const RUNTIME_COMPLETION_CACHE_LIMIT = 64;
const IDENTIFIER_CHARACTER_PATTERN = /[A-Za-z0-9_$]/u;
const NOTEBOOK_EDITOR_FONT_SIZE = 12;
const NOTEBOOK_EDITOR_LINE_HEIGHT = 20;

const NOTEBOOK_TSCONFIG_SOURCE = JSON.stringify({
  compilerOptions: {
    allowJs: true,
    checkJs: true,
    jsx: "react-jsx",
    module: "esnext",
    moduleDetection: "force",
    moduleResolution: "bundler",
    noEmit: true,
    strict: false,
    target: "es2022",
    types: [NOTEBOOK_RUNTIME_TYPES_PATH],
  },
}, null, 2);

type RuntimeFragmentMatch = {
  fragment: string;
  from: number;
};

type MonacoNamespace = Awaited<ReturnType<typeof init>>;
type MonacoEditor = ReturnType<MonacoNamespace["editor"]["create"]>;

type NotebookJavascriptEditorProps = {
  value: string;
  sessionCode?: string;
  cellId?: string;
  onChange: (value: string) => void;
  onRun?: () => void;
};

type ModelContext = {
  sessionCode?: string;
};

type SqlDecorationToken = {
  from: number;
  to: number;
  className: string;
};

type SqlQueryFragmentMatch = {
  fragment: string;
  from: number;
};

type MonacoDecorationCollection = ReturnType<MonacoEditor["createDecorationsCollection"]>;

const notebookWorkspace = new Workspace({ name: "iscan-notebook-editor" });
const completionCache = new Map<string, readonly RemoteNotebookCompletionItem[]>();
const modelContexts = new Map<string, ModelContext>();
let notebookRuntimeTypeSourcePromise: Promise<void> | null = null;
let notebookRuntimeTypesLoaded = false;
let notebookMonacoPromise: Promise<MonacoNamespace> | null = null;
let notebookCompletionProvider: { dispose(): void } | null = null;
let configuredMonaco: MonacoNamespace | null = null;
let monacoConfigured = false;

const SQL_QUERY_PROPERTY_PATTERN = /(?:^|[,{(]\s*)(?:query|["']query["'])\s*:\s*/gmu;
const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "is",
  "null",
  "like",
  "in",
  "between",
  "exists",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "on",
  "group",
  "by",
  "order",
  "limit",
  "offset",
  "having",
  "as",
  "distinct",
  "union",
  "all",
  "with",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "create",
  "alter",
  "drop",
  "table",
  "view",
  "pragma",
  "explain",
  "case",
  "when",
  "then",
  "else",
  "end",
  "count",
  "sum",
  "avg",
  "min",
  "max",
]);
const SQL_FUNCTIONS = new Set(["count", "sum", "avg", "min", "max", "coalesce", "ifnull", "json_extract"]);

function ensureModernMonacoRuntimeImportMap(): void {
  const selector = 'script[type="importmap"][data-iscan-modern-monaco="true"]';
  const existing = document.head.querySelector<HTMLScriptElement>(selector);
  const importMapSource = JSON.stringify({
    imports: {
      "modern-monaco/editor-core": NOTEBOOK_MODERN_MONACO_EDITOR_CORE_URL,
      "modern-monaco/lsp": NOTEBOOK_MODERN_MONACO_LSP_URL,
    },
  });

  if (existing) {
    if (existing.textContent !== importMapSource) {
      existing.textContent = importMapSource;
    }
    return;
  }

  const script = document.createElement("script");
  script.type = "importmap";
  script.dataset.iscanModernMonaco = "true";
  script.textContent = importMapSource;
  document.head.prepend(script);
}

function toWorkspacePath(targetPath: string): string {
  if (targetPath.startsWith("file://")) {
    return new URL(targetPath).pathname;
  }

  return targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
}

async function writeWorkspaceFile(targetPath: string, content: string): Promise<void> {
  const workspacePath = toWorkspacePath(targetPath);
  const separatorIndex = workspacePath.lastIndexOf("/");
  if (separatorIndex > 0) {
    await notebookWorkspace.fs.createDirectory(workspacePath.slice(0, separatorIndex));
  }

  try {
    const currentContent = await notebookWorkspace.fs.readTextFile(workspacePath);
    if (currentContent === content) {
      return;
    }
  } catch {
  }

  await notebookWorkspace.fs.writeFile(workspacePath, content);
}

async function ensureWorkspaceFileExists(targetPath: string, content: string): Promise<void> {
  try {
    await notebookWorkspace.fs.readTextFile(toWorkspacePath(targetPath));
    return;
  } catch {
  }

  await writeWorkspaceFile(targetPath, content);
}

async function ensureNotebookWorkspaceScaffold(): Promise<void> {
  await writeWorkspaceFile(NOTEBOOK_TSCONFIG_PATH, NOTEBOOK_TSCONFIG_SOURCE);
  await ensureWorkspaceFileExists(NOTEBOOK_RUNTIME_TYPES_PATH, NOTEBOOK_DEFAULT_RUNTIME_TYPES_SOURCE);
}

async function ensureNotebookRuntimeTypes(): Promise<void> {
  await ensureNotebookWorkspaceScaffold();

  if (notebookRuntimeTypesLoaded) {
    return;
  }

  if (!notebookRuntimeTypeSourcePromise) {
    notebookRuntimeTypeSourcePromise = (async () => {
      const notebookRuntimeTypeSource = await getRemoteNotebookTypeSource();
      await writeWorkspaceFile(NOTEBOOK_RUNTIME_TYPES_PATH, notebookRuntimeTypeSource);
      notebookRuntimeTypesLoaded = true;
    })().catch((error) => {
      notebookRuntimeTypeSourcePromise = null;
      notebookRuntimeTypesLoaded = false;
      throw error;
    });
  }

  await notebookRuntimeTypeSourcePromise;
}

async function getNotebookMonaco(): Promise<MonacoNamespace> {
  if (!notebookMonacoPromise) {
    notebookMonacoPromise = (async () => {
      await ensureNotebookWorkspaceScaffold();
      ensureModernMonacoRuntimeImportMap();

      const monaco = await init({
        defaultTheme: NOTEBOOK_MONACO_THEME,
        lsp: {
          typescript: {
            compilerOptions: {
              allowJs: true,
              checkJs: true,
              jsx: "react-jsx",
              module: "esnext",
              moduleDetection: "force",
              moduleResolution: "bundler",
              noEmit: true,
              strict: false,
              target: "es2022",
            },
            diagnosticsOptions: {
              codesToIgnore: [1108, 1308, 1375, 1378],
            },
          },
        },
        workspace: notebookWorkspace,
      });

      configureMonaco(monaco);
      void ensureNotebookRuntimeTypes().catch(() => undefined);
      return monaco;
    })().catch((error) => {
      notebookMonacoPromise = null;
      throw error;
    });
  }

  ensureModernMonacoRuntimeImportMap();
  const monaco = await notebookMonacoPromise;
  configureMonaco(monaco);
  return monaco;
}

function rememberCompletionItems(
  cacheKey: string,
  items: readonly RemoteNotebookCompletionItem[],
): void {
  completionCache.set(cacheKey, items);
  if (completionCache.size <= RUNTIME_COMPLETION_CACHE_LIMIT) {
    return;
  }

  const oldestKey = completionCache.keys().next().value;
  if (typeof oldestKey === "string") {
    completionCache.delete(oldestKey);
  }
}

function findRuntimeFragment(source: string, cursorOffset: number): RuntimeFragmentMatch | null {
  const sourceStart = Math.max(0, cursorOffset - RUNTIME_COMPLETION_WINDOW);
  const windowText = source.slice(sourceStart, cursorOffset);
  const relativeIndex = windowText.lastIndexOf("$");
  if (relativeIndex < 0) {
    return null;
  }

  const absoluteIndex = sourceStart + relativeIndex;
  const previousCharacter = absoluteIndex > 0 ? source[absoluteIndex - 1] : "";
  if (previousCharacter && IDENTIFIER_CHARACTER_PATTERN.test(previousCharacter)) {
    return null;
  }

  const fragment = source.slice(absoluteIndex, cursorOffset);
  if (!fragment.startsWith("$.") && !fragment.startsWith("$vm") && !fragment.startsWith("$axios")) {
    return null;
  }

  return {
    fragment,
    from: absoluteIndex,
  };
}

function findSqlCompletionStart(source: string, cursorOffset: number): number {
  const prefix = source.slice(0, cursorOffset);
  const qualifiedColumnMatch = prefix.match(/[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_]*)$/u);
  if (qualifiedColumnMatch) {
    return cursorOffset - (qualifiedColumnMatch[1]?.length ?? 0);
  }

  const dotCommandMatch = prefix.match(/(\.[A-Za-z]*)$/u);
  if (dotCommandMatch?.[1]) {
    return cursorOffset - dotCommandMatch[1].length;
  }

  const wordMatch = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)$/u);
  if (wordMatch?.[1]) {
    return cursorOffset - wordMatch[1].length;
  }

  return cursorOffset;
}

function findSqlQueryFragment(source: string, cursorOffset: number): SqlQueryFragmentMatch | null {
  for (const match of source.matchAll(SQL_QUERY_PROPERTY_PATTERN)) {
    const literalRange = readSqlQueryLiteralRange(source, (match.index ?? 0) + match[0].length);
    if (!literalRange) {
      continue;
    }

    if (cursorOffset < literalRange.contentStart || cursorOffset > literalRange.contentEnd) {
      continue;
    }

    const sqlCursorOffset = cursorOffset - literalRange.contentStart;
    const sqlSource = source.slice(literalRange.contentStart, cursorOffset);
    const sqlCompletionStart = findSqlCompletionStart(sqlSource, sqlCursorOffset);

    return {
      fragment: sqlSource,
      from: literalRange.contentStart + sqlCompletionStart,
    };
  }

  return null;
}

function shouldTriggerSqlSuggestions(changeText: string): boolean {
  return changeText.length > 0 && !/[\r\n]/u.test(changeText);
}

function toCompletionKind(
  monaco: MonacoNamespace,
  kind: RemoteNotebookCompletionItem["kind"],
) {
  switch (kind) {
    case "command":
      return monaco.languages.CompletionItemKind.Function;
    case "module":
      return monaco.languages.CompletionItemKind.Module;
    default:
      return monaco.languages.CompletionItemKind.Variable;
  }
}

function buildEditorPath(sessionCode?: string, cellId?: string): string {
  const encodedSession = encodeURIComponent(sessionCode ?? "scratch");
  const encodedCell = encodeURIComponent(cellId ?? "active");
  return `file:///iscan/notebooks/${encodedSession}/${encodedCell}.ts`;
}

function isSqlIdentifierCharacter(char: string | undefined): boolean {
  return typeof char === "string" && /[A-Za-z0-9_]/u.test(char);
}

function readSqlQueryLiteralRange(source: string, startOffset: number): { contentStart: number; contentEnd: number } | null {
  let index = startOffset;
  while (index < source.length && /\s/u.test(source[index] ?? "")) {
    index += 1;
  }

  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }

  const contentStart = index + 1;
  index = contentStart;

  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (quote === "`" && char === "$" && source[index + 1] === "{") {
      return null;
    }

    if (char === quote) {
      return {
        contentStart,
        contentEnd: index,
      };
    }

    index += 1;
  }

  return null;
}

function tokenizeSqlFragment(sqlText: string, offset: number): SqlDecorationToken[] {
  const tokens: SqlDecorationToken[] = [];
  let index = 0;

  while (index < sqlText.length) {
    const char = sqlText[index];

    if (!char || /\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-" && sqlText[index + 1] === "-") {
      const start = index;
      index += 2;
      while (index < sqlText.length && sqlText[index] !== "\n") {
        index += 1;
      }
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-comment" });
      continue;
    }

    if (char === "/" && sqlText[index + 1] === "*") {
      const start = index;
      index += 2;
      while (index < sqlText.length && !(sqlText[index] === "*" && sqlText[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(sqlText.length, index + 2);
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-comment" });
      continue;
    }

    if (char === "'") {
      const start = index;
      index += 1;
      while (index < sqlText.length) {
        if (sqlText[index] === "'" && sqlText[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sqlText[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-string" });
      continue;
    }

    if (/[0-9]/u.test(char)) {
      const start = index;
      index += 1;
      while (index < sqlText.length && /[0-9._]/u.test(sqlText[index] ?? "")) {
        index += 1;
      }
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-number" });
      continue;
    }

    if (/[A-Za-z_]/u.test(char)) {
      const start = index;
      index += 1;
      while (isSqlIdentifierCharacter(sqlText[index])) {
        index += 1;
      }
      const word = sqlText.slice(start, index);
      const normalizedWord = word.toLowerCase();
      const remaining = sqlText.slice(index);

      if (SQL_FUNCTIONS.has(normalizedWord) && /^\s*\(/u.test(remaining)) {
        tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-function" });
        continue;
      }

      if (SQL_KEYWORDS.has(normalizedWord)) {
        tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-keyword" });
      }

      continue;
    }

    if (/[=<>!*/+\-%]/u.test(char)) {
      const start = index;
      index += 1;
      if (/^[=<>]/u.test(sqlText[index] ?? "")) {
        index += 1;
      }
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-operator" });
      continue;
    }

    if (/[(),.;]/u.test(char)) {
      const start = index;
      index += 1;
      tokens.push({ from: offset + start, to: offset + index, className: "notebook-sql-token-operator" });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function buildSqlQueryDecorations(source: string): SqlDecorationToken[] {
  const decorations: SqlDecorationToken[] = [];

  for (const match of source.matchAll(SQL_QUERY_PROPERTY_PATTERN)) {
    const literalRange = readSqlQueryLiteralRange(source, (match.index ?? 0) + match[0].length);
    if (!literalRange || literalRange.contentEnd <= literalRange.contentStart) {
      continue;
    }

    decorations.push(...tokenizeSqlFragment(
      source.slice(literalRange.contentStart, literalRange.contentEnd),
      literalRange.contentStart,
    ));
  }

  return decorations;
}

function updateSqlQueryDecorations(
  monaco: MonacoNamespace,
  editor: MonacoEditor,
  collection: MonacoDecorationCollection,
): void {
  const model = editor.getModel();
  if (!model) {
    collection.clear();
    return;
  }

  const decorations = buildSqlQueryDecorations(model.getValue()).map((token) => {
    const start = model.getPositionAt(token.from);
    const end = model.getPositionAt(token.to);
    return {
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      options: {
        inlineClassName: token.className,
      },
    };
  });

  collection.set(decorations);
}

async function openEditorModel(
  monaco: MonacoNamespace,
  editor: MonacoEditor,
  editorPath: string,
  value: string,
): Promise<void> {
  await writeWorkspaceFile(editorPath, value);
  const model = await notebookWorkspace.openTextDocument(editorPath, undefined, editor);

  monaco.editor.setModelLanguage(model, "typescript");
  if (model.getValue() !== value) {
    model.setValue(value);
  }
}

function configureMonaco(monaco: MonacoNamespace): void {
  configuredMonaco = monaco;

  monaco.editor.defineTheme(NOTEBOOK_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B949E", fontStyle: "italic" },
      { token: "keyword", foreground: "FF7B72" },
      { token: "operator", foreground: "FF7B72" },
      { token: "string", foreground: "A5D6FF" },
      { token: "string.escape", foreground: "79C0FF" },
      { token: "number", foreground: "79C0FF" },
      { token: "regexp", foreground: "A5D6FF" },
      { token: "delimiter", foreground: "C9D1D9" },
      { token: "delimiter.bracket", foreground: "C9D1D9" },
      { token: "delimiter.parenthesis", foreground: "C9D1D9" },
      { token: "variable", foreground: "C9D1D9" },
      { token: "identifier", foreground: "C9D1D9" },
      { token: "predefined", foreground: "79C0FF" },
      { token: "type", foreground: "FFA657" },
      { token: "type.identifier", foreground: "FFA657" },
      { token: "typeParameter", foreground: "FFA657" },
      { token: "class", foreground: "FFA657" },
      { token: "namespace", foreground: "D2A8FF" },
      { token: "function", foreground: "D2A8FF" },
      { token: "constructor", foreground: "D2A8FF" },
      { token: "tag", foreground: "7EE787" },
      { token: "attribute.name", foreground: "79C0FF" },
      { token: "attribute.value", foreground: "A5D6FF" },
      { token: "invalid", foreground: "F85149" },
    ],
    colors: {
      "editor.background": "#00000000",
      "editor.foreground": "#d0d4db",
      "editorLineNumber.foreground": "#5d636d",
      "editorLineNumber.activeForeground": "#8b949e",
      "editorCursor.foreground": "#c9d1d9",
      "editor.lineHighlightBackground": "#ffffff06",
      "editor.selectionBackground": "#8b949e20",
      "editor.inactiveSelectionBackground": "#8b949e14",
      "editorGutter.background": "#00000000",
      "editorIndentGuide.background1": "#ffffff0a",
      "editorWhitespace.foreground": "#ffffff0a",
      "editorBracketMatch.background": "#79c0ff14",
      "editorBracketMatch.border": "#79c0ff55",
      "editorWidget.background": "#141517",
      "editorWidget.border": "#ffffff08",
      "editorHoverWidget.background": "#141517",
      "editorHoverWidget.border": "#ffffff08",
      "editorSuggestWidget.background": "#141517",
      "editorSuggestWidget.border": "#ffffff08",
      "editorSuggestWidget.foreground": "#d0d4db",
      "editorSuggestWidget.selectedBackground": "#ffffff08",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff22",
      "scrollbarSlider.activeBackground": "#ffffff2b",
      "input.background": "#0f1011",
      "input.foreground": "#d0d4db",
      "input.border": "#00000000",
      "list.hoverBackground": "#ffffff05",
      "list.activeSelectionBackground": "#ffffff08",
    },
  });
  monaco.editor.setTheme(NOTEBOOK_MONACO_THEME);

  if (monacoConfigured) {
    return;
  }

  monacoConfigured = true;

  notebookCompletionProvider?.dispose();
  notebookCompletionProvider = monaco.languages.registerCompletionItemProvider("typescript", {
    triggerCharacters: ["$", ".", " ", "(", ","],
    async provideCompletionItems(
      model,
      position,
      _context,
      token,
    ) {
      const modelUri = model.uri.toString();
      const modelContext = modelContexts.get(modelUri);
      if (!modelContext?.sessionCode) {
        return { suggestions: [] };
      }

      const source = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const sqlQueryMatch = findSqlQueryFragment(source, cursorOffset);
      if (sqlQueryMatch) {
        const cacheKey = `${modelContext.sessionCode}:sql:${sqlQueryMatch.fragment}`;
        const cachedItems = completionCache.get(cacheKey);
        const startPosition = model.getPositionAt(sqlQueryMatch.from);
        const range = new monaco.Range(
          startPosition.lineNumber,
          startPosition.column,
          position.lineNumber,
          position.column,
        );

        if (cachedItems) {
          return {
            suggestions: cachedItems.map((item) => ({
              detail: item.detail,
              insertText: item.value,
              kind: item.kind === "module"
                ? monaco.languages.CompletionItemKind.Struct
                : monaco.languages.CompletionItemKind.Field,
              label: item.label ?? item.value,
              range,
            })),
          };
        }

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        try {
          const items = await getRemoteNotebookCompletions(modelContext.sessionCode, sqlQueryMatch.fragment, {
            language: "sql",
            signal: abortController.signal,
          });
          if (token.isCancellationRequested) {
            return { suggestions: [] };
          }

          rememberCompletionItems(cacheKey, items);
          return {
            suggestions: items.map((item) => ({
              detail: item.detail,
              insertText: item.value,
              kind: item.kind === "module"
                ? monaco.languages.CompletionItemKind.Struct
                : monaco.languages.CompletionItemKind.Field,
              label: item.label ?? item.value,
              range,
            })),
          };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return { suggestions: [] };
          }

          return { suggestions: [] };
        }
      }

      const fragmentMatch = findRuntimeFragment(source, cursorOffset);
      if (!fragmentMatch) {
        return { suggestions: [] };
      }

      await ensureNotebookRuntimeTypes().catch(() => undefined);

      const cacheKey = `${modelContext.sessionCode}:${fragmentMatch.fragment}`;
      const cachedItems = completionCache.get(cacheKey);
      const startPosition = model.getPositionAt(fragmentMatch.from);
      const range = new monaco.Range(
        startPosition.lineNumber,
        startPosition.column,
        position.lineNumber,
        position.column,
      );

      if (cachedItems) {
        return {
          suggestions: cachedItems.map((item) => ({
            detail: item.detail,
            insertText: item.value,
            kind: toCompletionKind(monaco, item.kind),
            label: item.label ?? item.value,
            range,
          })),
        };
      }

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      try {
        const items = await getRemoteNotebookCompletions(modelContext.sessionCode, fragmentMatch.fragment, {
          language: "javascript",
          signal: abortController.signal,
        });
        if (token.isCancellationRequested) {
          return { suggestions: [] };
        }

        rememberCompletionItems(cacheKey, items);
        return {
          suggestions: items.map((item) => ({
            detail: item.detail,
            insertText: item.value,
            kind: toCompletionKind(monaco, item.kind),
            label: item.label ?? item.value,
            range,
          })),
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return { suggestions: [] };
        }

        return { suggestions: [] };
      }
    },
  });
}

export default function NotebookJavascriptEditor({
  value,
  sessionCode,
  cellId,
  onChange,
  onRun,
}: NotebookJavascriptEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const sqlDecorationCollectionRef = useRef<MonacoDecorationCollection | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const valueRef = useRef(value);
  const [editorState, setEditorState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const editorPath = useMemo(() => buildEditorPath(sessionCode, cellId), [sessionCode, cellId]);
  const editorHeight = useMemo(() => {
    const lineCount = value.split(/\r?\n/u).length;
    return Math.min(Math.max(lineCount * NOTEBOOK_EDITOR_LINE_HEIGHT + 28, 128), 560);
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    modelContexts.set(editorPath, { sessionCode });
    return () => {
      modelContexts.delete(editorPath);
    };
  }, [editorPath, sessionCode]);

  useEffect(() => {
    void ensureNotebookRuntimeTypes().catch(() => undefined);
  }, []);

  useEffect(() => {
    let disposed = false;
    let contentChangeDisposable: { dispose(): void } | null = null;

    void (async () => {
      try {
        const container = containerRef.current;
        if (!container) {
          return;
        }

        const monaco = await getNotebookMonaco();
        if (disposed || !containerRef.current) {
          return;
        }

        monacoRef.current = monaco;
        const editor = monaco.editor.create(containerRef.current, {
          automaticLayout: true,
          cursorBlinking: "smooth",
          fixedOverflowWidgets: true,
          folding: true,
          fontFamily: "var(--iscan-editor-font-family)",
          fontSize: NOTEBOOK_EDITOR_FONT_SIZE,
          glyphMargin: false,
          lineHeight: NOTEBOOK_EDITOR_LINE_HEIGHT,
          lineDecorationsWidth: 10,
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          padding: { top: 10, bottom: 10 },
          renderLineHighlight: "line",
          roundedSelection: true,
          scrollBeyondLastLine: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontal: "auto",
            horizontalScrollbarSize: 8,
            useShadows: false,
            vertical: "auto",
            verticalScrollbarSize: 8,
          },
          quickSuggestions: {
            comments: false,
            other: true,
            strings: true,
          },
          suggest: {
            preview: true,
            showWords: false,
          },
          tabSize: 2,
          wordWrap: "on",
        });

        editorRef.current = editor;
        sqlDecorationCollectionRef.current = editor.createDecorationsCollection();
        contentChangeDisposable = editor.onDidChangeModelContent((event) => {
          const nextValue = editor.getModel()?.getValue() ?? "";
          valueRef.current = nextValue;
          onChangeRef.current(nextValue);
          if (sqlDecorationCollectionRef.current) {
            updateSqlQueryDecorations(monaco, editor, sqlDecorationCollectionRef.current);
          }

          const cursorPosition = editor.getPosition();
          if (event.isFlush || !cursorPosition) {
            return;
          }

          const hasInlineChange = event.changes.some((change) => shouldTriggerSqlSuggestions(change.text));
          if (!hasInlineChange) {
            return;
          }

          const cursorOffset = editor.getModel()?.getOffsetAt(cursorPosition) ?? 0;
          if (!findSqlQueryFragment(nextValue, cursorOffset)) {
            return;
          }

          queueMicrotask(() => {
            if (editorRef.current !== editor) {
              return;
            }

            editor.trigger("iscan-sql-query", "editor.action.triggerSuggest", {});
          });
        });

        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
          () => {
            onRunRef.current?.();
          },
        );

        await openEditorModel(monaco, editor, editorPath, valueRef.current);
        if (sqlDecorationCollectionRef.current) {
          updateSqlQueryDecorations(monaco, editor, sqlDecorationCollectionRef.current);
        }
        modelContexts.set(editor.getModel()?.uri.toString() ?? editorPath, { sessionCode });
        setEditorState("ready");
        setErrorMessage(null);
      } catch (error) {
        if (disposed) {
          return;
        }

        setEditorState("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to load modern Monaco.");
      }
    })();

    return () => {
      disposed = true;
      contentChangeDisposable?.dispose();

      const currentEditor = editorRef.current;
      editorRef.current = null;
      if (!currentEditor) {
        return;
      }

      const modelUri = currentEditor.getModel()?.uri.toString();
      if (modelUri) {
        modelContexts.delete(modelUri);
      }

      sqlDecorationCollectionRef.current = null;
      currentEditor.dispose();
    };
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || model.getValue() === value) {
      return;
    }

    model.setValue(value);
  }, [value]);

  useEffect(() => {
    const currentEditor = editorRef.current;
    const monaco = monacoRef.current;
    if (!currentEditor || !monaco) {
      return;
    }

    let cancelled = false;
    void openEditorModel(monaco, currentEditor, editorPath, valueRef.current)
      .then(() => {
        if (cancelled) {
          return;
        }

        if (sqlDecorationCollectionRef.current) {
          updateSqlQueryDecorations(monaco, currentEditor, sqlDecorationCollectionRef.current);
        }

        modelContexts.set(currentEditor.getModel()?.uri.toString() ?? editorPath, { sessionCode });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [editorPath]);

  useEffect(() => {
    const modelUri = editorRef.current?.getModel()?.uri.toString();
    if (!modelUri) {
      return;
    }

    modelContexts.set(modelUri, { sessionCode });
  }, [sessionCode]);

  useEffect(() => {
    editorRef.current?.layout();
  }, [editorHeight]);

  return (
    <div className="relative overflow-visible rounded-[10px]">
      <div
        className="overflow-hidden rounded-[10px]"
        ref={containerRef}
        style={{ height: editorHeight }}
      />
      {editorState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-[11px] text-slate-400">
          Loading editor...
        </div>
      ) : null}
      {editorState === "error" ? (
        <div className="absolute inset-0 flex items-center px-3 text-[11px] text-rose-300">
          {errorMessage ?? "Failed to load modern Monaco."}
        </div>
      ) : null}
    </div>
  );
}