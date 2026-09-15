import type { Db } from "db";
import { slackInstalls, eq, sql } from "db";

export type SlackCredentialState = "active" | "rejected";

export interface SlackInstall {
  teamId: string;
  teamName: string | null;
  secretPath: string;
  secretField: string;
  installedBy: string | null;
  credentialState: SlackCredentialState;
}

function toInstall(row: typeof slackInstalls.$inferSelect): SlackInstall {
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    secretPath: row.secretPath,
    secretField: row.secretField,
    installedBy: row.installedBy,
    credentialState: row.credentialState === "rejected" ? "rejected" : "active",
  };
}

export function findSlackInstall(db: Db) {
  return async (teamId: string): Promise<SlackInstall | null> => {
    const rows = await db
      .select()
      .from(slackInstalls)
      .where(eq(slackInstalls.teamId, teamId))
      .limit(1);
    return rows.length === 0 ? null : toInstall(rows[0]);
  };
}

export function listSlackInstalls(db: Db) {
  return async (): Promise<SlackInstall[]> => {
    const rows = await db.select().from(slackInstalls);
    return rows.map(toInstall);
  };
}

export function upsertSlackInstall(db: Db) {
  return async (install: {
    teamId: string;
    teamName: string | null;
    secretPath: string;
    secretField: string;
    installedBy: string | null;
  }): Promise<void> => {
    await db
      .insert(slackInstalls)
      .values({ ...install, credentialState: "active" })
      .onConflictDoUpdate({
        target: slackInstalls.teamId,
        set: {
          teamName: install.teamName,
          secretPath: install.secretPath,
          secretField: install.secretField,
          installedBy: install.installedBy,
          credentialState: "active",
          updatedAt: sql`now()`,
        },
      });
  };
}

export function setSlackCredentialState(db: Db) {
  return async (teamId: string, state: SlackCredentialState): Promise<void> => {
    await db
      .update(slackInstalls)
      .set({ credentialState: state, updatedAt: sql`now()` })
      .where(eq(slackInstalls.teamId, teamId));
  };
}
