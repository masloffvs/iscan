import { readdir } from "node:fs/promises";
import { isIP } from "node:net";
import { cpus, totalmem } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { FilePicker } from "ink-file-picker";

import { QemuKit, type QemuDiskInterface, type QemuKitEnvironmentReport, type QemuRouterNetworkConfig, type QemuVmPreset } from "../../kits";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";
import { QEMU_NOTEBOOK_TYPE_OVERLAY } from "./qemu-shared";

type QemuManagerProps = InteractiveApplicationProps & {
	kit: QemuKit;
};

type SystemTemplateId = "opnsense-router" | "windows-installer" | "linux-installer" | "custom";
type SystemTemplate = {
	id: SystemTemplateId;
	label: string;
	description: string;
	role?: QemuVmPreset["role"];
	diskFormat: (typeof IMAGE_FORMATS)[number];
	diskInterface: QemuDiskInterface;
	diskSize: string;
	memoryMb: string;
	machine: string;
	accelerator: string;
	cpu: string;
	smp: string;
	args: string;
	useAccelerator: boolean;
};
type SystemDraft = {
	templateId: SystemTemplateId;
	name: string;
	installIso: string;
	diskSize: string;
	routerNetwork?: RouterNetworkDraft;
};
type SystemCreationPlan = {
	templateId: SystemTemplateId;
	diskSize: string;
	role?: QemuVmPreset["role"];
	sourcePath?: string;
};
type FilePickerSource = "preset" | "system";
type FilePickerTarget = "diskImage" | "cdrom" | "kernel" | "initrd";
type IndexedDataFiles = Record<FilePickerTarget, string[]>;

type ViewState = "list" | "actions" | "environment" | "system" | "preset" | "router-network" | "details" | "image" | "file-picker";
type MessageTone = "info" | "success" | "error";
type ListFocus = "presets" | "panels";

const IMAGE_FORMATS = ["qcow2", "raw", "vmdk", "vdi"] as const;
const DISK_INTERFACE_OPTIONS: readonly QemuDiskInterface[] = ["virtio", "ide", "scsi"];
const LIST_ACTIONS = [
	{ id: "create-router", label: "+ Create OPNsense router", description: "Create the single routing VM that every other VM must use." },
	{ id: "create-system", label: "+ Create system from template", description: "Start from Windows/Linux defaults, auto-create a disk, then customize before saving." },
	{ id: "create-preset", label: "+ Add new VM preset", description: "Save a reusable VM launch profile." },
	{ id: "create-image", label: "+ Create disk image", description: "Run qemu-img create with the current draft." },
	{ id: "refresh", label: "+ Refresh environment", description: "Re-read dependency state and running process count." },
] as const;
const LIST_PANEL_BUTTONS = [
	{ id: "actions", label: "Actions", description: "Open create/refresh commands in a separate panel." },
	{ id: "environment", label: "Environment", description: "Inspect qemu, qemu-img, proxy and runtime status only when needed." },
] as const;

type ListActionId = typeof LIST_ACTIONS[number]["id"];
type ListPanelButtonId = typeof LIST_PANEL_BUTTONS[number]["id"];

const IMAGE_FIELDS = ["path", "size", "format", "overwrite"] as const;
type ImageInputMode = typeof IMAGE_FIELDS[number];

const SYSTEM_FIELDS = ["template", "name", "installIso", "diskSize"] as const;
const ROUTER_SYSTEM_FIELDS = [...SYSTEM_FIELDS, "routerHostname", "routerDomain", "routerLanAddress", "routerLanPrefix", "routerDhcpStart", "routerDhcpEnd"] as const;
type SystemInputMode = typeof ROUTER_SYSTEM_FIELDS[number];
const ROUTER_NETWORK_FIELDS = ["hostname", "domain", "lanAddress", "lanPrefix", "dhcpStart", "dhcpEnd"] as const;
type RouterNetworkInputMode = typeof ROUTER_NETWORK_FIELDS[number];

type PresetCategoryId = "general" | "boot" | "hardware" | "runtime" | "router";
const PRESET_FIELDS = [
	"name",
	"diskImage",
	"diskFormat",
	"diskInterface",
	"cdrom",
	"kernel",
	"initrd",
	"append",
	"memoryMb",
	"machine",
	"accelerator",
	"cpu",
	"smp",
	"args",
	"useProxy",
	"headless",
	"snapshot",
	"daemonize",
	"useAccelerator",
] as const;
type PresetInputMode = typeof PRESET_FIELDS[number] | "routerNetwork";
const FILE_PICKER_TARGETS: readonly FilePickerTarget[] = ["diskImage", "cdrom", "kernel", "initrd"];

type PresetCategory = {
	id: PresetCategoryId;
	label: string;
	description: string;
	fields: readonly PresetInputMode[];
};

const BASE_PRESET_CATEGORIES: readonly PresetCategory[] = [
	{
		id: "general",
		label: "General",
		description: "Name, primary disk path and storage format.",
		fields: ["name", "diskImage", "diskFormat", "diskInterface"],
	},
	{
		id: "boot",
		label: "Boot",
		description: "Installer media, kernel assets and guest boot append string.",
		fields: ["cdrom", "kernel", "initrd", "append"],
	},
	{
		id: "hardware",
		label: "Hardware",
		description: "Memory, machine type, accelerator and CPU topology.",
		fields: ["memoryMb", "machine", "accelerator", "cpu", "smp", "useAccelerator"],
	},
	{
		id: "runtime",
		label: "Runtime",
		description: "Advanced args, proxy and launch lifecycle flags.",
		fields: ["args", "useProxy", "headless", "snapshot", "daemonize"],
	},
] as const;

const ROUTER_PRESET_CATEGORY: PresetCategory = {
	id: "router",
	label: "Router",
	description: "Legacy router metadata kept for already-saved presets.",
	fields: ["routerNetwork"],
};

type PresetDraft = {
	name: string;
	role?: QemuVmPreset["role"];
	routerNetwork?: RouterNetworkDraft;
	diskImage: string;
	diskFormat: (typeof IMAGE_FORMATS)[number];
	diskInterface: QemuDiskInterface;
	cdrom: string;
	kernel: string;
	initrd: string;
	append: string;
	memoryMb: string;
	machine: string;
	accelerator: string;
	cpu: string;
	smp: string;
	args: string;
	useProxy: boolean;
	headless: boolean;
	snapshot: boolean;
	daemonize: boolean;
	useAccelerator: boolean;
};

type RouterNetworkDraft = {
	hostname: string;
	domain: string;
	lanAddress: string;
	lanPrefix: string;
	dhcpStart: string;
	dhcpEnd: string;
};

type ValidatedRouterNetworkConfig = {
	hostname: string;
	domain: string;
	wanInterface: string;
	lanInterface: string;
	lanAddress: string;
	lanPrefix: number;
	dhcpStart: string;
	dhcpEnd: string;
};

const HOST_LOGICAL_CPU_COUNT = Math.max(1, cpus().length || 1);
const HOST_TOTAL_MEMORY_MB = Math.max(512, Math.floor(totalmem() / (1024 * 1024)));
const HOST_RECOMMENDED_MEMORY_MB = Math.max(
	512,
	Math.min(HOST_TOTAL_MEMORY_MB, Math.max(512, Math.floor(HOST_TOTAL_MEMORY_MB * 0.75))),
);
const MIN_TERMINAL_WIDTH = 80;
const MIN_TERMINAL_HEIGHT = 24;
const MAX_INDEXED_FILES_PER_TARGET = 24;
const CDROM_IMAGE_PATTERN = /\.(iso|img)$/i;
const DISK_IMAGE_PATTERN = /\.(qcow2?|raw|img|vmdk|vdi|vhd|vhdx)$/i;
const KERNEL_IMAGE_PATTERN = /(^|[._-])(vmlinuz|bzimage|kernel)([._-]|$)|(^|[._-])image([._-]|$)/i;
const INITRD_IMAGE_PATTERN = /(^|[._-])(initrd|initramfs)([._-]|$)|\.cpio(\.(gz|xz|zst))?$/i;
const EMPTY_INDEXED_DATA_FILES: IndexedDataFiles = {
	cdrom: [],
	diskImage: [],
	kernel: [],
	initrd: [],
};
const FILE_PICKER_LABELS: Record<FilePickerTarget, string> = {
	cdrom: "CDROM image",
	diskImage: "disk image",
	kernel: "kernel image",
	initrd: "initrd image",
};
const ROUTER_ROLE: NonNullable<QemuVmPreset["role"]> = "router";
const ROUTER_BASE_IMAGE_BASENAMES = ["router.qcow2"] as const;
const ROUTER_DEFAULT_HOSTNAME = "opnsense";
const ROUTER_DEFAULT_DOMAIN = "localdomain";
const ROUTER_DEFAULT_LAN_ADDRESS = "192.168.1.1";
const ROUTER_DEFAULT_LAN_PREFIX = "24";
const ROUTER_DEFAULT_DHCP_START = "192.168.1.100";
const ROUTER_DEFAULT_DHCP_END = "192.168.1.199";
const ROUTER_DEFAULT_WAN_INTERFACE = "em0";
const ROUTER_DEFAULT_LAN_INTERFACE = "em1";
const ROUTER_DEFAULT_HOST_WEB_HOST = "127.0.0.1";
const ROUTER_DEFAULT_HOST_HTTP_PORT = 8080;
const ROUTER_DEFAULT_HOST_HTTPS_PORT = 8443;
const ROUTER_DEFAULT_HOST_SSH_PORT = 22022;
const ROUTER_NETWORK_ARGS = [
	"-netdev",
	"user,id=wan,hostfwd=tcp:127.0.0.1:8443-:443,hostfwd=tcp:127.0.0.1:8080-:80,hostfwd=tcp:127.0.0.1:22022-:22",
	"-device",
	"e1000,netdev=wan,mac=52:54:00:12:34:56",
	"-netdev",
	"tap,id=lan,ifname=tap0,script=no,downscript=no",
	"-device",
	"e1000,netdev=lan,mac=52:54:00:12:34:57",
	"-device",
	"virtio-vga-gl",
	"-display",
	"gtk,zoom-to-fit=on,gl=on",
] as const;
const ROUTED_CLIENT_NETWORK_ARG_PREFIX = [
	"-netdev",
	"-device",
	"virtio-net-pci,netdev=net1",
	"-display",
	"gtk,zoom-to-fit=on",
] as const;
const WINDOWS_ROUTED_CLIENT_DEVICE = "e1000,netdev=net1";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}

	return String(error);
}

function parseOptionalPositiveInteger(value: string, label: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const numericValue = Number(trimmed);
	if (!Number.isInteger(numericValue) || numericValue < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return numericValue;
}

function parseArgs(value: string): string[] | undefined {
	const parts = value.split(/\s+/).map(part => part.trim()).filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

function isFilePickerTarget(value: PresetInputMode): value is FilePickerTarget {
	return FILE_PICKER_TARGETS.includes(value as FilePickerTarget);
}

function parseIntegerOrNull(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const numericValue = Number(trimmed);
	if (!Number.isInteger(numericValue) || numericValue < 1) {
		return null;
	}

	return numericValue;
}

function roundToStep(value: number, step: number): number {
	return Math.max(step, Math.round(value / step) * step);
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		if (value === undefined) {
			continue;
		}

		if (seen.has(value)) {
			continue;
		}

		seen.add(value);
		result.push(value);
	}

	return result;
}

function uniqueSortedNumbers(values: readonly (number | null | undefined)[]): number[] {
	return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

function cycleStringValue(currentValue: string, options: readonly string[], delta: number): string {
	if (options.length === 0) {
		return currentValue;
	}

	const currentIndex = options.indexOf(currentValue);
	if (currentIndex === -1) {
		return options[delta >= 0 ? 0 : options.length - 1] ?? currentValue;
	}

	return options[(currentIndex + delta + options.length) % options.length] ?? currentValue;
}

function joinArgSegments(...segments: readonly (string | undefined)[]): string {
	return segments.map(segment => segment?.trim() ?? "").filter(Boolean).join(" ");
}

function formatArgList(parts: readonly string[]): string {
	return parts.join(" ");
}

function normalizeSearchToken(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findIndexedIsoByTokens(paths: readonly string[], tokens: readonly string[]): string {
	const normalizedTokens = tokens.map(normalizeSearchToken).filter(Boolean);
	return paths.find(candidatePath => {
		const normalizedPath = normalizeSearchToken(candidatePath);
		return normalizedTokens.some(token => normalizedPath.includes(token));
	}) ?? "";
}

function findIndexedPathByBasename(paths: readonly string[], basenames: readonly string[]): string {
	const normalizedBasenames = basenames.map(normalizeSearchToken).filter(Boolean);
	return paths.find(candidatePath => {
		const segments = candidatePath.split(/[\\/]/);
		const fileName = segments[segments.length - 1] ?? candidatePath;
		return normalizedBasenames.includes(normalizeSearchToken(fileName));
	}) ?? "";
}

function isRouterPreset(preset: Pick<QemuVmPreset, "role"> | Pick<PresetDraft, "role">): boolean {
	return preset.role === ROUTER_ROLE;
}

function getRouterPreset(presets: readonly QemuVmPreset[]): QemuVmPreset | null {
	return presets.find(preset => isRouterPreset(preset)) ?? null;
}

function extractTapInterfaceIndex(args: readonly string[] | undefined): number | null {
	if (!args) {
		return null;
	}

	for (const arg of args) {
		const match = /(?:^|,)ifname=tap(\d+)(?:,|$)/u.exec(arg);
		if (!match) {
			continue;
		}

		const tapIndex = Number(match[1]);
		if (Number.isInteger(tapIndex) && tapIndex >= 1) {
			return tapIndex;
		}
	}

	return null;
}

function findNextClientTapIndex(presets: readonly QemuVmPreset[]): number {
	const usedTapIndices = new Set(
		presets
			.filter((preset) => preset.role !== ROUTER_ROLE)
			.map((preset) => extractTapInterfaceIndex(preset.args))
			.filter((tapIndex): tapIndex is number => tapIndex !== null),
	);

	let tapIndex = 1;
	while (usedTapIndices.has(tapIndex)) {
		tapIndex += 1;
	}

	return tapIndex;
}

function createRoutedGuestArgs(defaultArgs: string, tapIndex: number, device: string = ROUTED_CLIENT_NETWORK_ARG_PREFIX[2]): string {
	return joinArgSegments(
		defaultArgs,
		formatArgList([
			ROUTED_CLIENT_NETWORK_ARG_PREFIX[0],
			`tap,id=net1,ifname=tap${tapIndex},script=no,downscript=no`,
			ROUTED_CLIENT_NETWORK_ARG_PREFIX[1],
			device,
			...ROUTED_CLIENT_NETWORK_ARG_PREFIX.slice(3),
		]),
	);
}

function createRouterArgs(defaultArgs: string): string {
	return joinArgSegments(defaultArgs, formatArgList(ROUTER_NETWORK_ARGS));
}

function getSystemFields(template: SystemTemplate): readonly SystemInputMode[] {
	return SYSTEM_FIELDS;
}

function getPresetCategories(draft: PresetDraft): readonly PresetCategory[] {
	return draft.routerNetwork ? [...BASE_PRESET_CATEGORIES, ROUTER_PRESET_CATEGORY] : BASE_PRESET_CATEGORIES;
}

function getPresetCategory(categories: readonly PresetCategory[], id: PresetCategoryId): PresetCategory {
	return categories.find(category => category.id === id) ?? categories[0]!;
}

function trimOptionalString(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function createDefaultRouterHostname(name = ROUTER_DEFAULT_HOSTNAME): string {
	return slugifySystemName(name) || ROUTER_DEFAULT_HOSTNAME;
}

function createDefaultRouterNetworkDraft(name = ROUTER_DEFAULT_HOSTNAME): RouterNetworkDraft {
	return {
		hostname: createDefaultRouterHostname(name),
		domain: ROUTER_DEFAULT_DOMAIN,
		lanAddress: ROUTER_DEFAULT_LAN_ADDRESS,
		lanPrefix: ROUTER_DEFAULT_LAN_PREFIX,
		dhcpStart: ROUTER_DEFAULT_DHCP_START,
		dhcpEnd: ROUTER_DEFAULT_DHCP_END,
	};
}

function hydrateRouterNetworkDraft(value: QemuRouterNetworkConfig | RouterNetworkDraft | undefined, name = ROUTER_DEFAULT_HOSTNAME): RouterNetworkDraft {
	const defaults = createDefaultRouterNetworkDraft(name);
	return {
		hostname: trimOptionalString(value?.hostname ?? "") ?? defaults.hostname,
		domain: trimOptionalString(value?.domain ?? "") ?? defaults.domain,
		lanAddress: trimOptionalString(value?.lanAddress ?? "") ?? defaults.lanAddress,
		lanPrefix: value?.lanPrefix !== undefined ? String(value.lanPrefix) : defaults.lanPrefix,
		dhcpStart: trimOptionalString(value?.dhcpStart ?? "") ?? defaults.dhcpStart,
		dhcpEnd: trimOptionalString(value?.dhcpEnd ?? "") ?? defaults.dhcpEnd,
	};
}

function validateHostnameLabel(value: string, label: string): string {
	const normalized = value.trim().toLowerCase();
	if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
		throw new Error(`${label} must be a valid hostname label.`);
	}

	return normalized;
}

function validateDomainName(value: string, label: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized.includes("..") || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(normalized)) {
		throw new Error(`${label} must be a valid domain name.`);
	}

	return normalized;
}

function parseRequiredIpv4(value: string, label: string): string {
	const normalized = value.trim();
	if (isIP(normalized) !== 4) {
		throw new Error(`${label} must be a valid IPv4 address.`);
	}

	return normalized;
}

function parseRouterLanPrefix(value: string): number {
	const normalized = parseOptionalPositiveInteger(value, "LAN prefix");
	if (!normalized || normalized > 30) {
		throw new Error("LAN prefix must be an integer between 1 and 30.");
	}

	return normalized;
}

function ipv4ToNumber(value: string): number {
	return value.split(".").reduce((accumulator, octet) => ((accumulator << 8) + Number(octet)) >>> 0, 0);
}

function isIpv4InSubnet(candidate: string, gateway: string, prefix: number): boolean {
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipv4ToNumber(candidate) & mask) === (ipv4ToNumber(gateway) & mask);
}

function buildRouterNetworkConfigFromDraft(routerNetwork: RouterNetworkDraft | undefined, presetName: string): ValidatedRouterNetworkConfig {
	if (!routerNetwork) {
		throw new Error("Router network configuration is required.");
	}

	const hostname = validateHostnameLabel(routerNetwork.hostname, "Router hostname");
	const domain = validateDomainName(routerNetwork.domain, "Router domain");
	const lanAddress = parseRequiredIpv4(routerNetwork.lanAddress, "LAN address");
	const lanPrefix = parseRouterLanPrefix(routerNetwork.lanPrefix);
	const dhcpStart = parseRequiredIpv4(routerNetwork.dhcpStart, "DHCP start");
	const dhcpEnd = parseRequiredIpv4(routerNetwork.dhcpEnd, "DHCP end");
	const lanAddressNumber = ipv4ToNumber(lanAddress);
	const dhcpStartNumber = ipv4ToNumber(dhcpStart);
	const dhcpEndNumber = ipv4ToNumber(dhcpEnd);

	if (!isIpv4InSubnet(dhcpStart, lanAddress, lanPrefix) || !isIpv4InSubnet(dhcpEnd, lanAddress, lanPrefix)) {
		throw new Error("DHCP range must stay inside the configured LAN subnet.");
	}

	if (dhcpStartNumber > dhcpEndNumber) {
		throw new Error("DHCP start address must be less than or equal to DHCP end.");
	}

	if (lanAddressNumber >= dhcpStartNumber && lanAddressNumber <= dhcpEndNumber) {
		throw new Error("DHCP range cannot include the router LAN address.");
	}

	return {
		hostname,
		domain,
		wanInterface: ROUTER_DEFAULT_WAN_INTERFACE,
		lanInterface: ROUTER_DEFAULT_LAN_INTERFACE,
		lanAddress,
		lanPrefix,
		dhcpStart,
		dhcpEnd,
	};
}
function formatRouterNetworkSummary(routerNetwork: Pick<RouterNetworkDraft, "lanAddress" | "lanPrefix" | "dhcpStart" | "dhcpEnd">): string {
	return `${routerNetwork.lanAddress}/${routerNetwork.lanPrefix} • DHCP ${routerNetwork.dhcpStart} - ${routerNetwork.dhcpEnd}`;
}

function createMemoryOptions(currentValue: string, configMemoryMb: number): string[] {
	const currentMemoryMb = parseIntegerOrNull(currentValue);
	const hostQuarter = roundToStep(HOST_RECOMMENDED_MEMORY_MB / 4, 256);
	const hostHalf = roundToStep(HOST_RECOMMENDED_MEMORY_MB / 2, 256);
	const hostRecommended = roundToStep(HOST_RECOMMENDED_MEMORY_MB, 256);
	return uniqueSortedNumbers([
		512,
		1024,
		2048,
		4096,
		8192,
		16384,
		configMemoryMb,
		hostQuarter,
		hostHalf,
		hostRecommended,
		currentMemoryMb,
	]).map(String);
}

function createSmpOptions(currentValue: string): string[] {
	const currentSmp = parseIntegerOrNull(currentValue);
	const halfHost = Math.max(1, Math.ceil(HOST_LOGICAL_CPU_COUNT / 2));
	return uniqueSortedNumbers([
		1,
		2,
		4,
		8,
		halfHost,
		HOST_LOGICAL_CPU_COUNT,
		currentSmp,
	]).map(String);
}

function createMachineOptions(architecture: string, configMachine: string, currentValue: string): string[] {
	const normalizedArchitecture = architecture.toLowerCase();
	const defaultMachines = normalizedArchitecture.includes("arm") || normalizedArchitecture.includes("aarch64")
		? ["virt"]
		: ["q35", "pc"];

	return uniqueStrings([...defaultMachines, configMachine, currentValue.trim() || undefined]);
}

function createAcceleratorOptions(configAccelerator: string | undefined, currentValue: string): string[] {
	const defaults = process.platform === "linux"
		? ["", "kvm", "tcg"]
		: process.platform === "darwin"
			? ["", "hvf", "tcg"]
			: process.platform === "win32"
				? ["", "whpx", "tcg"]
				: ["", "tcg"];

	return uniqueStrings([...defaults, configAccelerator, currentValue.trim() || undefined]);
}

function createCpuOptions(architecture: string, currentValue: string): string[] {
	const normalizedArchitecture = architecture.toLowerCase();
	const defaults = normalizedArchitecture.includes("x86")
		? ["", "host", "max", "qemu64"]
		: normalizedArchitecture.includes("arm") || normalizedArchitecture.includes("aarch64")
			? ["", "host", "max", "cortex-a72"]
			: ["", "host", "max"];

	return uniqueStrings([...defaults, currentValue.trim() || undefined]);
}

function createDefaultPresetDraft(kit: QemuKit): PresetDraft {
	const config = kit.getConfig();
	return {
		name: "",
		role: undefined,
		routerNetwork: undefined,
		diskImage: "",
		diskFormat: "qcow2",
		diskInterface: "virtio",
		cdrom: "",
		kernel: "",
		initrd: "",
		append: "",
		memoryMb: String(config.memoryMb),
		machine: config.machine,
		accelerator: config.accelerator ?? "",
		cpu: "",
		smp: "",
		args: config.defaultArgs.join(" "),
		useProxy: config.useProxy,
		headless: false,
		snapshot: false,
		daemonize: false,
		useAccelerator: Boolean(config.accelerator),
	};
}

function createRouterSystemTemplate(config: ReturnType<QemuKit["getConfig"]>): SystemTemplate {
	const defaultArgs = createRouterArgs(config.defaultArgs.join(" "));
	const routerMemoryMb = HOST_RECOMMENDED_MEMORY_MB >= 4096 ? "2048" : "1024";
	const routerSmp = String(Math.max(1, Math.min(HOST_LOGICAL_CPU_COUNT, 2)));

	return {
		id: "opnsense-router",
		label: "OPNsense Router",
		description: "Copies a prepared router qcow base image and launches it with WAN user-mode forwarding plus LAN tap0.",
		role: ROUTER_ROLE,
		diskFormat: "qcow2",
		diskInterface: "virtio",
		diskSize: "16G",
		memoryMb: String(Math.max(4096, Number(routerMemoryMb))),
		machine: config.machine,
		accelerator: config.accelerator ?? "",
		cpu: "host",
		smp: String(Math.max(4, Number(routerSmp))),
		args: defaultArgs,
		useAccelerator: Boolean(config.accelerator),
	};
}

function createSystemTemplates(config: ReturnType<QemuKit["getConfig"]>): readonly SystemTemplate[] {
	const defaultArgs = config.defaultArgs.join(" ");
	const windowsMemoryMb = HOST_RECOMMENDED_MEMORY_MB >= 6144
		? "6144"
		: HOST_RECOMMENDED_MEMORY_MB >= 4096
			? "4096"
			: String(Math.max(2048, roundToStep(HOST_RECOMMENDED_MEMORY_MB, 256)));
	const linuxMemoryMb = HOST_RECOMMENDED_MEMORY_MB >= 4096
		? "4096"
		: HOST_RECOMMENDED_MEMORY_MB >= 2048
			? "2048"
			: String(Math.max(1024, roundToStep(HOST_RECOMMENDED_MEMORY_MB, 256)));
	const windowsSmp = String(Math.max(1, Math.min(HOST_LOGICAL_CPU_COUNT, 4)));
	const linuxSmp = String(Math.max(1, Math.min(HOST_LOGICAL_CPU_COUNT, 2)));

	return [
		{
			id: "windows-installer",
			label: "Windows Installer",
			description: "Uses an IDE disk so Windows setup sees the drive without extra virtio drivers.",
			diskFormat: "qcow2",
			diskInterface: "ide",
			diskSize: "64G",
			memoryMb: windowsMemoryMb,
			machine: config.machine,
			accelerator: config.accelerator ?? "",
			cpu: "host",
			smp: windowsSmp,
			args: defaultArgs,
			useAccelerator: Boolean(config.accelerator),
		},
		{
			id: "linux-installer",
			label: "Linux Installer",
			description: "Uses a virtio disk for the standard faster Linux guest path.",
			diskFormat: "qcow2",
			diskInterface: "virtio",
			diskSize: "32G",
			memoryMb: linuxMemoryMb,
			machine: config.machine,
			accelerator: config.accelerator ?? "",
			cpu: "host",
			smp: linuxSmp,
			args: defaultArgs,
			useAccelerator: Boolean(config.accelerator),
		},
		{
			id: "custom",
			label: "Custom Base",
			description: "Starts from the current QemuKit defaults and lets you tune everything manually.",
			diskFormat: "qcow2",
			diskInterface: "virtio",
			diskSize: "20G",
			memoryMb: String(config.memoryMb),
			machine: config.machine,
			accelerator: config.accelerator ?? "",
			cpu: "host",
			smp: "",
			args: defaultArgs,
			useAccelerator: Boolean(config.accelerator),
		},
	] as const;
}

function createDefaultSystemDraft(template: SystemTemplate): SystemDraft {
	return {
		templateId: template.id,
		name: "",
		installIso: "",
		diskSize: template.diskSize,
		routerNetwork: undefined,
	};
}

function getSystemTemplate(templates: readonly SystemTemplate[], id: SystemTemplateId): SystemTemplate {
	return templates.find(template => template.id === id) ?? templates[0]!;
}

function slugifySystemName(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getDiskImageExtension(format: (typeof IMAGE_FORMATS)[number]): string {
	return format === "raw" ? "img" : format;
}

function buildSystemDiskImagePath(name: string, format: (typeof IMAGE_FORMATS)[number]): string {
	const slug = slugifySystemName(name) || "unnamed-system";
	return toProjectPath(resolve(process.cwd(), "data", "qemu", `${slug}.${getDiskImageExtension(format)}`));
}

function createPresetDraftFromSystem(
	kit: QemuKit,
	systemDraft: SystemDraft,
	template: SystemTemplate,
): PresetDraft {
	const draft = createDefaultPresetDraft(kit);
	return {
		...draft,
		name: systemDraft.name.trim(),
		role: template.role,
		diskImage: buildSystemDiskImagePath(systemDraft.name, template.diskFormat),
		diskFormat: template.diskFormat,
		diskInterface: template.diskInterface,
		cdrom: template.role === ROUTER_ROLE ? "" : systemDraft.installIso.trim(),
		memoryMb: template.memoryMb,
		machine: template.machine,
		accelerator: template.accelerator,
		cpu: template.cpu,
		smp: template.smp,
		args: template.args,
		routerNetwork: undefined,
		useAccelerator: template.useAccelerator,
	};
}

function toProjectPath(filePath: string): string {
	const relativePath = relative(process.cwd(), filePath);
	if (!relativePath || relativePath.startsWith("..")) {
		return filePath;
	}

	return relativePath;
}

function getMediaPickerInitialPath(currentValue: string): string {
	const trimmedValue = currentValue.trim();
	if (!trimmedValue) {
		return process.cwd();
	}

	const absolutePath = isAbsolute(trimmedValue)
		? trimmedValue
		: resolve(process.cwd(), trimmedValue);

	return dirname(absolutePath);
}

function shouldSkipIndexedDataDirectory(name: string): boolean {
	return name.startsWith(".") || name.startsWith("profile-");
}

function matchesIndexedTargetFile(target: FilePickerTarget, fileName: string): boolean {
	if (target === "cdrom") {
		return CDROM_IMAGE_PATTERN.test(fileName) && !INITRD_IMAGE_PATTERN.test(fileName);
	}

	if (target === "diskImage") {
		return DISK_IMAGE_PATTERN.test(fileName)
			&& !fileName.toLowerCase().endsWith(".iso")
			&& !INITRD_IMAGE_PATTERN.test(fileName);
	}

	if (target === "kernel") {
		return KERNEL_IMAGE_PATTERN.test(fileName);
	}

	return INITRD_IMAGE_PATTERN.test(fileName);
}

function shouldFilterPickerTarget(target: FilePickerTarget): boolean {
	return target === "cdrom" || target === "diskImage";
}

function matchesPickerTargetFile(target: FilePickerTarget, fileName: string): boolean {
	if (!shouldFilterPickerTarget(target)) {
		return true;
	}

	return matchesIndexedTargetFile(target, fileName);
}

function formatIndexedDataSummary(indexedDataFiles: IndexedDataFiles): string {
	const parts: string[] = [];
	if (indexedDataFiles.cdrom.length > 0) {
		parts.push(`${indexedDataFiles.cdrom.length} ISO/IMG`);
	}
	if (indexedDataFiles.diskImage.length > 0) {
		parts.push(`${indexedDataFiles.diskImage.length} disk images`);
	}
	if (indexedDataFiles.kernel.length > 0) {
		parts.push(`${indexedDataFiles.kernel.length} kernels`);
	}
	if (indexedDataFiles.initrd.length > 0) {
		parts.push(`${indexedDataFiles.initrd.length} initrd`);
	}

	return parts.length > 0
		? `Indexed data/: ${parts.join(" • ")}`
		: "Indexed data/: no quick media matches found";
}

async function indexDataFiles(rootDirectory = resolve(process.cwd(), "data")): Promise<IndexedDataFiles> {
	const indexedDataFiles: IndexedDataFiles = {
		cdrom: [],
		diskImage: [],
		kernel: [],
		initrd: [],
	};

	const walk = async (currentDirectory: string): Promise<void> => {
		const entries = await readdir(currentDirectory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));

		for (const entry of entries) {
			const fullPath = resolve(currentDirectory, entry.name);

			if (entry.isDirectory()) {
				if (shouldSkipIndexedDataDirectory(entry.name)) {
					continue;
				}

				await walk(fullPath);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			const storedPath = toProjectPath(fullPath);
			for (const target of FILE_PICKER_TARGETS) {
				if (!matchesIndexedTargetFile(target, entry.name)) {
					continue;
				}

				if (indexedDataFiles[target].length >= MAX_INDEXED_FILES_PER_TARGET || indexedDataFiles[target].includes(storedPath)) {
					continue;
				}

				indexedDataFiles[target].push(storedPath);
			}
		}
	};

	try {
		await walk(rootDirectory);
	} catch {
		return EMPTY_INDEXED_DATA_FILES;
	}

	return indexedDataFiles;
}

function toneColor(tone: MessageTone): string {
	if (tone === "success") {
		return "#34d399";
	}

	if (tone === "error") {
		return "#f87171";
	}

	return "#7dd3fc";
}

function QemuManager({ width, height, onExit, kit }: QemuManagerProps) {
	const config = kit.getConfig();
	const routerSystemTemplate = createRouterSystemTemplate(config);
	const systemTemplates = createSystemTemplates(config);
	const allSystemTemplates = [routerSystemTemplate, ...systemTemplates] as const;
	const [view, setView] = useState<ViewState>("list");
	const [cursor, setCursor] = useState(0);
	const [actionCursor, setActionCursor] = useState(0);
	const [listFocus, setListFocus] = useState<ListFocus>("presets");
	const [listPanelCursor, setListPanelCursor] = useState<ListPanelButtonId>("actions");
	const [presets, setPresets] = useState<QemuVmPreset[]>([]);
	const [indexedDataFiles, setIndexedDataFiles] = useState<IndexedDataFiles>(EMPTY_INDEXED_DATA_FILES);
	const [report, setReport] = useState<QemuKitEnvironmentReport | null>(null);
	const [message, setMessage] = useState<string>("Use the manager to work with VM presets. Open Actions or Environment only when you need them.");
	const [messageTone, setMessageTone] = useState<MessageTone>("info");

	const [imagePath, setImagePath] = useState("");
	const [imageSize, setImageSize] = useState("20G");
	const [imageFormat, setImageFormat] = useState<(typeof IMAGE_FORMATS)[number]>("qcow2");
	const [imageOverwrite, setImageOverwrite] = useState(false);
	const [imageInputMode, setImageInputMode] = useState<ImageInputMode>("path");
	const [systemDraft, setSystemDraft] = useState<SystemDraft>(() => createDefaultSystemDraft(systemTemplates[0]!));
	const [systemInputMode, setSystemInputMode] = useState<SystemInputMode>("template");

	const [draft, setDraft] = useState<PresetDraft>(() => createDefaultPresetDraft(kit));
	const [presetInputMode, setPresetInputMode] = useState<PresetInputMode>("name");
	const [presetCategory, setPresetCategory] = useState<PresetCategoryId>("general");
	const [routerNetworkInputMode, setRouterNetworkInputMode] = useState<RouterNetworkInputMode>("hostname");
	const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
	const [pendingSystemCreation, setPendingSystemCreation] = useState<SystemCreationPlan | null>(null);
	const [filePickerTarget, setFilePickerTarget] = useState<FilePickerTarget>("cdrom");
	const [filePickerSource, setFilePickerSource] = useState<FilePickerSource>("preset");
	const memoryOptions = createMemoryOptions(draft.memoryMb, config.memoryMb);
	const smpOptions = createSmpOptions(draft.smp);
	const machineOptions = createMachineOptions(config.architecture, config.machine, draft.machine);
	const acceleratorOptions = createAcceleratorOptions(config.accelerator, draft.accelerator);
	const cpuOptions = createCpuOptions(config.architecture, draft.cpu);
	const routerPreset = getRouterPreset(presets);
	const hasRouterPreset = Boolean(routerPreset);
	const routerBaseImage = findIndexedPathByBasename(indexedDataFiles.diskImage, ROUTER_BASE_IMAGE_BASENAMES);
	const activeSystemTemplate = getSystemTemplate(allSystemTemplates, systemDraft.templateId);
	const generatedSystemDiskPath = buildSystemDiskImagePath(systemDraft.name, activeSystemTemplate.diskFormat);
	const indexedSystemMediaOptions = activeSystemTemplate.role === ROUTER_ROLE
		? uniqueStrings([systemDraft.installIso.trim() || undefined, ...indexedDataFiles.diskImage])
		: uniqueStrings([systemDraft.installIso.trim() || undefined, ...indexedDataFiles.cdrom]);
	const indexedCdromOptions = uniqueStrings([draft.cdrom.trim() || undefined, ...indexedDataFiles.cdrom]);
	const indexedDiskImageOptions = uniqueStrings([draft.diskImage.trim() || undefined, ...indexedDataFiles.diskImage]);
	const indexedKernelOptions = uniqueStrings([draft.kernel.trim() || undefined, ...indexedDataFiles.kernel]);
	const indexedInitrdOptions = uniqueStrings([draft.initrd.trim() || undefined, ...indexedDataFiles.initrd]);
	const indexedDataSummary = formatIndexedDataSummary(indexedDataFiles);
	const selectedPanelButton = LIST_PANEL_BUTTONS.find(button => button.id === listPanelCursor) ?? LIST_PANEL_BUTTONS[0]!;
	const systemFields = getSystemFields(activeSystemTemplate);
	const presetCategories = getPresetCategories(draft);
	const activePresetCategory = getPresetCategory(presetCategories, presetCategory);
	const presetFields = activePresetCategory.fields;
	const nextClientTapIndex = findNextClientTapIndex(presets);
	const routerSystemSummary = systemDraft.routerNetwork ? formatRouterNetworkSummary(systemDraft.routerNetwork) : null;
	const routerPresetSummary = draft.routerNetwork ? formatRouterNetworkSummary(draft.routerNetwork) : null;

	const refreshReport = () => {
		try {
			setReport(kit.inspectEnvironment());
		} catch (error) {
			setMessage(getErrorMessage(error));
			setMessageTone("error");
		}
	};

	const refreshIndexedDataFiles = async () => {
		const nextIndexedDataFiles = await indexDataFiles();
		setIndexedDataFiles(nextIndexedDataFiles);
	};

	const refreshState = () => {
		const nextPresets = kit.getPresets();
		setPresets(nextPresets);
		void refreshIndexedDataFiles();
	};

	useEffect(() => {
		refreshState();
	}, [kit]);

	useEffect(() => {
		if (systemDraft.templateId !== routerSystemTemplate.id || systemDraft.installIso || !routerBaseImage) {
			return;
		}

		setSystemDraft(currentDraft => currentDraft.templateId === routerSystemTemplate.id && !currentDraft.installIso
			? { ...currentDraft, installIso: routerBaseImage }
			: currentDraft);
	}, [routerBaseImage, routerSystemTemplate.id, systemDraft.installIso, systemDraft.templateId]);

	const cycleImageFormat = (delta: number) => {
		const currentIndex = IMAGE_FORMATS.indexOf(imageFormat);
		const nextIndex = (currentIndex + delta + IMAGE_FORMATS.length) % IMAGE_FORMATS.length;
		setImageFormat(IMAGE_FORMATS[nextIndex]!);
	};

	const cyclePresetFormat = (delta: number) => {
		const currentIndex = IMAGE_FORMATS.indexOf(draft.diskFormat);
		const nextIndex = (currentIndex + delta + IMAGE_FORMATS.length) % IMAGE_FORMATS.length;
		setDraft(currentDraft => ({ ...currentDraft, diskFormat: IMAGE_FORMATS[nextIndex]! }));
	};

	const cycleSystemTemplate = (delta: number) => {
		if (activeSystemTemplate.role === ROUTER_ROLE) {
			return;
		}

		const currentIndex = systemTemplates.findIndex(template => template.id === systemDraft.templateId);
		const nextIndex = (currentIndex + delta + systemTemplates.length) % systemTemplates.length;
		const nextTemplate = systemTemplates[nextIndex] ?? systemTemplates[0]!;
		setSystemDraft(currentDraft => ({
			...currentDraft,
			templateId: nextTemplate.id,
			diskSize: nextTemplate.diskSize,
		}));
	};

	const updateSystemRouterNetwork = (field: keyof RouterNetworkDraft, updater: (value: string) => string) => {
		setSystemDraft(currentDraft => ({
			...currentDraft,
			routerNetwork: {
				...hydrateRouterNetworkDraft(currentDraft.routerNetwork, currentDraft.name),
				[field]: updater(currentDraft.routerNetwork?.[field] ?? ""),
			},
		}));
	};

	const updateDraftRouterNetwork = (field: keyof RouterNetworkDraft, updater: (value: string) => string) => {
		setDraft(currentDraft => ({
			...currentDraft,
			routerNetwork: {
				...hydrateRouterNetworkDraft(currentDraft.routerNetwork, currentDraft.name),
				[field]: updater(currentDraft.routerNetwork?.[field] ?? ""),
			},
		}));
	};

	const switchPresetCategory = (delta: number) => {
		const currentIndex = presetCategories.findIndex(category => category.id === activePresetCategory.id);
		const nextCategory = presetCategories[(currentIndex + delta + presetCategories.length) % presetCategories.length] ?? presetCategories[0]!;
		setPresetCategory(nextCategory.id);
		setPresetInputMode(nextCategory.fields[0] ?? "name");
	};

	const buildPresetFromDraft = (routerNetworkOverride?: ValidatedRouterNetworkConfig): QemuVmPreset => ({
		id: editingPresetId || crypto.randomUUID(),
		name: draft.name.trim(),
		role: draft.role,
		routerNetwork: routerNetworkOverride ?? (isRouterPreset(draft) && draft.routerNetwork ? buildRouterNetworkConfigFromDraft(draft.routerNetwork, draft.name.trim()) : undefined),
		diskImage: draft.diskImage.trim() || undefined,
		diskFormat: draft.diskFormat,
		diskInterface: draft.diskInterface,
		cdrom: draft.cdrom.trim() || undefined,
		kernel: draft.kernel.trim() || undefined,
		initrd: draft.initrd.trim() || undefined,
		append: draft.append.trim() || undefined,
		memoryMb: parseOptionalPositiveInteger(draft.memoryMb, "memoryMb"),
		machine: draft.machine.trim() || undefined,
		accelerator: draft.accelerator.trim() || undefined,
		cpu: draft.cpu.trim() || undefined,
		smp: parseOptionalPositiveInteger(draft.smp, "smp"),
		args: parseArgs(draft.args),
		useProxy: draft.useProxy,
		headless: draft.headless,
		snapshot: draft.snapshot,
		daemonize: draft.daemonize,
		enableKvm: draft.useAccelerator,
	});

	const getPresetPreview = (): { command: string | null; error: string | null } => {
		try {
			const preview = kit.buildCommand(kit.createLaunchSpecFromPreset(buildPresetFromDraft()));
			return {
				command: preview.command.join(" "),
				error: null,
			};
		} catch (error) {
			return {
				command: null,
				error: getErrorMessage(error),
			};
		}
	};

	const startCreateRouter = (reason?: string) => {
		if (routerPreset) {
			setMessage(`Router already exists: ${routerPreset.name}. Only one router VM is allowed.`);
			setMessageTone("error");
			return;
		}

		setEditingPresetId(null);
		setPendingSystemCreation(null);
		setSystemDraft({
			templateId: routerSystemTemplate.id,
			name: "opnsense-router",
			installIso: routerBaseImage,
			diskSize: routerSystemTemplate.diskSize,
			routerNetwork: undefined,
		});
		setSystemInputMode(routerBaseImage ? "name" : "installIso");
		setView("system");
		setMessage(reason ?? (routerBaseImage
			? `Router base image detected automatically: ${routerBaseImage}. Finish router creation before adding other VMs.`
			: "Create the router first. The prepared base image is expected at data/qemu/router.qcow2."));
		setMessageTone("info");
	};

	const startCreatePreset = () => {
		if (!hasRouterPreset) {
			startCreateRouter("Create the router first. Every new VM preset is expected to sit behind that router.");
			return;
		}

		setEditingPresetId(null);
		setPendingSystemCreation(null);
		setDraft({
			...createDefaultPresetDraft(kit),
			args: createRoutedGuestArgs(config.defaultArgs.join(" "), nextClientTapIndex),
		});
		setPresetCategory("general");
		setPresetInputMode("name");
		setView("preset");
	};

	const startCreateSystem = () => {
		if (!hasRouterPreset) {
			startCreateRouter("Create the router first. Every system template is wired behind that router.");
			return;
		}

		const initialTemplate = systemTemplates[0]!;
		setEditingPresetId(null);
		setPendingSystemCreation(null);
		setSystemDraft(createDefaultSystemDraft(initialTemplate));
		setSystemInputMode("template");
		setView("system");
		setMessage(`${initialTemplate.label} template selected. Set a system name and source media, then continue to the full preset editor.`);
		setMessageTone("info");
	};

	const startEditPreset = (preset: QemuVmPreset) => {
		setEditingPresetId(preset.id);
		setPendingSystemCreation(null);
		setDraft({
			name: preset.name,
			role: preset.role,
			routerNetwork: undefined,
			diskImage: preset.diskImage ?? "",
			diskFormat: (preset.diskFormat as (typeof IMAGE_FORMATS)[number] | undefined) ?? "qcow2",
			diskInterface: preset.diskInterface ?? "virtio",
			cdrom: preset.cdrom ?? "",
			kernel: preset.kernel ?? "",
			initrd: preset.initrd ?? "",
			append: preset.append ?? "",
			memoryMb: preset.memoryMb ? String(preset.memoryMb) : String(config.memoryMb),
			machine: preset.machine ?? config.machine,
			accelerator: preset.accelerator ?? config.accelerator ?? "",
			cpu: preset.cpu ?? "",
			smp: preset.smp ? String(preset.smp) : "",
			args: preset.args?.join(" ") ?? config.defaultArgs.join(" "),
			useProxy: preset.useProxy ?? config.useProxy,
			headless: preset.headless ?? false,
			snapshot: preset.snapshot ?? false,
			daemonize: preset.daemonize ?? false,
			useAccelerator: preset.enableKvm ?? Boolean(preset.accelerator ?? config.accelerator),
		});
		setPresetCategory("general");
		setPresetInputMode("name");
		setView("preset");
	};

	const openRouterNetworkEditor = () => {
		if (!isRouterPreset(draft)) {
			return;
		}

		setDraft(currentDraft => ({
			...currentDraft,
			routerNetwork: hydrateRouterNetworkDraft(currentDraft.routerNetwork, currentDraft.name),
		}));
		setRouterNetworkInputMode("hostname");
		setView("router-network");
		setMessage("Edit router LAN and DHCP settings. Enter or Esc returns to the preset editor.");
		setMessageTone("info");
	};

	const closeRouterNetworkEditor = () => {
		setPresetCategory("router");
		setView("preset");
		setPresetInputMode("routerNetwork");
	};

	const continueSystemCreation = () => {
		try {
			if (!systemDraft.name.trim()) {
				throw new Error("System name is required.");
			}

			if (!systemDraft.installIso.trim()) {
				throw new Error(activeSystemTemplate.role === ROUTER_ROLE ? "Prepared router base qcow is required." : "Installer ISO is required.");
			}

			const diskSize = systemDraft.diskSize.trim() || activeSystemTemplate.diskSize;
			const nextDraft = createPresetDraftFromSystem(kit, { ...systemDraft, diskSize }, activeSystemTemplate);
			setDraft({
				...nextDraft,
				args: activeSystemTemplate.role === ROUTER_ROLE
					? nextDraft.args
					: createRoutedGuestArgs(
						config.defaultArgs.join(" "),
						nextClientTapIndex,
						activeSystemTemplate.id === "windows-installer"
							? WINDOWS_ROUTED_CLIENT_DEVICE
							: undefined,
					),
			});
			setEditingPresetId(null);
			setPendingSystemCreation({
				templateId: activeSystemTemplate.id,
				diskSize,
				role: activeSystemTemplate.role,
				sourcePath: activeSystemTemplate.role === ROUTER_ROLE ? systemDraft.installIso.trim() : undefined,
			});
			setPresetCategory("general");
			setPresetInputMode("diskInterface");
			setView("preset");
			setMessage(`${activeSystemTemplate.label} preset prepared. Review the full VM config; saving will ${activeSystemTemplate.role === ROUTER_ROLE ? "copy the prepared base image" : "create the disk image"} at ${generatedSystemDiskPath}.`);
			setMessageTone("info");
		} catch (error) {
			setMessage(getErrorMessage(error));
			setMessageTone("error");
		}
	};

	const getDraftFieldValue = (target: FilePickerTarget): string => {
		if (target === "diskImage") {
			return draft.diskImage;
		}

		if (target === "cdrom") {
			return draft.cdrom;
		}

		if (target === "kernel") {
			return draft.kernel;
		}

		return draft.initrd;
	};

	const getFilePickerLabel = (): string => {
		if (filePickerSource === "system") {
			return filePickerTarget === "diskImage" ? "router base qcow" : "installer ISO";
		}

		return FILE_PICKER_LABELS[filePickerTarget];
	};

	const openFilePicker = (target: FilePickerTarget, source: FilePickerSource = "preset") => {
		setFilePickerSource(source);
		setFilePickerTarget(target);
		setView("file-picker");
		setMessage(`Browse for ${source === "system" ? (target === "diskImage" ? "a router base qcow" : "an installer ISO") : `a ${FILE_PICKER_LABELS[target]}`} and press Enter to attach it.`);
		setMessageTone("info");
	};

	const closeFilePicker = () => {
		if (filePickerSource === "system") {
			setView("system");
			setSystemInputMode("installIso");
			return;
		}

		setView("preset");
		setPresetInputMode(filePickerTarget);
	};

	const handleFileSelected = (paths: string[]) => {
		const selectedPath = paths[0]?.trim();
		if (!selectedPath) {
			closeFilePicker();
			return;
		}

		const normalizedPath = toProjectPath(selectedPath);

		if (filePickerSource === "system") {
			setSystemDraft(currentDraft => ({
				...currentDraft,
				installIso: normalizedPath,
			}));
			setMessage(`${activeSystemTemplate.role === ROUTER_ROLE ? "Router base image" : "Installer ISO"} attached: ${normalizedPath}`);
			setMessageTone("success");
			closeFilePicker();
			return;
		}

		setDraft(currentDraft => ({
			...currentDraft,
			[filePickerTarget]: normalizedPath,
		}));
		setMessage(`${FILE_PICKER_LABELS[filePickerTarget]} attached: ${normalizedPath}`);
		setMessageTone("success");
		closeFilePicker();
	};

	const createImage = async () => {
		try {
			if (!imagePath.trim()) {
				throw new Error("Image path is required.");
			}

			if (!imageSize.trim()) {
				throw new Error("Image size is required.");
			}

			await kit.createDiskImage({
				path: imagePath.trim(),
				size: imageSize.trim(),
				format: imageFormat,
				overwrite: imageOverwrite,
			});
			refreshState();
			setMessage(`Disk image created: ${imagePath.trim()}`);
			setMessageTone("success");
			setView("list");
		} catch (error) {
			setMessage(getErrorMessage(error));
			setMessageTone("error");
		}
	};

	const savePreset = async () => {
		try {
			if (!draft.name.trim()) {
				throw new Error("Preset name is required.");
			}

			if (isRouterPreset(draft)) {
				if (routerPreset && routerPreset.id !== editingPresetId) {
					throw new Error(`Router already exists: ${routerPreset.name}. Only one router VM is allowed.`);
				}
			} else if (!routerPreset) {
				throw new Error("Create the OPNsense router first. Every other VM is expected to use that routed network.");
			}

			if (pendingSystemCreation) {
				if (!draft.diskImage.trim()) {
					throw new Error("System creation requires a disk image path.");
				}

				if (pendingSystemCreation.role === ROUTER_ROLE) {
					if (!pendingSystemCreation.sourcePath) {
						throw new Error("Router creation requires a prepared base qcow path.");
					}

					await kit.copyDiskImage({
						sourcePath: pendingSystemCreation.sourcePath,
						path: draft.diskImage.trim(),
					});
				} else {
					await kit.createDiskImage({
						path: draft.diskImage.trim(),
						size: pendingSystemCreation.diskSize,
						format: draft.diskFormat,
					});
				}
			}

			const routerNetwork = isRouterPreset(draft) && draft.routerNetwork ? buildRouterNetworkConfigFromDraft(draft.routerNetwork, draft.name.trim()) : undefined;
			const presetToSave = buildPresetFromDraft(routerNetwork);

			await kit.savePreset(presetToSave);
			refreshState();
			setPendingSystemCreation(null);
			setMessage(`VM preset saved: ${draft.name.trim()}`);
			setMessageTone("success");
			setView("list");
		} catch (error) {
			setMessage(getErrorMessage(error));
			setMessageTone("error");
		}
	};

	const launchPreset = (preset: QemuVmPreset) => {
		void (async () => {
			try {
				if (preset.headless && !preset.daemonize) {
					throw new Error("Headless presets require daemonize=true when launched from the manager to avoid taking over the Ink terminal.");
				}

				await kit.launchPreset(preset.id);
				refreshState();
				setMessage(`QEMU process started from preset: ${preset.name}`);
				setMessageTone("success");
				setView("list");
			} catch (error) {
				setMessage(getErrorMessage(error));
				setMessageTone("error");
			}
		})();
	};

	const openActionsView = () => {
		setActionCursor(0);
		setView("actions");
	};

	const openEnvironmentView = () => {
		refreshReport();
		setView("environment");
	};

	const runListAction = (action: ListActionId | undefined) => {
		if (action === "create-router") {
			startCreateRouter();
			return;
		}

		if (action === "create-system") {
			startCreateSystem();
			return;
		}

		if (action === "create-preset") {
			startCreatePreset();
			return;
		}

		if (action === "create-image") {
			setView("image");
			setImageInputMode("path");
			return;
		}

		if (action === "refresh") {
			refreshReport();
			setMessage("Environment refreshed.");
			setMessageTone("info");
		}
	};

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			onExit(0);
			return;
		}

		if (view === "file-picker") {
			return;
		}

		if (key.escape) {
			if (view === "router-network") {
				closeRouterNetworkEditor();
				return;
			}

			if (view !== "list") {
				if (view === "preset") {
					setPendingSystemCreation(null);
				}
				setView("list");
				return;
			}

			onExit(0);
			return;
		}

		if (view === "list") {
			const lastPresetIndex = Math.max(0, presets.length - 1);
			const panelIds = LIST_PANEL_BUTTONS.map(button => button.id);

			if (key.tab) {
				setListFocus(currentFocus => currentFocus === "presets" ? "panels" : "presets");
				return;
			}

			if (listFocus === "panels") {
				if (key.leftArrow || key.rightArrow) {
					const currentIndex = panelIds.indexOf(listPanelCursor);
					const nextIndex = (currentIndex + (key.leftArrow ? -1 : 1) + panelIds.length) % panelIds.length;
					setListPanelCursor(panelIds[nextIndex] ?? "actions");
					return;
				}

				if (key.return) {
					if (listPanelCursor === "actions") {
						openActionsView();
					} else if (listPanelCursor === "environment") {
						openEnvironmentView();
					}
					return;
				}

				return;
			}

			if (key.upArrow) {
				setCursor(currentCursor => Math.max(0, currentCursor - 1));
				return;
			}

			if (key.downArrow) {
				setCursor(currentCursor => Math.min(lastPresetIndex, currentCursor + 1));
				return;
			}

			if (key.return && presets[cursor]) {
				setView("details");
				return;
			}

			if ((input === "e" || input === "E") && cursor < presets.length && presets[cursor]) {
				startEditPreset(presets[cursor]!);
				return;
			}

			if ((input === "l" || input === "L") && cursor < presets.length && presets[cursor]) {
				launchPreset(presets[cursor]!);
				return;
			}

			if (input === "r" || input === "R") {
				refreshState();
				setMessage("Preset list refreshed.");
				setMessageTone("info");
				return;
			}

			if ((key.delete || key.backspace) && cursor < presets.length && presets[cursor]) {
				void kit.deletePreset(presets[cursor]!.id).then(() => {
					const nextPresets = kit.getPresets();
					setPresets(nextPresets);
					setCursor(currentCursor => Math.max(0, Math.min(currentCursor, Math.max(0, nextPresets.length - 1))));
					setMessage(`VM preset deleted: ${presets[cursor]!.name}`);
					setMessageTone("success");
				}).catch(error => {
					setMessage(getErrorMessage(error));
					setMessageTone("error");
				});
			}

			return;
		}

		if (view === "actions") {
			const lastActionIndex = Math.max(0, LIST_ACTIONS.length - 1);

			if (key.upArrow) {
				setActionCursor(currentCursor => Math.max(0, currentCursor - 1));
				return;
			}

			if (key.downArrow) {
				setActionCursor(currentCursor => Math.min(lastActionIndex, currentCursor + 1));
				return;
			}

			if (key.return) {
				runListAction(LIST_ACTIONS[actionCursor]?.id);
				return;
			}

			return;
		}

		if (view === "environment") {
			if (input === "r" || input === "R" || key.return) {
				refreshReport();
				setMessage("Environment refreshed.");
				setMessageTone("info");
			}

			return;
		}

		if (view === "details") {
			const preset = presets[cursor];
			if (!preset) {
				setView("list");
				return;
			}

			if (input === "e" || input === "E") {
				startEditPreset(preset);
				return;
			}

			if (input === "l" || input === "L") {
				launchPreset(preset);
				return;
			}

			if (key.delete || key.backspace) {
				void kit.deletePreset(preset.id).then(() => {
					refreshState();
					setCursor(currentCursor => Math.max(0, Math.min(currentCursor, Math.max(0, presets.length - 2))));
					setMessage(`VM preset deleted: ${preset.name}`);
					setMessageTone("success");
					setView("list");
				}).catch(error => {
					setMessage(getErrorMessage(error));
					setMessageTone("error");
				});
			}

			return;
		}

		if (view === "system") {
			if (key.tab || key.downArrow) {
				const index = systemFields.indexOf(systemInputMode);
				setSystemInputMode(systemFields[(index + 1) % systemFields.length]!);
				return;
			}

			if (key.upArrow) {
				const index = systemFields.indexOf(systemInputMode);
				setSystemInputMode(systemFields[(index - 1 + systemFields.length) % systemFields.length]!);
				return;
			}

			if (key.leftArrow || key.rightArrow) {
				const delta = key.leftArrow ? -1 : 1;
				if (systemInputMode === "template") {
					cycleSystemTemplate(delta);
					return;
				}

				if (systemInputMode === "installIso" && indexedSystemMediaOptions.length > 0) {
					setSystemDraft(currentDraft => ({
						...currentDraft,
						installIso: cycleStringValue(currentDraft.installIso, indexedSystemMediaOptions, delta),
					}));
					return;
				}
			}

			if (key.return) {
				if (systemInputMode === "installIso") {
					openFilePicker(activeSystemTemplate.role === ROUTER_ROLE ? "diskImage" : "cdrom", "system");
					return;
				}

				continueSystemCreation();
				return;
			}

			if (key.delete || key.backspace) {
				if (systemInputMode === "name") setSystemDraft(currentDraft => ({ ...currentDraft, name: currentDraft.name.slice(0, -1) }));
				if (systemInputMode === "installIso") setSystemDraft(currentDraft => ({ ...currentDraft, installIso: currentDraft.installIso.slice(0, -1) }));
				if (systemInputMode === "diskSize") setSystemDraft(currentDraft => ({ ...currentDraft, diskSize: currentDraft.diskSize.slice(0, -1) }));
				if (systemInputMode === "routerHostname") updateSystemRouterNetwork("hostname", value => value.slice(0, -1));
				if (systemInputMode === "routerDomain") updateSystemRouterNetwork("domain", value => value.slice(0, -1));
				if (systemInputMode === "routerLanAddress") updateSystemRouterNetwork("lanAddress", value => value.slice(0, -1));
				if (systemInputMode === "routerLanPrefix") updateSystemRouterNetwork("lanPrefix", value => value.slice(0, -1));
				if (systemInputMode === "routerDhcpStart") updateSystemRouterNetwork("dhcpStart", value => value.slice(0, -1));
				if (systemInputMode === "routerDhcpEnd") updateSystemRouterNetwork("dhcpEnd", value => value.slice(0, -1));
				return;
			}

			if (input.length > 0) {
				if ((input === "f" || input === "F") && systemInputMode === "installIso") {
					openFilePicker(activeSystemTemplate.role === ROUTER_ROLE ? "diskImage" : "cdrom", "system");
					return;
				}

				if (systemInputMode === "name") setSystemDraft(currentDraft => ({ ...currentDraft, name: currentDraft.name + input }));
				if (systemInputMode === "installIso") setSystemDraft(currentDraft => ({ ...currentDraft, installIso: currentDraft.installIso + input }));
				if (systemInputMode === "diskSize") setSystemDraft(currentDraft => ({ ...currentDraft, diskSize: currentDraft.diskSize + input }));
				if (systemInputMode === "routerHostname") updateSystemRouterNetwork("hostname", value => value + input);
				if (systemInputMode === "routerDomain") updateSystemRouterNetwork("domain", value => value + input);
				if (systemInputMode === "routerLanAddress") updateSystemRouterNetwork("lanAddress", value => value + input);
				if (systemInputMode === "routerLanPrefix") updateSystemRouterNetwork("lanPrefix", value => value + input);
				if (systemInputMode === "routerDhcpStart") updateSystemRouterNetwork("dhcpStart", value => value + input);
				if (systemInputMode === "routerDhcpEnd") updateSystemRouterNetwork("dhcpEnd", value => value + input);
			}

			return;
		}

		if (view === "router-network") {
			if (key.tab || key.downArrow) {
				const index = ROUTER_NETWORK_FIELDS.indexOf(routerNetworkInputMode);
				setRouterNetworkInputMode(ROUTER_NETWORK_FIELDS[(index + 1) % ROUTER_NETWORK_FIELDS.length]!);
				return;
			}

			if (key.upArrow) {
				const index = ROUTER_NETWORK_FIELDS.indexOf(routerNetworkInputMode);
				setRouterNetworkInputMode(ROUTER_NETWORK_FIELDS[(index - 1 + ROUTER_NETWORK_FIELDS.length) % ROUTER_NETWORK_FIELDS.length]!);
				return;
			}

			if (key.return) {
				closeRouterNetworkEditor();
				return;
			}

			if (key.delete || key.backspace) {
				if (routerNetworkInputMode === "hostname") updateDraftRouterNetwork("hostname", value => value.slice(0, -1));
				if (routerNetworkInputMode === "domain") updateDraftRouterNetwork("domain", value => value.slice(0, -1));
				if (routerNetworkInputMode === "lanAddress") updateDraftRouterNetwork("lanAddress", value => value.slice(0, -1));
				if (routerNetworkInputMode === "lanPrefix") updateDraftRouterNetwork("lanPrefix", value => value.slice(0, -1));
				if (routerNetworkInputMode === "dhcpStart") updateDraftRouterNetwork("dhcpStart", value => value.slice(0, -1));
				if (routerNetworkInputMode === "dhcpEnd") updateDraftRouterNetwork("dhcpEnd", value => value.slice(0, -1));
				return;
			}

			if (input.length > 0) {
				if (routerNetworkInputMode === "hostname") updateDraftRouterNetwork("hostname", value => value + input);
				if (routerNetworkInputMode === "domain") updateDraftRouterNetwork("domain", value => value + input);
				if (routerNetworkInputMode === "lanAddress") updateDraftRouterNetwork("lanAddress", value => value + input);
				if (routerNetworkInputMode === "lanPrefix") updateDraftRouterNetwork("lanPrefix", value => value + input);
				if (routerNetworkInputMode === "dhcpStart") updateDraftRouterNetwork("dhcpStart", value => value + input);
				if (routerNetworkInputMode === "dhcpEnd") updateDraftRouterNetwork("dhcpEnd", value => value + input);
			}

			return;
		}

		if (view === "image") {
			if (key.tab || key.downArrow) {
				const index = IMAGE_FIELDS.indexOf(imageInputMode);
				setImageInputMode(IMAGE_FIELDS[(index + 1) % IMAGE_FIELDS.length]!);
				return;
			}

			if (key.upArrow) {
				const index = IMAGE_FIELDS.indexOf(imageInputMode);
				setImageInputMode(IMAGE_FIELDS[(index - 1 + IMAGE_FIELDS.length) % IMAGE_FIELDS.length]!);
				return;
			}

			if (key.leftArrow || key.rightArrow) {
				if (imageInputMode === "format") {
					cycleImageFormat(key.leftArrow ? -1 : 1);
					return;
				}

				if (imageInputMode === "overwrite") {
					setImageOverwrite(value => !value);
					return;
				}
			}

			if (key.return) {
				if (imageInputMode === "overwrite") {
					setImageOverwrite(value => !value);
					return;
				}

				void createImage();
				return;
			}

			if (key.delete || key.backspace) {
				if (imageInputMode === "path") setImagePath(value => value.slice(0, -1));
				if (imageInputMode === "size") setImageSize(value => value.slice(0, -1));
				return;
			}

			if (input.length > 0) {
				if (input === " " && imageInputMode === "overwrite") {
					setImageOverwrite(value => !value);
					return;
				}

				if (imageInputMode === "path") setImagePath(value => value + input);
				if (imageInputMode === "size") setImageSize(value => value + input);
			}

			return;
		}

		if (key.tab || key.downArrow) {
			const index = presetFields.indexOf(presetInputMode);
			setPresetInputMode(presetFields[(index + 1) % presetFields.length]!);
			return;
		}

		if (key.upArrow) {
			const index = presetFields.indexOf(presetInputMode);
			setPresetInputMode(presetFields[(index - 1 + presetFields.length) % presetFields.length]!);
			return;
		}

		if (input === "[" || input === "]") {
			switchPresetCategory(input === "[" ? -1 : 1);
			return;
		}

		if (key.leftArrow || key.rightArrow) {
			const delta = key.leftArrow ? -1 : 1;
			if (presetInputMode === "diskFormat") {
				cyclePresetFormat(delta);
				return;
			}

			if (presetInputMode === "diskInterface") {
				setDraft(currentDraft => ({
					...currentDraft,
					diskInterface: cycleStringValue(currentDraft.diskInterface, DISK_INTERFACE_OPTIONS, delta) as QemuDiskInterface,
				}));
				return;
			}

			if (presetInputMode === "diskImage" && indexedDiskImageOptions.length > 0) {
				setDraft(currentDraft => ({ ...currentDraft, diskImage: cycleStringValue(currentDraft.diskImage, indexedDiskImageOptions, delta) }));
				return;
			}

			if (presetInputMode === "cdrom" && indexedCdromOptions.length > 0) {
				setDraft(currentDraft => ({ ...currentDraft, cdrom: cycleStringValue(currentDraft.cdrom, indexedCdromOptions, delta) }));
				return;
			}

			if (presetInputMode === "kernel" && indexedKernelOptions.length > 0) {
				setDraft(currentDraft => ({ ...currentDraft, kernel: cycleStringValue(currentDraft.kernel, indexedKernelOptions, delta) }));
				return;
			}

			if (presetInputMode === "initrd" && indexedInitrdOptions.length > 0) {
				setDraft(currentDraft => ({ ...currentDraft, initrd: cycleStringValue(currentDraft.initrd, indexedInitrdOptions, delta) }));
				return;
			}

			if (presetInputMode === "memoryMb") {
				setDraft(currentDraft => ({ ...currentDraft, memoryMb: cycleStringValue(currentDraft.memoryMb, memoryOptions, delta) }));
				return;
			}

			if (presetInputMode === "smp") {
				setDraft(currentDraft => ({ ...currentDraft, smp: cycleStringValue(currentDraft.smp, smpOptions, delta) }));
				return;
			}

			if (presetInputMode === "machine") {
				setDraft(currentDraft => ({ ...currentDraft, machine: cycleStringValue(currentDraft.machine, machineOptions, delta) }));
				return;
			}

			if (presetInputMode === "accelerator") {
				setDraft(currentDraft => ({ ...currentDraft, accelerator: cycleStringValue(currentDraft.accelerator, acceleratorOptions, delta) }));
				return;
			}

			if (presetInputMode === "cpu") {
				setDraft(currentDraft => ({ ...currentDraft, cpu: cycleStringValue(currentDraft.cpu, cpuOptions, delta) }));
				return;
			}

			if (["useProxy", "headless", "snapshot", "daemonize", "useAccelerator"].includes(presetInputMode)) {
				if (presetInputMode === "useProxy") setDraft(currentDraft => ({ ...currentDraft, useProxy: !currentDraft.useProxy }));
				if (presetInputMode === "headless") setDraft(currentDraft => ({ ...currentDraft, headless: !currentDraft.headless }));
				if (presetInputMode === "snapshot") setDraft(currentDraft => ({ ...currentDraft, snapshot: !currentDraft.snapshot }));
				if (presetInputMode === "daemonize") setDraft(currentDraft => ({ ...currentDraft, daemonize: !currentDraft.daemonize }));
				if (presetInputMode === "useAccelerator") setDraft(currentDraft => ({ ...currentDraft, useAccelerator: !currentDraft.useAccelerator }));
				return;
			}

			switchPresetCategory(delta);
			return;
		}

		if (key.return) {
			if (presetInputMode === "routerNetwork") {
				openRouterNetworkEditor();
				return;
			}

			if (["useProxy", "headless", "snapshot", "daemonize", "useAccelerator"].includes(presetInputMode)) {
				if (presetInputMode === "useProxy") setDraft(currentDraft => ({ ...currentDraft, useProxy: !currentDraft.useProxy }));
				if (presetInputMode === "headless") setDraft(currentDraft => ({ ...currentDraft, headless: !currentDraft.headless }));
				if (presetInputMode === "snapshot") setDraft(currentDraft => ({ ...currentDraft, snapshot: !currentDraft.snapshot }));
				if (presetInputMode === "daemonize") setDraft(currentDraft => ({ ...currentDraft, daemonize: !currentDraft.daemonize }));
				if (presetInputMode === "useAccelerator") setDraft(currentDraft => ({ ...currentDraft, useAccelerator: !currentDraft.useAccelerator }));
				return;
			}

			if (presetInputMode === "diskInterface") {
				setDraft(currentDraft => ({
					...currentDraft,
					diskInterface: cycleStringValue(currentDraft.diskInterface, DISK_INTERFACE_OPTIONS, 1) as QemuDiskInterface,
				}));
				return;
			}

			if (isFilePickerTarget(presetInputMode)) {
				openFilePicker(presetInputMode);
				return;
			}

			void savePreset();
			return;
		}

		if (key.delete || key.backspace) {
			if (presetInputMode === "name") setDraft(currentDraft => ({ ...currentDraft, name: currentDraft.name.slice(0, -1) }));
			if (presetInputMode === "diskImage") setDraft(currentDraft => ({ ...currentDraft, diskImage: currentDraft.diskImage.slice(0, -1) }));
			if (presetInputMode === "cdrom") setDraft(currentDraft => ({ ...currentDraft, cdrom: currentDraft.cdrom.slice(0, -1) }));
			if (presetInputMode === "kernel") setDraft(currentDraft => ({ ...currentDraft, kernel: currentDraft.kernel.slice(0, -1) }));
			if (presetInputMode === "initrd") setDraft(currentDraft => ({ ...currentDraft, initrd: currentDraft.initrd.slice(0, -1) }));
			if (presetInputMode === "append") setDraft(currentDraft => ({ ...currentDraft, append: currentDraft.append.slice(0, -1) }));
			if (presetInputMode === "memoryMb") setDraft(currentDraft => ({ ...currentDraft, memoryMb: currentDraft.memoryMb.slice(0, -1) }));
			if (presetInputMode === "machine") setDraft(currentDraft => ({ ...currentDraft, machine: currentDraft.machine.slice(0, -1) }));
			if (presetInputMode === "accelerator") setDraft(currentDraft => ({ ...currentDraft, accelerator: currentDraft.accelerator.slice(0, -1) }));
			if (presetInputMode === "cpu") setDraft(currentDraft => ({ ...currentDraft, cpu: currentDraft.cpu.slice(0, -1) }));
			if (presetInputMode === "smp") setDraft(currentDraft => ({ ...currentDraft, smp: currentDraft.smp.slice(0, -1) }));
			if (presetInputMode === "args") setDraft(currentDraft => ({ ...currentDraft, args: currentDraft.args.slice(0, -1) }));
			return;
		}

		if (input.length > 0) {
			if ((input === "f" || input === "F") && isFilePickerTarget(presetInputMode)) {
				openFilePicker(presetInputMode);
				return;
			}

			if (input === " " && presetInputMode === "useProxy") setDraft(currentDraft => ({ ...currentDraft, useProxy: !currentDraft.useProxy }));
			if (input === " " && presetInputMode === "headless") setDraft(currentDraft => ({ ...currentDraft, headless: !currentDraft.headless }));
			if (input === " " && presetInputMode === "snapshot") setDraft(currentDraft => ({ ...currentDraft, snapshot: !currentDraft.snapshot }));
			if (input === " " && presetInputMode === "daemonize") setDraft(currentDraft => ({ ...currentDraft, daemonize: !currentDraft.daemonize }));
			if (input === " " && presetInputMode === "useAccelerator") setDraft(currentDraft => ({ ...currentDraft, useAccelerator: !currentDraft.useAccelerator }));

			if (presetInputMode === "name") setDraft(currentDraft => ({ ...currentDraft, name: currentDraft.name + input }));
			if (presetInputMode === "diskImage") setDraft(currentDraft => ({ ...currentDraft, diskImage: currentDraft.diskImage + input }));
			if (presetInputMode === "cdrom") setDraft(currentDraft => ({ ...currentDraft, cdrom: currentDraft.cdrom + input }));
			if (presetInputMode === "kernel") setDraft(currentDraft => ({ ...currentDraft, kernel: currentDraft.kernel + input }));
			if (presetInputMode === "initrd") setDraft(currentDraft => ({ ...currentDraft, initrd: currentDraft.initrd + input }));
			if (presetInputMode === "append") setDraft(currentDraft => ({ ...currentDraft, append: currentDraft.append + input }));
			if (presetInputMode === "memoryMb") setDraft(currentDraft => ({ ...currentDraft, memoryMb: currentDraft.memoryMb + input }));
			if (presetInputMode === "machine") setDraft(currentDraft => ({ ...currentDraft, machine: currentDraft.machine + input }));
			if (presetInputMode === "accelerator") setDraft(currentDraft => ({ ...currentDraft, accelerator: currentDraft.accelerator + input }));
			if (presetInputMode === "cpu") setDraft(currentDraft => ({ ...currentDraft, cpu: currentDraft.cpu + input }));
			if (presetInputMode === "smp") setDraft(currentDraft => ({ ...currentDraft, smp: currentDraft.smp + input }));
			if (presetInputMode === "args") setDraft(currentDraft => ({ ...currentDraft, args: currentDraft.args + input }));
		}
	});

	const renderInput = (isActive: boolean, label: string, value: string, placeholder = "") => {
		const content = isActive
			? <Text color="#34d399">{value || placeholder}█</Text>
			: (value || <Text dimColor>{placeholder}</Text>);

		return (
			<Box>
				<Text wrap="truncate">{label}: {content}</Text>
			</Box>
		);
	};

	const renderDropdown = (isActive: boolean, label: string, value: string, placeholder = "") => (
		<Box>
			<Text wrap="truncate">{label}: {isActive ? <Text color="#34d399">{"< "}{value || placeholder}{" >"}</Text> : (value || <Text dimColor>{placeholder}</Text>)}</Text>
		</Box>
	);

	const renderCheckbox = (isActive: boolean, label: string, value: boolean) => (
		<Box>
			<Text>{label}: {isActive ? <Text color="#34d399">[{value ? "x" : " "}]</Text> : `[${value ? "x" : " "}]`}</Text>
		</Box>
	);

	const renderAction = (isActive: boolean, label: string, value: string) => (
		<Box>
			<Text wrap="truncate">{label}: {isActive ? <Text color="#34d399">{value}</Text> : value}</Text>
		</Box>
	);

	const renderCategoryTabs = () => (
		<Box marginTop={1}>
			{presetCategories.map((category, index) => {
				const isActive = activePresetCategory.id === category.id;
				return (
					<Box key={category.id} marginRight={index === presetCategories.length - 1 ? 0 : 1}>
						<Text color={isActive ? "#34d399" : "#9ca3af"}>{isActive ? `[ ${category.label} ]` : category.label}</Text>
					</Box>
				);
			})}
		</Box>
	);

	const missingWidth = Math.max(0, MIN_TERMINAL_WIDTH - width);
	const missingHeight = Math.max(0, MIN_TERMINAL_HEIGHT - height);
	const terminalTooSmall = missingWidth > 0 || missingHeight > 0;
	if (terminalTooSmall) {
		return (
			<Box flexDirection="column" width={width} height={height} justifyContent="center" paddingX={1}>
				<Text color="#7dd3fc" bold>QEMU Kit Manager</Text>
				<Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="#fbbf24" paddingX={1}>
					<Text color="#fbbf24" bold>Terminal size is too small</Text>
					<Text>Current: {width} x {height}</Text>
					<Text>Required: {MIN_TERMINAL_WIDTH} x {MIN_TERMINAL_HEIGHT}</Text>
					{missingWidth > 0 && <Text>Need {missingWidth} more columns.</Text>}
					{missingHeight > 0 && <Text>Need {missingHeight} more rows.</Text>}
					<Text color="#9ca3af">Resize the terminal to continue. Esc exits.</Text>
				</Box>
			</Box>
		);
	}

	const preview = getPresetPreview();
	const selectedPreset = cursor < presets.length ? presets[cursor] ?? null : null;
	const selectedPresetPreview = selectedPreset
		? (() => {
			try {
				return { command: kit.previewPreset(selectedPreset.id).command.join(" "), error: null };
			} catch (error) {
				return { command: null, error: getErrorMessage(error) };
			}
		})()
		: null;
	const presetTableWidth = Math.max(72, width - 3);
	const presetCursorColumnWidth = 3;
	const presetMemoryColumnWidth = 10;
	const presetMachineColumnWidth = 8;
	const presetProxyColumnWidth = 7;
	const presetNameColumnWidth = Math.max(24, Math.min(36, Math.floor(presetTableWidth * 0.32)));
	const presetMediaColumnWidth = Math.max(
		18,
		presetTableWidth
			- presetCursorColumnWidth
			- presetNameColumnWidth
			- presetMemoryColumnWidth
			- presetMachineColumnWidth
			- presetProxyColumnWidth,
	);

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Text color="#7dd3fc" bold>QEMU Kit Manager</Text>
			<Box marginTop={1}>
				<Text color={toneColor(messageTone)} wrap="truncate">{message}</Text>
			</Box>

			{view === "list" && (
				<Box flexDirection="column" marginTop={1}>
					<Box marginTop={1} flexDirection="column">
						<Text bold color="#e5e7eb">VM Presets</Text>
						<Text color="#9ca3af">{indexedDataSummary}</Text>
						{presets.length === 0 ? (
							<Box paddingX={1} marginTop={1}><Text color="#9ca3af">No VM presets saved yet.</Text></Box>
						) : (
							presets.map((preset, index) => (
								<Box key={preset.id} flexDirection="row" paddingLeft={1}>
									<Box width={presetCursorColumnWidth}><Text color={cursor === index ? "#34d399" : "#e5e7eb"}>{cursor === index ? "> " : "  "}</Text></Box>
									<Box width={presetNameColumnWidth}><Text color={cursor === index ? "#34d399" : "#e5e7eb"} wrap="truncate">{preset.name}{isRouterPreset(preset) ? " [router]" : ""}</Text></Box>
									<Box width={presetMemoryColumnWidth}><Text color="#d1d5db">{preset.memoryMb ?? config.memoryMb} MB</Text></Box>
									<Box width={presetMachineColumnWidth}><Text color="#9ca3af" wrap="truncate">{preset.machine ?? config.machine}</Text></Box>
									<Box width={presetMediaColumnWidth}><Text color="#9ca3af" wrap="truncate">{preset.diskImage ?? preset.cdrom ?? "No media"}</Text></Box>
									<Box width={presetProxyColumnWidth}><Text color="#9ca3af">{preset.useProxy ?? config.useProxy ? "Proxy" : "Direct"}</Text></Box>
								</Box>
							))
						)}

						<Box marginTop={1} flexDirection="column">
							<Text bold color="#e5e7eb">Panels</Text>
							<Box marginTop={1}>
								{LIST_PANEL_BUTTONS.map((button, index) => {
									const isActive = listFocus === "panels" && listPanelCursor === button.id;
									return (
										<Box key={button.id} marginRight={index === LIST_PANEL_BUTTONS.length - 1 ? 0 : 2}>
											<Text color={isActive ? "#34d399" : "#e5e7eb"}>{isActive ? `[ ${button.label} ]` : button.label}</Text>
										</Box>
									);
								})}
							</Box>
							<Text color="#9ca3af">{selectedPanelButton.description}</Text>
						</Box>
					</Box>

					<Box marginTop={1}>
						<Text dimColor>Up/Down browse presets • Enter opens preset • Tab switches to panels • Left/Right picks panel • Enter opens panel • E edits • L launches • Del deletes • R refreshes presets • Esc exits</Text>
					</Box>
				</Box>
			)}

			{view === "actions" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Actions</Text>
					<Box marginTop={1} flexDirection="column">
						{LIST_ACTIONS.map((action, index) => (
							<Box key={action.id} flexDirection="column" paddingX={1}>
								<Text color={actionCursor === index ? "#34d399" : "#e5e7eb"}>
									{actionCursor === index ? "> " : "  "}
									{action.label}
								</Text>
								<Text color="#9ca3af">{action.description}</Text>
							</Box>
						))}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down to navigate • Enter to run • Esc to go back</Text>
					</Box>
				</Box>
			)}

			{view === "environment" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Environment</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>Host Resources: {HOST_LOGICAL_CPU_COUNT} logical CPUs • {HOST_TOTAL_MEMORY_MB} MB RAM</Text>
						<Text>System: <Text color={report?.system.available ? "#34d399" : "#f87171"}>{report?.system.resolvedPath ?? "missing"}</Text></Text>
						<Text>Image Tool: <Text color={report?.imageTool.available ? "#34d399" : "#f87171"}>{report?.imageTool.resolvedPath ?? "missing"}</Text></Text>
						<Text>Proxychains: <Text color={report?.proxy.available ? "#34d399" : report?.config.useProxy ? "#f87171" : "#9ca3af"}>{report?.config.useProxy ? (report?.proxy.resolvedPath ?? "missing") : "disabled"}</Text></Text>
						<Text>Architecture: {report?.config.architecture ?? config.architecture}</Text>
						<Text>Machine: {report?.config.machine ?? config.machine}</Text>
						<Text>Accelerator: {report?.config.accelerator ?? "none"}</Text>
						<Text>Default Memory: {report?.config.memoryMb ?? config.memoryMb} MB</Text>
						<Text>Default Args: {report?.config.defaultArgs.join(" ") || "<none>"}</Text>
						<Text>Running QEMU Processes: {report?.runningProcessCount ?? 0}</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>R or Enter refreshes • Esc to go back</Text>
					</Box>
				</Box>
			)}

			{view === "system" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Create System From Template</Text>
					<Box marginTop={1}>
						<Text color="#9ca3af">Pick a template, set a system name and source media, then continue to the full preset editor.</Text>
					</Box>
					<Box>
						<Text color="#9ca3af">{indexedDataSummary}</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						{renderDropdown(systemInputMode === "template", "Template", activeSystemTemplate.label)}
						{renderInput(systemInputMode === "name", "System Name", systemDraft.name, "Required, e.g. windows-11-lab")}
						{renderInput(systemInputMode === "installIso", activeSystemTemplate.role === ROUTER_ROLE ? "Prepared Base QCOW" : "Installer ISO", systemDraft.installIso, activeSystemTemplate.role === ROUTER_ROLE
							? (indexedDataFiles.diskImage.length > 0 ? "Left/Right quick-select from data/qemu • Enter/F to browse" : "Required qcow2 path • Enter/F to browse")
							: (indexedDataFiles.cdrom.length > 0 ? "Left/Right quick-select from data • Enter/F to browse" : "Required ISO path • Enter/F to browse"))}
						{renderInput(systemInputMode === "diskSize", "Disk Size", systemDraft.diskSize, activeSystemTemplate.diskSize)}
					</Box>
					<Box marginTop={1} flexDirection="column">
						<Text bold color="#e5e7eb">Template Defaults</Text>
						<Text>{activeSystemTemplate.description}</Text>
						{activeSystemTemplate.role === ROUTER_ROLE && <Text color="#9ca3af">The router base image is auto-searched at data/qemu/router.qcow2 when available.</Text>}
						<Text>Generated Disk Path: {generatedSystemDiskPath}</Text>
						<Text>Disk Format: {activeSystemTemplate.diskFormat}</Text>
						<Text>Disk Interface: {activeSystemTemplate.diskInterface}</Text>
						<Text>Memory: {activeSystemTemplate.memoryMb} MB</Text>
						<Text>SMP: {activeSystemTemplate.smp || "Default"}</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab to navigate • Left/Right cycles template and indexed media matches • F or Enter on source media opens picker • Enter elsewhere continues to full preset customization • Esc to cancel</Text>
					</Box>
				</Box>
			)}

			{view === "image" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Create QEMU Disk Image</Text>
					<Box marginTop={1} flexDirection="column">
						{renderInput(imageInputMode === "path", "Path", imagePath, "Required, e.g. ./images/lab.qcow2")}
						{renderInput(imageInputMode === "size", "Size", imageSize, "Required, e.g. 20G")}
						{renderDropdown(imageInputMode === "format", "Format", imageFormat)}
						{renderCheckbox(imageInputMode === "overwrite", "Overwrite", imageOverwrite)}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab to navigate • Left/Right to change format • Enter to create • Esc to cancel</Text>
					</Box>
				</Box>
			)}

			{view === "preset" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>{editingPresetId ? "Edit VM Preset" : "Create VM Preset"}</Text>
					<Box marginTop={1}>
						<Text color="#9ca3af">Host resources: {HOST_LOGICAL_CPU_COUNT} logical CPUs • {HOST_TOTAL_MEMORY_MB} MB RAM • arrows cycle Memory/SMP/Machine/Accelerator/CPU</Text>
					</Box>
					<Box>
						<Text color="#9ca3af">{indexedDataSummary}</Text>
					</Box>
					{renderCategoryTabs()}
					<Box>
						<Text color="#9ca3af">{activePresetCategory.description}</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						{activePresetCategory.id === "general" && renderInput(presetInputMode === "name", "Name", draft.name, "Required")}
						{activePresetCategory.id === "general" && renderInput(presetInputMode === "diskImage", "Disk Image", draft.diskImage, indexedDataFiles.diskImage.length > 0 ? "Left/Right quick-select from data • Enter/F to browse" : "Optional, e.g. ./images/lab.qcow2 • Enter/F to browse")}
						{activePresetCategory.id === "general" && renderDropdown(presetInputMode === "diskFormat", "Disk Format", draft.diskFormat)}
						{activePresetCategory.id === "general" && renderDropdown(presetInputMode === "diskInterface", "Disk Interface", draft.diskInterface, "virtio")}
						{activePresetCategory.id === "boot" && renderInput(presetInputMode === "cdrom", "CDROM / ISO", draft.cdrom, indexedDataFiles.cdrom.length > 0 ? "Left/Right quick-select from data • Enter/F to browse" : "Optional ISO path • Enter/F to browse")}
						{activePresetCategory.id === "boot" && renderInput(presetInputMode === "kernel", "Kernel", draft.kernel, indexedDataFiles.kernel.length > 0 ? "Left/Right quick-select from data • Enter/F to browse" : "Optional bzImage path • Enter/F to browse")}
						{activePresetCategory.id === "boot" && renderInput(presetInputMode === "initrd", "Initrd", draft.initrd, indexedDataFiles.initrd.length > 0 ? "Left/Right quick-select from data • Enter/F to browse" : "Optional initrd path • Enter/F to browse")}
						{activePresetCategory.id === "boot" && renderInput(presetInputMode === "append", "Append", draft.append, "Optional kernel cmdline")}
						{activePresetCategory.id === "hardware" && renderDropdown(presetInputMode === "memoryMb", "Memory MB", draft.memoryMb, `${config.memoryMb} default`) }
						{activePresetCategory.id === "hardware" && renderDropdown(presetInputMode === "machine", "Machine", draft.machine, config.machine)}
						{activePresetCategory.id === "hardware" && renderDropdown(presetInputMode === "accelerator", "Accelerator", draft.accelerator, config.accelerator ?? "auto")}
						{activePresetCategory.id === "hardware" && renderDropdown(presetInputMode === "cpu", "CPU", draft.cpu, "default / host")}
						{activePresetCategory.id === "hardware" && renderDropdown(presetInputMode === "smp", "SMP", draft.smp, `${HOST_LOGICAL_CPU_COUNT} host threads`) }
						{activePresetCategory.id === "hardware" && renderCheckbox(presetInputMode === "useAccelerator", "Use Accelerator", draft.useAccelerator)}
						{activePresetCategory.id === "runtime" && renderInput(presetInputMode === "args", "Extra Args", draft.args, "Optional, space separated")}
						{activePresetCategory.id === "runtime" && renderCheckbox(presetInputMode === "useProxy", "Use Proxychains", draft.useProxy)}
						{activePresetCategory.id === "runtime" && renderCheckbox(presetInputMode === "headless", "Headless", draft.headless)}
						{activePresetCategory.id === "runtime" && renderCheckbox(presetInputMode === "snapshot", "Snapshot", draft.snapshot)}
						{activePresetCategory.id === "runtime" && renderCheckbox(presetInputMode === "daemonize", "Daemonize", draft.daemonize)}
						{activePresetCategory.id === "router" && draft.routerNetwork && renderAction(presetInputMode === "routerNetwork", "Router Network", `${routerPresetSummary} • Enter to edit`)}
					</Box>

					{pendingSystemCreation && activePresetCategory.id === "general" && (
						<Box marginTop={1} flexDirection="column">
							<Text bold color="#7dd3fc">Pending System Creation</Text>
							<Text>Template: {getSystemTemplate(allSystemTemplates, pendingSystemCreation.templateId).label}</Text>
							{pendingSystemCreation.role === ROUTER_ROLE && <Text>Role: router</Text>}
							{pendingSystemCreation.role === ROUTER_ROLE && pendingSystemCreation.sourcePath && <Text>Base Image: {pendingSystemCreation.sourcePath}</Text>}
							<Text>Disk Image: {draft.diskImage || "<missing>"}</Text>
							<Text>Disk Size: {pendingSystemCreation.diskSize}</Text>
							<Text>Disk Interface: {draft.diskInterface}</Text>
							<Text color="#9ca3af">Saving this preset will {pendingSystemCreation.role === ROUTER_ROLE ? "copy the prepared base image first" : "create the disk image first"}, then persist the VM preset.</Text>
						</Box>
					)}

					{draft.routerNetwork && activePresetCategory.id === "router" && (
						<Box marginTop={1} flexDirection="column">
							<Text bold color="#7dd3fc">Router Network</Text>
							<Text>Host / Domain: {draft.routerNetwork.hostname}.{draft.routerNetwork.domain}</Text>
							<Text>LAN Profile: {routerPresetSummary}</Text>
							<Text>WAN / LAN Interfaces: {ROUTER_DEFAULT_WAN_INTERFACE} / {ROUTER_DEFAULT_LAN_INTERFACE}</Text>
							<Text color="#9ca3af">Legacy router network metadata. New router presets rely on the baked-in base qcow configuration instead.</Text>
						</Box>
					)}

					<Box marginTop={1} flexDirection="column">
						<Text bold color="#e5e7eb">Command Preview</Text>
						{preview.error ? (
							<Text color="#f87171" wrap="truncate">{preview.error}</Text>
						) : (
							<Text color="#9ca3af" wrap="truncate">{preview.command ?? "No command"}</Text>
						)}
					</Box>

					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab moves inside the current section • Left/Right cycles the active selector when available • [ and ] switch sections from anywhere • Enter on Disk Image/CDROM/Kernel/Initrd opens picker • Enter on Router Network opens its editor • Enter elsewhere saves • Esc to cancel</Text>
					</Box>
				</Box>
			)}

			{view === "router-network" && draft.routerNetwork && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Router Network Editor</Text>
					<Box marginTop={1}>
						<Text color="#9ca3af">Adjust the OPNsense LAN and DHCP defaults for this router preset.</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						{renderInput(routerNetworkInputMode === "hostname", "Router Hostname", draft.routerNetwork.hostname, ROUTER_DEFAULT_HOSTNAME)}
						{renderInput(routerNetworkInputMode === "domain", "Router Domain", draft.routerNetwork.domain, ROUTER_DEFAULT_DOMAIN)}
						{renderInput(routerNetworkInputMode === "lanAddress", "LAN Address", draft.routerNetwork.lanAddress, ROUTER_DEFAULT_LAN_ADDRESS)}
						{renderInput(routerNetworkInputMode === "lanPrefix", "LAN Prefix", draft.routerNetwork.lanPrefix, ROUTER_DEFAULT_LAN_PREFIX)}
						{renderInput(routerNetworkInputMode === "dhcpStart", "DHCP Start", draft.routerNetwork.dhcpStart, ROUTER_DEFAULT_DHCP_START)}
						{renderInput(routerNetworkInputMode === "dhcpEnd", "DHCP End", draft.routerNetwork.dhcpEnd, ROUTER_DEFAULT_DHCP_END)}
					</Box>
					<Box marginTop={1} flexDirection="column">
						<Text bold color="#7dd3fc">Import Summary</Text>
						<Text>Host / Domain: {draft.routerNetwork.hostname}.{draft.routerNetwork.domain}</Text>
						<Text>LAN Profile: {routerPresetSummary}</Text>
						<Text>WAN / LAN Interfaces: {ROUTER_DEFAULT_WAN_INTERFACE} / {ROUTER_DEFAULT_LAN_INTERFACE}</Text>
						<Text color="#9ca3af">Legacy metadata only. New router presets no longer generate an external import config.</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab to navigate • Type to edit • Enter or Esc returns to the preset editor</Text>
					</Box>
				</Box>
			)}

			{view === "file-picker" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Select {getFilePickerLabel()}</Text>
					<Box marginTop={1}>
						<Text color="#9ca3af">Enter to attach file • Left Arrow to parent directory • Escape to cancel</Text>
					</Box>
					<Box>
						<Text color="#9ca3af">{indexedDataSummary}</Text>
					</Box>
					<Box marginTop={1}>
						<FilePicker
							initialPath={getMediaPickerInitialPath(filePickerSource === "system" ? systemDraft.installIso : getDraftFieldValue(filePickerTarget))}
							fileTypes="files"
							showDetails
							maxHeight={Math.max(10, height - 10)}
							filter={shouldFilterPickerTarget(filePickerTarget)
								? ((entry) => entry.kind !== "file" || matchesPickerTargetFile(filePickerTarget, entry.name))
								: undefined}
							onSelect={handleFileSelected}
							onCancel={closeFilePicker}
						/>
					</Box>
				</Box>
			)}

			{view === "details" && selectedPreset && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>VM Preset Details</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>Name: {selectedPreset.name}</Text>
						{isRouterPreset(selectedPreset) && <Text>Role: router</Text>}
						{selectedPreset.routerNetwork && <Text>Host / Domain: {(selectedPreset.routerNetwork.hostname ?? ROUTER_DEFAULT_HOSTNAME)}.{(selectedPreset.routerNetwork.domain ?? ROUTER_DEFAULT_DOMAIN)}</Text>}
						{selectedPreset.routerNetwork && <Text>LAN Profile: {(selectedPreset.routerNetwork.lanAddress ?? ROUTER_DEFAULT_LAN_ADDRESS)}/{selectedPreset.routerNetwork.lanPrefix ?? ROUTER_DEFAULT_LAN_PREFIX} • DHCP {selectedPreset.routerNetwork.dhcpStart ?? ROUTER_DEFAULT_DHCP_START} - {selectedPreset.routerNetwork.dhcpEnd ?? ROUTER_DEFAULT_DHCP_END}</Text>}
						{selectedPreset.routerNetwork && <Text>Host Access: http://{ROUTER_DEFAULT_HOST_WEB_HOST}:{ROUTER_DEFAULT_HOST_HTTP_PORT} • https://{ROUTER_DEFAULT_HOST_WEB_HOST}:{ROUTER_DEFAULT_HOST_HTTPS_PORT} • ssh {ROUTER_DEFAULT_HOST_SSH_PORT}</Text>}
						<Text>Disk Image: {selectedPreset.diskImage ?? "None"}</Text>
						<Text>Disk Format: {selectedPreset.diskFormat ?? "qcow2"}</Text>
						<Text>Disk Interface: {selectedPreset.diskInterface ?? "virtio"}</Text>
						<Text>CDROM: {selectedPreset.cdrom ?? "None"}</Text>
						<Text>Kernel: {selectedPreset.kernel ?? "None"}</Text>
						<Text>Initrd: {selectedPreset.initrd ?? "None"}</Text>
						<Text>Append: {selectedPreset.append ?? "None"}</Text>
						<Text>Memory: {selectedPreset.memoryMb ?? config.memoryMb} MB</Text>
						<Text>Machine: {selectedPreset.machine ?? config.machine}</Text>
						<Text>Accelerator: {selectedPreset.enableKvm === false ? "disabled" : (selectedPreset.accelerator ?? config.accelerator ?? "none")}</Text>
						<Text>CPU: {selectedPreset.cpu ?? "Default"}</Text>
						<Text>SMP: {selectedPreset.smp ?? "Default"}</Text>
						<Text>Extra Args: {selectedPreset.args?.join(" ") || "None"}</Text>
						<Text>Proxychains: {selectedPreset.useProxy ?? config.useProxy ? "Enabled" : "Disabled"}</Text>
						<Text>Headless: {selectedPreset.headless ? "Yes" : "No"}</Text>
						<Text>Snapshot: {selectedPreset.snapshot ? "Yes" : "No"}</Text>
						<Text>Daemonize: {selectedPreset.daemonize ? "Yes" : "No"}</Text>
					</Box>

					<Box marginTop={1} flexDirection="column">
						<Text bold color="#e5e7eb">Command Preview</Text>
						{selectedPresetPreview?.error ? (
							<Text color="#f87171" wrap="truncate">{selectedPresetPreview.error}</Text>
						) : (
							<Text color="#9ca3af" wrap="truncate">{selectedPresetPreview?.command ?? "No command"}</Text>
						)}
					</Box>

					<Box marginTop={1}>
						<Text dimColor>L to launch • E to edit • Del to delete • Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

export const qemuManagerModule = defineModule({
	id: "kits/qemu/manager",
	category: "kits",
	description: "Create systems from templates, manage saved QEMU VM presets, create images, and launch VMs via QemuKit",
	notebookTypeOverlay: QEMU_NOTEBOOK_TYPE_OVERLAY,
	executor: defineExecutor(async (context) => {
		let kit = context.getQemuKit();
		if (!kit) {
			kit = new QemuKit();
			await context.runtime.attachKit(kit, {
				reason: "Starting QemuManager",
			});
		}

		const exitCode = await context.runInteractiveApplication(QemuManager, { kit });
		return { exitCode };
	}),
});