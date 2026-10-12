import type { CarbonIconType } from "@carbon/icons-react";
import {
  Book,
  ChevronRight,
  Document,
  Launch,
  LogoGithub,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { LIST_ROW } from "@/components/ui/list-section";
import { PageHeader } from "@/components/ui/page-header";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { DOCS_URL, SOURCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { AppVersionRow } from "./app-version-row.js";

const ROW = cn(
  LIST_ROW,
  "w-full text-left transition-colors hover:bg-muted/40",
);

export function AboutTab() {
  const setView = useStore((s) => s.setView);
  const { name } = getBrand();
  return (
    <div>
      <PageHeader
        title={`About ${name}`}
        description="Documentation, source code and terms for this installation."
      />
      <Card className="divide-y divide-border overflow-hidden">
        <a href={DOCS_URL} {...externalLinkProps} className={ROW}>
          <AboutRowBody
            icon={Book}
            title="Documentation"
            description="Guides and reference for using agents."
            external
          />
        </a>
        <a href={SOURCE_URL} {...externalLinkProps} className={ROW}>
          <AboutRowBody
            icon={LogoGithub}
            title="Source code"
            description="The repository on GitHub."
            external
          />
        </a>
        <button type="button" onClick={() => setView("terms")} className={ROW}>
          <AboutRowBody
            icon={Document}
            title="Terms of Use"
            description="The terms you accepted to use this installation."
          />
        </button>
      </Card>
      <AppVersionRow />
    </div>
  );
}

function AboutRowBody({
  icon: Icon,
  title,
  description,
  external = false,
}: {
  icon: CarbonIconType;
  title: string;
  description: ReactNode;
  external?: boolean;
}) {
  const Trailing = external ? Launch : ChevronRight;
  return (
    <>
      <Icon size={20} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-md font-medium text-foreground">
          {title}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <Trailing size={16} className="shrink-0 text-muted-foreground" />
    </>
  );
}
