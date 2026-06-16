import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FormField } from "./form-field.js";

export function CardList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormField className={cn("flex flex-col gap-3", className)}>
      {children}
    </FormField>
  );
}
