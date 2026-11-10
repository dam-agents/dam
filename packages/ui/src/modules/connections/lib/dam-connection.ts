import { DAM_TEMPLATE_ID } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the web app says about the Connection that
 * lets an Agent drive this install as its owner. Every surface that grants it,
 * shares the Agent with editors, or binds it to a chat says the same thing:
 * whoever drives the Agent acts as the owner.
 */
export const isDamConnection = (connection: { templateId: string }): boolean =>
  connection.templateId === DAM_TEMPLATE_ID;

/* UNIT_BOUNDARY_DESCRIPTION: the Connection that drives this install is on offer only while the person's own flag says so: with it off the catalog offers neither the template nor a grant of the Connection an owner already holds, while that Connection, its grants, its rotation and its deletion keep working. */
export const damConnectionOffered = (
  flags: { damConnection?: boolean } | undefined,
): boolean => flags?.damConnection === true;

export function canGrantConnection(
  offered: boolean,
  connection: { templateId: string },
): boolean {
  return offered || !isDamConnection(connection);
}

/* UNIT_BOUNDARY_DESCRIPTION: whether an Agent holds it, as far as a page can tell: `unknown` is a library that has not arrived or a read that failed, and every warning treats it as held, because a warning that is wrong costs a sentence and one that is missing costs an account. */
export type DamHold = "held" | "not-held" | "unknown";

export const damHoldWarns = (hold: DamHold): boolean => hold !== "not-held";

export function damActsAsYou(brand: string): string {
  return `Acts as you on ${brand}`;
}

export function damAudienceSentence(brand: string, audience: string): string {
  return `This agent holds the ${brand} connection, so ${audience} can act as you on ${brand}.`;
}

export function damGrantSentence(brand: string): string {
  return `This lets the agent act as you on ${brand}, and anyone who can drive it too.`;
}

/* UNIT_BOUNDARY_DESCRIPTION: what the confirmation before a grant says when the Connection being granted is the one that drives this install. A Connection the Agent already holds is a different warning, said by its own sentence. */
export function damPreGrantSentence(
  brand: string,
  connection: { templateId?: string } | undefined,
): string | null {
  return connection?.templateId === DAM_TEMPLATE_ID
    ? damGrantSentence(brand)
    : null;
}
