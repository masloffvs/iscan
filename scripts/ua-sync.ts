import { UaKit } from "../src/kits";
import { defineBackgroundScript } from "../src/worker";

type UaSyncReason = "startup" | "interval";

export default defineBackgroundScript(async ({ emit, logger, sleep }) => {
	const kit = new UaKit();
	const syncIntervalMs = kit.getConfig().refreshIntervalMs;
	const enabledSourceIds = kit.getConfig().sources
		.filter((source) => source.enabled)
		.map((source) => source.id);

	const sync = async (reason: UaSyncReason) => {
		const result = await kit.refresh();
		const payload = {
			reason,
			exactAgentCount: result.exactAgentCount,
			patternCount: result.patternCount,
			refreshedAt: result.refreshedAt,
			refreshedSourceIds: result.refreshedSourceIds,
			sources: result.sources.map((source) => ({
				sourceId: source.sourceId,
				sourceKind: source.sourceKind,
				fetchStatus: source.fetchStatus,
				exactAgentCount: source.exactAgentCount,
				patternCount: source.patternCount,
				errorMessage: source.errorMessage,
				fetchedAt: source.fetchedAt,
				isStale: source.isStale,
			})),
		};

		if (payload.sources.some((source) => source.fetchStatus === "error")) {
			logger.warn("ua sync completed with an error", payload);
		} else {
			logger.info("ua sync completed", payload);
		}

		emit("ua-sync", payload);
	};

	logger.info("ua sync worker started", {
		enabledSourceIds,
		syncIntervalMs,
	});

	await sync("startup");

	while (true) {
		await sleep(syncIntervalMs);
		await sync("interval");
	}
});