import {
  ArrowLeft,
  ArrowRight,
  Close,
  ErrorFilled,
  Globe,
  OverflowMenuVertical,
  Renew,
} from "@carbon/icons-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { useBrowserStream } from "../hooks/use-browser-stream.js";
import {
  addressUrl,
  devicePoint,
  FOCUS_RELEASE_KEY,
  heldButton,
  keyboardInput,
  modifiers,
  mouseButton,
} from "../lib/stream.js";

const SIGN_IN_NOTICE_KEY = "platform.browserPanel.signInNoticeSeen";

interface Props {
  agentId: string;
  agentName: string;
}

export function DockedBrowserPanel({ agentId, agentName }: Props) {
  const close = useStore((s) => s.setOpenBrowser);
  const showConfirm = useStore((s) => s.showConfirm);
  const openRequestId = useStore((s) => s.browserOpenRequest?.id);
  const takeOpenRequest = useStore((s) => s.takeBrowserOpenRequest);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const pendingMove = useRef<object | null>(null);
  const moveFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    },
    [],
  );
  const stream = useBrowserStream(agentId, canvasRef);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(() =>
    readPersistedFlag(SIGN_IN_NOTICE_KEY, false),
  );

  useEffect(() => {
    if (!editing)
      setAddress(stream.pageUrl === "about:blank" ? "" : stream.pageUrl);
  }, [stream.pageUrl, editing]);

  const { navigate } = stream;
  useEffect(() => {
    const request = takeOpenRequest();
    if (request) navigate(request.url);
  }, [openRequestId, takeOpenRequest, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = addressUrl(address);
    if (!url) return;
    stream.navigate(url);
    setEditing(false);
    canvasRef.current?.focus();
  };

  const clearData = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { confirmLabel: "Clear" },
    );
    if (ok) stream.clearData();
  };

  const pointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const device = stream.device();
    if (!device) return null;
    return devicePoint(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      {
        width: device.deviceWidth,
        height: device.deviceHeight,
      },
    );
  };

  const mouseMessage = (
    eventType: "mousePressed" | "mouseReleased" | "mouseMoved",
    e: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    const at = pointer(e);
    if (!at) return null;
    return {
      type: "input_mouse",
      eventType,
      ...at,
      button:
        eventType === "mouseMoved"
          ? heldButton(e.buttons)
          : mouseButton(e.button),
      clickCount: eventType === "mouseMoved" ? 0 : e.detail,
      modifiers: modifiers(e),
    };
  };

  const flushMove = () => {
    if (pendingMove.current) stream.send(pendingMove.current);
    pendingMove.current = null;
  };

  const queueMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const msg = mouseMessage("mouseMoved", e);
    if (!msg) return;
    pendingMove.current = msg;
    moveFrame.current ??= requestAnimationFrame(() => {
      moveFrame.current = null;
      flushMove();
    });
  };

  const sendMouse = (
    eventType: "mousePressed" | "mouseReleased",
    e: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    const msg = mouseMessage(eventType, e);
    if (!msg) return;
    flushMove();
    stream.send(msg, eventType === "mousePressed");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-light text-accent"
        >
          <Globe size={13} />
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={stream.back}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          onClick={stream.forward}
        >
          <ArrowRight size={16} />
        </Button>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <Input
            ref={addressRef}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            placeholder="localhost:3000"
            aria-label="Address in the agent's browser"
            className="h-8 font-mono text-xs"
          />
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload"
          onClick={stream.reload}
        >
          <Renew size={16} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Browser actions">
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem tone="danger" onSelect={() => void clearData()}>
              Clear browser data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          Runs in {agentName}'s sandbox — not a page from this site
        </span>
        <span
          className="shrink-0 tabular-nums"
          title="Time from your click or key to the next frame, frames per second, and stream bandwidth"
        >
          {stream.stats.roundTripMs === null
            ? "–"
            : `${stream.stats.roundTripMs} ms`}
          {" · "}
          {stream.stats.fps} fps
          {" · "}
          {stream.stats.kbPerSec} KB/s
        </span>
      </div>

      {!noticeSeen && (
        <Callout
          tone="info"
          size="sm"
          className="m-3 mb-0 flex items-start gap-3 text-xs"
        >
          <span className="flex-1">
            Sign-ins made here are stored in this agent, and the agent can use
            them. Clear them any time from the browser menu.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              writePersistedFlag(SIGN_IN_NOTICE_KEY, true);
              setNoticeSeen(true);
            }}
          >
            Got it
          </Button>
        </Callout>
      )}

      {stream.error && (
        <p className="px-4 pt-2 text-xs text-danger">{stream.error}</p>
      )}

      <div className="relative min-h-0 flex-1 bg-muted/30">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Browser in ${agentName}'s sandbox`}
          className="h-full w-full object-contain outline-none"
          onPointerDown={(e) => {
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onMouseDown={(e) => sendMouse("mousePressed", e)}
          onMouseUp={(e) => sendMouse("mouseReleased", e)}
          onPointerMove={queueMove}
          onWheel={(e) => {
            const at = pointer(e);
            if (!at) return;
            stream.send(
              {
                type: "input_mouse",
                eventType: "mouseWheel",
                ...at,
                deltaX: e.deltaX,
                deltaY: e.deltaY,
              },
              true,
            );
          }}
          aria-description={`${FOCUS_RELEASE_KEY} moves focus to the address`}
          onKeyDown={(e) => {
            e.preventDefault();
            if (e.key === FOCUS_RELEASE_KEY) addressRef.current?.focus();
            else stream.send(keyboardInput("keyDown", e), true);
          }}
          onKeyUp={(e) => {
            e.preventDefault();
            if (e.key !== FOCUS_RELEASE_KEY)
              stream.send(keyboardInput("keyUp", e));
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {stream.state === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
            <Spinner size={18} />
            Starting the agent's browser…
          </div>
        )}
        {stream.state === "disconnected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-center">
            <ErrorFilled size={24} className="text-danger" />
            <p className="text-sm text-muted-foreground">
              The connection to the agent's browser closed.
            </p>
            <Button variant="outline" onClick={stream.reconnect}>
              Reconnect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
