import { NetAddr } from "../../primitives";
import { $hunter } from "../../hunter";
import { HunterQuery } from "../../query";
import { createApacheWalkOutput, normalizeWalkedDirectories, type WalkedHostResult } from "../apache-walk";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";
import { ApacheFilesWalker } from "../walkers";

export type DiscoveryHunterNowApacheIndexParams = {
	page?: number;
	pageSize?: number;
	maxDepth?: number;
	daysBack?: number;
};

const HUNTERNOW_APACHE_INDEX_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "page",
		detail: "Hunter results page number.",
		valueType: "number",
		example: "page=1",
	},
	{
		name: "pageSize",
		detail: "Number of Hunter hits to inspect per page.",
		valueType: "number",
		example: "pageSize=10",
	},
	{
		name: "maxDepth",
		detail: "Maximum Apache directory recursion depth per host.",
		valueType: "number",
		example: "maxDepth=3",
	},
	{
		name: "daysBack",
		detail: "How many days of Hunter history to search.",
		valueType: "number",
		example: "daysBack=30",
	},
];

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

const executor = defineExecutor<DiscoveryHunterNowApacheIndexParams>(async ({ logger, params }) => {
	const endDate = new Date();
	const startDate = new Date(endDate);
	startDate.setDate(startDate.getDate() - (params.daysBack ?? 30));

	const queryBuilder = new HunterQuery()
		.where("web.title", "==", "Index of /")
		.and("ip.port", "==", "80");

	const results = await $hunter.search({
		query: queryBuilder.build(),
		startTime: formatDate(startDate),
		endTime: formatDate(endDate),
		page: params.page ?? 1,
		pageSize: params.pageSize ?? 10,
	});

	const walkedDirectories: WalkedHostResult[] = [];

	for (const result of results.unpack()) {
		const address = new NetAddr(`${result.ip}:${result.port}`);
		const url = address.toUrl();

		logger.info(
			{ url, title: result.web_title },
			"Found result. Trying to fetch title...",
		);

		const walker = new ApacheFilesWalker(address);
		const walkResult = await walker.run({ maxDepth: params.maxDepth ?? 3 });
		const directories = normalizeWalkedDirectories(url, walkResult);

		directories.forEach(directory => {
			logger.info({ url: directory.url, files: directory.files, error: directory.error }, "Walked directory");
		});

		walkedDirectories.push({
			url,
			directories,
		});
	}

	return createApacheWalkOutput(walkedDirectories);
});

export const discoveryHunterNowApacheIndexModule = defineModule({
	id: "discovery/hunternow/apache-index",
	aliases: ["hunternow/apache-index"],
	category: "discovery",
	description: "Search Hunter for Apache directory listings and walk them",
	consoleParams: HUNTERNOW_APACHE_INDEX_CONSOLE_PARAMS,
	executor,
});