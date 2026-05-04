import type { NotebookDocument } from "../data";

export function serializeISB(notebook: NotebookDocument): Uint8Array {
  const jsonStr = JSON.stringify(notebook);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const header = new TextEncoder().encode("ISCB");
  
  const buffer = new Uint8Array(header.length + jsonBytes.length);
  buffer.set(header, 0);
  buffer.set(jsonBytes, header.length);
  return buffer;
}

export function deserializeISB(buffer: Uint8Array): NotebookDocument {
  const header = new TextDecoder().decode(buffer.slice(0, 4));
  if (header !== "ISCB") {
    throw new Error("Invalid ISB format: Missing ISCB header magic bytes");
  }
  const jsonStr = new TextDecoder().decode(buffer.slice(4));
  return JSON.parse(jsonStr) as NotebookDocument;
}

export function downloadFile(buffer: Uint8Array, filename: string) {
  const blob = new Blob([buffer as any], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
