import { type ComponentType } from "react";

export type ReactJsonProps = {
  src: Record<string, unknown> | unknown[];
  name: false;
  theme: string;
  collapsed: number;
  collapseStringsAfterLength: number;
  displayDataTypes: boolean;
  displayObjectSize: boolean;
  enableClipboard: boolean;
  quotesOnKeys: boolean;
  style: {
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
  };
};

export type OutputTone = "command" | "output" | "info" | "error" | "muted" | "accent";
export type PresentationKind = "plain-text" | "ink-table" | "ink-tree";
export type PrimitiveCellValue = string | number | boolean | null | undefined;

export type OutputEntityBase = {
  id: string;
  createdAt: number;
  title?: string;
  meta?: Record<string, unknown>;
};

export type PrimitiveTextEntity = OutputEntityBase & {
  kind: "text";
  lines: string[];
  tone: OutputTone;
  presentation: {
    kind: "plain-text";
  };
};

export type PrimitiveTableColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: number;
  maxWidth?: number;
};

export type PrimitiveTableEntity = OutputEntityBase & {
  kind: "table";
  columns: PrimitiveTableColumn[];
  rows: Record<string, PrimitiveCellValue>[];
  presentation: {
    kind: "ink-table";
    dense?: boolean;
  };
};

export type PrimitiveTreeNode = {
  id?: string;
  label: string;
  value?: string | number | boolean | null;
  children?: PrimitiveTreeNode[];
  tone?: OutputTone;
};

export type PrimitiveTreeEntity = OutputEntityBase & {
  kind: "tree";
  roots: PrimitiveTreeNode[];
  presentation: {
    kind: "ink-tree";
    dense?: boolean;
    showValues?: boolean;
  };
};

export type OutputEntity = PrimitiveTextEntity | PrimitiveTableEntity | PrimitiveTreeEntity;

export type BpkgCommandResultValue = {
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

export type DockerWorkingDirectoryValue = {
  dataRoot: string;
  logicalPath: string;
  realPath: string;
};

export type DockerCommandResultValue = {
  command: string[];
  commandString: string;
  cwd: DockerWorkingDirectoryValue;
  exitCode: number;
  parsed?: unknown;
  stderr: string;
  stdout: string;
};

export type BpkgResultTabId = "parsed" | "stdout" | "stderr" | "raw";

export type NmapParsedResponseValue = {
  format?: string;
  kind: "nmap-report";
  report: Record<string, unknown>;
  target: string;
};

export type NmapParsedPortRow = {
  findings: string;
  host: string;
  id: string;
  port: string;
  service: string;
  state: string;
};

export type StructuredCellOutputProps = {
  value: unknown;
  onTableSelectionCopyTextChange?: (tableId: string, text: string | null) => void;
};
