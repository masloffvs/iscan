import { defineBackgroundScript } from "../src/worker";

export default defineBackgroundScript(async ({ emit, logger, sleep }) => {
	let seconds = 0;

	logger.info("clock worker started");

	while (true) {
		await sleep(1000);
		seconds += 1;
		emit("tick", { seconds });
	}
});