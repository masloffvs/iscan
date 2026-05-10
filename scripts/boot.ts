import { $config } from "../src/config";
import { $hunter } from "../src/hunter";
import { logger } from "../src/logger";
import {
	AiKit,
	CloakKit,
	DomainLookupKit,
	Kit,
	ProxyKit,
	QemuKit,
	$settings,
	$storageKit,
} from "../src/kits";

const COMMON_RUNTIME_REASON = "scripts/boot";

export const $ai = new AiKit();
export const $cloak = new CloakKit();
export const $domainLookup = new DomainLookupKit();
export const $proxy = new ProxyKit();
export const $qemu = new QemuKit();

export const $commonRuntimeKits = [
	$storageKit,
	$settings,
	$ai,
	$cloak,
	$domainLookup,
	$proxy,
	$qemu,
] as const satisfies readonly Kit[];

async function startCommonRuntime(): Promise<void> {
	const results = await Promise.allSettled(
		$commonRuntimeKits.map(async (kit) => {
			await kit.start({ reason: COMMON_RUNTIME_REASON });
		}),
	);

	for (const [index, result] of results.entries()) {
		if (result.status === "fulfilled") {
			continue;
		}

		const kit = $commonRuntimeKits[index];
		logger.warn(
			{ kitId: kit?.id, error: result.reason },
			`Failed to start common runtime singleton ${kit?.id ?? index}`,
		);
	}
}

export async function stopCommonRuntime(): Promise<void> {
	await Promise.allSettled(
		[...$commonRuntimeKits]
			.reverse()
			.map(async (kit) => {
				await kit.stop({ reason: `${COMMON_RUNTIME_REASON}:stop` });
			}),
	);
}

export const commonRuntimeReady = startCommonRuntime();

await commonRuntimeReady;

export { $config, $hunter, $settings, $storageKit, logger };
