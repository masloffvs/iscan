import { MicrolinkUaKit } from "../src/kits";
import { defineBackgroundScript } from "../src/worker";

const MICROLINK_UA_SYNC_INTERVAL_MS = 1000 * 60 * 60 * 4;

export default defineBackgroundScript(async ({ emit, logger, sleep }) => {
	const kit = new MicrolinkUaKit();

	const sync = async (reason: "startup" | "interval") => {
		const status = await kit.refresh();
		const payload = {
			reason,
			fetchStatus: status.fetchStatus,
			hasCachedPayload: status.hasCachedPayload,
			isStale: status.isStale,
			userAgentCount: status.userAgentCount,
			crawlerCount: status.crawlerCount,
			aiCount: status.aiCount,
			errorMessage: status.errorMessage,
			fetchedAt: status.fetchedAt,
		};

		if (status.fetchStatus === "error") {
			logger.warn("microlink ua sync completed with an error", payload);
		} else {
			logger.info("microlink ua sync completed", payload);
		}

		emit("microlink-ua-sync", payload);
	};

	logger.info("microlink ua sync worker started", {
		syncIntervalMs: MICROLINK_UA_SYNC_INTERVAL_MS,
		sourceUrl: kit.getSourceUrl(),
	});

	await sync("startup");

	while (true) {
		await sleep(MICROLINK_UA_SYNC_INTERVAL_MS);
		await sync("interval");
	}
});