export function OverflowPreviewView() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-12">
      <div className="min-w-[220px] rounded-md border border-border bg-popover p-1 shadow-md">
        <MenuItem>Configure</MenuItem>
        <Separator />
        <MenuItem>
          <img src="/icons/slack.svg" alt="" className="size-4" />
          Add to Slack channel
        </MenuItem>
        <MenuItem>
          <img src="/icons/telegram.svg" alt="" className="size-4" />
          Add to a Telegram channel
        </MenuItem>
        <Separator />
        <MenuItem>Restart</MenuItem>
        <MenuItem>Pause — wakes on next use</MenuItem>
        <MenuItem>Stop — until started again</MenuItem>
        <Separator />
        <MenuItem danger>Delete agent</MenuItem>
      </div>
    </div>
  );
}

function MenuItem({
  children,
  danger,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex h-9 w-full cursor-default items-center gap-2 rounded-md px-3 text-sm ${
        danger ? "text-destructive" : "text-popover-foreground"
      } hover:bg-muted`}
    >
      {children}
    </div>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-border" />;
}
