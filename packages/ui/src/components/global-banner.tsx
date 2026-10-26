import { Notification } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import { getBrand } from "../brand.js";
import { useNotifications } from "../modules/notifications/api/queries.js";
import { isNeedsYou } from "../modules/notifications/lib/notification-types.js";
import { useStore } from "../store.js";
import { BrandLogo } from "./brand-logo.js";

export function GlobalBanner() {
  const toggleNotifications = useStore((s) => s.toggleNotifications);
  const { items: notifItems } = useNotifications();
  const needsYouCount = notifItems.filter(isNeedsYou).length;
  const setView = useStore((s) => s.setView);

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center border-b border-border bg-card px-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView("home")}
          aria-label={getBrand().name}
          className="rounded-lg p-0.5 text-foreground transition-colors hover:opacity-80"
        >
          <BrandLogo />
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center">
        <button
          type="button"
          onClick={toggleNotifications}
          aria-label={
            needsYouCount > 0
              ? `Notifications, ${needsYouCount} need attention`
              : "Notifications"
          }
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Notification size={16} />
          {needsYouCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-warning px-1 text-[10px] font-bold text-white hover:bg-warning"
            >
              {needsYouCount > 9 ? "9+" : needsYouCount}
            </Badge>
          )}
        </button>
      </div>
    </header>
  );
}
