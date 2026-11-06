import { LOGIN_TESTIMONIAL_LIMITS as LIMITS } from "api-server-api";
import { useId, useRef, useState } from "react";

import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Textarea } from "@/components/ui/textarea";

import { uploadAvatarImage } from "../../../lib/upload-avatar-image.js";
import type { TestimonialFields } from "../lib/draft.js";
import { LengthCount, lengthError } from "./length-hint.js";
import { TestimonialPhoto } from "./testimonial-photo.js";

type Fields = TestimonialFields;

const EMPTY: Fields = { name: "", role: "", quote: "", photoId: null };

// UNIT_BOUNDARY_DESCRIPTION: adds or edits one testimonial. Text is never cut: a field past its limit (the contract's LOGIN_TESTIMONIAL_LIMITS) says by how much and keeps Save off, and the quote shows its count as it is typed. A photo uploads as soon as it is picked, through the avatar upload, which crops it to a square; its refusal shows under the photo. Save stores the testimonial at once, and the dialog closes once it is stored.
export function TestimonialDialog({
  testimonial,
  saving,
  onSave,
  onClose,
}: {
  testimonial: TestimonialFields | null;
  saving: boolean;
  onSave: (fields: Fields) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(testimonial ?? EMPTY);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const quoteCountId = useId();
  const errors = {
    name: lengthError("The name", fields.name, LIMITS.name),
    role: lengthError("The role", fields.role, LIMITS.role),
    quote: lengthError("The quote", fields.quote, LIMITS.quote),
  };
  const set = (patch: Partial<Fields>) =>
    setFields((f) => ({ ...f, ...patch }));
  const canSave =
    fields.name.trim() !== "" &&
    fields.quote.trim() !== "" &&
    !errors.name &&
    !errors.role &&
    !errors.quote &&
    !uploading &&
    !saving;

  async function pickPhoto(file: File) {
    setUploading(true);
    setPhotoError(undefined);
    try {
      set({ photoId: await uploadAvatarImage(file) });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal size="sm" onClose={saving ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          onSave({
            name: fields.name.trim(),
            role: fields.role.trim(),
            quote: fields.quote.trim(),
            photoId: fields.photoId,
          });
        }}
      >
        <DialogHeader
          title={testimonial ? "Edit testimonial" : "Add testimonial"}
          subtitle="Shown on the login page within a minute of saving."
          onClose={onClose}
          closeDisabled={saving}
        />
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <SectionLabel>Photo</SectionLabel>
            <div className="flex items-center gap-3">
              <TestimonialPhoto
                name={fields.name}
                photoId={fields.photoId}
                className="size-12"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading
                  ? "Uploading…"
                  : fields.photoId
                    ? "Replace photo"
                    : "Upload photo"}
              </Button>
              {fields.photoId && !uploading && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ photoId: null })}
                >
                  Remove photo
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void pickPhoto(file);
                }}
              />
            </div>
            <FormError message={photoError} />
          </div>
          <FormField label="Name" error={errors.name}>
            <Input
              autoFocus
              variant={errors.name ? "invalid" : "standard"}
              aria-invalid={errors.name !== undefined}
              value={fields.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </FormField>
          <FormField
            label="Role"
            hint="Optional, such as their job title."
            error={errors.role}
          >
            <Input
              variant={errors.role ? "invalid" : "standard"}
              aria-invalid={errors.role !== undefined}
              value={fields.role}
              onChange={(event) => set({ role: event.target.value })}
            />
          </FormField>
          <FormField
            label="Quote"
            error={errors.quote}
            hint={
              <span className="flex items-start justify-between gap-3">
                <span id={hintId}>
                  Write {"{brand}"} where the quote names the product.
                </span>
                <LengthCount
                  id={quoteCountId}
                  value={fields.quote}
                  max={LIMITS.quote}
                />
              </span>
            }
          >
            <Textarea
              rows={7}
              variant={errors.quote ? "invalid" : "standard"}
              aria-invalid={errors.quote !== undefined}
              aria-describedby={`${hintId} ${quoteCountId}`}
              value={fields.quote}
              onChange={(event) => set({ quote: event.target.value })}
            />
          </FormField>
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelDisabled={saving}
          label="Save"
          pendingLabel={uploading ? "Uploading…" : "Saving…"}
          pending={uploading || saving}
          disabled={!canSave}
        />
      </form>
    </Modal>
  );
}
