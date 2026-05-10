import { useCallback, type ComponentType, memo } from "react";

import { getApplicationDefinition } from "../applications";
import type { ApplicationInstance as WebApplicationInstance } from "../applications/application";
import { useInterfaceStore } from "../store/ui";

export default memo(function ApplicationHost() {
  const selectedApplicationInstanceId = useInterfaceStore((state) => state.selectedApplicationInstanceId);
  const applicationInstances = useInterfaceStore((state) => state.applicationInstances);
  const updateApplicationInstanceTitle = useInterfaceStore((state) => state.updateApplicationInstanceTitle);

  const activeInstance = selectedApplicationInstanceId
    ? applicationInstances.find((instance) => instance.instanceId === selectedApplicationInstanceId) ?? null
    : null;

  if (!activeInstance) {
    return (
      <div className="flex h-full items-center justify-center bg-[#121212] text-[12px] text-[#8d8d96]">
        Select an application from the sidebar.
      </div>
    );
  }

  const applicationDefinition = getApplicationDefinition(activeInstance.applicationId);
  if (!applicationDefinition) {
    return (
      <div className="flex h-full items-center justify-center bg-[#121212] text-[12px] text-rose-200">
        Unknown application: {activeInstance.applicationId}
      </div>
    );
  }

  const View = applicationDefinition.View as ComponentType<{
    instance: WebApplicationInstance;
    setTitle: (title: string) => void;
  }>;
  const handleSetTitle = useCallback((title: string) => {
    updateApplicationInstanceTitle(activeInstance.instanceId, title);
  }, [activeInstance.instanceId, updateApplicationInstanceTitle]);

  return (
    <View
      instance={activeInstance}
      setTitle={handleSetTitle}
    />
  );
});