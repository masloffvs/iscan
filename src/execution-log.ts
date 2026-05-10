import { AsyncLocalStorage } from "node:async_hooks";

export type ExecutionLogStream = "stdout" | "stderr" | "log";

export type ExecutionLogChunk = {
  stream: ExecutionLogStream;
  chunk: string;
};

type ExecutionLogSink = (entry: ExecutionLogChunk) => void;

const executionLogStorage = new AsyncLocalStorage<ExecutionLogSink | null>();

export function emitExecutionLogChunk(entry: ExecutionLogChunk): void {
  executionLogStorage.getStore()?.(entry);
}

export async function runWithExecutionLogSink<T>(
  sink: ExecutionLogSink,
  callback: () => Promise<T> | T,
): Promise<T> {
  return await executionLogStorage.run(sink, callback);
}