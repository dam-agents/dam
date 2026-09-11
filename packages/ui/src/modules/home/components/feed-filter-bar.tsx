import { type TabDef, Tabs } from "@/components/ui/tabs";

export type FeedTab = "all" | "in-progress" | "channels" | "schedules";

export const FEED_TABS: readonly TabDef<FeedTab>[] = [
  { value: "all", label: "All" },
  { value: "in-progress", label: "In progress" },
  { value: "channels", label: "Channels" },
  { value: "schedules", label: "Schedules" },
];

interface Props {
  value: FeedTab;
  onValueChange: (tab: FeedTab) => void;
}

export function FeedFilterBar({ value, onValueChange }: Props) {
  return (
    <Tabs
      tabs={FEED_TABS}
      value={value}
      onValueChange={onValueChange}
      variant="pill"
      size="sm"
      ariaLabel="Filter notifications"
    />
  );
}
