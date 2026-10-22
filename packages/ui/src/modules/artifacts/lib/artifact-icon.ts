import {
  type CarbonIconType,
  DocumentAttachment,
  Folders,
} from "@carbon/icons-react";
import { createElement, forwardRef } from "react";

import { useNewLayout } from "../../features/hooks/use-new-layout.js";

export const ArtifactIcon: CarbonIconType = forwardRef((props, ref) =>
  createElement(useNewLayout() ? DocumentAttachment : Folders, {
    ...props,
    ref,
  }),
);
