import { type ReactNode, type ComponentType } from "react";
import ReactJsonModule from "react-json-view";
import { type ReactJsonProps } from "../types";
import { unwrapComponentModule } from "../utils";

const ReactJson = unwrapComponentModule(ReactJsonModule) as ComponentType<ReactJsonProps>;

export default function JsonRenderer({ value }: { value: Record<string, unknown> | unknown[] }): ReactNode {
  return (
    <ReactJson
      src={value}
      name={false}
      theme="monokai"
      collapsed={2}
      collapseStringsAfterLength={120}
      displayDataTypes={false}
      displayObjectSize={false}
      enableClipboard={false}
      quotesOnKeys={false}
      style={{
        backgroundColor: "transparent",
        fontSize: "11px",
        fontFamily: "monospace",
      }}
    />
  );
}
