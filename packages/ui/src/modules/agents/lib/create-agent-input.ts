import type { EgressPreset } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import {
  type RegistryCredential,
  registryFilledCount,
} from "../../sandboxes/components/registry-credential-section.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  egressPreset: EgressPreset;
  vm: boolean;
}

export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return draft.name.trim().length > 0;
}

export function buildCreateAgentInput(
  draft: CreateAgentDraft,
): CreateAgentInput {
  if (!isCreateAgentDraftComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  return {
    name: draft.name.trim(),
    egressPreset: draft.egressPreset,
    ...(draft.vm ? { vm: true } : {}),
  };
}

export interface CodingAgentSetupDraft {
  name: string;
  templateId: string | null;
  customImage: string;
  providerRef: ProviderRef | null;
  connectionIds: string[];
  registryCredential: RegistryCredential;
  hibernationTimeoutMin: number | null;
  vm: boolean;
  requireConnectionAddress?: boolean;
}

function setupUsesCustomImage(draft: CodingAgentSetupDraft): boolean {
  return draft.customImage.trim().length > 0;
}

export function hasPartialRegistryCredential(
  draft: CodingAgentSetupDraft,
): boolean {
  if (!setupUsesCustomImage(draft)) return false;
  const filled = registryFilledCount(draft.registryCredential);
  return filled > 0 && filled < 3;
}

export function isCodingAgentSetupComplete(
  draft: CodingAgentSetupDraft,
): boolean {
  return (
    draft.name.trim().length > 0 &&
    (draft.templateId !== null || setupUsesCustomImage(draft)) &&
    (draft.hibernationTimeoutMin === null ||
      (Number.isInteger(draft.hibernationTimeoutMin) &&
        draft.hibernationTimeoutMin >= 0)) &&
    !hasPartialRegistryCredential(draft)
  );
}

export function buildCodingAgentSetupInput(
  draft: CodingAgentSetupDraft,
): CreateAgentInput {
  if (!isCodingAgentSetupComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  const image = draft.customImage.trim();
  const credential = draft.registryCredential;
  return {
    name: draft.name.trim(),
    egressPreset: "trusted",
    ...(draft.vm ? { vm: true } : {}),
    ...(draft.hibernationTimeoutMin === null
      ? {}
      : { hibernationTimeoutMin: draft.hibernationTimeoutMin }),
    ...(draft.requireConnectionAddress
      ? { requireConnectionAddress: true }
      : {}),
    ...(image ? { image } : { templateId: draft.templateId! }),
    appConnectionIds: [
      ...new Set([
        ...draft.connectionIds,
        ...(draft.providerRef ? [draft.providerRef.id] : []),
      ]),
    ],
    ...(image && registryFilledCount(credential) === 3
      ? {
          registryCredential: {
            server: credential.server.trim(),
            username: credential.username.trim(),
            password: credential.password,
          },
        }
      : {}),
  };
}
