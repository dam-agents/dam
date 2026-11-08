import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useNativeLoginStatus } from "../../agents/api/native-login.js";
import { NativeLoginDialog } from "./native-login-dialog.js";

export function NativeLoginCard({
  agentId,
  maySignIn,
}: {
  agentId: string;
  maySignIn: boolean;
}) {
  const [loginSession, setLoginSession] = useState<string | null>(null);
  const status = useNativeLoginStatus(agentId, loginSession !== null);
  const state = !status.operable
    ? "asleep"
    : status.isError
      ? "unavailable"
      : status.isPending
        ? "checking"
        : (status.data?.state ?? "unavailable");
  const label = {
    asleep: "Agent asleep — sign-in status unavailable",
    unavailable: "Could not check sign-in",
    checking: "Checking ChatGPT sign-in…",
    "signed-in": "Signed in on this agent",
    "sign-in-required": "ChatGPT sign-in required",
  }[state];

  return (
    <div className="border-t border-border px-4 py-3 space-y-2">
      <p role="status" className="text-sm font-medium">
        {label}
      </p>
      <p className="text-sm text-muted-foreground">
        {state === "signed-in"
          ? "Saved ChatGPT login detected. Account access is checked when you send a message. Signing in again replaces this agent’s current login."
          : state === "asleep"
            ? "Wake this agent to check its ChatGPT sign-in."
            : state === "unavailable"
              ? "Make sure this agent is running the latest version, then check again."
              : "Each agent needs its own ChatGPT sign-in. Enabling the provider does not sign this agent in."}
      </p>
      <div className="flex flex-wrap gap-2">
        {maySignIn &&
          (state === "sign-in-required" || state === "signed-in") && (
            <Button
              size="sm"
              onClick={() => setLoginSession(crypto.randomUUID())}
            >
              {state === "signed-in" ? "Sign in again" : "Sign in to ChatGPT"}
            </Button>
          )}
        {status.operable && (
          <Button
            size="sm"
            variant="outline"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Check again
          </Button>
        )}
      </div>
      {!maySignIn && state === "sign-in-required" && (
        <p className="text-sm text-muted-foreground">
          Ask this agent’s owner to sign in.
        </p>
      )}
      {loginSession !== null && (
        <NativeLoginDialog
          key={loginSession}
          agentId={agentId}
          sessionId={loginSession}
          signedIn={state === "signed-in"}
          onRetry={() => setLoginSession(crypto.randomUUID())}
          onClose={() => {
            setLoginSession(null);
            void status.refetch();
          }}
        />
      )}
    </div>
  );
}
