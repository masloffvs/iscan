import type { ModuleRuntime } from "../runtime";
import { CloakKit } from "../../kits/cloak-kit";
import { ProxyKit } from "../../kits/proxy-kit";

export type CloakManagerDependencies = {
	kit: CloakKit;
	proxyKit: ProxyKit | null;
};

type EnsureCloakManagerDependenciesOptions = {
	includeProxyKit?: boolean;
};

export async function ensureCloakManagerDependencies(
	runtime: ModuleRuntime<any>,
	reason: string,
	options: EnsureCloakManagerDependenciesOptions = {},
): Promise<CloakManagerDependencies> {
	let kit = runtime.getCloakKit();
	if (!kit) {
		kit = new CloakKit();
		await runtime.attachKit(kit, { reason });
	}

	if (options.includeProxyKit === false) {
		return { kit, proxyKit: null };
	}

	let proxyKit = runtime.getProxyKit();
	if (!proxyKit) {
		proxyKit = new ProxyKit();
		await runtime.attachKit(proxyKit, {
			reason: `${reason} (dependency)`,
		});
	}

	return { kit, proxyKit };
}