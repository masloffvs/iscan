import type { RemoteSettingsCatalog } from "../api/client";
import {
  ApplicationChoiceButton,
  ApplicationPanel,
} from "./application-layout.tsx";

type SettingsGroupsPanelProps = {
  groups: RemoteSettingsCatalog["groups"];
  totalCount: number;
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
};

function GroupButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <ApplicationChoiceButton
      onClick={onClick}
      isActive={isActive}
      className="flex w-full items-center justify-between"
    >
      <span className="truncate">{label}</span>
      <span className="text-[#6f7078]">{count}</span>
    </ApplicationChoiceButton>
  );
}

export default function SettingsGroupsPanel({
  groups,
  totalCount,
  selectedGroupId,
  onSelectGroup,
}: SettingsGroupsPanelProps) {
  return (
    <ApplicationPanel title="Groups">
        <div className="space-y-1">
          <GroupButton
            label="All"
            count={totalCount}
            isActive={selectedGroupId.length === 0}
            onClick={() => onSelectGroup("")}
          />
          {groups.map((group) => (
            <GroupButton
              key={group.id}
              label={group.label}
              count={group.settingCount}
              isActive={selectedGroupId === group.id}
              onClick={() => onSelectGroup(group.id)}
            />
          ))}
        </div>
    </ApplicationPanel>
  );
}