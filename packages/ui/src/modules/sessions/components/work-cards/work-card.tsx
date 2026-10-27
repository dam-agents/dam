import type { WorkPart } from "../../../../types.js";
import { BrowserCard } from "./browser-card.js";
import { ChangesCard } from "./changes-card.js";
import { EnvironmentCard } from "./environment-card.js";
import { ProcessCard } from "./process-card.js";

export function WorkCard({ part }: { part: WorkPart }) {
  switch (part.tool) {
    case "changes":
      return <ChangesCard part={part} />;
    case "process":
      return <ProcessCard part={part} />;
    case "browser":
      return <BrowserCard part={part} />;
    case "environment":
      return <EnvironmentCard part={part} />;
  }
}
