import { type ReactNode } from "react";
import { type PrimitiveTextEntity } from "../types";
import { toneClassName } from "../utils";

export default function TextEntityRenderer({ entity }: { entity: PrimitiveTextEntity }): ReactNode {
  return (
    <pre className={`${toneClassName(entity.tone)} whitespace-pre-wrap font-mono text-[11px] leading-relaxed`}>
      {entity.lines.join("\n")}
    </pre>
  );
}
