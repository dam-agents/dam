import type { ComponentProps } from "react";

import { cn } from "../lib/cn.js";

export const Label = ({ className, ...props }: ComponentProps<"label">) => (
  <label
    className={cn("text-sm font-medium leading-none", className)}
    {...props}
  />
);
