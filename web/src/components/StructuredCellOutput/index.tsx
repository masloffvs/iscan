import React, { Suspense } from "react";
import { type StructuredCellOutputProps } from "./types";
import {
  normalizeOutputEntities,
  isBpkgCommandResultValue,
  isDockerCommandResultValue,
} from "./utils";

const OutputEntityRenderer = React.lazy(() => import("./Renderers/OutputEntityRenderer"));
const BpkgCommandResultRenderer = React.lazy(() => import("./Renderers/BpkgCommandResultRenderer"));
const DockerCommandResultRenderer = React.lazy(() => import("./Renderers/DockerCommandResultRenderer"));
const FallbackRenderer = React.lazy(() => import("./Renderers/FallbackRenderer"));

export default React.memo(function StructuredCellOutput({ value, onTableSelectionCopyTextChange }: StructuredCellOutputProps) {
  const outputEntities = normalizeOutputEntities(value);
  if (outputEntities) {
    return (
      <div className="space-y-3">
        {outputEntities.map((entity) => (
          <Suspense key={entity.id} fallback={<div className="text-[11px] text-[#7b7b84]">Loading renderer...</div>}>
            <OutputEntityRenderer entity={entity} onTableSelectionCopyTextChange={onTableSelectionCopyTextChange} />
          </Suspense>
        ))}
      </div>
    );
  }

  if (isBpkgCommandResultValue(value)) {
    return (
      <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading BPKG renderer...</div>}>
        <BpkgCommandResultRenderer value={value} onTableSelectionCopyTextChange={onTableSelectionCopyTextChange} />
      </Suspense>
    );
  }

  if (isDockerCommandResultValue(value)) {
    return (
      <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading Docker renderer...</div>}>
        <DockerCommandResultRenderer value={value} onTableSelectionCopyTextChange={onTableSelectionCopyTextChange} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading fallback...</div>}>
      <FallbackRenderer value={value} />
    </Suspense>
  );
});
