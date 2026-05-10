import type {
  ModuleConsoleParam,
  ModulePaletteCommand,
} from "./modules/module";

type CommandTreeNode = {
  children: Map<string, CommandTreeNode>;
  command?: ModulePaletteCommand;
  path: string[];
};

const TS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function toJsPropertyName(segment: string): string {
  return segment.replace(/-+([A-Za-z0-9])/gu, (_match, nextChar: string) => nextChar.toUpperCase());
}

function toTypeSuffix(value: string): string {
  const normalized = value
    .split(/[^A-Za-z0-9]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("_");
  return normalized.length > 0 ? normalized : "Root";
}

function quoteProperty(name: string): string {
  return TS_IDENTIFIER_PATTERN.test(name) ? name : JSON.stringify(name);
}

function sanitizeComment(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\*\//gu, "*\\/")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function formatParamDoc(param: ModuleConsoleParam): string {
  return [
    param.required ? "required" : "optional",
    param.valueType ? `type: ${param.valueType}` : "",
    param.detail ?? "",
    param.values && param.values.length > 0 ? `values: ${param.values.join(", ")}` : "",
    param.example ? `example: ${param.example}` : "",
  ].filter(Boolean).join(" | ");
}

function buildLiteralUnion(values: readonly string[] | undefined): string | null {
  if (!values || values.length === 0) {
    return null;
  }

  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return uniqueValues.length > 0
    ? uniqueValues.map((value) => JSON.stringify(value)).join(" | ")
    : null;
}

function buildParamValueType(param: ModuleConsoleParam): string {
  const literalUnion = buildLiteralUnion(param.values);

  switch (param.valueType) {
    case "string":
      return literalUnion ?? "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "NotebookRuntimeJsonValue";
    case "string[]":
      return literalUnion ? `(${literalUnion})[]` : "string[]";
    default:
      return literalUnion ?? "unknown";
  }
}

function getParamDescriptorName(param: ModuleConsoleParam): string {
  return param.jsDescriptorName ?? toJsPropertyName(param.name);
}

function createTreeNode(path: string[] = []): CommandTreeNode {
  return {
    children: new Map<string, CommandTreeNode>(),
    path,
  };
}

function buildCommandTree(commands: readonly ModulePaletteCommand[]): CommandTreeNode {
  const root = createTreeNode();

  for (const command of commands) {
    const segments = command.id
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => toJsPropertyName(segment));

    let currentNode = root;
    for (const segment of segments) {
      let childNode = currentNode.children.get(segment);
      if (!childNode) {
        childNode = createTreeNode([...currentNode.path, segment]);
        currentNode.children.set(segment, childNode);
      }
      currentNode = childNode;
    }

    currentNode.command = command;
  }

  return root;
}

function getNodeInterfaceName(path: readonly string[]): string {
  return `NotebookRuntimeNode_${toTypeSuffix(path.join("/"))}`;
}

function getParamsInterfaceName(commandId: string): string {
  return `NotebookRuntimeParams_${toTypeSuffix(commandId)}`;
}

function getModuleInterfaceName(commandId: string): string {
  return `NotebookRuntimeModule_${toTypeSuffix(commandId)}`;
}

function renderParamsInterface(command: ModulePaletteCommand): string[] {
  const interfaceName = getParamsInterfaceName(command.id);
  if (command.consoleParams.length === 0) {
    return [`type ${interfaceName} = NotebookRuntimeEmptyConfig;`, ""];
  }

  return [
    `interface ${interfaceName} {`,
    ...command.consoleParams.flatMap((param) => {
      const propertyName = quoteProperty(param.name);
      const propertyType = buildParamValueType(param);
      const doc = sanitizeComment(formatParamDoc(param));
      return [
        ...(doc ? [`  /** ${doc} */`] : []),
        `  ${propertyName}${param.required ? "" : "?"}: ${propertyType};`,
      ];
    }),
    "}",
    "",
  ];
}

function renderModuleInterface(command: ModulePaletteCommand): string[] {
  const moduleInterfaceName = getModuleInterfaceName(command.id);
  const moduleResultType = `NotebookRuntimeModuleResult<${JSON.stringify(command.id)}>`;
  const paramsInterfaceName = getParamsInterfaceName(command.id);
  const defaultParam = command.defaultParameterName
    ? command.consoleParams.find((param) => param.name === command.defaultParameterName)
    : undefined;
  const directCallTypes = [
    command.consoleParams.length > 0 ? paramsInterfaceName : null,
    defaultParam ? buildParamValueType(defaultParam) : null,
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const description = sanitizeComment(command.description ?? `Execute ${command.id}.`);
  const booleanDescriptorParams = command.consoleParams.filter((param) => param.valueType === "boolean");

  return [
    `interface ${moduleInterfaceName} extends PromiseLike<${moduleResultType}> {`,
    ...(description ? [`  /** ${description} */`] : []),
    `  (): ${moduleInterfaceName};`,
    ...(directCallTypes.length > 0
      ? [
        ...(description ? [`  /** ${description} */`] : []),
        `  (params: ${directCallTypes.join(" | ")}): ${moduleInterfaceName};`,
      ]
      : []),
    ...(description ? [`  /** ${description} */`] : []),
    `  with(config${command.consoleParams.length === 0 ? "?" : ""}: ${paramsInterfaceName}): ${moduleInterfaceName};`,
    ...booleanDescriptorParams.flatMap((param) => {
      const descriptorName = quoteProperty(getParamDescriptorName(param));
      const doc = sanitizeComment(param.detail ?? `Enable ${param.name}.`);
      return [
        ...(doc ? [`  /** ${doc} */`] : []),
        `  readonly ${descriptorName}: ${moduleInterfaceName};`,
      ];
    }),
    "}",
    "",
  ];
}

function renderNodeInterfaces(node: CommandTreeNode): string[] {
  const lines: string[] = [];

  for (const childNode of [...node.children.values()].sort((left, right) => {
    const leftKey = left.path[left.path.length - 1] ?? "";
    const rightKey = right.path[right.path.length - 1] ?? "";
    return leftKey.localeCompare(rightKey);
  })) {
    lines.push(...renderNodeInterfaces(childNode));
  }

  if (node.path.length === 0) {
    return lines;
  }

  lines.push(`interface ${getNodeInterfaceName(node.path)} {`);
  for (const [propertyName, childNode] of [...node.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const propertyType = childNode.command && childNode.children.size === 0
      ? getModuleInterfaceName(childNode.command.id)
      : getNodeInterfaceName(childNode.path);
    const propertyDoc = sanitizeComment(
      childNode.command?.description
        ?? `Runtime module group ${childNode.path.join("/")}.`,
    );
    if (propertyDoc) {
      lines.push(`  /** ${propertyDoc} */`);
    }
    lines.push(`  ${quoteProperty(propertyName)}: ${propertyType};`);
  }
  lines.push("}", "");

  return lines;
}

export function buildNotebookCommandRuntimeTypeSource(
  commands: readonly ModulePaletteCommand[],
): string {
  const sortedCommands = [...commands].sort((left, right) => left.id.localeCompare(right.id));
  const tree = buildCommandTree(sortedCommands);

  return [
    "type NotebookRuntimeJsonPrimitive = string | number | boolean | null | undefined;",
    "type NotebookRuntimeJsonValue = NotebookRuntimeJsonPrimitive | NotebookRuntimeJsonObject | NotebookRuntimeJsonValue[];",
    "type NotebookRuntimeJsonObject = { [key: string]: NotebookRuntimeJsonValue };",
    "type NotebookRuntimeEmptyConfig = Record<string, never>;",
    "interface NotebookRuntimeModuleResultMap {}",
    "type NotebookRuntimeModuleResult<TModuleId extends string> = TModuleId extends keyof NotebookRuntimeModuleResultMap ? NotebookRuntimeModuleResultMap[TModuleId] : unknown;",
    "",
    ...sortedCommands.flatMap((command) => ([
      ...renderParamsInterface(command),
      ...renderModuleInterface(command),
    ])),
    ...renderNodeInterfaces(tree),
    "interface NotebookRuntimeRoot {",
    ...([...tree.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([propertyName, childNode]) => {
        const propertyDoc = sanitizeComment(
          childNode.command?.description
            ?? `Runtime module group ${childNode.path.join("/")}.`,
        );
        return [
          ...(propertyDoc ? [`  /** ${propertyDoc} */`] : []),
          `  ${quoteProperty(propertyName)}: ${childNode.command && childNode.children.size === 0
            ? getModuleInterfaceName(childNode.command.id)
            : getNodeInterfaceName(childNode.path)};`,
        ];
      })),
    "}",
  ].join("\n");
}