import { Copy, Password, Terminal } from "@carbon/icons-react";

import { getBrand } from "@/brand";
import {
  IconSquare,
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";

export function ApiKeysEmptyIllustration({
  className,
}: {
  className?: string;
}) {
  const cli = getBrand().short;
  const key = `${cli}_••••7f3a`;
  return (
    <IllustrationCanvas className={className}>
      <div
        className={`${ILLUSTRATION_CARD} left-[18px] top-[20px] w-[380px] px-4 py-3`}
      >
        <div className="flex items-center gap-3">
          <IconSquare>
            <Password size={16} />
          </IconSquare>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-[23px] text-foreground">
              Laptop CLI
            </p>
            <p className="font-mono text-[12px] leading-[22px] text-muted-foreground">
              {key}
            </p>
          </div>
          <div className="flex size-7 items-center justify-center rounded-md border border-border text-foreground">
            <Copy size={16} />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-0.5 border-t border-border pt-2 text-[14px] leading-[22px]">
          <dt className="text-muted-foreground">Agent</dt>
          <dd className="text-foreground">Docs monitor</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd className="text-foreground">In 90 days</dd>
        </dl>
      </div>

      <div className="absolute left-[201px] top-[154px] w-[381px] rounded-xl border border-[#121619] bg-[#121619] p-4 font-mono text-[13px] leading-5 shadow-[0_4px_27px_rgba(56,56,56,0.1)]">
        <p className="text-[#C1C7CD]">
          <span className="text-[#6F6F6F]">$</span> {cli} login --key {key}
        </p>
        <p className="text-[#42BE65]">&#10003; Logged in</p>
        <p className="mt-1 text-[#C1C7CD]">
          <span className="text-[#6F6F6F]">$</span> {cli} run docs-monitor
        </p>
        <p className="text-[#42BE65]">&#10003; Run started</p>
      </div>

      <SlackMessage className="left-[102px] top-[286px]" time="9:41 AM">
        Started from the CLI. Report in 4 min.
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Password size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <Terminal size={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}
