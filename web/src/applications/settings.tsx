import { Suspense, lazy, useEffect, useState } from "react";

import {
  getRemoteSettingsCatalog,
  resetRemoteSettingValue,
  setRemoteSettingValue,
  type RemoteSettingSnapshot,
  type RemoteSettingsCatalog,
} from "../api/client";
import { useInterfaceStore } from "../store/ui";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";
import {
  ApplicationAlert,
  ApplicationHeader,
  ApplicationMetaRow,
  ApplicationSurface,
} from "./application-layout.tsx";
import {
  applySettingValue,
  createDraftMap,
  formatDraftValue,
  parseDraftValue,
  type SettingsDraftValue,
} from "./settings-model";

export const SETTINGS_APPLICATION_ID = "applications/settings";

const SettingsGroupsPanel = lazy(() => import("./settings-groups-panel.tsx"));
const SettingsListPanel = lazy(() => import("./settings-list-panel.tsx"));

export type SettingsInput = {
  search?: string | null;
  selectedGroupId?: string | null;
  showSecrets?: boolean | null;
};

function omitRecordKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) {
    return record;
  }

  const nextRecord = { ...record };
  delete nextRecord[key];
  return nextRecord;
}

function getSettingsApplicationTitle(): string {
  return "Settings · workspace";
}

function SettingsApplicationView({
  instance,
  setTitle,
}: ApplicationViewProps<SettingsInput>) {
  const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
  const initialInput = instance.input ?? {};
  const [catalog, setCatalog] = useState<RemoteSettingsCatalog | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettingsDraftValue>>({});
  const [selectedGroupId, setSelectedGroupId] = useState(initialInput.selectedGroupId?.trim() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busySettingId, setBusySettingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const groups = catalog?.groups ?? [];
  const filteredSettings = (catalog?.settings ?? []).filter((snapshot) => selectedGroupId.length === 0 || snapshot.definition.groupId === selectedGroupId);

  useEffect(() => {
    setTitle(getSettingsApplicationTitle());
  }, [setTitle]);

  useEffect(() => {
    updateApplicationInstanceInput(instance.instanceId, {
      search: null,
      selectedGroupId: selectedGroupId || null,
      showSecrets: false,
    } satisfies SettingsInput);
  }, [instance.instanceId, selectedGroupId, updateApplicationInstanceInput]);

  useEffect(() => {
    let disposed = false;

    setIsLoading(true);
    void getRemoteSettingsCatalog()
      .then((nextCatalog) => {
        if (disposed) {
          return;
        }

        setCatalog(nextCatalog);
        setDrafts(createDraftMap(nextCatalog));
        setError(null);
      })
      .catch((loadError) => {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  async function handleSave(snapshot: RemoteSettingSnapshot): Promise<void> {
    const { id } = snapshot.definition;
    setBusySettingId(id);
    setActionErrors((current) => omitRecordKey(current, id));

    try {
      const parsedValue = parseDraftValue(snapshot.definition, drafts[id] ?? formatDraftValue(snapshot));
      const resolvedValue = await setRemoteSettingValue(id, parsedValue);
      setCatalog((current) => applySettingValue(current, id, resolvedValue));
      setDrafts((current) => ({
        ...current,
        [id]: formatDraftValue({
          ...snapshot,
          value: resolvedValue,
          missing: false,
        }),
      }));
    } catch (saveError) {
      setActionErrors((current) => ({
        ...current,
        [id]: saveError instanceof Error ? saveError.message : String(saveError),
      }));
    } finally {
      setBusySettingId(null);
    }
  }

  async function handleReset(snapshot: RemoteSettingSnapshot): Promise<void> {
    const { id } = snapshot.definition;
    setBusySettingId(id);
    setActionErrors((current) => omitRecordKey(current, id));

    try {
      const result = await resetRemoteSettingValue(id);
      setCatalog((current) => applySettingValue(current, id, result.value));
      setDrafts((current) => ({
        ...current,
        [id]: formatDraftValue({
          ...snapshot,
          value: result.value,
          missing: false,
        }),
      }));
    } catch (resetError) {
      setActionErrors((current) => ({
        ...current,
        [id]: resetError instanceof Error ? resetError.message : String(resetError),
      }));
    } finally {
      setBusySettingId(null);
    }
  }

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title="Settings"
        subtitle="Registry-backed workspace values persisted in SQLite and exposed through $settings in notebooks and runtime code."
        alert={error ? <ApplicationAlert>{error}</ApplicationAlert> : undefined}
        meta={(
          <ApplicationMetaRow>
            <span>visible {filteredSettings.length}</span>
            <span>catalog {catalog?.settings.length ?? 0}</span>
          </ApplicationMetaRow>
        )}
      />

      <div className="min-h-0 flex-1 pt-2">
        <div className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
          <Suspense fallback={<div className="min-h-[120px]" />}>
            <SettingsGroupsPanel
              groups={groups}
              totalCount={catalog?.settings.length ?? 0}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
            />
          </Suspense>

          <Suspense fallback={<div className="min-h-[240px]" />}>
            <SettingsListPanel
              filteredSettings={filteredSettings}
              drafts={drafts}
              busySettingId={busySettingId}
              actionErrors={actionErrors}
              isLoading={isLoading}
              onSave={handleSave}
              onReset={handleReset}
              onDraftChange={(settingId, value) => {
                setDrafts((current) => ({
                  ...current,
                  [settingId]: value,
                }));
                setActionErrors((current) => omitRecordKey(current, settingId));
              }}
            />
          </Suspense>
        </div>
      </div>
    </ApplicationSurface>
  );
}

export const settingsApplication = defineApplication<SettingsInput>({
  id: SETTINGS_APPLICATION_ID,
  title: "Settings",
  View: SettingsApplicationView,
});