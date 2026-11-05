import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What an assistant's token may do to the install,
 * decided once per tRPC mutation so no procedure can be reached without a
 * verdict. `create` adds something new and leaves what exists as it was, so it
 * runs at once; `change` alters or removes something that already exists, so it
 * waits for the owner's approval; `refuse` is a decision this platform gives to
 * the person and an agent never makes — verdicts on approvals, API keys, the
 * Terms, feature flags, a person's own UI state, and the surfaces no CLI verb
 * reaches.
 */
export type AgentChangeKind = "create" | "change" | "refuse";

const AGENT_CHANGE_KINDS: Readonly<Record<string, AgentChangeKind>> = {
  "agents.bindSlackChannel": "change",
  "agents.bindTelegramChat": "change",
  "agents.connectSlack": "change",
  "agents.create": "create",
  "agents.delete": "change",
  "agents.disconnectSlack": "change",
  "agents.leave": "change",
  "agents.restart": "change",
  "agents.retryWorkspace": "change",
  "agents.setCredentialInjection": "change",
  "agents.setDisabled": "change",
  "agents.setEditors": "refuse",
  "agents.setEnv": "change",
  "agents.setSecretRef": "change",
  "agents.setWhisper": "change",
  "agents.sleep": "change",
  "agents.unbindTelegramChat": "change",
  "agents.update": "change",
  "agents.upgrade": "change",
  "agents.wake": "create",

  "apiKeys.create": "refuse",
  "apiKeys.revoke": "refuse",

  "approvals.approveHost": "refuse",
  "approvals.approveOnce": "refuse",
  "approvals.approvePermanent": "refuse",
  "approvals.denyForever": "refuse",
  "approvals.dismiss": "refuse",
  "approvals.dismissMany": "refuse",

  "artifactLibrary.callAgentApi": "change",
  "artifactLibrary.create": "create",
  "artifactLibrary.createFolder": "create",
  "artifactLibrary.createUploadUrl": "create",
  "artifactLibrary.delete": "change",
  "artifactLibrary.deleteFolder": "change",
  "artifactLibrary.sendPrompt": "change",
  "artifactLibrary.setSharing": "change",
  "artifactLibrary.update": "change",
  "artifactLibrary.updateFolder": "change",

  "assistants.dismissNotice": "change",
  "attention.dismiss": "change",

  "budgets.users.remove": "refuse",
  "budgets.users.set": "refuse",

  "caseStudies.release": "change",
  "channels.setChoice": "change",
  "chatForms.setPreferences": "change",

  "connections.cancelSecretRequest": "refuse",
  "connections.checkCredential": "refuse",
  "connections.create": "refuse",
  "connections.createFromParent": "refuse",
  "connections.delete": "refuse",
  "connections.discoverMcp": "refuse",
  "connections.probeClusterCa": "refuse",
  "connections.probeGitHubAppInstallation": "refuse",
  "connections.probeGitHubAppInstallationForConnection": "refuse",
  "connections.probeGitHubUserTokenForConnection": "refuse",
  "connections.recheckProviderKeys": "refuse",
  "connections.requestSecret": "refuse",
  "connections.setAgentConnections": "change",
  "connections.setPreferredConnection": "change",
  "connections.startOAuth": "refuse",
  "connections.submitSecretRequest": "refuse",
  "connections.update": "refuse",
  "connections.updateAgentConnections": "change",
  "connections.updateGitHubAppScope": "refuse",
  "connections.updateGitHubUserTokenScope": "refuse",

  "costReviews.dismiss": "change",
  "costReviews.start": "create",

  "e2e.performFetch": "refuse",
  "e2e.setScript": "refuse",
  "e2e.slackAddMember": "refuse",
  "e2e.slackConnectWorkspace": "refuse",
  "e2e.slackEnableTokenRotation": "refuse",
  "e2e.slackFireCommand": "refuse",
  "e2e.slackFireMention": "refuse",
  "e2e.slackFireMessage": "refuse",
  "e2e.slackImportHelmToken": "refuse",
  "e2e.slackRenewTokens": "refuse",
  "e2e.slackResetOutbound": "refuse",
  "e2e.slackSetChannels": "refuse",
  "e2e.spawnInvocation": "refuse",

  "egressRules.applyPreset": "change",
  "egressRules.create": "change",
  "egressRules.restorePlatformRule": "change",
  "egressRules.revoke": "change",
  "egressRules.update": "change",

  "environments.delete": "change",
  "environments.extend": "change",
  "environments.setAgentMembers": "change",
  "environments.setMembers": "change",

  "features.setFlag": "refuse",

  "files.upload": "change",

  "gettingStarted.markAvatarPicked": "refuse",
  "gettingStarted.markUnlockSeen": "refuse",
  "gettingStarted.reset": "refuse",
  "gettingStarted.setDismissed": "refuse",

  "harnessConfig.clearSessionDefault": "change",
  "harnessConfig.rememberSessionPair": "change",
  "harnessConfig.set": "change",

  "invocations.stop": "change",

  "kbShares.create": "refuse",
  "kbShares.refresh": "refuse",
  "kbShares.resolveLink": "refuse",
  "kbShares.reveal": "refuse",
  "kbShares.revoke": "refuse",
  "kbShares.rotate": "refuse",
  "kbShares.setName": "refuse",

  "profiles.create": "create",
  "profiles.delete": "change",
  "profiles.setDefault": "change",
  "profiles.update": "change",

  "satellites.cancelJob": "refuse",
  "satellites.claim": "refuse",
  "satellites.claimFenced": "refuse",
  "satellites.connect": "refuse",
  "satellites.connectFenced": "refuse",
  "satellites.drain": "refuse",
  "satellites.drainFenced": "refuse",
  "satellites.grant": "change",
  "satellites.heartbeat": "refuse",
  "satellites.heartbeatFenced": "refuse",
  "satellites.remove": "change",
  "satellites.report": "refuse",
  "satellites.reportFenced": "refuse",
  "satellites.revoke": "change",

  "schedules.clearSessionChoices": "change",
  "schedules.createCron": "create",
  "schedules.createOnce": "create",
  "schedules.createRRule": "create",
  "schedules.delete": "change",
  "schedules.resetSession": "change",
  "schedules.runNow": "change",
  "schedules.toggle": "change",
  "schedules.updateCron": "change",
  "schedules.updateOnce": "change",
  "schedules.updateRRule": "change",

  "sidebarOrder.setAgents": "refuse",

  "skills.applyBatch": "change",
  "skills.createLocal": "create",
  "skills.deleteLocal": "change",
  "skills.install": "change",
  "skills.publish": "change",
  "skills.sets.applyToAgent": "change",
  "skills.sets.create": "create",
  "skills.sets.delete": "change",
  "skills.sources.create": "create",
  "skills.sources.delete": "change",
  "skills.sources.refresh": "change",
  "skills.sources.setHidden": "change",
  "skills.uninstall": "change",

  "spend.ceilings.set": "refuse",
  "spend.setLimit": "change",

  "starterKits.create": "create",
  "starterKits.skipUpdate": "change",
  "starterKits.startUpdate": "change",

  "terms.accept": "refuse",

  "usage.entryPointChosen": "refuse",
};

/* UNIT_BOUNDARY_DESCRIPTION: what makes a create a change after all — a new
 * Agent that already holds something of the owner's. A create that grants a
 * Connection (a kit's, or a named model provider, which the server turns into a
 * grant), names a shared Secret or brings a registry credential hands the new
 * Agent reach over the owner's credentials, so it waits like any other grant; a
 * plain create, whose provider the server picks from the caller's own default,
 * runs at once. */
const GRANT_CARRYING_CREATES = new Set(["agents.create", "starterKits.create"]);

function grantsAnything(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const create = input as {
    connectionIds?: unknown;
    secretRef?: unknown;
    registryCredential?: unknown;
    providerConnectionId?: unknown;
  };
  return (
    (Array.isArray(create.connectionIds) && create.connectionIds.length > 0) ||
    create.secretRef !== undefined ||
    create.registryCredential !== undefined ||
    create.providerConnectionId !== undefined
  );
}

export function agentChangeKind(
  path: string,
  input?: unknown,
): AgentChangeKind {
  if (GRANT_CARRYING_CREATES.has(path) && grantsAnything(input))
    return "change";
  // UNIT_BOUNDARY_DESCRIPTION: a mutation nobody classified waits for the owner rather than running, so a procedure added without a verdict fails safe.
  return AGENT_CHANGE_KINDS[path] ?? "change";
}

export function isClassifiedAgentChange(path: string): boolean {
  return AGENT_CHANGE_KINDS[path] !== undefined;
}

export const agentChangeProcedurePaths = (): readonly string[] =>
  Object.keys(AGENT_CHANGE_KINDS);

/* UNIT_BOUNDARY_DESCRIPTION: the arguments in full, never abbreviated — a field the owner cannot see is a field they did not approve. The gate bounds what can be filed at all, so this cannot grow without limit. */
function compact(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text === undefined ? "no arguments" : text;
}

/* UNIT_BOUNDARY_DESCRIPTION: the few changes whose bare procedure name says
 * nothing to a person; everything else reads as its own path. */
const CHANGE_TITLES: Readonly<Record<string, string>> = {
  "agents.delete": "Delete an Agent",
  "agents.restart": "Restart an Agent",
  "agents.sleep": "Put an Agent to sleep",
  "agents.setDisabled": "Disable or enable an Agent",
  "agents.update": "Change an Agent's settings",
  "agents.setEnv": "Change an Agent's environment variables",
  "agents.upgrade": "Upgrade an Agent's image",
  "agents.setEditors": "Change who may work on an Agent",
  "egressRules.applyPreset": "Replace an Agent's network rules",
  "egressRules.create": "Allow network access",
  "files.upload": "Write files into an Agent",
  "schedules.delete": "Delete a schedule",
  "schedules.runNow": "Run a scheduled task now",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner reads before deciding, and what the
 * CLI prints while it waits: the change in a person's words, and the exact
 * arguments it will run with — which is the only honest answer to "what will it
 * do" for a procedure no sentence can summarise.
 */
export function describeAgentChange(
  procedure: string,
  input: unknown,
): { title: string; detail: string } {
  return {
    title: CHANGE_TITLES[procedure] ?? procedure.replace(/\./g, " · "),
    detail: compact(input),
  };
}

export const pendingApprovalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
