import { damKeyName } from "api-server-api";

const REVOKE_BODY =
  "The key stops working immediately for every CLI and integration that uses it. To restore access, create a new key.";

/* UNIT_BOUNDARY_DESCRIPTION: the key the platform minted for the connection that drives this install is the one key a new key cannot replace — rotating that connection's key is, so its revoke says where. The key list does not say which connection holds a key, so the name `damKeyName` gives it is how this finds it; a brand rename leaves an older key with the generic text, and a key the owner typed that name for gets this one, both of which cost a sentence, never access. */
export function revokeKeyBody(keyName: string, brandName: string): string {
  return keyName === damKeyName(brandName)
    ? `The key stops working immediately for every CLI and integration that uses it, and every agent that holds the ${brandName} connection loses access. To restore it, open Settings › Connections and choose Rotate key.`
    : REVOKE_BODY;
}
