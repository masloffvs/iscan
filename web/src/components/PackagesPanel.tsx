import { type ReactNode, useMemo } from "react";
import type { RemotePackageBoxEntry } from "../api/client";
import { useInterfaceStore } from "../store/ui";

function deriveDefaultPrivilege(box: RemotePackageBoxEntry): string {
  return box.defaultSandboxRw ? "sandbox-rw" : "sandbox-ro";
}

function deriveAllowedPrivileges(box: RemotePackageBoxEntry): string {
  return [
    "sandbox-ro",
    ...(box.allowSandboxRw ? ["sandbox-rw"] : []),
    ...(box.allowHostPrivileged ? ["host-privileged"] : []),
  ].join(", ");
}

function describeHostInfo(hostInfo: ReturnType<typeof useInterfaceStore.getState>["packageHostInfo"]): string {
  if (!hostInfo) {
    return "Waiting for package host info.";
  }

  const details = [hostInfo.archCompatible ? "Arch host" : `Unsupported: ${hostInfo.distro.prettyName ?? hostInfo.platform}`];
  details.push(hostInfo.bwrapExecutable ? "bwrap" : "no bwrap");
  details.push(hostInfo.nspawnExecutable ? "nspawn" : "no nspawn");
  details.push(hostInfo.pacstrapExecutable ? "pacstrap" : "no pacstrap");
  details.push(hostInfo.sudoExecutable ? "sudo" : "no sudo");
  return details.join(" · ");
}

function describeBox(box: RemotePackageBoxEntry, isDefault: boolean): string {
  const details = [box.status];
  if (isDefault) {
    details.push("default");
  }
  details.push(`default ${deriveDefaultPrivilege(box)}`);
  details.push(deriveAllowedPrivileges(box));
  details.push(box.packages.length > 0 ? `${box.packages.length} supported package(s)` : "empty");

  return details.join(" · ");
}

function formatUpdatedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

function summarizeBoxError(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function normalizeBoxId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function IconButton({
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
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`flex h-7 w-7 items-center justify-center rounded-[10px] transition ${active ? "bg-emerald-400/12 text-emerald-100" : "bg-white/[0.05] text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export default function PackagesPanel() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const supportedPackages = useInterfaceStore((state) => state.supportedPackages);
  const defaultPackageBoxId = useInterfaceStore((state) => state.defaultPackageBoxId);
  const packageHostInfo = useInterfaceStore((state) => state.packageHostInfo);
  const isPackagesLoading = useInterfaceStore((state) => state.isPackagesLoading);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const refreshPackageList = useInterfaceStore((state) => state.refreshPackageList);
  const createPackageBox = useInterfaceStore((state) => state.createPackageBox);
  const deletePackageBox = useInterfaceStore((state) => state.deletePackageBox);
  const selectPackageBox = useInterfaceStore((state) => state.selectPackageBox);
  const openPackageBoxModal = useInterfaceStore((state) => state.openPackageBoxModal);

  const sortedBoxes = useMemo(() => {
    return [...packageBoxes].sort((left, right) => {
      if ((left.id === defaultPackageBoxId) !== (right.id === defaultPackageBoxId)) {
        return left.id === defaultPackageBoxId ? -1 : 1;
      }

      if (left.status !== right.status) {
        return left.status === "ready" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }, [defaultPackageBoxId, packageBoxes]);

  const defaultBox = useMemo(() => {
    return sortedBoxes.find((entry) => entry.id === defaultPackageBoxId) ?? null;
  }, [defaultPackageBoxId, sortedBoxes]);

  const createEmptyBox = async () => {
    const requestedId = window.prompt("Box id", "toolbox")?.trim();
    if (!requestedId) {
      return;
    }

    await createPackageBox({
      id: requestedId,
      name: requestedId,
    });

    const normalizedId = normalizeBoxId(requestedId);
    if (normalizedId.length > 0) {
      openPackageBoxModal(normalizedId, "presets");
    }
  };

  return (
    <div className="grow overflow-y-auto dense-scroll px-1">
      <div className="mb-2 flex items-start justify-between gap-3 px-1.5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#68686e]">Boxes</p>
          <p className="mt-1 text-[11px] text-[#8b8b95]">{describeHostInfo(packageHostInfo)}</p>
          <p className="mt-1 text-[11px] text-[#72727c]">
            Default <span className="text-white">{defaultBox?.name ?? defaultPackageBoxId ?? "none"}</span> · {supportedPackages.length} built-in presets ready
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { void refreshPackageList(); }}
            disabled={isPackagesLoading}
            aria-label="Refresh boxes"
            title="Refresh boxes"
            className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-white/[0.05] text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
              <path d="M3 12A9 9 0 0 1 18.5 5.64L21 8" />
              <path d="M8 16H3v5" />
              <path d="M16 8h5V3" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => { void createEmptyBox(); }}
            disabled={packageActionKind === "create"}
            aria-label="Create box"
            title="Create box"
            className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-white/[0.05] text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-1 pb-2">
        {isPackagesLoading ? (
          <div className="rounded-[10px] bg-black/20 px-3 py-2 text-[11px] text-[#68686e]">Loading boxes...</div>
        ) : sortedBoxes.length === 0 ? (
          <div className="rounded-[16px] bg-black/20 px-4 py-5 text-center">
            <p className="text-[12px] font-medium text-white">No boxes created yet.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-[#8b8b95]">Create an empty box now, then jump straight into presets or refresh if another session has already prepared one.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => { void createEmptyBox(); }}
                className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.1]"
              >
                Create Box
              </button>
              <button
                type="button"
                onClick={() => { void refreshPackageList(); }}
                className="rounded-full bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#d4d4da] transition hover:bg-white/[0.08] hover:text-white"
              >
                Refresh
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[10px] bg-black/20">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[28%]" />
                <col className="w-[28%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#68686e]">
                  <th className="px-2.5 py-2 font-medium">Box</th>
                  <th className="px-2.5 py-2 font-medium">State</th>
                  <th className="px-2.5 py-2 font-medium">Packages</th>
                  <th className="px-2.5 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedBoxes.map((box, index) => {
                  const isDefault = box.id === defaultPackageBoxId;
                  const isSelecting = packageActionKind === "select" && packageActionTarget === box.id;
                  const isDeleting = packageActionKind === "delete" && packageActionTarget === box.id;
                  const rowClassName = isDefault
                    ? "bg-emerald-400/[0.08]"
                    : index % 2 === 0
                      ? "bg-transparent hover:bg-white/[0.03]"
                      : "bg-white/[0.015] hover:bg-white/[0.03]";

                  return (
                    <tr
                      key={box.id}
                      tabIndex={0}
                      onClick={() => openPackageBoxModal(box.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openPackageBoxModal(box.id);
                        }
                      }}
                      className={`cursor-pointer align-top text-[11px] transition ${rowClassName}`}
                    >
                      <td className="px-2.5 py-2.5">
                        <p className="font-medium text-white">{box.name}</p>
                        <p className="mt-1 text-[10px] text-[#72727c]">{box.id}</p>
                      </td>
                      <td className="px-2.5 py-2.5 text-[#8f8f98]">
                        <p>{describeBox(box, isDefault)}</p>
                        <p className="mt-1 text-[10px] text-[#72727c]">Updated {formatUpdatedAt(box.updatedAt)}</p>
                        {box.lastError ? <p className="mt-1 text-[10px] text-rose-300">{summarizeBoxError(box.lastError)}</p> : null}
                      </td>
                      <td className="px-2.5 py-2.5 text-[#72727c]">
                        <p className="line-clamp-2 text-[10px]">{box.packages.length > 0 ? box.packages.join(", ") : "empty"}</p>
                      </td>
                      <td className="px-2.5 py-2.5">
                        <div className="flex justify-end gap-1">
                          <IconButton
                            ariaLabel={isDefault ? "Default box" : "Set as default box"}
                            active={isDefault}
                            disabled={isDefault || isSelecting || isDeleting}
                            onClick={() => { void selectPackageBox(box.id); }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <circle cx="12" cy="12" r="7" />
                              <circle cx="12" cy="12" r="2.5" />
                            </svg>
                          </IconButton>

                          <IconButton ariaLabel="Open box" onClick={() => openPackageBoxModal(box.id)}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <path d="M7 17 17 7" />
                              <path d="M8 7h9v9" />
                            </svg>
                          </IconButton>

                          <IconButton
                            ariaLabel="Delete box"
                            disabled={isDeleting}
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Delete box '${box.name}' (${box.id}) and all stored data? This cannot be undone.`,
                              );
                              if (!confirmed) {
                                return;
                              }

                              void deletePackageBox(box.id);
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="m6 6 1 14h10l1-14" />
                            </svg>
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}