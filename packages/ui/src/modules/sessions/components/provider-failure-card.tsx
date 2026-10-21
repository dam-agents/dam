import type { Message } from "../../../types.js";
import { ProviderErrorCard } from "../../provider-status/components/provider-error-card.js";
import { useSessionTemplateId } from "../hooks/use-session-template-id.js";
import { UndeliveredActionsMenu } from "./undelivered-actions-menu.js";
import { type OnRetry, retryHandlerFor } from "./undelivered-notice.js";

interface Props {
  message: Message;
  agentId?: string;
  sessionId?: string;
  interrupted: boolean;
  onRetry?: OnRetry;
  onDelete?: (id: string) => void;
  className?: string;
}

export function ProviderFailureCard({
  message,
  agentId,
  sessionId,
  interrupted,
  onRetry,
  onDelete,
  className,
}: Props) {
  const templateId = useSessionTemplateId(agentId ?? null, sessionId ?? null);
  return (
    <ProviderErrorCard
      rawError={message.error?.message ?? ""}
      templateId={templateId}
      agentId={agentId ?? null}
      interrupted={interrupted}
      onRetry={onRetry && retryHandlerFor(message, onRetry)}
      menu={
        onDelete && (
          <UndeliveredActionsMenu message={message} onDelete={onDelete} />
        )
      }
      className={className}
    />
  );
}
