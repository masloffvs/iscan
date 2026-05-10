import type { BpkgPackageBindingsDefinition } from "./define-bindings";
import aircrackBindings from "./aircrack.bindings";
import atoolBindings from "./atool.bindings";
import cameradarBindings from "./cameradar.bindings";
import metasploitBindings from "./metasploit.bindings";
import nmapBindings from "./nmap.bindings";
import sqlmapBindings from "./sqlmap.bindings";
import ytdlpBindings from "./ytdlp.bindings";

export * from "./define-bindings";
export { aircrackBindings, atoolBindings, cameradarBindings, metasploitBindings, nmapBindings, sqlmapBindings, ytdlpBindings };

export const registeredBpkgPackages: readonly BpkgPackageBindingsDefinition[] = [
	aircrackBindings,
	atoolBindings,
	cameradarBindings,
	metasploitBindings,
	nmapBindings,
	sqlmapBindings,
	ytdlpBindings,
] as const;

export type RegisteredBpkgPackageDefinition = BpkgPackageBindingsDefinition;

export type BpkgSupportedPackageSummary = {
	id: string;
	package: string;
	description: string;
	bindings: {
		id: string;
		description: string;
	}[];
	dependency: {
		pacman: readonly string[];
		paru: readonly string[];
	};
};

export function listRegisteredBpkgPackages(): BpkgSupportedPackageSummary[] {
	return registeredBpkgPackages.map((packageDefinition) => ({
		id: packageDefinition.id,
		package: packageDefinition.package,
		description: packageDefinition.description,
		bindings: Object.entries(packageDefinition.bindings).map(([bindingId, bindingDefinition]) => ({
			id: bindingId,
			description: bindingDefinition.description,
		})),
		dependency: {
			pacman: [...(packageDefinition.dependency.pacman ?? [])],
			paru: [...(packageDefinition.dependency.paru ?? [])],
		},
	}));
}

export function getRegisteredBpkgPackage(
	packageId: string,
): RegisteredBpkgPackageDefinition | null {
	return registeredBpkgPackages.find((packageDefinition) => packageDefinition.id === packageId) ?? null;
}