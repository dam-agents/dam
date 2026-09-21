import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { type BindMessenger, BindPage } from "./bind-page.js";

interface Props {
  messenger: BindMessenger;
  title: string;
  children: ReactNode;
}

export function BindTerminalPage({ messenger, title, children }: Props) {
  return (
    <BindPage messenger={messenger} title={title} narrow>
      <div className="mt-6 flex flex-col items-start gap-6 text-sm text-muted-foreground">
        {children}
        <Button onClick={() => window.location.assign("/")}>
          Go to dashboard
        </Button>
      </div>
    </BindPage>
  );
}
