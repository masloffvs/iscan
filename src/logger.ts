import { AsyncLocalStorage } from "node:async_hooks";
import { Writable } from "node:stream";

import { pino } from "pino";
import pretty from "pino-pretty";

type LoggerOutputSink = (line: string) => void;

const ansiPattern = /\u001B\[[0-9;]*m/g;

let activeLoggerOutputSink: LoggerOutputSink | null = null;
const loggerOutputSinkStorage = new AsyncLocalStorage<LoggerOutputSink | null>();

function writeFormattedChunk(chunk: string): void {
  const scopedSink = loggerOutputSinkStorage.getStore();
  if (scopedSink) {
    const lines = chunk.replace(/\r/g, "").split("\n");
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }

      scopedSink(line.replace(ansiPattern, ""));
    }
    return;
  }

  if (!activeLoggerOutputSink) {
    process.stdout.write(chunk);
    return;
  }

  const lines = chunk.replace(/\r/g, "").split("\n");
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }

    activeLoggerOutputSink(line.replace(ansiPattern, ""));
  }
}

export function attachLoggerOutputSink(sink: LoggerOutputSink): () => void {
  activeLoggerOutputSink = sink;

  return () => {
    if (activeLoggerOutputSink === sink) {
      activeLoggerOutputSink = null;
    }
  };
}

export async function runWithLoggerOutputSink<T>(
  sink: LoggerOutputSink,
  callback: () => Promise<T> | T,
): Promise<T> {
  return await loggerOutputSinkStorage.run(sink, callback);
}

const prettify = pretty.prettyFactory({
  colorize: true,
  translateTime: "SYS:standard",
  ignore: "pid,hostname",
});

const prettyDestination = new Writable({
  write(chunk, _encoding, callback) {
    try {
      const formattedChunk = prettify(String(chunk));
      if (formattedChunk) {
        writeFormattedChunk(formattedChunk);
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  },
});

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
}, prettyDestination);
