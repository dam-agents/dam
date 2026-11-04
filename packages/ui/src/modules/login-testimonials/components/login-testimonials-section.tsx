import { Add } from "@carbon/icons-react";
import { LOGIN_TESTIMONIALS_MAX } from "api-server-api";
import { useState } from "react";

import { AddRow, ListSection } from "@/components/ui/list-section";

import { useStore } from "../../../store.js";
import { useSaveLoginTestimonials } from "../api/mutations.js";
import { useLoginTestimonials } from "../api/queries.js";
import { moved, type TestimonialFields, toFields } from "../lib/draft.js";
import { TestimonialDialog } from "./testimonial-dialog.js";
import { TestimonialRow } from "./testimonial-row.js";

type DialogTarget = { index: number | null } | null;

// UNIT_BOUNDARY_DESCRIPTION: the operator's card for the quotes the login page shows. Every change saves at once: the dialog's Save, a move and a confirmed removal each send the whole list with that one change, so nothing is left unsaved when the page reloads, and the login page shows the change within a minute.
export function LoginTestimonialsSection() {
  const { data: saved = [], isLoading, isError } = useLoginTestimonials();
  const save = useSaveLoginTestimonials();
  const showConfirm = useStore((s) => s.showConfirm);
  const [dialog, setDialog] = useState<DialogTarget>(null);
  const list = saved.map(toFields);
  const full = list.length >= LOGIN_TESTIMONIALS_MAX;

  function saveList(next: TestimonialFields[], onSaved?: () => void) {
    save.mutate({ testimonials: next }, { onSuccess: onSaved });
  }

  async function remove(index: number) {
    const ok = await showConfirm(
      <p>
        <span className="font-semibold text-foreground">
          {list[index]!.name}
        </span>{" "}
        no longer shows on the login page.
      </p>,
      "Remove testimonial?",
      { kind: "destructive", confirmLabel: "Remove" },
    );
    if (ok) saveList(list.filter((_, i) => i !== index));
  }

  return (
    <>
      <ListSection
        label="Login page testimonials"
        description="Quotes from users, shown on the login page in this order. A change reaches the page within a minute."
        loading={isLoading}
        error={isError && "Couldn't load the testimonials."}
        isEmpty={list.length === 0}
        empty="No testimonials: the login page leaves the section out."
        onNew={full ? undefined : () => setDialog({ index: null })}
        newLabel="Add testimonial"
        addRow={
          !full && (
            <AddRow
              onClick={() => setDialog({ index: null })}
              disabled={save.isPending}
            >
              <Add size={20} className="shrink-0" />
              <p className="text-md font-medium text-foreground">
                Add testimonial
              </p>
            </AddRow>
          )
        }
      >
        {list.map((t, i) => (
          <TestimonialRow
            key={`${i}-${t.name}`}
            testimonial={t}
            first={i === 0}
            last={i === list.length - 1}
            disabled={save.isPending}
            onEdit={() => setDialog({ index: i })}
            onMove={(by) => saveList(moved(list, i, by))}
            onRemove={() => void remove(i)}
          />
        ))}
      </ListSection>

      {dialog && (
        <TestimonialDialog
          testimonial={dialog.index === null ? null : list[dialog.index]!}
          saving={save.isPending}
          onClose={() => setDialog(null)}
          onSave={(fields) =>
            saveList(
              dialog.index === null
                ? [...list, fields]
                : list.map((t, i) => (i === dialog.index ? fields : t)),
              () => setDialog(null),
            )
          }
        />
      )}
    </>
  );
}
