import { type ReactNode, useMemo } from "react";
import type { RemoteSupportedPackageEntry } from "../api/client";
import { useInterfaceStore, type PackageBoxModalTab } from "../store/ui";

type BoxPresetDefinition = {
  description: string;
  id: string;
  packageIds: string[];
  title: string;
};

type TableColumn = {
  className?: string;
  key: string;
  label: string;
};

function packageDependencySummary(packageEntry: RemoteSupportedPackageEntry): string {
  const pacman = packageEntry.dependency.pacman.join(", ");
  const paru = packageEntry.dependency.paru.join(", ");
  if (pacman && paru) {
    return `pacman: ${pacman} · paru: ${paru}`;
  }

  if (pacman) {
    return `pacman: ${pacman}`;
  }

  if (paru) {
    return `paru: ${paru}`;
  }

  return "No declarative dependencies.";
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

function createPresetDefinitions(supportedPackages: readonly RemoteSupportedPackageEntry[]): BoxPresetDefinition[] {
  const presets = supportedPackages.map((packageEntry) => ({
    description: packageEntry.description,
    id: packageEntry.id,
    packageIds: [packageEntry.id],
    title: packageEntry.package,
  }));

  if (supportedPackages.length > 1) {
    presets.unshift({
      description: "Install the currently registered supported tool surfaces into one box.",
      id: "stack-full",
      packageIds: supportedPackages.map((entry) => entry.id),
      title: "Full Stack",
    });
  }

  return presets;
}

function compareInstalledCounts(left: number, right: number): number {
  if (left !== right) {
    return right - left;
  }

  return 0;
}

function renderPackageList(packageIds: readonly string[], installedPackageIds: ReadonlySet<string>): ReactNode {
  return (
    <span>
      {packageIds.map((packageId, index) => {
        const isInstalled = installedPackageIds.has(packageId);
        return (
          <span key={packageId}>
            {index > 0 ? <span className="text-[#68686e]">, </span> : null}
            <span className={isInstalled ? "font-semibold text-white" : "font-normal text-[#8b8b95]"}>
              {packageId}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function CompactTable({
  columns,
  children,
}: {
  columns: readonly TableColumn[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[8px] bg-black/20">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#68686e]">
            {columns.map((column) => (
              <th key={column.key} className={`px-2.5 py-2 font-medium ${column.className ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CompactTableEmptyRow({
  colSpan,
  label,
}: {
  colSpan: number;
  label: string;
}) {
  return (
    <tr className="text-[11px] text-[#8b8b95]">
      <td colSpan={colSpan} className="px-2.5 py-3">
        {label}
      </td>
    </tr>
  );
}

function tableRowClassName(index: number): string {
  return index % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]";
}

function ActionIconButton({
  active = false,
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`flex h-7 w-7 items-center justify-center rounded-[10px] transition ${active ? "bg-emerald-400/12 text-emerald-100" : "bg-white/[0.05] text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[10px] px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${active ? "bg-white/[0.08] text-white" : "text-[#8f8f98] hover:bg-white/[0.04] hover:text-white"}`}
    >
      {label}
    </button>
  );
}

function StatusPill({ tone, value }: { tone: "default" | "error" | "success"; value: string }) {
  const className = tone === "error"
    ? "text-rose-200"
    : tone === "success"
      ? "text-emerald-200"
      : "text-[#d6d6db]";

  return <span className={`text-[10px] uppercase tracking-[0.16em] ${className}`}>{value}</span>;
}

function PackageBoxModalOverview() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const defaultPackageBoxId = useInterfaceStore((state) => state.defaultPackageBoxId);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const selectPackageBox = useInterfaceStore((state) => state.selectPackageBox);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );

  if (!box) {
    return (
      <div className="rounded-[10px] bg-white/[0.02] p-3 text-[11px] text-[#8b8b95]">
        Selected box is no longer available. Refresh the boxes list and open it again.
      </div>
    );
  }

  const isDefault = box.id === defaultPackageBoxId;
  const isSelecting = packageActionKind === "select" && packageActionTarget === box.id;
  const statusTone: "default" | "error" | "success" = box.status === "error"
    ? "error"
    : box.status === "ready"
      ? "success"
      : "default";

  return (
    <div className="rounded-[10px] bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[14px] font-medium text-white">{box.name}</h4>
            <StatusPill tone={statusTone} value={box.status} />
            {isDefault ? <StatusPill tone="success" value="default" /> : null}
          </div>
          <p className="mt-1 text-[11px] text-[#72727c]">{box.id}</p>
        </div>

        <ActionIconButton
          ariaLabel={isDefault ? "Default box" : "Set as default box"}
          active={isDefault}
          disabled={isDefault || isSelecting}
          onClick={() => { void selectPackageBox(box.id); }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        </ActionIconButton>
      </div>

      <div className="mt-3">
        <CompactTable
          columns={[
            { key: "field", label: "Field", className: "w-[26%]" },
            { key: "value", label: "Value", className: "w-[74%]" },
          ]}
        >
          {[
            { field: "Status", value: <StatusPill tone={statusTone} value={box.status} /> },
            { field: "Default", value: isDefault ? <StatusPill tone="success" value="default" /> : <span className="text-[#72727c]">No</span> },
            { field: "Root", value: <span className="break-all font-mono text-[11px] text-[#d6d6db]">{box.rootPath}</span> },
            { field: "Created", value: <span className="text-[#d6d6db]">{formatTimestamp(box.createdAt)}</span> },
            { field: "Updated", value: <span className="text-[#d6d6db]">{formatTimestamp(box.updatedAt)}</span> },
            { field: "Last error", value: box.lastError ? <span className="text-rose-200">{box.lastError}</span> : <span className="text-[#72727c]">-</span> },
          ].map((row, index) => (
            <tr key={row.field} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
              <td className="px-2.5 py-2.5 text-[#8f8f98]">{row.field}</td>
              <td className="px-2.5 py-2.5">{row.value}</td>
            </tr>
          ))}
        </CompactTable>
      </div>
    </div>
  );
}

function PackageBoxModalPresets() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const supportedPackages = useInterfaceStore((state) => state.supportedPackages);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const installPackageSet = useInterfaceStore((state) => state.installPackageSet);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );
  const installedPackageIds = useMemo(() => new Set(box?.packages ?? []), [box?.packages]);
  const presets = useMemo(() => {
    return [...createPresetDefinitions(supportedPackages)].sort((left, right) => {
      const leftInstalled = left.packageIds.filter((packageId) => installedPackageIds.has(packageId)).length;
      const rightInstalled = right.packageIds.filter((packageId) => installedPackageIds.has(packageId)).length;
      const byInstalledCount = compareInstalledCounts(leftInstalled, rightInstalled);
      if (byInstalledCount !== 0) {
        return byInstalledCount;
      }

      return left.title.localeCompare(right.title);
    });
  }, [installedPackageIds, supportedPackages]);

  if (!box) {
    return null;
  }

  return (
    <CompactTable
      columns={[
        { key: "preset", label: "Preset", className: "w-[18%]" },
        { key: "packages", label: "Packages", className: "w-[26%]" },
        { key: "description", label: "Description", className: "w-[42%]" },
        { key: "action", label: "Action", className: "w-[14%] text-right" },
      ]}
    >
      {presets.map((preset, index) => {
        const installedCount = preset.packageIds.filter((packageId) => box.packages.includes(packageId)).length;
        const isInstalled = installedCount === preset.packageIds.length;
        const isInstalling = packageActionKind === "install" && packageActionTarget === box.id;

        return (
          <tr key={preset.id} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
            <td className="px-2.5 py-2.5 text-white">{preset.title}</td>
            <td className="px-2.5 py-2.5">{renderPackageList(preset.packageIds, installedPackageIds)}</td>
            <td className="px-2.5 py-2.5 text-[#8b8b95]">{preset.description}</td>
            <td className="px-2.5 py-2.5">
              <div className="flex justify-end">
                <ActionIconButton
                  ariaLabel={isInstalled ? "Preset already installed" : `Install ${preset.title}`}
                  active={isInstalled}
                  disabled={isInstalled || isInstalling}
                  onClick={() => { void installPackageSet(preset.packageIds, box.id); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 19h14" />
                  </svg>
                </ActionIconButton>
              </div>
            </td>
          </tr>
        );
      })}
    </CompactTable>
  );
}

function PackageBoxModalPackages() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const supportedPackages = useInterfaceStore((state) => state.supportedPackages);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );

  if (!box) {
    return null;
  }

  const installedPackageIds = useMemo(() => new Set(box.packages), [box.packages]);
  const sortedPackages = useMemo(() => {
    return [...supportedPackages].sort((left, right) => {
      const leftInstalled = installedPackageIds.has(left.id) ? 1 : 0;
      const rightInstalled = installedPackageIds.has(right.id) ? 1 : 0;
      const byInstalled = compareInstalledCounts(leftInstalled, rightInstalled);
      if (byInstalled !== 0) {
        return byInstalled;
      }

      return left.id.localeCompare(right.id);
    });
  }, [installedPackageIds, supportedPackages]);

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Packages</p>
        <div className="mt-2">
          <CompactTable
            columns={[
              { key: "package", label: "Package", className: "w-[18%]" },
              { key: "bindings", label: "Bindings", className: "w-[24%]" },
              { key: "dependencies", label: "Dependencies", className: "w-[28%]" },
              { key: "description", label: "Description", className: "w-[30%]" },
            ]}
          >
            {sortedPackages.length === 0 ? <CompactTableEmptyRow colSpan={4} label="No package metadata is available yet for this box." /> : null}
            {sortedPackages.map((packageEntry, index) => {
              const isInstalled = installedPackageIds.has(packageEntry.id);
              return (
              <tr key={packageEntry.id} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
                <td className={`px-2.5 py-2.5 ${isInstalled ? "font-semibold text-white" : "font-normal text-[#8b8b95]"}`}>{packageEntry.id}</td>
                <td className="px-2.5 py-2.5 text-[#72727c]">{packageEntry.bindings.map((binding) => binding.id).join(", ")}</td>
                <td className="px-2.5 py-2.5 text-[#8b8b95]">{packageDependencySummary(packageEntry)}</td>
                <td className="px-2.5 py-2.5 text-[#8b8b95]">{packageEntry.description}</td>
              </tr>
            );})}
          </CompactTable>
        </div>
      </div>

      <div className="rounded-[10px] bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Official pacman next</p>
        <div className="mt-2">
          <CompactTable
            columns={[
              { key: "capability", label: "Capability", className: "w-[28%]" },
              { key: "status", label: "Status", className: "w-[18%]" },
              { key: "note", label: "Note", className: "w-[54%]" },
            ]}
          >
            {[
              {
                capability: "Search",
                status: "next",
                note: "Box-local official pacman search results will land here.",
              },
              {
                capability: "Installed index",
                status: "next",
                note: "Per-box installed vs not-installed state will be tracked in this table.",
              },
              {
                capability: "Install",
                status: "next",
                note: "One-click official pacman installs will reuse the same modal shell.",
              },
            ].map((row, index) => (
              <tr key={row.capability} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
                <td className="px-2.5 py-2.5 text-white">{row.capability}</td>
                <td className="px-2.5 py-2.5"><StatusPill tone="default" value={row.status} /></td>
                <td className="px-2.5 py-2.5 text-[#8b8b95]">{row.note}</td>
              </tr>
            ))}
          </CompactTable>
        </div>
      </div>
    </div>
  );
}

function PackageBoxModalTerminal() {
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);

  return (
    <div className="rounded-[10px] bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Terminal hook</p>
      <div className="mt-2">
        <CompactTable
          columns={[
            { key: "layer", label: "Layer", className: "w-[24%]" },
            { key: "choice", label: "Choice", className: "w-[24%]" },
            { key: "note", label: "Note", className: "w-[52%]" },
          ]}
        >
          {[
            {
              layer: "Target",
              choice: activePackageBoxId ?? "unknown",
              note: "Current modal selection for the future shell session.",
            },
            {
              layer: "Transport",
              choice: "WebSocket",
              note: "Bidirectional data flow for stdin/stdout and control events.",
            },
            {
              layer: "Renderer",
              choice: "xterm",
              note: "The package is already installed and will render the live terminal grid.",
            },
            {
              layer: "Status",
              choice: "next",
              note: "Backend session endpoint and attach flow are the next implementation slice.",
            },
          ].map((row, index) => (
            <tr key={row.layer} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
              <td className="px-2.5 py-2.5 text-white">{row.layer}</td>
              <td className="px-2.5 py-2.5 text-[#d6d6db]">{row.choice}</td>
              <td className="px-2.5 py-2.5 text-[#8b8b95]">{row.note}</td>
            </tr>
          ))}
        </CompactTable>
      </div>
    </div>
  );
}

export default function PackageBoxModalContent() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const activePackageBoxTab = useInterfaceStore((state) => state.activePackageBoxTab);
  const setPackageBoxModalTab = useInterfaceStore((state) => state.setPackageBoxModalTab);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );

  const tabs: { id: PackageBoxModalTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "presets", label: "Presets" },
    { id: "packages", label: "Packages" },
    { id: "terminal", label: "Terminal" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Box workspace</p>
            <p className="mt-1 text-[13px] text-white">{box?.name ?? activePackageBoxId ?? "Unknown box"}</p>
          </div>

          <div className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <TabButton
                key={tab.id}
                active={tab.id === activePackageBoxTab}
                label={tab.label}
                onClick={() => setPackageBoxModalTab(tab.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {activePackageBoxTab === "overview" ? <PackageBoxModalOverview /> : null}
      {activePackageBoxTab === "presets" ? <PackageBoxModalPresets /> : null}
      {activePackageBoxTab === "packages" ? <PackageBoxModalPackages /> : null}
      {activePackageBoxTab === "terminal" ? <PackageBoxModalTerminal /> : null}
    </div>
  );
}