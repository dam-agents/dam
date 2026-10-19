import { type Db, connections as connectionsTable } from "db";

export async function readConnectionTemplateIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ templateId: connectionsTable.templateId })
    .from(connectionsTable);
  return rows.map((r) => r.templateId);
}
