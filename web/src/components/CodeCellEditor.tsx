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
import { javascript } from "@codemirror/lang-javascript";
import { sql as sqlLanguage } from "@codemirror/lang-sql";
import {
  githubDarkInit,
} from "@uiw/codemirror-theme-github";
import {
  getRemoteNotebookCompletions,
  type RemoteNotebookCellLanguage,
  type RemoteNotebookCompletionItem,
} from "../api/client";

const editorTheme = githubDarkInit({
  settings: {
    background: "transparent",
    gutterBackground: "transparent",
    caret: "#c6c6c6",
    fontFamily: "monospace",
  },
});

const editorBasicSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  completionKeymap: true,
} as const;

const RUNTIME_COMPLETION_WINDOW = 512;
const RUNTIME_COMPLETION_CACHE_LIMIT = 64;
const RUNTIME_COMPLETION_DELAY_MS = 180;
const IDENTIFIER_CHARACTER_PATTERN = /[A-Za-z0-9_$]/u;

type RuntimeFragmentMatch = {
  fragment: string;
  from: number;
};

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
  onChange: (value: string) => void;
  onRun?: () => void;
};

export default function CodeCellEditor({ value, language, sessionCode, onChange, onRun }: CodeCellEditorProps) {
  const cellLanguage = getNotebookCellLanguage(language);

  const extensions = useMemo<Extension[]>(() => {
    const completionCache = new Map<string, readonly RemoteNotebookCompletionItem[]>();
    const languageExtensions: Extension[] = cellLanguage === "sql"
      ? [sqlLanguage()]
      : [javascript({ jsx: true })];

    const baseExtensions = [
      ...languageExtensions,
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

    if (cellLanguage === "sql") {
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
    }

    const runtimeCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const source = context.state.doc.sliceString(0, context.pos);
      const fragmentMatch = findRuntimeFragment(source, context.pos);
      if (!fragmentMatch) {
        return null;
      }

      const cachedItems = completionCache.get(fragmentMatch.fragment);
      if (cachedItems) {
        return buildCompletionResult(fragmentMatch.from, context.pos, cachedItems);
      }

      const abortController = new AbortController();
      context.addEventListener("abort", () => abortController.abort(), { onDocChange: true });

      try {
        const items = await getRemoteNotebookCompletions(
          sessionCode,
          fragmentMatch.fragment,
          {
            language: "javascript",
            signal: abortController.signal,
          },
        );
        if (context.aborted) {
          return null;
        }

        rememberCompletionItems(completionCache, fragmentMatch.fragment, items);
        return buildCompletionResult(fragmentMatch.from, context.pos, items);
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
        override: [runtimeCompletionSource],
      }),
    ];
  }, [cellLanguage, sessionCode, onRun]);

  return (
    <CodeMirror
      className="[&_.cm-editor]:rounded-[10px] [&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-focused]:outline-none [&_.cm-gutters]:rounded-l-[10px] [&_.cm-gutters]:border-0 [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:rounded-[10px]"
      value={value}
      theme={editorTheme}
      onChange={onChange}
      extensions={extensions}
      basicSetup={editorBasicSetup}
    />
  );
}