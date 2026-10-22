import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import { HelpTip } from "../../spend/components/help-tip.js";
import { durationSegments, formatTokens } from "../lib/format.js";

function Sub({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}

export function Stat({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 p-4">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {help && <HelpTip content={help} />}
      </dt>
      <dd className="mt-1.5 font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {children}
      </dd>
    </Card>
  );
}

export function TokensInOut({
  tokensIn,
  tokensOut,
}: {
  tokensIn: number;
  tokensOut: number;
}) {
  return (
    <>
      {formatTokens(tokensIn)}
      <wbr />
      <Sub>
        <span className="whitespace-nowrap">
          <span className="mx-1">/</span>
          {formatTokens(tokensOut)}
        </span>
      </Sub>
    </>
  );
}

export function Duration({ ms }: { ms: number }) {
  return (
    <>
      {durationSegments(ms).map((segment, i) =>
        segment.unit ? (
          <Sub key={i}>{segment.text}</Sub>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
