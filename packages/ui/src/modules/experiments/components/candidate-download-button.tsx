import { Download } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { downloadCandidate } from "../lib/candidate-download.js";

interface Props {
  experimentId: string;
  runId: string;
  candidateRef: string;
}

export function CandidateDownloadButton({
  experimentId,
  runId,
  candidateRef,
}: Props) {
  const [pending, setPending] = useState(false);
  const filename = candidateRef.split("/").pop() ?? "candidate";

  async function handleClick() {
    setPending(true);
    try {
      await downloadCandidate(experimentId, runId);
    } catch (err) {
      emitToast({
        kind: "error",
        message: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="link"
      size="xs"
      disabled={pending}
      onClick={handleClick}
      className="font-mono"
    >
      <Download size={14} />
      {filename}
    </Button>
  );
}
