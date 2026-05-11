# iscan

For a production install on an Arch host, use the single-command installer:

```bash
curl -fsSL git.new/iscan | bash
```

The installer is idempotent: running it again will automatically update your installation to the latest version. It pulls the latest Docker images, extracts the project's Nginx configuration, and restarts the services.

### Architecture

Iscan runs as a multi-service Docker stack managed by Nginx as a single entry point:

- **Access URL**: `http://localhost:33760`
- **Web Interface**: Proxied from the `webui` service.
- **API & WebSockets**: Proxied to the `vmserver` service via `/api/` and `/vm/`.

The stack is deployed to `/opt/iscan/`, with persistent state in `/var/lib/iscan`. The generated `/var/lib/iscan/config.yml` contains placeholder Hunter credentials; replace them before serious use.

To install local development dependencies:

```bash
bun install
```

To run the same project inside an Arch Linux container:

```bash
docker pull archlinux
docker compose build
```

For the default interactive console inside the same Arch-based container:

```bash
docker compose run --rm iscan
```

The Docker image installs Bun, SQLite, and the system libraries used by the project runtime. Host services stay reachable from the container at `host.docker.internal`. The bundled compose file keeps the Linux/X11 bind mount for headful browser workflows; on macOS/Windows you may still need an external X server and a matching `DISPLAY` override when launching visible browser sessions from inside the container.

To run:

```bash
bun run index.ts
```

To start the web interface on port `8086`:

```bash
bun run index.ts -- --web
```

There is also a convenience script:

```bash
bun run web
```

By default this now starts a small module console with a `/>` prompt.

Useful runtime modes:

```bash
bun run index.ts -- --module core/modules
bun run index.ts -- --eval "listModules().map(module => module.id)"
bun run index.ts -- --module core/modules --param category=discovery
bun run index.ts -- --module games/hangman
bun run index.ts -- --module discovery/apache-index --params '{"maxDepth":1,"daysBack":7}'
```

Inside the interactive prompt you can use:

```text
list
worker ls
worker ps
worker top
worker watch
worker logs clock
worker stop clock
worker restart clock
use discovery/apache-index
run
run maxDepth=1 daysBack=7
exit
```

Background workers are auto-discovered from the top-level `scripts/` directory on startup. Each `*.ts`, `*.js`, `*.mjs`, `*.mts`, `*.cts`, `*.tsx`, or `*.jsx` file is launched in its own Bun worker with `smol: true`.

Write worker scripts against the API exported from `src/worker`:

```ts
import { defineBackgroundScript } from "../src/worker";

export default defineBackgroundScript(async ({ logger, descriptor, sleep }) => {
	logger.info(`started ${descriptor.name}`);
	await sleep(1000);
	logger.info("done");
});
```

Inside the console, use `worker ls` or `worker ps` to print the worker table, `worker top` or `worker watch` for a live refreshing dashboard, and `worker logs <name>` to inspect the persisted worker history backed by the storage database. The old `workers` command still works as a compatibility alias. Inside `--eval`, `workers()` returns raw worker snapshots and `workerLogs(name)` reads the same persisted history.

The worker runtime now reads `runtime.backgroundWorkers` from `config.yml`: `SMOL`, `METRICS_INTERVAL_MS`, `WATCH_REFRESH_MS`, `RESOURCE_LIMITS`, and `LOG_RETENTION.MAX_ENTRIES_PER_WORKER`. Persisted worker logs are pruned per script path as new entries arrive, so noisy workers do not grow the SQLite database without bounds. The repo also includes a demo worker at `scripts/clock.ts`. It keeps a local `seconds` counter, increments it every second, and emits `tick` events so you can see a live payload in the worker table and log history. Worker snapshots now also surface configured worker-thread `resourceLimits` plus periodic memory usage metrics.

If a prompt command throws, the console now stays alive and prints the error inline instead of crashing the whole Bun process.

Prompt-facing failures are normalized into small runtime errors such as `UnknownModuleError`, `InvalidParamsError`, and `EvalRuntimeError`, so the console prints cleaner messages like `Unknown module: foo/bar` or `Unknown symbol or command: abc` instead of noisy Bun stack traces.

Business logic modules now live under `src/modules/`. Define them with `defineExecutor(...)` and `defineModule(...)`:

```ts
import { defineExecutor, defineModule } from "./src/modules";

const executor = defineExecutor(async ({ logger, params }) => {
	logger.info({ params }, "module started");
	return { ok: true };
});

export const exampleModule = defineModule({
	id: "example/demo",
	category: "example",
	description: "Example module",
	executor,
});
```

Registered modules are executed through the main entrypoint, and `--eval` runs async JavaScript in the same runtime context with helpers like `listModules()`, `use(id)`, and `run(id, params)`.

The module tree is now category-oriented instead of one flat bucket:

```text
src/modules/audit/
src/modules/core/
src/modules/discovery/
src/modules/games/
src/modules/kits/
```

Example audit flow for a deployed Vite SPA:

```bash
bun run index.ts -- --eval "run('audit/vite-spa', { url: 'https://app.example.com' })"
```

`audit/vite-spa` fetches the entry document plus linked same-origin JS and CSS assets, then flags common production leaks such as `import.meta.hot`, `@vite/client`, `sourceMappingURL`, private-network URLs, internal hostnames, suspicious `VITE_*` env keys, and provider-specific secret detectors for Telegram, Discord, GitHub, GitLab, npm, Slack, OpenAI, Anthropic, Groq, Hugging Face, Replicate, OpenRouter, Stripe restricted keys, and Supabase secrets, plus bearer-style auth literals and other secret-like literals.

The reusable secret detector dataset now lives under `src/modules/audit/datasets/` so future `audit/*` modules can share the same provider-specific coverage instead of redefining regexes locally.

If the SPA only reveals suspicious assets after client-side rendering, both Vite audit modules also support browser-backed traversal through `CloakKit`:

```bash
bun run index.ts -- --eval "run('audit/vite-spa', { url: 'https://app.example.com', fetchMode: 'browser', cloakProfileId: 'my-profile', renderMs: 1500 })"
```

With `fetchMode: 'browser'`, the shared audit traversal launches the selected Cloak profile, waits for the page to render, snapshots the final DOM, and then resolves same-origin asset URLs from the browser-rendered page instead of the raw HTTP response.

`cloakProfileId` accepts either the real profile `id` or a unique profile `name` from the Cloak profile manager.

To actively confirm public source maps and inspect what they expose:

```bash
bun run index.ts -- --eval "run('audit/vite-sourcemaps', { url: 'https://app.example.com' })"
```

`audit/vite-sourcemaps` fetches linked same-origin JS and CSS assets, follows `sourceMappingURL` references, downloads reachable `.map` files, and reports exposed source paths, embedded `sourcesContent`, filesystem paths, and suspicious source roots.

You can pass module params in two ways:

```bash
--params '{"maxDepth":1,"daysBack":7}'
--param maxDepth=1 --param daysBack=7
```

`core/modules` understands filters such as `category`, `prefix`, and `search`, which makes it useful as a built-in index when the module catalog grows.

Hunter Search is wired in via [src/hunter.ts](src/hunter.ts).

Configuration in `config.yml` supports both auth modes:

```yml
services:
	hunter:
		AUTH_METHOD: api-key
		API_KEY: your-hunter-api-key
		BEARER_TOKEN: "workspace-id:token"

manifest:
	dependencies:
		proxychains:
			binary: proxychains4
			aliases: [proxychains]
			required: true
		qemu-system:
			binary: qemu-system-x86_64
			required: true
		qemu-img:
			binary: qemu-img
			required: true
	kits:
		qemu:
			architecture: x86_64
			machine: q35
			accelerator: kvm
			memoryMb: 2048
			useProxy: false
			autoBootstrapRouterOnLaunch: false
			systemDependencyId: qemu-system
			imageDependencyId: qemu-img
			proxyDependencyId: proxychains
			defaultArgs: []
```

Set `AUTH_METHOD` to `api-key` to send `api-key=...` in the query string, or to `bearer` to send `Authorization: Bearer ...`.

`src/manifest.ts` now acts as a second config-oriented layer over the same `config.yml`: it resolves declared binaries, keeps a dependency status snapshot, and lets kits fail fast with precise messages when tools like `proxychains4`, `qemu-system-x86_64`, or `qemu-img` are missing. QEMU now starts directly by default; enable `useProxy: true` only when you explicitly want to wrap the host-side QEMU process with `proxychains`, and enable `autoBootstrapRouterOnLaunch: true` only if you want router presets to block on the initial OPNsense bootstrap workflow before launch.

The new `QemuKit` is exposed as an Activity-scoped module as well:

```bash
bun run index.ts -- --module kits/qemu/connect
bun run index.ts -- --eval 'await run("kits/qemu/connect")'
```

Once connected, the runtime sandbox can reuse it directly:

```ts
const qemu = requireQemuKit();
const preview = qemu.buildCommand({
	diskImage: "./images/lab.qcow2",
	headless: true,
	args: ["-nic", "user,hostfwd=tcp::2222-:22"],
});

console.log(preview.command.join(" "));
```

Example raw query:

```ts
import { $hunter } from "./src/hunter";

const result = await $hunter.search({
	query: 'ip="1.1.1.1"',
	startTime: "2026-04-01",
	endTime: "2026-04-21",
	page: 1,
	pageSize: 10,
	fields: ["ip", "port", "domain", "url", "updated_at"],
});
```

There is also a convenience wrapper for domain searches:

```ts
const result = await $hunter.searchDomain("example.com", {
	startTime: "2026-04-01",
	endTime: "2026-04-21",
	pageSize: 10,
	fields: ["ip", "port", "domain", "url", "updated_at"],
});
```

The client enforces Hunter's documented `1 request / 2 seconds` limit per process. If you need extra response columns such as `body`, `banner`, `cert`, or `product`, pass them explicitly in `fields` according to your Hunter plan.
