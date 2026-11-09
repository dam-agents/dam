import { DAM_TEMPLATE_ID } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the web app says about the Connection that
 * lets an Agent drive this install as its owner. Every surface that grants it,
 * shares the Agent with editors, or binds it to a chat says the same thing:
 * whoever drives the Agent acts as the owner.
 */
export const isDamConnection = (connection: { templateId: string }): boolean =>
  connection.templateId === DAM_TEMPLATE_ID;

export function damActsAsYou(brand: string): string {
  return `Acts as you on ${brand}`;
}

export function damAudienceSentence(brand: string, audience: string): string {
  return `This agent holds the ${brand} connection, so ${audience} can act as you on ${brand}.`;
}
