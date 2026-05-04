import { type ReactNode } from "react";
import { type PrimitiveCellValue } from "../types";
import { isObjectRecord, formatPrimitiveValue } from "../utils";
import React, { Suspense } from "react";

const JsonRenderer = React.lazy(() => import("./JsonRenderer"));

export default function FallbackRenderer({ value }: { value: unknown }): ReactNode {
  if (isObjectRecord(value) || Array.isArray(value)) {
    return (
      <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading...</div>}>
        <JsonRenderer value={value as Record<string, unknown> | unknown[]} />
      </Suspense>
    );
  }

  return (
    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#e4e4e7]">
      {formatPrimitiveValue(value as PrimitiveCellValue)}
    </pre>
  );
}
