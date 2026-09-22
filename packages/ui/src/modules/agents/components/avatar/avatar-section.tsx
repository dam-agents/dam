import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { AvatarPicker } from "./avatar-picker.js";

interface Props {
  value: string;
  onChange: (seed: string) => void;
  disabled?: boolean;
}

export function AvatarSection({ value, onChange, disabled }: Props) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Avatar</SectionLabel>
      <Inset>
        <AvatarPicker value={value} onChange={onChange} disabled={disabled} />
      </Inset>
    </section>
  );
}
