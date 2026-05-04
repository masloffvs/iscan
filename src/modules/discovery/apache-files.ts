import { NetAddr } from "../../primitives";
import { createApacheWalkOutput, normalizeWalkedDirectories } from "../apache-walk";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";
import { ApacheFilesWalker } from "../walkers";

export type ApacheFilesParams = {
	address?: string;
	maxDepth?: number;
};

const APACHE_FILES_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "address",
		detail: "Target host or host:port that serves the Apache directory listing.",
		valueType: "string",
		example: "address=118.89.189.23:6080",
		required: true,
	},
	{
		name: "maxDepth",
		detail: "Maximum recursion depth while walking nested directories.",
		valueType: "number",
		example: "maxDepth=3",
	},
];

const executor = defineExecutor<ApacheFilesParams>(async ({ logger, params }) => {
	if (typeof params.address !== "string" || params.address.trim().length === 0) {
		throw new InvalidParamsError("Param 'address' is required. Example: address=118.89.189.23:6080");
	}

	const address = new NetAddr(params.address);
	const walker = new ApacheFilesWalker(address);
	const walkResult = await walker.run({ maxDepth: params.maxDepth ?? 3 });
	const url = address.toUrl();
	const directories = normalizeWalkedDirectories(url, walkResult);

	directories.forEach(directory => {
		logger.info({ url: directory.url, files: directory.files, error: directory.error }, "Walked directory");
	});

	return createApacheWalkOutput([{ url, directories }]);
});

export const apacheFilesModule = defineModule({
	id: "discovery/apache-files",
	category: "discovery",
	description: "Walk an Apache directory listing from a specific address",
	consoleParams: APACHE_FILES_CONSOLE_PARAMS,
	executor,
}).useDefault("address");