import {
  providerKeyCheckSchema,
  type Connection,
  type ProviderKeyCheck,
} from "api-server-api";

export const KEY_CHECK_INPUT_KEY = "keyCheck";

export function keyCheckOf(conn: Connection): ProviderKeyCheck | undefined {
  const parsed = providerKeyCheckSchema.safeParse(
    conn.inputs[KEY_CHECK_INPUT_KEY],
  );
  return parsed.success ? parsed.data : undefined;
}
