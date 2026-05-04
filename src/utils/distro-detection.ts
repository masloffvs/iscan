import fs from "node:fs/promises";

export type LinuxDistroInfo = {
	id: string | null;
	idLike: string[];
	name: string | null;
	prettyName: string | null;
	versionId: string | null;
};

function normalizeOsReleaseValue(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

export async function readLinuxDistroInfo(filePath = "/etc/os-release"): Promise<LinuxDistroInfo> {
	try {
		const rawText = await fs.readFile(filePath, "utf8");
		const values = new Map<string, string>();

		for (const line of rawText.split(/\r?\n/gu)) {
			const trimmed = line.trim();
			if (trimmed.length === 0 || trimmed.startsWith("#")) {
				continue;
			}

			const separatorIndex = trimmed.indexOf("=");
			if (separatorIndex < 0) {
				continue;
			}

			const key = trimmed.slice(0, separatorIndex).trim().toUpperCase();
			const value = normalizeOsReleaseValue(trimmed.slice(separatorIndex + 1));
			values.set(key, value);
		}

		return {
			id: values.get("ID")?.toLowerCase() ?? null,
			idLike: (values.get("ID_LIKE") ?? "")
				.split(/\s+/u)
				.map((value) => value.trim().toLowerCase())
				.filter(Boolean),
			name: values.get("NAME") ?? null,
			prettyName: values.get("PRETTY_NAME") ?? null,
			versionId: values.get("VERSION_ID") ?? null,
		};
	} catch {
		return {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		};
	}
}

export function isArchCompatibleDistro(distroInfo: LinuxDistroInfo): boolean {
	if (distroInfo.id === "arch") {
		return true;
	}

	return distroInfo.idLike.includes("arch") || distroInfo.idLike.includes("archlinux");
}