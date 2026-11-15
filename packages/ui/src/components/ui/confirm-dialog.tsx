import {
  Information,
  TrashCan,
  Warning,
  WarningAlt,
} from "@carbon/icons-react";
import {
  type AnimationEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmDialogKind = "default" | "destructive" | "info";

const KIND_ICON = {
  default: Warning,
  destructive: WarningAlt,
  info: Information,
} as const satisfies Record<ConfirmDialogKind, typeof Warning>;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAnimationEnd?: () => void;
  kind?: ConfirmDialogKind;
  icon?: typeof Warning;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onCloseAnimationEnd,
  kind = "default",
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  showCancel = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const destructive = kind === "destructive";
  const Icon = icon ?? KIND_ICON[kind];
  const resolvedConfirmLabel = confirmLabel ?? (showCancel ? "Confirm" : "OK");
  const [body, setBody] = useState<HTMLElement | null>(null);
  const moreBelow = useMoreBelow(body);
  const [wasOpen, setWasOpen] = useState(open);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setOpener(document.activeElement as HTMLElement | null);
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (!open && event.currentTarget === event.target) onCloseAnimationEnd?.();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel?.();
        onOpenChange(o);
      }}
    >
      <AlertDialogContent
        className="flex max-h-[95dvh] flex-col md:max-h-[85vh]"
        onAnimationEnd={handleAnimationEnd}
        onCloseAutoFocus={(event) => {
          if (!opener?.isConnected) return;
          event.preventDefault();
          opener.focus();
          setOpener(null);
        }}
        onBackdropClick={() => {
          onCancel?.();
          onOpenChange(false);
        }}
      >
        <AlertDialogHeader className="min-h-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
                destructive ? "bg-danger-light" : "bg-primary/10",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  destructive ? "text-danger" : "text-primary",
                )}
              />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          {description && (
            <AlertDialogDescription asChild>
              <div
                ref={setBody}
                data-more-below={moreBelow || undefined}
                className={cn(
                  "min-h-0 overflow-y-auto pt-1 text-sm text-muted-foreground",
                  moreBelow &&
                    "[mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]",
                )}
              >
                {description}
              </div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="shrink-0">
          {showCancel && (
            <AlertDialogCancel onClick={() => onCancel?.()}>
              {cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={() => onConfirm()}
            autoFocus={!showCancel}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
          >
            {destructive && /^(Delete|Remove)\b/.test(resolvedConfirmLabel) && (
              <TrashCan size={16} />
            )}
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useMoreBelow(el: HTMLElement | null): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!el) return;
    const check = () =>
      setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const resize = new ResizeObserver(check);
    resize.observe(el);
    for (const child of el.children) resize.observe(child);
    return () => {
      el.removeEventListener("scroll", check);
      resize.disconnect();
    };
  }, [el]);
  return more;
}
