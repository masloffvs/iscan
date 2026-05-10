import type { ReactNode } from "react";
import workbookTheme from "../theme.tsx";

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

export function ApplicationSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={joinClassNames("dense-scroll h-full overflow-auto px-3 py-2", workbookTheme.surface.canvas, workbookTheme.text.canvas, className)}>
      <div className="flex min-h-full flex-col">{children}</div>
    </div>
  );
}

export function ApplicationHeader({
  title,
  subtitle,
  actions,
  meta,
  alert,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  alert?: ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClassNames("pb-2", className)}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className={joinClassNames("text-[11px] font-medium uppercase tracking-[0.16em]", workbookTheme.text.primary)}>{title}</h1>
          {subtitle ? <div className={joinClassNames("mt-0.5 max-w-3xl text-[10px]", workbookTheme.text.secondary)}>{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:justify-end">{actions}</div> : null}
      </div>

      {alert ? <div className="mt-2">{alert}</div> : null}
      {meta ? <div className="mt-2">{meta}</div> : null}
    </section>
  );
}

export function ApplicationMetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={joinClassNames("flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]", workbookTheme.text.muted, className)}>
      {children}
    </div>
  );
}

export function ApplicationPanel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClassNames("min-h-0 overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 px-0 py-2">
        <div className="min-w-0">
          <h2 className={joinClassNames("text-[10px] font-medium uppercase tracking-[0.18em]", workbookTheme.text.label)}>{title}</h2>
          {subtitle ? <div className={joinClassNames("mt-1 text-[10px]", workbookTheme.text.secondary)}>{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="min-h-0 px-0 pt-3">{children}</div>
    </section>
  );
}

export function ApplicationEmptyState({ text }: { text: string }) {
  return <div className={joinClassNames("text-[11px]", workbookTheme.text.muted)}>{text}</div>;
}

export function ApplicationMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] leading-5">
      <span className={joinClassNames("uppercase tracking-[0.16em]", workbookTheme.text.label)}>{label}</span>
      <span className={workbookTheme.text.primary}>{value}</span>
      {detail ? <span className={workbookTheme.text.secondary}>{detail}</span> : null}
    </div>
  );
}

export function ApplicationAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={joinClassNames(
        "rounded-[14px] px-3.5 py-2.5 text-[10px]",
        tone === "error" ? "bg-rose-500/12 text-rose-100" : "bg-amber-500/10 text-amber-100",
      )}
    >
      {children}
    </div>
  );
}

export function ApplicationActionButton({
  children,
  className,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      {...buttonProps}
      className={joinClassNames(
        "cursor-pointer rounded-[8px] px-2.5 py-1.5 text-[10px] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
        workbookTheme.interaction.button,
        workbookTheme.text.primary,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ApplicationChoiceButton({
  children,
  isActive,
  className,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  isActive: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      {...buttonProps}
      className={joinClassNames(
        "rounded-[8px] px-2.5 py-1.5 text-left text-[10px] transition",
        isActive
          ? `${workbookTheme.interaction.active} text-white`
          : `${workbookTheme.text.muted} ${workbookTheme.interaction.hover} hover:text-white`,
        className,
      )}
    >
      {children}
    </button>
  );
}