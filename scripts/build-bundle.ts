import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWebAssets } from "../src/web/build";

const projectRoot = resolve(import.meta.dir, "..");
const distRoot = resolve(projectRoot, "dist");
const binaryPath = resolve(distRoot, "iscan");

const runtimeAssets = [
	{ pathSegments: ["config.yml"], recursive: false },
] as const;

function runCheckedCommand(command: string[], failureMessage: string): void {
	const result = Bun.spawnSync({
		cmd: command,
		cwd: projectRoot,
		stdout: "inherit",
		stderr: "inherit",
	});

	if (result.exitCode !== 0) {
		throw new Error(`${failureMessage} Exit code: ${result.exitCode ?? "unknown"}.`);
	}
}

async function copyRuntimeAssets(): Promise<void> {
	for (const asset of runtimeAssets) {
		const sourcePath = resolve(projectRoot, ...asset.pathSegments);
		const targetPath = resolve(distRoot, ...asset.pathSegments);
		await cp(sourcePath, targetPath, { recursive: asset.recursive });
	}
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

await buildWebAssets({
	outDir: resolve(distRoot, "web-build"),
});

runCheckedCommand(
	[process.execPath, "build", "--compile", "index.ts", "--outfile", binaryPath],
	"Failed to compile the Bun executable.",
);

await copyRuntimeAssets();

process.stdout.write(`Built standalone bundle at ${distRoot}\n`);