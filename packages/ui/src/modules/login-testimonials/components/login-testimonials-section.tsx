import { Add } from "@carbon/icons-react";
import { LOGIN_TESTIMONIALS_MAX } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AddRow, ListSection } from "@/components/ui/list-section";

import { useStore } from "../../../store.js";
import { useSaveLoginTestimonials } from "../api/mutations.js";
import { useLoginTestimonials } from "../api/queries.js";
import {
  type DraftTestimonial,
  moved,
  sameTestimonials,
  toDraft,
  toSaveInput,
} from "../lib/draft.js";
import { TestimonialDialog } from "./testimonial-dialog.js";
import { TestimonialRow } from "./testimonial-row.js";

type DialogTarget = { index: number | null } | null;

// UNIT_BOUNDARY_DESCRIPTION: the operator's card for the quotes the login page shows. Adding, editing, reordering and removing change an unsaved copy of the list; Save sends the whole list at once and Cancel drops the copy, so the login page never shows a half-edited list. The page picks up a save within a minute.
export function LoginTestimonialsSection() {
  const { data: saved = [], isLoading, isError } = useLoginTestimonials();
  const save = useSaveLoginTestimonials();
  const showConfirm = useStore((s) => s.showConfirm);
  const [edited, setEdited] = useState<DraftTestimonial[] | null>(null);
  const [dialog, setDialog] = useState<DialogTarget>(null);
  const list = edited ?? saved.map(toDraft);
  const dirty = edited !== null && !sameTestimonials(edited, saved);
  const full = list.length >= LOGIN_TESTIMONIALS_MAX;

  async function remove(index: number) {
    const ok = await showConfirm(
      <p>
        <span className="font-semibold text-foreground">
          {list[index]!.name}
        </span>{" "}
        leaves the list. The login page changes once you save.
      </p>,
      "Remove testimonial?",
      { kind: "destructive", confirmLabel: "Remove" },
    );
    if (ok) setEdited(list.filter((_, i) => i !== index));
  }

  return (
    <>
      <ListSection
        label="Login page testimonials"
        description="Quotes from users, shown on the login page in this order. A save reaches the page within a minute."
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
        footer={
          dirty && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    { testimonials: toSaveInput(list) },
                    { onSuccess: () => setEdited(null) },
                  )
                }
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => setEdited(null)}
              >
                Cancel
              </Button>
            </div>
          )
        }
      >
        {list.map((t, i) => (
          <TestimonialRow
            key={t.key}
            testimonial={t}
            first={i === 0}
            last={i === list.length - 1}
            disabled={save.isPending}
            onEdit={() => setDialog({ index: i })}
            onMove={(by) => setEdited(moved(list, i, by))}
            onRemove={() => void remove(i)}
          />
        ))}
      </ListSection>

      {dialog && (
        <TestimonialDialog
          testimonial={dialog.index === null ? null : list[dialog.index]!}
          onClose={() => setDialog(null)}
          onDone={(fields) => {
            setEdited(
              dialog.index === null
                ? [...list, toDraft(fields)]
                : list.map((t, i) =>
                    i === dialog.index ? { ...t, ...fields } : t,
                  ),
            );
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
