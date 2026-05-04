import { useState, useEffect, type ReactNode } from "react";
import React, { Suspense } from "react";
import { type OutputEntity, type PresentationKind, type PrimitiveTextEntity, type PrimitiveTableEntity, type PrimitiveTreeEntity } from "../types";

const TextEntityRenderer = React.lazy(() => import("./TextEntityRenderer"));
const TableOutputRenderer = React.lazy(() => import("./TableOutputRenderer"));
const TreeEntityRenderer = React.lazy(() => import("./TreeEntityRenderer"));

export default function OutputEntityRenderer({
  entity,
  onTableSelectionCopyTextChange,
}: {
  entity: OutputEntity;
  onTableSelectionCopyTextChange?: (tableId: string, text: string | null) => void;
}): ReactNode {
  let content: ReactNode = null;

  switch (entity.presentation.kind as PresentationKind) {
    case "plain-text":
      content = <TextEntityRenderer entity={entity as PrimitiveTextEntity} />;
      break;
    case "ink-table":
      content = (
        <TableOutputRenderer
          entity={entity as PrimitiveTableEntity}
          onTableSelectionCopyTextChange={onTableSelectionCopyTextChange}
        />
      );
      break;
    case "ink-tree":
      content = <TreeEntityRenderer entity={entity as PrimitiveTreeEntity} />;
      break;
    default:
      content = null;
  }

  if (!content) {
    return null;
  }

  return (
    <section key={entity.id} className="space-y-2">
      {entity.title && (
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#8c8c94]">
          {entity.title}
        </div>
      )}
      <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading renderer...</div>}>
        {content}
      </Suspense>
    </section>
  );
}
