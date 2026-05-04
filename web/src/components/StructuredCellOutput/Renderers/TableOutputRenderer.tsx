import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { type PrimitiveTableEntity, type PrimitiveTableColumn } from "../types";
import { formatPrimitiveValue, formatCopyCellValue, alignClassName } from "../utils";

type ColumnSelection = {
  mode: "columns";
  anchorColumnIndex: number;
  currentColumnIndex: number;
};

type CellSelection = {
  mode: "cells";
  anchorColumnIndex: number;
  currentColumnIndex: number;
  anchorRowIndex: number;
  currentRowIndex: number;
};

type TableSelection = ColumnSelection | CellSelection;

function isPrimaryPointer(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.button === 0;
}

function isIndexWithinSelection(value: number, anchor: number, current: number): boolean {
  const start = Math.min(anchor, current);
  const end = Math.max(anchor, current);
  return value >= start && value <= end;
}

function getSelectionRange(anchor: number, current: number): number[] {
  const start = Math.min(anchor, current);
  const end = Math.max(anchor, current);
  const indices: number[] = [];
  for (let index = start; index <= end; index += 1) {
    indices.push(index);
  }
  return indices;
}

function formatTableSelectionCopyText(entity: PrimitiveTableEntity, selection: TableSelection | null): string | null {
  if (!selection) {
    return null;
  }
  if (selection.mode === "columns") {
    const columnIndices = getSelectionRange(selection.anchorColumnIndex, selection.currentColumnIndex);
    const lines = [columnIndices.map((columnIndex) => entity.columns[columnIndex]?.header ?? "").join("\t")];
    for (const row of entity.rows) {
      lines.push(columnIndices
        .map((columnIndex) => formatCopyCellValue(row[entity.columns[columnIndex]?.key ?? ""]))
        .join("\t"));
    }
    return lines.join("\n");
  }
  const rowIndices = getSelectionRange(selection.anchorRowIndex, selection.currentRowIndex);
  const columnIndices = getSelectionRange(selection.anchorColumnIndex, selection.currentColumnIndex);
  return rowIndices
    .map((rowIndex) => {
      const row = entity.rows[rowIndex] ?? {};
      return columnIndices
        .map((columnIndex) => formatCopyCellValue(row[entity.columns[columnIndex]?.key ?? ""]))
        .join("\t");
    })
    .join("\n");
}

export default function TableOutputRenderer({
  entity,
  onTableSelectionCopyTextChange,
}: {
  entity: PrimitiveTableEntity;
  onTableSelectionCopyTextChange?: (tableId: string, text: string | null) => void;
}) {
  const dense = entity.presentation.dense ?? true;
  const cellPaddingClassName = dense ? "px-2 py-1" : "px-3 py-2";
  const [selection, setSelection] = useState<TableSelection | null>(null);
  const [dragSelection, setDragSelection] = useState<TableSelection | null>(null);

  useEffect(() => {
    if (!dragSelection) {
      return undefined;
    }
    const handlePointerUp = () => {
      setDragSelection(null);
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragSelection]);

  useEffect(() => {
    if (!onTableSelectionCopyTextChange) {
      return undefined;
    }
    onTableSelectionCopyTextChange(entity.id, formatTableSelectionCopyText(entity, selection));
    return () => {
      onTableSelectionCopyTextChange(entity.id, null);
    };
  }, [entity, onTableSelectionCopyTextChange, selection]);

  const handleColumnPointerDown = (event: ReactPointerEvent<HTMLElement>, columnIndex: number) => {
    if (!isPrimaryPointer(event)) {
      return;
    }
    event.preventDefault();
    const nextSelection: ColumnSelection = {
      mode: "columns",
      anchorColumnIndex: columnIndex,
      currentColumnIndex: columnIndex,
    };
    setSelection(nextSelection);
    setDragSelection(nextSelection);
  };

  const handleColumnPointerEnter = (columnIndex: number) => {
    setDragSelection((current) => {
      if (!current || current.mode !== "columns") {
        return current;
      }
      const nextSelection: ColumnSelection = {
        ...current,
        currentColumnIndex: columnIndex,
      };
      setSelection(nextSelection);
      return nextSelection;
    });
  };

  const handleCellPointerDown = (event: ReactPointerEvent<HTMLElement>, rowIndex: number, columnIndex: number) => {
    if (!isPrimaryPointer(event)) {
      return;
    }
    event.preventDefault();
    const nextSelection: CellSelection = {
      mode: "cells",
      anchorColumnIndex: columnIndex,
      currentColumnIndex: columnIndex,
      anchorRowIndex: rowIndex,
      currentRowIndex: rowIndex,
    };
    setSelection(nextSelection);
    setDragSelection(nextSelection);
  };

  const handleCellPointerEnter = (rowIndex: number, columnIndex: number) => {
    setDragSelection((current) => {
      if (!current || current.mode !== "cells") {
        return current;
      }
      const nextSelection: CellSelection = {
        ...current,
        currentRowIndex: rowIndex,
        currentColumnIndex: columnIndex,
      };
      setSelection(nextSelection);
      return nextSelection;
    });
  };

  const isColumnSelected = (columnIndex: number): boolean => {
    if (!selection) {
      return false;
    }
    if (selection.mode === "columns") {
      return isIndexWithinSelection(columnIndex, selection.anchorColumnIndex, selection.currentColumnIndex);
    }
    return false;
  };

  const isCellSelected = (rowIndex: number, columnIndex: number): boolean => {
    if (!selection || selection.mode !== "cells") {
      return false;
    }
    return isIndexWithinSelection(rowIndex, selection.anchorRowIndex, selection.currentRowIndex)
      && isIndexWithinSelection(columnIndex, selection.anchorColumnIndex, selection.currentColumnIndex);
  };

  const getHeaderClassName = (columnIndex: number, align: PrimitiveTableColumn["align"]): string => {
    const columnSelected = isColumnSelected(columnIndex);
    return [
      cellPaddingClassName,
      alignClassName(align),
      "select-none text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94] transition-colors",
      columnSelected ? "bg-[#8eb7ff]/16 text-[#dce8ff]" : "bg-transparent",
    ].join(" ");
  };

  const getCellClassName = (rowIndex: number, columnIndex: number, align: PrimitiveTableColumn["align"]): string => {
    const columnSelected = isColumnSelected(columnIndex);
    const cellSelected = isCellSelected(rowIndex, columnIndex);
    return [
      cellPaddingClassName,
      alignClassName(align),
      "select-none whitespace-pre-wrap break-words text-[#e4e4e7] transition-colors",
      cellSelected
        ? "bg-[#8eb7ff]/24 text-white"
        : columnSelected
          ? "bg-white/[0.08]"
          : "bg-transparent",
    ].join(" ");
  };

  return (
    <div
      className="overflow-x-auto rounded-[10px] bg-white/[0.02]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          setSelection(null);
          setDragSelection(null);
        }
      }}
    >
      <table className="min-w-full w-max border-collapse font-mono text-[11px] leading-relaxed text-[#e4e4e7]">
        <thead>
          <tr className="bg-white/[0.03]">
            {entity.columns.map((column, columnIndex) => (
              <th
                key={`${entity.id}:${column.key}`}
                onPointerDown={(event) => handleColumnPointerDown(event, columnIndex)}
                onPointerEnter={() => handleColumnPointerEnter(columnIndex)}
                className={getHeaderClassName(columnIndex, column.align)}
                style={{
                  width: typeof column.width === "number" ? `${column.width}ch` : undefined,
                  maxWidth: typeof column.maxWidth === "number" ? `${column.maxWidth}ch` : undefined,
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entity.rows.length > 0 ? entity.rows.map((row, rowIndex) => (
            <tr key={`${entity.id}:row:${rowIndex}`} className="odd:bg-white/[0.012] even:bg-transparent">
              {entity.columns.map((column, columnIndex) => (
                <td
                  key={`${entity.id}:row:${rowIndex}:${column.key}`}
                  onPointerDown={(event) => handleCellPointerDown(event, rowIndex, columnIndex)}
                  onPointerEnter={() => handleCellPointerEnter(rowIndex, columnIndex)}
                  className={getCellClassName(rowIndex, columnIndex, column.align)}
                  style={{
                    width: typeof column.width === "number" ? `${column.width}ch` : undefined,
                    maxWidth: typeof column.maxWidth === "number" ? `${column.maxWidth}ch` : undefined,
                  }}
                >
                  {formatPrimitiveValue(row[column.key])}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={Math.max(1, entity.columns.length)} className={`${cellPaddingClassName} text-[#7b7b84]`}>
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
