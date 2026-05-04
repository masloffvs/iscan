import { $config } from "./config";
import { logger } from "./logger";
import * as lodash from "lodash-es";
import {
  createTableEntity,
  createTextEntity,
  createTreeEntity,
  createTreeNode,
  outputStack,
} from "./primitives";
import { BackgroundLifecycle } from "./worker";
import { ModuleRuntime, parseModuleParams, readFlagValue, registeredModules } from "./modules";
import { DEFAULT_VM_SERVER_PORT, startVmServer } from "./vm/server";
import { startWebInterface } from "./web/server";

const runtimeArgv = Bun.argv.slice(2);

function hasAnyFlag(argv: readonly string[], ...flagNames: readonly string[]): boolean {
  return flagNames.some((flagName) => argv.includes(flagName));
}

function getCliHelpText(): string {
  return [
    "iscan",
    "",
    "Usage:",
    "  bun run index.ts",
    "  bun run index.ts --help",
    "  bun run index.ts --web",
    "  bun run index.ts --vmserver",
    "  bun run index.ts --eval <code>",
    "  bun run index.ts --module <id> [--params <value>] [--param key=value]",
    "",
    "Modes:",
    "  no flags                    Start the interactive console",
    "  --web                       Start the web interface on port 8086",
    `  --vmserver                  Start the VM server on port ${DEFAULT_VM_SERVER_PORT}`,
    "  --eval <code>               Evaluate code in the runtime sandbox",
    "  --module <id>               Run a registered module directly",
    "",
    "Module params:",
    "  --params <value>            Inline JSON/string/number/bool payload",
    "  --param key=value           Add or override object fields; repeatable",
    "",
    "Examples:",
    "  bun run index.ts",
    "  bun run index.ts --web",
    "  bun run index.ts --vmserver",
    "  bun run index.ts --eval \"await $.games.hangman()\"",
    "  bun run index.ts --module discovery/zoomeye/pull --param page=1 --param pages=2",
    "",
    `Registered modules: ${registeredModules.length}`,
  ].join("\n");
}

if (hasAnyFlag(runtimeArgv, "--help", "-h")) {
  process.stdout.write(`${getCliHelpText()}\n`);
  process.exit(0);
}

if (hasAnyFlag(runtimeArgv, "--web")) {
  await startWebInterface();
}

const backgroundLifecycle = new BackgroundLifecycle({
  smol: $config.runtime.backgroundWorkers.smol,
  metricsIntervalMs: $config.runtime.backgroundWorkers.metricsIntervalMs,
  watchRefreshMs: $config.runtime.backgroundWorkers.watchRefreshMs,
  resourceLimits: $config.runtime.backgroundWorkers.resourceLimits,
});

const moduleRuntime = new ModuleRuntime(registeredModules, {
  helpers: {
    backgroundLifecycle,
    createTableEntity,
    createTextEntity,
    createTreeEntity,
    createTreeNode,
    workers: () => backgroundLifecycle.getWorkerSnapshots(),
    workerLogs: (target: string) => backgroundLifecycle.getWorkerLogs(target),
    stopWorker: async (target: string) => await backgroundLifecycle.stopWorker(target),
    restartWorker: async (target: string) => await backgroundLifecycle.restartWorker(target),
    output: outputStack,
  },
  sandboxEnvironment: {
    _: lodash,
    lodash,
  },
});

let exitCode = 0;

try {
  await backgroundLifecycle.start();
  if (hasAnyFlag(runtimeArgv, "--vmserver")) {
    await startVmServer(moduleRuntime, DEFAULT_VM_SERVER_PORT);
  } else {
    const evalCode = readFlagValue(runtimeArgv, "--eval");
    if (evalCode) {
      const result = await moduleRuntime.evaluate(evalCode);
      if (result !== undefined) {
        logger.info({ result }, "Eval completed");
      }
    } else {
      const moduleId = readFlagValue(runtimeArgv, "--module");
      if (moduleId) {
        const moduleParams = parseModuleParams(runtimeArgv);
        const result = await moduleRuntime.runModule(moduleId, moduleParams);
        if (result !== undefined) {
          logger.info({ result, moduleId, params: moduleParams }, "Module completed");
        }
      } else {
        exitCode = await moduleRuntime.startConsole();
      }
    }
  }
} finally {
  await backgroundLifecycle.stop();
}

process.exit(exitCode);
