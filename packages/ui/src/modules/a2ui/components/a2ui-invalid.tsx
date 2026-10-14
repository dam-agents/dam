import { useState } from "react";

import { Callout } from "@/components/ui/callout";
import { DisclosureToggle } from "@/components/ui/disclosure";

import type { RendererError } from "../lib/conversation.js";
import { formatRendererMessage } from "../lib/prompts.js";
import { A2UI_VERSION } from "../lib/schema.js";
import { A2uiSendButton } from "./a2ui-send-button.js";

const TEXT_INSTEAD = "The form didn't work. Ask me in plain text instead.";

function errorPrompt(error: RendererError): string {
  return formatRendererMessage({
    version: A2UI_VERSION,
    error: { ...error, surfaceId: error.surfaceId ?? "(unknown)" },
  });
}

interface Props {
  errors: readonly RendererError[];
  source: string;
}

export function A2uiInvalid({ errors, source }: Props) {
  const [showSource, setShowSource] = useState(false);
  return (
    <Callout
      tone="warning"
      size="sm"
      className="not-prose flex flex-col gap-2 text-sm"
    >
      <p className="font-medium text-foreground">
        The agent sent UI this app can&apos;t fully show.
      </p>
      <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        {errors.map((error, index) => (
          <li key={index}>
            {error.code}: {error.message}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <A2uiSendButton
          prompt={errors.map(errorPrompt).join("\n")}
          label="Send the error to the agent"
        />
        <A2uiSendButton
          prompt={TEXT_INSTEAD}
          label="Ask me in text instead"
          withCapabilities={false}
        />
      </div>
      <DisclosureToggle
        open={showSource}
        onToggle={() => setShowSource((open) => !open)}
        chevronSize={12}
        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        Source
      </DisclosureToggle>
      {showSource && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {source.trim()}
        </pre>
      )}
    </Callout>
  );
}
