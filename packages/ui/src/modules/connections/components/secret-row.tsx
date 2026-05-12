import {
  Close as X,
  Edit as Pencil,
  Password as Lock,
} from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import type { SecretView } from "../../../types.js";
import { useDeleteSecret } from "../../secrets/api/mutations.js";

interface Props {
  secret: SecretView;
  animationDelayMs: number;
  onEdit: (secret: SecretView) => void;
}

export function SecretRow({ secret, animationDelayMs, onEdit }: Props) {
  const { id, name, hostPattern, pathPattern, envMappings } = secret;
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteSecret = useDeleteSecret();

  const handleRemove = async () => {
    if (!(await showConfirm(`Delete "${name}"?`, "Delete Secret"))) return;
    deleteSecret.mutate({ id });
  };

  return (
    <Card
      className="flex items-center gap-4 px-5 py-4 transition-shadow hover:shadow-md anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center text-foreground/80">
        <Lock size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-foreground truncate">{name}</div>
        <div className="text-[12px] font-mono text-muted-foreground truncate">
          {hostPattern}
          {pathPattern && <span className="text-foreground/80">{pathPattern}</span>}
          {envMappings && envMappings.length > 0 && (
            <>
              {" · "}
              <span className="text-primary">
                {envMappings.map((m) => m.envName).join(", ")}
              </span>
            </>
          )}
        </div>
      </div>
      <Badge variant="secondary" className="shrink-0 uppercase tracking-[0.03em]">
        Secret
      </Badge>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onEdit(secret)}
        className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary"
        title="Edit"
      >
        <Pencil size={13} />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={handleRemove}
        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:border-destructive"
        title="Remove"
      >
        <X size={13} />
      </Button>
    </Card>
  );
}
