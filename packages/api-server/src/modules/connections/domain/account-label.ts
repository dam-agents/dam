import type { Connection } from "api-server-api";

export const ACCOUNT_LABEL_INPUT_KEY = "accountLabel";

export function accountLabelOf(conn: Connection): string | undefined {
  const label = conn.inputs[ACCOUNT_LABEL_INPUT_KEY];
  return typeof label === "string" && label.length > 0 ? label : undefined;
}
