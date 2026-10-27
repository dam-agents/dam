import { parseKbShareString, SHARED_KB_TEMPLATE_ID } from "api-server-api";
import { useState } from "react";

import { useCreateConnection } from "../../connections/api/mutations.js";
import { useResolveKbShareLink } from "../api/kb-share-mutations.js";

export function useConnectKnowledgeBase() {
  const create = useCreateConnection();
  const resolve = useResolveKbShareLink();

  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = link.trim();
  const shareId = parseKbShareString(trimmed)?.shareId ?? null;
  const formatOk = shareId !== null;
  const busy = resolve.isPending || create.isPending;

  const setLinkValue = (value: string) => {
    setLink(value);
    setError(null);
  };

  const connect = (onConnected: (id: string) => void) => {
    setError(null);
    if (!shareId) {
      setError("That doesn't look like a share link.");
      return;
    }
    resolve.mutate(
      { shareString: trimmed },
      {
        onSuccess: ({ valid }) => {
          if (!valid) {
            setError(
              "That link is unknown or revoked — ask the owner for a current one.",
            );
            return;
          }
          create.mutate(
            {
              templateId: SHARED_KB_TEMPLATE_ID,
              name: `kb-${shareId}`,
              authKind: "header",
              value: trimmed,
            },
            {
              onSuccess: ({ id }) => {
                onConnected(id);
                setLink("");
              },
            },
          );
        },
      },
    );
  };

  return {
    link,
    setLink: setLinkValue,
    error,
    formatOk,
    trimmed,
    busy,
    connect,
  };
}
