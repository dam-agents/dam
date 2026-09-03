import type { ConnectionTemplateView } from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";

import { TemplateCreateFormBody } from "../forms/template-create-form-body.js";
import {
  type CatalogProviderGroup,
  templateCreateHeading,
  templateMethodCopy,
} from "../lib/catalog-providers.js";
import { CatalogPaneHeader } from "./catalog-pane-header.js";

interface Props {
  group: CatalogProviderGroup;
  oauthReturnView?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}

export function CatalogCreatePane({
  group,
  oauthReturnView,
  onBack,
  onCreated,
}: Props) {
  const templates = group.templates;
  const [selectedId, setSelectedId] = useState(templates[0]?.id);
  const [editedName, setEditedName] = useState<string>();

  const multiMethod = templates.length > 1;
  const template = multiMethod
    ? templates.find((t) => t.id === selectedId)
    : templates[0];

  const heading = multiMethod
    ? { title: `Connect ${group.provider.title}` }
    : template
      ? templateCreateHeading(template)
      : undefined;
  if (!heading) return null;

  const body = (fields: ReactNode) =>
    multiMethod ? (
      <MethodRadioList
        templates={templates}
        selectedId={template?.id}
        onSelect={setSelectedId}
        fields={fields}
      />
    ) : (
      fields
    );

  if (!template) {
    return (
      <>
        <CatalogPaneHeader title={heading.title} onBack={onBack} />
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{body(null)}</div>
        <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
          <Button variant="outline" onClick={onBack}>
            Cancel
          </Button>
          <Button disabled data-testid="connection-create-submit">
            Create
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <CatalogPaneHeader
        title={heading.title}
        subtitle={heading.subtitle}
        onBack={onBack}
      />
      <TemplateCreateFormBody
        key={template.id}
        template={template}
        popupOAuth
        oauthReturnView={oauthReturnView}
        onCreated={onCreated}
        onCancel={onBack}
        initialName={editedName}
        onNameChange={setEditedName}
        layout={(fields, footer) => (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {body(fields)}
            </div>
            <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
              {footer}
            </div>
          </>
        )}
      />
    </>
  );
}

function MethodRadioList({
  templates,
  selectedId,
  onSelect,
  fields,
}: {
  templates: readonly ConnectionTemplateView[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  fields: ReactNode;
}) {
  return (
    <RadioGroup
      value={selectedId ?? ""}
      onValueChange={onSelect}
      className="gap-4"
    >
      {templates.map((t) => {
        const copy = templateMethodCopy(t);
        const selected = t.id === selectedId;
        return (
          <RadioGroupCard
            key={t.id}
            value={t.id}
            label={copy.title}
            description={selected ? copy.description : undefined}
            testId={`catalog-option-${t.id}`}
          >
            {selected ? fields : null}
          </RadioGroupCard>
        );
      })}
    </RadioGroup>
  );
}
