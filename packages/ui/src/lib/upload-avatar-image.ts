import { authFetch } from "../auth.js";

// UNIT_BOUNDARY_DESCRIPTION: uploads one JPG or PNG to POST /api/avatars, which crops it to a 512 px square and stores it, and returns the image id of its answer (`image:<id>`). A refused or failed upload throws with the server's own message, so each caller words the toast or field error itself.
export async function uploadAvatarImage(file: File): Promise<string> {
  const res = await authFetch("/api/avatars", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as {
    avatar?: string;
    error?: string;
  };
  if (!res.ok || !body.avatar?.startsWith("image:"))
    throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.avatar.slice("image:".length);
}
