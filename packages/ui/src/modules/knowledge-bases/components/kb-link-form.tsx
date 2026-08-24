import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  link: string;
  setLink: (value: string) => void;
  error: string | null;
  formatOk: boolean;
  trimmed: string;
  busy: boolean;
  disabled?: boolean;
  onConnect: () => void;
}

export function KbLinkForm({
  link,
  setLink,
  error,
  formatOk,
  trimmed,
  busy,
  disabled = false,
  onConnect,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-64 flex-1"
          size="sm"
          variant="monospace"
          placeholder="kbshare_…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!formatOk || busy || disabled}
          onClick={onConnect}
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {trimmed.length > 0 && !formatOk && (
        <p className="text-xs text-warning">
          {trimmed.startsWith("kbshare_")
            ? "That share link looks incomplete or mistyped — check you copied the whole kbshare_… string."
            : "That doesn't look like a share link — expected a kbshare_… string."}
        </p>
      )}
      {error && <p className="text-xs text-warning">{error}</p>}
    </div>
  );
}
