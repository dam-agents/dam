import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";

import type { EgressPreset } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import {
  type RegistryCredential,
  registryFilledCount,
} from "../../sandboxes/components/registry-credential-section.js";
import {
  harnessForTemplateId,
  PI_TEMPLATE_ID,
} from "../../templates/lib/harness-templates.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  templateId: string | null;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
  vm: boolean;
}

export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.templateId !== null &&
    draft.providerRef !== null
  );
}

export function buildCreateAgentInput(
  draft: CreateAgentDraft,
): CreateAgentInput {
  if (!isCreateAgentDraftComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  const harness = harnessForTemplateId(draft.templateId);
  return {
    name: draft.name.trim(),
    templateId: draft.templateId!,
    ...(harness ? { harness } : {}),
    egressPreset: draft.egressPreset,
    ...(draft.vm ? { vm: true } : {}),
    appConnectionIds: [draft.providerRef!.id],
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
    draft.providerRef !== null &&
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
  const harness = harnessForTemplateId(draft.templateId);
  return {
    name: draft.name.trim(),
    egressPreset: "trusted",
    ...(harness && !image ? { harness } : {}),
    ...(draft.vm ? { vm: true } : {}),
    ...(draft.hibernationTimeoutMin === null
      ? {}
      : { hibernationTimeoutMin: draft.hibernationTimeoutMin }),
    ...(draft.requireConnectionAddress
      ? { requireConnectionAddress: true }
      : {}),
    ...(image ? { image } : { templateId: draft.templateId! }),
    appConnectionIds: [
      ...new Set([...draft.connectionIds, draft.providerRef!.id]),
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness and provider a create form starts
 * on. A person who holds the deployment's shared CurveBender starts on Pi and
 * that Connection, so a new agent runs on it without a choice; they can still
 * pick another. A kit keeps its own harness and provider, and until the
 * Connection list has answered the form waits, so it never saves the old
 * default as a choice first.
 */
export function curveBenderPreselection(
  kit: object | null,
  connections: readonly { templateId: string }[] | undefined,
): { harnessTemplateId?: string; settled: boolean; preferShared: boolean } {
  if (kit) return { settled: true, preferShared: false };
  if (!connections) return { settled: false, preferShared: false };
  return connections.some(
    (c) => c.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  )
    ? { harnessTemplateId: PI_TEMPLATE_ID, settled: true, preferShared: true }
    : { settled: true, preferShared: false };
}
