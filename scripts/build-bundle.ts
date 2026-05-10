import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWebAssets } from "../src/web/build";

const projectRoot = resolve(import.meta.dir, "..");
const distRoot = resolve(projectRoot, "dist");

const runtimeAssets = [
	{ pathSegments: ["config.yml"], recursive: false },
	{ pathSegments: ["package.json"], recursive: false },
	{ pathSegments: ["bun.lock"], recursive: false },
	{ pathSegments: ["tsconfig.json"], recursive: false },
	{ pathSegments: ["index.ts"], recursive: false },
	{ pathSegments: ["README.md"], recursive: false },
	{ pathSegments: ["src"], recursive: true },
	{ pathSegments: ["web"], recursive: true },
] as const;

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

await copyRuntimeAssets();

process.stdout.write(`Built source release bundle at ${distRoot}\n`);