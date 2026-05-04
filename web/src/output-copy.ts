export type OutputCopyFormat = "text" | "json" | "yaml" | "xml";

export type OutputCopyOption = {
  format: OutputCopyFormat;
  label: string;
  shortcut: string;
};

export const outputCopyOptions: readonly OutputCopyOption[] = [
  { format: "text", label: "Text", shortcut: "1" },
  { format: "json", label: "JSON", shortcut: "2" },
  { format: "yaml", label: "YAML", shortcut: "3" },
  { format: "xml", label: "XML", shortcut: "4" },
] as const;

type FormatOutputForCopyOptions = {
  plainText?: string;
  xmlRootTag?: string;
};

type OutputTone = "command" | "output" | "info" | "error" | "muted" | "accent";

type OutputEntityBase = {
  id: string;
  createdAt: number;
  title?: string;
};

type PrimitiveTextEntity = OutputEntityBase & {
  kind: "text";
  lines: string[];
  tone: OutputTone;
  presentation: {
    kind: "plain-text";
  };
};

type PrimitiveTableColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
};

type PrimitiveCellValue = string | number | boolean | null | undefined;

type PrimitiveTableEntity = OutputEntityBase & {
  kind: "table";
  columns: PrimitiveTableColumn[];
  rows: Record<string, PrimitiveCellValue>[];
  presentation: {
    kind: "ink-table";
    dense?: boolean;
  };
};

type PrimitiveTreeNode = {
  label: string;
  value?: string | number | boolean | null;
  children?: PrimitiveTreeNode[];
};

type PrimitiveTreeEntity = OutputEntityBase & {
  kind: "tree";
  roots: PrimitiveTreeNode[];
  presentation: {
    kind: "ink-tree";
    dense?: boolean;
    showValues?: boolean;
  };
};

type OutputEntity = PrimitiveTextEntity | PrimitiveTableEntity | PrimitiveTreeEntity;

type BpkgCommandResultValue = {
  bindingId?: string;
  boxId: string;
  command: string[];
  commandString: string;
  exitCode: number;
  packageId?: string;
  parsed?: unknown;
  stderr: string;
  stdout: string;
  transpiled?: {
    argv?: readonly string[];
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
  };
};

type DockerWorkingDirectoryValue = {
  dataRoot: string;
  logicalPath: string;
  realPath: string;
};

type DockerCommandResultValue = {
  command: string[];
  commandString: string;
  cwd: DockerWorkingDirectoryValue;
  exitCode: number;
  parsed?: unknown;
  stderr: string;
  stdout: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function normalizeCopyValue(value: unknown, plainText?: string): unknown {
  if (value !== undefined) {
    return value;
  }

  return plainText ?? "";
}

function isOutputEntity(value: unknown): value is OutputEntity {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string"
    && typeof value.createdAt === "number"
    && typeof value.kind === "string"
    && isRecord(value.presentation)
    && typeof value.presentation.kind === "string";
}

function normalizeOutputEntities(value: unknown): OutputEntity[] | null {
  if (isOutputEntity(value)) {
    return [value];
  }

  if (Array.isArray(value) && value.every(isOutputEntity)) {
    return value;
  }

  return null;
}

function isBpkgCommandResultValue(value: unknown): value is BpkgCommandResultValue {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.boxId === "string"
    && isStringArray(value.command)
    && typeof value.commandString === "string"
    && typeof value.exitCode === "number"
    && typeof value.stdout === "string"
    && typeof value.stderr === "string";
}

function isDockerWorkingDirectoryValue(value: unknown): value is DockerWorkingDirectoryValue {
  return isRecord(value)
    && typeof value.dataRoot === "string"
    && typeof value.logicalPath === "string"
    && typeof value.realPath === "string";
}

function isDockerCommandResultValue(value: unknown): value is DockerCommandResultValue {
  if (!isRecord(value)) {
    return false;
  }

  return isStringArray(value.command)
    && value.command[0] === "docker"
    && typeof value.commandString === "string"
    && typeof value.exitCode === "number"
    && typeof value.stdout === "string"
    && typeof value.stderr === "string"
    && isDockerWorkingDirectoryValue(value.cwd);
}

function formatPrimitiveTextValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return JSON.stringify(value) ?? String(value);
}

function sanitizeInlineText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function hasMeaningfulText(text: string): boolean {
  return text.trim().length > 0;
}

function renderTreeNodeToLines(
  node: PrimitiveTreeNode,
  lines: string[],
  prefix: string,
  depth: number,
  isLast: boolean,
  showValues: boolean,
): void {
  const branch = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
  const valueSuffix = showValues && node.value !== undefined && node.value !== null
    ? `: ${sanitizeInlineText(formatPrimitiveTextValue(node.value))}`
    : "";
  lines.push(`${prefix}${branch}${sanitizeInlineText(node.label)}${valueSuffix}`);

  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) {
      continue;
    }

    const nextPrefix = depth === 0 ? "" : `${prefix}${isLast ? "   " : "│  "}`;
    renderTreeNodeToLines(child, lines, nextPrefix, depth + 1, index === children.length - 1, showValues);
  }
}

function formatOutputEntitiesAsText(entities: readonly OutputEntity[]): string {
  const lines: string[] = [];

  for (const entity of entities) {
    if (lines.length > 0) {
      lines.push("");
    }

    if (entity.title) {
      lines.push(entity.title);
    }

    switch (entity.kind) {
      case "text": {
        lines.push(...entity.lines);
        break;
      }
      case "table": {
        for (const row of entity.rows) {
          lines.push(entity.columns
            .map((column) => sanitizeInlineText(formatPrimitiveTextValue(row[column.key])))
            .filter((value) => value.length > 0)
            .join(" ")
            .trimEnd());
        }
        break;
      }
      case "tree": {
        const showValues = entity.presentation.showValues ?? true;
        for (let index = 0; index < entity.roots.length; index += 1) {
          const root = entity.roots[index];
          if (!root) {
            continue;
          }

          renderTreeNodeToLines(root, lines, "", 0, index === entity.roots.length - 1, showValues);
        }
        break;
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function pushCopySection(lines: string[], title: string, body: string): void {
  if (!hasMeaningfulText(body)) {
    return;
  }

  if (lines.length > 0) {
    lines.push("");
  }

  lines.push(title);
  lines.push(body.trimEnd());
}

function formatBpkgCommandResultAsText(value: BpkgCommandResultValue): string {
  const lines: string[] = [
    "BPkg Result",
    `Status: ${value.exitCode === 0 ? "Success" : `Exit ${value.exitCode}`}`,
    `Box: ${value.boxId}`,
  ];

  if (typeof value.packageId === "string" && value.packageId.length > 0) {
    lines.push(`Package: ${value.packageId}`);
  }

  if (typeof value.bindingId === "string" && value.bindingId.length > 0) {
    lines.push(`Binding: ${value.bindingId}`);
  }

  if (typeof value.transpiled?.cwd === "string" && value.transpiled.cwd.length > 0) {
    lines.push(`Cwd: ${value.transpiled.cwd}`);
  }

  const commandLabel = value.commandString.length > 0 ? value.commandString : value.command.join(" ");
  pushCopySection(lines, "Command", commandLabel);

  if (value.parsed !== undefined && value.parsed !== value) {
    pushCopySection(lines, "Parsed", formatTextOutput(value.parsed));
  }

  pushCopySection(lines, "Stdout", value.stdout);
  pushCopySection(lines, "Stderr", value.stderr);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatDockerCommandResultAsText(value: DockerCommandResultValue): string {
  const lines: string[] = [
    "Docker Result",
    `Status: ${value.exitCode === 0 ? "Success" : `Exit ${value.exitCode}`}`,
    `Cwd: ${value.cwd.logicalPath}`,
    `Data Root: ${value.cwd.dataRoot}`,
  ];

  const commandLabel = value.commandString.length > 0 ? value.commandString : value.command.join(" ");
  pushCopySection(lines, "Command", commandLabel);

  if (value.parsed !== undefined && value.parsed !== value) {
    pushCopySection(lines, "Parsed", formatTextOutput(value.parsed));
  }

  pushCopySection(lines, "Stdout", value.stdout);
  pushCopySection(lines, "Stderr", value.stderr);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatTextOutput(value: unknown, plainText?: string): string {
  const outputEntities = normalizeOutputEntities(value);
  if (outputEntities) {
    return formatOutputEntitiesAsText(outputEntities);
  }

  if (isBpkgCommandResultValue(value)) {
    return formatBpkgCommandResultAsText(value);
  }

  if (isDockerCommandResultValue(value)) {
    return formatDockerCommandResultAsText(value);
  }

  if (plainText !== undefined && plainText.length > 0) {
    return plainText;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value, null, 2) ?? String(value);
}

function formatJsonOutput(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  return JSON.stringify(value, null, 2) ?? JSON.stringify(String(value));
}

function toYamlScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return '""';
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(String(value));
}

function toYamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key) ? key : JSON.stringify(key);
}

function toYaml(value: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}[]`;
    }

    return value.map((entry) => {
      if (Array.isArray(entry) || isRecord(entry)) {
        return `${indent}-\n${toYaml(entry, depth + 1)}`;
      }

      return `${indent}- ${toYamlScalar(entry)}`;
    }).join("\n");
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${indent}{}`;
    }

    return entries.map(([key, entryValue]) => {
      if (Array.isArray(entryValue) || isRecord(entryValue)) {
        return `${indent}${toYamlKey(key)}:\n${toYaml(entryValue, depth + 1)}`;
      }

      return `${indent}${toYamlKey(key)}: ${toYamlScalar(entryValue)}`;
    }).join("\n");
  }

  return `${indent}${toYamlScalar(value)}`;
}

function sanitizeXmlTagName(tagName: string): string {
  const sanitized = tagName
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^[^A-Za-z_]+/u, "output-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

  return sanitized.length > 0 ? sanitized : "item";
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function toXml(value: unknown, tagName: string, depth = 0): string {
  const indent = "  ".repeat(depth);
  const xmlTagName = sanitizeXmlTagName(tagName);

  if (value === null || value === undefined) {
    return `${indent}<${xmlTagName}/>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}<${xmlTagName}/>`;
    }

    const children = value.map((entry) => toXml(entry, "item", depth + 1)).join("\n");
    return `${indent}<${xmlTagName}>\n${children}\n${indent}</${xmlTagName}>`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${indent}<${xmlTagName}/>`;
    }

    const children = entries.map(([key, entryValue]) => toXml(entryValue, key, depth + 1)).join("\n");
    return `${indent}<${xmlTagName}>\n${children}\n${indent}</${xmlTagName}>`;
  }

  return `${indent}<${xmlTagName}>${escapeXmlText(String(value))}</${xmlTagName}>`;
}

export function formatOutputForCopy(
  value: unknown,
  format: OutputCopyFormat,
  options: FormatOutputForCopyOptions = {},
): string {
  const normalizedValue = normalizeCopyValue(value, options.plainText);

  switch (format) {
    case "text":
      return formatTextOutput(normalizedValue, options.plainText);
    case "json":
      return formatJsonOutput(normalizedValue);
    case "yaml":
      return toYaml(normalizedValue);
    case "xml":
      return toXml(normalizedValue, options.xmlRootTag ?? "output");
  }
}