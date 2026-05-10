import type { Workspace } from "modern-monaco";

import { cache } from "../../../node_modules/modern-monaco/dist/cache.mjs";
import * as client from "../../../node_modules/modern-monaco/dist/lsp/client.mjs";

type MonacoNamespace = typeof import("modern-monaco/editor-core");
type MonacoWorker = Awaited<ReturnType<ReturnType<MonacoNamespace["editor"]["createWebWorker"]>["getProxy"]>>;
type ImportMapRaw = {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
};
type CompilerOptions = Record<string, unknown> & {
  $src?: string;
  $types?: string[];
};
type TypeScriptLanguageSettings = {
  importMap?: ImportMapRaw;
  compilerOptions?: CompilerOptions;
  diagnosticsOptions?: {
    validate?: boolean;
    codesToIgnore?: Array<string | number>;
    filter?: (diagnostic: unknown) => boolean;
  };
};
type FormattingOptions = {
  tabSize?: number;
  trimTrailingWhitespace?: boolean;
  insertSpaces?: boolean;
  semicolon?: "ignore" | "insert" | "remove";
};
type VersionedContent = {
  content: string;
  version: number;
};
type CreateData = {
  compilerOptions: CompilerOptions;
  formatOptions: Record<string, unknown>;
  importMap: ImportMapRaw;
  types: Record<string, VersionedContent>;
  fs?: string[];
};
type MonacoWebWorkerProxy = {
  updateCompilerOptions(options: {
    compilerOptions?: CompilerOptions;
    importMap?: ImportMapRaw;
    types?: Record<string, VersionedContent>;
  }): Promise<void>;
  fetchHttpModule(url: string, containingFile: string): Promise<void>;
};
type MonacoWebWorker = ReturnType<MonacoNamespace["editor"]["createWebWorker"]> & {
  getProxy(): Promise<MonacoWebWorkerProxy>;
};

let worker: MonacoWebWorker | Promise<MonacoWebWorker> | null = null;

export async function setup(
  monaco: MonacoNamespace,
  languageId: string,
  languageSettings?: TypeScriptLanguageSettings,
  formattingOptions?: FormattingOptions,
  workspace?: Workspace,
) {
  if (!worker) {
    worker = createWorker(monaco, workspace, languageSettings, formattingOptions);
  }

  if (worker instanceof Promise) {
    worker = await worker;
  }

  client.init(monaco as never);
  client.registerBasicFeatures(languageId, worker as never, [".", "/", '"', "'", "<"], workspace, languageSettings?.diagnosticsOptions as never);
  client.registerAutoComplete(languageId, worker as never, [">", "/"]);
  client.registerSignatureHelp(languageId, worker as never, ["(", ","]);
  client.registerCodeAction(languageId, worker as never);
}

async function createWorker(
  monaco: MonacoNamespace,
  workspace?: Workspace,
  languageSettings?: TypeScriptLanguageSettings,
  formattingOptions?: FormattingOptions,
): Promise<MonacoWebWorker> {
  const fs = workspace?.fs;
  const defaultCompilerOptions: CompilerOptions = {
    allowJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    isolatedModules: true,
    module: "esnext",
    moduleResolution: "bundler",
    moduleDetection: "force",
    skipLibCheck: true,
    target: "esnext",
    useDefineForClassFields: true,
    ...(languageSettings?.compilerOptions ?? {}),
  };
  const typesStore = new TypesSet();
  const defaultImportMap: ImportMapRaw = languageSettings?.importMap ?? {};
  const remixImportMap = (importMap: ImportMapRaw): ImportMapRaw => {
    if (isBlankImportMap(defaultImportMap)) {
      return importMap;
    }

    return {
      ...importMap,
      imports: Object.assign({}, defaultImportMap.imports, importMap.imports),
      scopes: Object.assign({}, defaultImportMap.scopes, importMap.scopes),
    };
  };

  let compilerOptions: CompilerOptions = { ...defaultCompilerOptions };
  let importMap = { ...defaultImportMap };

  if (workspace) {
    await Promise.all([
      loadCompilerOptions(workspace).then((options) => {
        compilerOptions = { ...defaultCompilerOptions, ...options };
      }),
      loadImportMap(workspace, remixImportMap).then((nextImportMap) => {
        importMap = nextImportMap;
      }),
    ]);
  }

  await typesStore.load(compilerOptions, workspace);

  const {
    tabSize = 4,
    trimTrailingWhitespace = true,
    insertSpaces = true,
    semicolon = "insert",
  } = formattingOptions ?? {};
  const createData: CreateData = {
    compilerOptions,
    formatOptions: {
      tabSize,
      trimTrailingWhitespace,
      semicolons: semicolon,
      indentSize: tabSize,
      convertTabsToSpaces: insertSpaces,
      insertSpaceAfterCommaDelimiter: insertSpaces,
      insertSpaceAfterSemicolonInForStatements: insertSpaces,
      insertSpaceBeforeAndAfterBinaryOperators: insertSpaces,
      insertSpaceAfterKeywordsInControlFlowStatements: insertSpaces,
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: insertSpaces,
    },
    importMap,
    types: typesStore.types,
    fs: workspace ? await client.walkFS(workspace.fs, "/") : undefined,
  };

  const nextWorker = monaco.editor.createWebWorker({
    worker: getWorker(createData),
    keepIdleModels: true,
    host: {
      openModel: async (uri: string): Promise<boolean> => {
        if (!workspace) {
          throw new Error("Workspace is undefined.");
        }

        try {
          const editors = monaco.editor.getEditors();
          const editor = editors.find((item) => item.hasWidgetFocus() || item.hasTextFocus()) ?? editors[0];
          if (editor) {
            await (workspace as Workspace & {
              _openTextDocument: (
                monaco: MonacoNamespace,
                editor: ReturnType<MonacoNamespace["editor"]["create"]>,
                uri: string,
              ) => Promise<unknown>;
            })._openTextDocument(monaco, editor, uri);
            return true;
          }

          return false;
        } catch (error) {
          if (isFsNotFoundError(error)) {
            return false;
          }

          throw error;
        }
      },
      refreshDiagnostics: async (uri: string) => {
        let model = monaco.editor.getModel(uri);
        if (model && model.uri.path.includes(".(embedded).")) {
          model = monaco.editor.getModel(model.uri.toString(true).split(".(embedded).")[0] ?? uri);
        }

        if (model) {
          Reflect.get(model, "refreshDiagnostics")?.();
        }
      },
    },
  }) as MonacoWebWorker;

  if (fs) {
    const updateCompilerOptions = async (options: {
      compilerOptions?: CompilerOptions;
      importMap?: ImportMapRaw;
      types?: Record<string, VersionedContent>;
    }) => {
      const proxy = await nextWorker.getProxy();
      await proxy.updateCompilerOptions(options);
      monaco.editor.getModels().forEach((model) => {
        const modelLanguageId = model.getLanguageId();
        if (modelLanguageId === "typescript" || modelLanguageId === "javascript" || modelLanguageId === "jsx" || modelLanguageId === "tsx") {
          Reflect.get(model, "refreshDiagnostics")?.();
        }
      });
    };

    const watchTypeFiles = () =>
      (compilerOptions.$types ?? [])
        .filter((url) => !url.startsWith("https://") && !url.startsWith("http://"))
        .map((url) => fs.watch(url, async (kind) => {
          if (kind === "remove") {
            typesStore.remove(url);
          } else {
            const content = await fs.readTextFile(url);
            typesStore.add(content, url);
          }

          await updateCompilerOptions({ types: typesStore.types });
        }));
    let unwatchTypeFiles = watchTypeFiles();

    fs.watch("tsconfig.json", () => {
      unwatchTypeFiles.forEach((dispose) => dispose());
      loadCompilerOptions(workspace!).then((options) => {
        const nextCompilerOptions = { ...defaultCompilerOptions, ...options };
        if (JSON.stringify(nextCompilerOptions) !== JSON.stringify(compilerOptions)) {
          compilerOptions = nextCompilerOptions;
          typesStore.load(compilerOptions, workspace).then(() => {
            void updateCompilerOptions({ compilerOptions, types: typesStore.types });
          });
        }
        unwatchTypeFiles = watchTypeFiles();
      });
    });

    fs.watch("index.html", () => {
      loadImportMap(workspace!, remixImportMap).then((nextImportMap) => {
        if (!isSameImportMap(importMap, nextImportMap)) {
          importMap = nextImportMap;
          void updateCompilerOptions({ importMap });
        }
      });
    });
  }

  monaco.editor.addCommand({
    id: "ts:fetch_http_module",
    run: async (_: unknown, url: string, containingFile: string) => {
      const proxy = await nextWorker.getProxy();
      await proxy.fetchHttpModule(url, containingFile);
    },
  });

  return nextWorker;
}

function createWebWorker(): Worker {
  const workerUrl = new URL("./typescript-worker.ts", import.meta.url);
  return new Worker(workerUrl, { type: "module", name: "typescript-worker" });
}

function getWorker(createData: CreateData) {
  const nextWorker = createWebWorker();
  nextWorker.postMessage(createData);
  return nextWorker;
}

class TypesSet {
  private readonly _types: Record<string, VersionedContent> = {};
  private readonly _removedTypes: Record<string, number> = {};

  get types() {
    return this._types;
  }

  reset(types: Record<string, string>) {
    const toRemove = Object.keys(this._types).filter((key) => !types[key]);
    for (const key of toRemove) {
      this.remove(key);
    }
    for (const [filePath, content] of Object.entries(types)) {
      this.add(content, filePath);
    }
  }

  add(content: string, filePath: string): boolean {
    if (this._types[filePath] && this._types[filePath].content === content) {
      return false;
    }

    let version = 1;
    if (this._removedTypes[filePath]) {
      version = this._removedTypes[filePath] + 1;
    }
    if (this._types[filePath]) {
      version = this._types[filePath].version + 1;
    }
    this._types[filePath] = { content, version };
    return true;
  }

  remove(filePath: string): boolean {
    const library = this._types[filePath];
    if (!library) {
      return false;
    }

    delete this._types[filePath];
    this._removedTypes[filePath] = library.version;
    return true;
  }

  async load(compilerOptions: CompilerOptions, workspace?: Workspace): Promise<void> {
    const types = compilerOptions.types;
    if (!Array.isArray(types)) {
      return;
    }

    delete compilerOptions.types;
    const entries = (await Promise.all(types.map(async (type) => {
      if (/^https?:\/\//.test(type)) {
        const response = await cache.fetch(type);
        const dtsUrl = response.headers.get("x-typescript-types");
        if (dtsUrl) {
          response.body?.cancel?.();
          const dtsResponse = await cache.fetch(dtsUrl);
          if (dtsResponse.ok) {
            return [dtsUrl, await dtsResponse.text()] as const;
          }
          console.error(`Failed to fetch \"${dtsUrl}\": ` + await dtsResponse.text());
          return null;
        }
        if (response.ok) {
          return [type, await response.text()] as const;
        }
        console.error(`Failed to fetch \"${type}\": ` + await response.text());
        return null;
      }

      if (typeof type === "string" && workspace) {
        const dtsUrl = new URL(type.replace(/\.d\.ts$/, "") + ".d.ts", "file:///").href;
        try {
          return [dtsUrl, await workspace.fs.readTextFile(dtsUrl)] as const;
        } catch (error) {
          console.error(`Failed to read \"${dtsUrl}\": ` + String((error as Error).message ?? error));
        }
      }

      return null;
    }))).filter(Boolean) as Array<readonly [string, string]>;

    if (workspace) {
      compilerOptions.$types = entries.map(([url]) => url).filter((url) => url.startsWith("file://"));
    }
    this.reset(Object.fromEntries(entries));
  }
}

async function loadCompilerOptions(workspace: Workspace) {
  const compilerOptions: CompilerOptions = {};
  try {
    const tsconfigJson = await workspace.fs.readTextFile("tsconfig.json");
    const tsconfig = parseJsonc(tsconfigJson) as { compilerOptions?: CompilerOptions };
    compilerOptions.$src = "file:///tsconfig.json";
    Object.assign(compilerOptions, tsconfig.compilerOptions);
  } catch (error) {
    if (!isFsNotFoundError(error)) {
      console.error(error);
    }
  }
  return compilerOptions;
}

async function loadImportMap(workspace: Workspace, validate: (importMap: ImportMapRaw) => ImportMapRaw) {
  try {
    const indexHtml = await workspace.fs.readTextFile("index.html");
    return validate(parseImportMapFromHtml(indexHtml));
  } catch (error) {
    if (!isFsNotFoundError(error)) {
      console.error("Failed to parse import map from index.html:", (error as Error).message);
    }
  }
  return validate({});
}

function isSameImportMap(left: ImportMapRaw, right: ImportMapRaw) {
  const { imports: leftImports, scopes: leftScopes } = left;
  const { imports: rightImports, scopes: rightScopes } = right;
  if (leftImports && rightImports) {
    if (!isSameStringMap(leftImports, rightImports)) {
      return false;
    }
  } else if (leftImports !== rightImports) {
    return false;
  }

  if (leftScopes && rightScopes) {
    if (!isSameScope(leftScopes, rightScopes)) {
      return false;
    }
  } else if (leftScopes !== rightScopes) {
    return false;
  }

  return true;
}

function isSameStringMap(left: Record<string, string>, right: Record<string, string>) {
  if (Object.keys(left).length !== Object.keys(right).length) {
    return false;
  }
  for (const key in left) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function isSameScope(left: Record<string, Record<string, string>>, right: Record<string, Record<string, string>>) {
  if (Object.keys(left).length !== Object.keys(right).length) {
    return false;
  }
  for (const key in left) {
    if (!isSameStringMap(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function isBlankImportMap(importMap: ImportMapRaw) {
  const { imports, scopes } = importMap;
  return (!imports || Object.keys(imports).length === 0) && (!scopes || Object.keys(scopes).length === 0);
}

function parseImportMapFromHtml(html: string): ImportMapRaw {
  const match = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    return {};
  }

  const source = match[1]?.trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = parseJsonc(source) as ImportMapRaw;
    return {
      imports: parsed.imports,
      scopes: parsed.scopes,
    };
  } catch (error) {
    console.error("Failed to parse inline import map:", (error as Error).message);
    return {};
  }
}

function isFsNotFoundError(error: unknown): error is Error & { FS_ERROR?: string } {
  return error instanceof Error && (error as { FS_ERROR?: string }).FS_ERROR === "NOT_FOUND";
}

function parseJsonc(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const stringOrCommentPattern = /("(?:\\?[^])*?")|(\/\/.*)|(\/\*[^]*?\*\/)/g;
    const stringOrTrailingCommaPattern = /("(?:\\?[^])*?")|(,\s*)(?=]|})/g;
    const fixed = text.replace(stringOrCommentPattern, "$1").replace(stringOrTrailingCommaPattern, "$1");
    return JSON.parse(fixed);
  }
}