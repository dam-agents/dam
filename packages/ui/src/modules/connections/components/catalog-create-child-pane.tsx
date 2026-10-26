import type { ConnectionView } from "api-server-api";

import { createChildHeading } from "../lib/connection-hierarchy.js";
import { CatalogPaneHeader } from "./catalog-pane-header.js";
import { ConnectionCreateChildForm } from "./connection-create-child-form.js";

export function CatalogCreateChildPane({
  parent,
  onBack,
  onCreated,
}: {
  parent: ConnectionView;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const heading = createChildHeading(parent);
  return (
    <>
      <CatalogPaneHeader
        title={heading.title}
        subtitle={heading.subtitle}
        onBack={onBack}
      />
      <ConnectionCreateChildForm
        parent={parent}
        onCreated={onCreated}
        onCancel={onBack}
        layout={(fields, footer) => (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{fields}</div>
            <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
              {footer}
            </div>
          </>
        )}
      />
    </>
  );
}
