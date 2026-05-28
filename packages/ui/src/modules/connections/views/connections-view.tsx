import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { isCustomSecret, type SecretView } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { EditSecretDialog } from "../../secrets/components/edit-secret-dialog.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import { SecretRow } from "../components/secret-row.js";
import { ConnectionTemplatesSection } from "../components/templates-section.js";

export function ConnectionsView() {
  const {
    data: secrets = [],
    refetch: refetchSecrets,
    isPending: isPendingSecrets,
  } = useSecrets();

  const [showAddSecret, setShowAddSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);

  const customSecrets = secrets.filter(isCustomSecret);

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">
          Connections
        </h1>
        <button
          onClick={() => refetchSecrets()}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal shadow-brutal-sm"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        External services and credentials available to your agents. Injected
        into outbound HTTP requests — agents never see raw tokens.
      </p>

      <ConnectionTemplatesSection />

      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          Provider Secrets
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          Custom bearer tokens injected into outbound requests matching a host
          pattern.
        </p>

        {isPendingSecrets && <ListSkeleton />}

        {!isPendingSecrets && customSecrets.length === 0 && !showAddSecret && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No custom secrets yet
          </div>
        )}

        {!isPendingSecrets && (
          <div className="flex flex-col gap-3">
            {customSecrets.map((secret, i) => (
              <SecretRow
                key={secret.id}
                secret={secret}
                animationDelayMs={i * 50}
                onEdit={setEditingSecret}
              />
            ))}
          </div>
        )}

        {!isPendingSecrets && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddSecret(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5 shadow-brutal-accent"
            >
              <Plus size={14} /> Add Secret
            </button>
          </div>
        )}
      </section>

      {showAddSecret && (
        <CreateSecretForm
          onCancel={() => setShowAddSecret(false)}
          onCreated={() => setShowAddSecret(false)}
        />
      )}

      {editingSecret && (
        <EditSecretDialog
          secret={editingSecret}
          onClose={() => setEditingSecret(null)}
        />
      )}
    </div>
  );
}
