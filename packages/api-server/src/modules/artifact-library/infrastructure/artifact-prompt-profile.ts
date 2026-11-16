import {
  and,
  eq,
  isNotNull,
  libraryArtifacts as artifactsTable,
  or,
  type Db,
} from "db";
import type {
  ArtifactPromptChoiceRow,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import {
  choiceSlots,
  resolvedChoice,
} from "../../harness-config/domain/session-pair.js";
import type { RunBoundary } from "../../harness-config/domain/run-boundary.js";
import type { ProfileResolver } from "../../profiles/index.js";

export type ArtifactPromptPair = (
  agentId: string,
  artifactId: string,
) => Promise<
  | { pair: SessionPair | null }
  | { refused: { profile: string; detail: string } }
>;

export interface ArtifactPromptChoices {
  slots(artifactId: string, owner: string): Promise<SessionChoiceSlots | null>;
  forAgent(owner: string, agentId: string): Promise<ArtifactPromptChoiceRow[]>;
  set(input: {
    artifactId: string;
    owner: string;
    pair: SessionPair | null;
    references: SessionChoiceReferences;
  }): Promise<void>;
}

const NO_CHOICE: SessionChoiceSlots = {
  profileId: null,
  pair: null,
  platformSubagentProfileId: null,
  platformSubagentSettings: null,
};

const artifactRow = (artifactId: string, owner?: string) =>
  owner === undefined
    ? eq(artifactsTable.id, artifactId)
    : and(eq(artifactsTable.id, artifactId), eq(artifactsTable.owner, owner));

const slotColumns = {
  profileId: artifactsTable.promptProfileId,
  pair: artifactsTable.promptSessionPair,
  platformSubagentProfileId: artifactsTable.promptSubagentProfile,
  platformSubagentSettings: artifactsTable.promptSubagentSettings,
};

const toSlots = (row: {
  profileId: string | null;
  pair: unknown;
  platformSubagentProfileId: string | null;
  platformSubagentSettings: unknown;
}): SessionChoiceSlots => ({
  profileId: row.profileId,
  pair: row.pair as SessionPair | null,
  platformSubagentProfileId: row.platformSubagentProfileId,
  platformSubagentSettings: row.platformSubagentSettings as Record<
    string,
    string
  > | null,
});

async function readSlots(
  db: Db,
  artifactId: string,
  owner?: string,
): Promise<SessionChoiceSlots | null> {
  const [row] = await db
    .select(slotColumns)
    .from(artifactsTable)
    .where(artifactRow(artifactId, owner))
    .limit(1);
  return row ? toSlots(row) : null;
}

/** UNIT_BOUNDARY_DESCRIPTION: an interactive page's own pick, kept on its row in the two slots a Slack channel keeps and stored as the caller checked it; a pick with neither primary slot set clears every slot, so the page follows the agent's channel pair again. */
export function createArtifactPromptChoices(db: Db): ArtifactPromptChoices {
  return {
    slots: (artifactId, owner) => readSlots(db, artifactId, owner),

    async forAgent(owner, agentId) {
      const rows = await db
        .select({
          id: artifactsTable.id,
          title: artifactsTable.title,
          ...slotColumns,
        })
        .from(artifactsTable)
        .where(
          and(
            eq(artifactsTable.owner, owner),
            eq(artifactsTable.agentId, agentId),
            or(
              isNotNull(artifactsTable.promptProfileId),
              isNotNull(artifactsTable.promptSessionPair),
              isNotNull(artifactsTable.promptSubagentProfile),
              isNotNull(artifactsTable.promptSubagentSettings),
            ),
          ),
        );
      return rows.map(({ id, title, ...slots }) => ({
        id,
        title,
        choice: toSlots(slots),
      }));
    },

    async set({ artifactId, owner, pair, references }) {
      const slots =
        pair === null && !references.profileId
          ? NO_CHOICE
          : choiceSlots(pair, references);
      await db
        .update(artifactsTable)
        .set({
          promptProfileId: slots.profileId,
          promptSessionPair: slots.pair,
          ...(slots.platformSubagentProfileId !== undefined && {
            promptSubagentProfile: slots.platformSubagentProfileId,
            promptSubagentSettings: slots.platformSubagentSettings ?? null,
          }),
        })
        .where(artifactRow(artifactId, owner));
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: what a Session that a page's prompt opens runs on, resolved as a channel's pick is (D91): a profile that cannot run on the agent refuses the prompt with its reason, and no pick of its own is a null pair, which follows the agent's channel pair. */
export function createArtifactPromptPair(
  db: Db,
  resolveProfile: ProfileResolver,
  boundary?: RunBoundary,
): ArtifactPromptPair {
  return async (agentId, artifactId) => {
    const slots = await readSlots(db, artifactId);
    if (!slots) return { pair: null };
    const resolved = await resolvedChoice(slots, resolveProfile, agentId);
    if (resolved.refused) return { refused: resolved.refused };
    if (!resolved.pair || !boundary) return { pair: resolved.pair };
    return {
      pair: (await boundary.pair(agentId, resolved.pair)) ?? resolved.pair,
    };
  };
}
