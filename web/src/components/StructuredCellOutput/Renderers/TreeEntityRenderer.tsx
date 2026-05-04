import { type ReactNode } from "react";
import { type PrimitiveTreeNode, type PrimitiveTreeEntity } from "../types";
import { formatPrimitiveValue, toneClassName } from "../utils";

function renderTreeNode(
  node: PrimitiveTreeNode,
  options: { depth: number; dense: boolean; showValues: boolean; keyPrefix: string },
): ReactNode {
  const paddingTopClassName = options.dense ? "py-0.5" : "py-1";
  const valueText = options.showValues && node.value !== undefined && node.value !== null
    ? formatPrimitiveValue(node.value)
    : null;

  return (
    <div key={options.keyPrefix} className="space-y-1">
      <div
        className={`${paddingTopClassName} flex items-start gap-2 text-[11px] leading-relaxed`}
        style={{ paddingLeft: `${options.depth * 14}px` }}
      >
        {options.depth > 0 && <span className="mt-[7px] h-px w-2 shrink-0 bg-white/[0.12]" />}
        <span className={`${toneClassName(node.tone)} break-all`}>{node.label}</span>
        {valueText !== null && <span className="break-all text-[#8c8c94]">{valueText}</span>}
      </div>
      {(node.children ?? []).map((child, index) => renderTreeNode(child, {
        depth: options.depth + 1,
        dense: options.dense,
        showValues: options.showValues,
        keyPrefix: `${options.keyPrefix}:${child.id ?? index}`,
      }))}
    </div>
  );
}

export default function TreeEntityRenderer({ entity }: { entity: PrimitiveTreeEntity }): ReactNode {
  const dense = entity.presentation.dense ?? true;
  const showValues = entity.presentation.showValues ?? true;

  return (
    <div className="space-y-1 rounded-[10px] bg-white/[0.02] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[#e4e4e7]">
      {entity.roots.map((root, index) => renderTreeNode(root, {
        depth: 0,
        dense,
        showValues,
        keyPrefix: `${entity.id}:${root.id ?? index}`,
      }))}
    </div>
  );
}
