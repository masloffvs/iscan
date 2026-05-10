import { type OutputTone } from "../types";
import { hasMeaningfulText, toneClassName } from "../utils";

export default function CommandStreamPanel({
  emptyLabel,
  text,
  tone,
}: {
  emptyLabel: string;
  text: string;
  tone: OutputTone;
}) {
  if (!hasMeaningfulText(text)) {
    return (
      <div className="py-1 text-[11px] text-[#7b7b84]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <pre className={`dense-scroll overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${toneClassName(tone)}`}>
      {text}
    </pre>
  );
}
