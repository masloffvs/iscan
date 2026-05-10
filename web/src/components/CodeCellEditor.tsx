import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { sql as sqlLanguage } from "@codemirror/lang-sql";
import {
  githubDarkInit,
} from "@uiw/codemirror-theme-github";
import {
  getRemoteNotebookCompletions,
  type RemoteNotebookCellLanguage,
  type RemoteNotebookCompletionItem,
} from "../api/client";
import NotebookJavascriptEditor from "./NotebookJavascriptEditor";

const editorTheme = githubDarkInit({
  settings: {
    background: "transparent",
    gutterBackground: "transparent",
    caret: "#c6c6c6",
    fontFamily: "var(--iscan-editor-font-family)",
  },
});

const editorBasicSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  completionKeymap: true,
} as const;

const RUNTIME_COMPLETION_CACHE_LIMIT = 64;
const RUNTIME_COMPLETION_DELAY_MS = 180;

function toCodeMirrorCompletion(item: RemoteNotebookCompletionItem): Completion {
  return {
    label: item.label ?? item.value,
    detail: item.detail,
    apply: item.value,
    type: item.kind === "module" ? "namespace" : "variable",
  };
}

function buildCompletionResult(
  from: number,
  cursorOffset: number,
  items: readonly RemoteNotebookCompletionItem[],
): CompletionResult | null {
  if (items.length === 0) {
    return null;
  }

  return {
    from,
    to: cursorOffset,
    options: items.map(toCodeMirrorCompletion),
  };
}

function getNotebookCellLanguage(language?: string): RemoteNotebookCellLanguage {
  return language === "sql" ? "sql" : "javascript";
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

function rememberCompletionItems(
  cache: Map<string, readonly RemoteNotebookCompletionItem[]>,
  fragment: string,
  items: readonly RemoteNotebookCompletionItem[],
): void {
  cache.set(fragment, items);
  if (cache.size <= RUNTIME_COMPLETION_CACHE_LIMIT) {
    return;
  }

  const oldestKey = cache.keys().next().value;
  if (typeof oldestKey === "string") {
    cache.delete(oldestKey);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type CodeCellEditorProps = {
  value: string;
  language?: string;
  sessionCode?: string;
  cellId?: string;
  onChange: (value: string) => void;
  onRun?: () => void;
};

export default function CodeCellEditor({
  value,
  language,
  sessionCode,
  cellId,
  onChange,
  onRun,
}: CodeCellEditorProps) {
  const cellLanguage = getNotebookCellLanguage(language);

  if (cellLanguage !== "sql") {
    return (
      <NotebookJavascriptEditor
        cellId={cellId}
        value={value}
        sessionCode={sessionCode}
        onChange={onChange}
        onRun={onRun}
      />
    );
  }

  const extensions = useMemo<Extension[]>(() => {
    const completionCache = new Map<string, readonly RemoteNotebookCompletionItem[]>();
    const baseExtensions = [
      sqlLanguage(),
      keymap.of([
        {
          key: "Mod-Shift-Enter",
          run: () => {
            if (onRun) {
              onRun();
              return true;
            }
            return false;
          },
        },
      ]),
    ];

    if (!sessionCode) {
      return baseExtensions;
    }

    const sqlCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const source = context.state.doc.sliceString(0, context.pos);
      const cachedItems = completionCache.get(source);
      if (cachedItems) {
        return buildCompletionResult(findSqlCompletionStart(source, context.pos), context.pos, cachedItems);
      }

      const abortController = new AbortController();
      context.addEventListener("abort", () => abortController.abort(), { onDocChange: true });

      try {
        const items = await getRemoteNotebookCompletions(sessionCode, source, {
          language: "sql",
          signal: abortController.signal,
        });
        if (context.aborted) {
          return null;
        }

        rememberCompletionItems(completionCache, source, items);
        return buildCompletionResult(findSqlCompletionStart(source, context.pos), context.pos, items);
      } catch (error) {
        if (isAbortError(error) || context.aborted) {
          return null;
        }

        return null;
      }
    };

    return [
      ...baseExtensions,
      autocompletion({
        activateOnTyping: true,
        activateOnTypingDelay: RUNTIME_COMPLETION_DELAY_MS,
        override: [sqlCompletionSource],
      }),
    ];
  }, [sessionCode, onRun]);

  return (
    <CodeMirror
      className="notebook-code-editor [&_.cm-editor]:rounded-[10px] [&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-focused]:outline-none [&_.cm-gutters]:rounded-l-[10px] [&_.cm-gutters]:border-0 [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:rounded-[10px]"
      value={value}
      theme={editorTheme}
      onChange={onChange}
      extensions={extensions}
      basicSetup={editorBasicSetup}
    />
  );
}