import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import { isQualifiedModel } from "api-server-api";

export interface SessionModelChoice {
  value: string;
  name: string;
}

export interface SessionModel {
  sessionId: string;
  configId: string;
  current: string;
  choices: readonly SessionModelChoice[];
}

export function sessionModelFrom(
  sessionId: string,
  configOptions: readonly SessionConfigOption[] | null | undefined,
): SessionModel | null {
  const option = configOptions?.find((o) => o.category === "model");
  if (!option || option.type !== "select") return null;
  const entries = option.options as readonly (
    SessionConfigSelectOption | SessionConfigSelectGroup
  )[];
  const choices = entries.flatMap((entry) =>
    "group" in entry ? entry.options : [entry],
  );
  return {
    sessionId,
    configId: option.id,
    current: option.currentValue,
    choices: choices.map((c) => ({
      value: c.value,
      name: modelDisplayName(c.name),
    })),
  };
}

export function modelDisplayName(id: string): string {
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

export function routedModelOf(value: string): string {
  for (
    let rest = value;
    rest.includes("/");
    rest = rest.slice(rest.indexOf("/") + 1)
  )
    if (isQualifiedModel(rest)) return rest;
  return value;
}

export function withRoutedCurrent(
  model: SessionModel,
  routed: string,
): SessionModel {
  const wanted = routedModelOf(routed).toLowerCase();
  const choice = model.choices.find(
    (c) => routedModelOf(c.value).toLowerCase() === wanted,
  );
  return choice ? { ...model, current: choice.value } : model;
}
