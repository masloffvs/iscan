import type { ComponentType } from "react";

export type ApplicationInstance<TInput = unknown> = {
  instanceId: string;
  applicationId: string;
  title: string;
  createdAt: string;
  input: TInput;
};

export type ApplicationViewProps<TInput = unknown> = {
  instance: ApplicationInstance<TInput>;
  setTitle: (title: string) => void;
};

export type ApplicationDefinition<TInput = unknown> = {
  id: string;
  title: string;
  View: ComponentType<ApplicationViewProps<TInput>>;
  getInitialTitle?: (input: TInput) => string;
};

export function defineApplication<TInput = unknown>(
  definition: ApplicationDefinition<TInput>,
): ApplicationDefinition<TInput> {
  return definition;
}