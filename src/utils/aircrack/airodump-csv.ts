import fs from "node:fs/promises";

export type AirodumpCsvAccessPoint = {
	bssid: string;
	firstSeen: string | null;
	lastSeen: string | null;
	channel: number | null;
	speed: number | null;
	privacy: string | null;
	cipher: string | null;
	authentication: string | null;
	power: number | null;
	beacons: number | null;
	ivs: number | null;
	lanIp: string | null;
	essidLength: number | null;
	essid: string | null;
	key: string | null;
	raw: string[];
};

export type AirodumpCsvStation = {
	stationMac: string;
	firstSeen: string | null;
	lastSeen: string | null;
	power: number | null;
	packets: number | null;
	bssid: string | null;
	probedEssids: string[];
	raw: string[];
};

export type AirodumpCsvSnapshot = {
	captureFile: string;
	parsedAt: number;
	accessPoints: AirodumpCsvAccessPoint[];
	stations: AirodumpCsvStation[];
};

function splitCsvLine(line: string): string[] {
	const fields: string[] = [];
	let currentField = "";
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index] ?? "";
		if (character === '"') {
			const nextCharacter = line[index + 1] ?? "";
			if (inQuotes && nextCharacter === '"') {
				currentField += '"';
				index += 1;
				continue;
			}

			inQuotes = !inQuotes;
			continue;
		}

		if (character === "," && !inQuotes) {
			fields.push(currentField.trim());
			currentField = "";
			continue;
		}

		currentField += character;
	}

	fields.push(currentField.trim());
	return fields;
}

function normalizeHeaderName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "");
}

function createHeaderIndexMap(header: readonly string[]): Map<string, number> {
	return new Map(header.map((column, index) => [normalizeHeaderName(column), index]));
}

function readCell(cells: readonly string[], headerIndexMap: Map<string, number>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const index = headerIndexMap.get(normalizeHeaderName(key));
		if (index !== undefined) {
			return cells[index];
		}
	}

	return undefined;
}

function normalizeOptionalString(value: string | undefined): string | null {
	if (value === undefined) {
		return null;
	}

	const normalizedValue = value.trim();
	return normalizedValue.length > 0 ? normalizedValue : null;
}

function parseOptionalInteger(value: string | undefined): number | null {
	const normalizedValue = normalizeOptionalString(value);
	if (!normalizedValue) {
		return null;
	}

	const parsedValue = Number.parseInt(normalizedValue, 10);
	return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseOptionalFloat(value: string | undefined): number | null {
	const normalizedValue = normalizeOptionalString(value);
	if (!normalizedValue) {
		return null;
	}

	const parsedValue = Number.parseFloat(normalizedValue);
	return Number.isFinite(parsedValue) ? parsedValue : null;
}

function looksLikeMacAddress(value: string | undefined): boolean {
	return typeof value === "string" && /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/u.test(value.trim());
}

function parseAccessPoint(headerIndexMap: Map<string, number>, cells: readonly string[]): AirodumpCsvAccessPoint | null {
	const bssid = normalizeOptionalString(readCell(cells, headerIndexMap, "BSSID"));
	if (!bssid || !looksLikeMacAddress(bssid)) {
		return null;
	}

	return {
		bssid,
		firstSeen: normalizeOptionalString(readCell(cells, headerIndexMap, "First time seen")),
		lastSeen: normalizeOptionalString(readCell(cells, headerIndexMap, "Last time seen")),
		channel: parseOptionalInteger(readCell(cells, headerIndexMap, "channel")),
		speed: parseOptionalInteger(readCell(cells, headerIndexMap, "Speed")),
		privacy: normalizeOptionalString(readCell(cells, headerIndexMap, "Privacy")),
		cipher: normalizeOptionalString(readCell(cells, headerIndexMap, "Cipher")),
		authentication: normalizeOptionalString(readCell(cells, headerIndexMap, "Authentication")),
		power: parseOptionalInteger(readCell(cells, headerIndexMap, "Power")),
		beacons: parseOptionalInteger(readCell(cells, headerIndexMap, "# beacons")),
		ivs: parseOptionalInteger(readCell(cells, headerIndexMap, "# IV", "#Data")),
		lanIp: normalizeOptionalString(readCell(cells, headerIndexMap, "LAN IP")),
		essidLength: parseOptionalInteger(readCell(cells, headerIndexMap, "ID-length")),
		essid: normalizeOptionalString(readCell(cells, headerIndexMap, "ESSID")),
		key: normalizeOptionalString(readCell(cells, headerIndexMap, "Key")),
		raw: [...cells],
	};
}

function parseStation(headerIndexMap: Map<string, number>, cells: readonly string[]): AirodumpCsvStation | null {
	const stationMac = normalizeOptionalString(readCell(cells, headerIndexMap, "Station MAC"));
	if (!stationMac || !looksLikeMacAddress(stationMac)) {
		return null;
	}

	const probedEssids = normalizeOptionalString(readCell(cells, headerIndexMap, "Probed ESSIDs"));
	return {
		stationMac,
		firstSeen: normalizeOptionalString(readCell(cells, headerIndexMap, "First time seen")),
		lastSeen: normalizeOptionalString(readCell(cells, headerIndexMap, "Last time seen")),
		power: parseOptionalFloat(readCell(cells, headerIndexMap, "Power")),
		packets: parseOptionalInteger(readCell(cells, headerIndexMap, "# packets", "Packets")),
		bssid: normalizeOptionalString(readCell(cells, headerIndexMap, "BSSID")),
		probedEssids: probedEssids ? [probedEssids] : [],
		raw: [...cells],
	};
}

export function parseAirodumpCsvContent(content: string, captureFile = "<memory>"): AirodumpCsvSnapshot {
	const accessPoints: AirodumpCsvAccessPoint[] = [];
	const stations: AirodumpCsvStation[] = [];
	const lines = content.split(/\r?\n/gu).map((line) => line.trimEnd());
	let section: "access-points" | "stations" | null = null;
	let headerIndexMap = new Map<string, number>();

	for (const line of lines) {
		if (line.trim().length === 0) {
			continue;
		}

		const cells = splitCsvLine(line);
		const firstCell = normalizeHeaderName(cells[0] ?? "");
		if (firstCell === "bssid") {
			section = "access-points";
			headerIndexMap = createHeaderIndexMap(cells);
			continue;
		}

		if (firstCell === "stationmac") {
			section = "stations";
			headerIndexMap = createHeaderIndexMap(cells);
			continue;
		}

		if (section === "access-points") {
			const record = parseAccessPoint(headerIndexMap, cells);
			if (record) {
				accessPoints.push(record);
			}
			continue;
		}

		if (section === "stations") {
			const record = parseStation(headerIndexMap, cells);
			if (record) {
				stations.push(record);
			}
		}
	}

	return {
		captureFile,
		parsedAt: Date.now(),
		accessPoints,
		stations,
	};
}

export async function parseAirodumpCsvFile(filePath: string): Promise<AirodumpCsvSnapshot> {
	const content = await fs.readFile(filePath, "utf8");
	return parseAirodumpCsvContent(content, filePath);
}