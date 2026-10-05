import { Checkmark, Share } from "@carbon/icons-react";

import {
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackComposer,
  SlackLink,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { ArtifactStatusBadge } from "./artifact-badges.js";

const SHARE_URL = "share-dam.res.ibm.com/a/pw4SYBykUQQMrw";

const PUBLIC_ARTIFACT = {
  visibility: "public",
  shareUrl: `https://${SHARE_URL}`,
  expiresAt: null,
};

export function ArtifactsEmptyIllustration({
  className,
}: {
  className?: string;
}) {
  return (
    <IllustrationCanvas className={className}>
      <SlackComposer
        className="left-[18px] top-[20px]"
        icon={<ConnectionIcon iconSlug="slack" alt="" size={16} />}
      >
        Pull our weekly metrics and build me a dashboard every Monday
      </SlackComposer>
      <ArtifactCard />
      <SlackMessage className="left-[102px] top-[282px]" time="6:00 AM">
        Weekly dashboard is ready. Signups up 12% this week.
        <SlackLink>{SHARE_URL}</SlackLink>
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Share size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <ConnectionIcon iconSlug="slack" alt="" size={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}

function ArtifactCard() {
  return (
    <div
      className={`${ILLUSTRATION_CARD} left-[201px] top-[154px] flex w-[381px] gap-4 rounded-xl p-4`}
    >
      <div className="h-[84px] w-[112px] shrink-0 overflow-hidden rounded border border-border bg-white">
        <DashboardThumbnail />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
          Weekly metrics dashboard
        </p>
        <div className="flex items-center gap-2 text-[14px] leading-[22px] text-muted-foreground">
          <ArtifactStatusBadge artifact={PUBLIC_ARTIFACT as never} />
          <span>HTML &middot; 38 KB</span>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-input px-2 font-mono text-[12px] text-foreground">
            <span className="truncate">{SHARE_URL}</span>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border">
            <Checkmark size={16} className="text-success" />
          </div>
        </div>
      </div>
    </div>
  );
}

const BAR_HEIGHTS = [32, 52, 44, 68, 58, 76, 62];

function DashboardThumbnail() {
  return (
    <div className="flex h-full flex-col gap-[6px] p-2.5">
      <div className="flex gap-[6px]">
        <div className="h-[16px] flex-1 rounded-[3px] bg-[#E0E5EB]" />
        <div className="h-[16px] flex-1 rounded-[3px] bg-[#E0E5EB]" />
        <div className="h-[16px] flex-1 rounded-[3px] bg-[#C1E8D5]" />
      </div>
      <div className="flex flex-1 items-end gap-[3px] rounded-[3px] border border-[#E0E5EB] px-1.5 pb-1.5">
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-[2px]"
            style={{
              height: `${(h / 76) * 100}%`,
              backgroundColor:
                i === BAR_HEIGHTS.length - 1 ? "#0F62FE" : "#A6C8FF",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function CheckoutPrototype() {
  const teal = "#0D9488";
  const dark = "#1a1a2e";
  const muted = "#6b7280";
  const border = "#e5e7eb";
  const font =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const inputStyle = {
    border: `1px solid ${border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    color: dark,
    fontFamily: font,
  } as const;
  const labelStyle = {
    display: "block",
    fontSize: 12,
    color: muted,
    marginBottom: 4,
  } as const;

  return (
    <div className="h-full overflow-hidden" style={{ fontFamily: font }}>
      <div
        style={{
          borderBottom: `1px solid ${border}`,
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{ width: 22, height: 22, borderRadius: 5, background: teal }}
        />
        <span
          style={{
            color: teal,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "-0.01em",
          }}
        >
          ShopFlow
        </span>
      </div>

      <div
        style={{
          padding: "14px 20px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {(["Cart", "Payment", "Confirm"] as const).map((step, i) => (
          <div key={step} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && (
              <div
                style={{
                  width: 40,
                  height: 1,
                  background: i <= 1 ? teal : border,
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: i <= 1 ? teal : "transparent",
                  border: i <= 1 ? "none" : `1.5px solid ${border}`,
                  color: i <= 1 ? "#fff" : muted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {i < 1 ? "✓" : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: i === 1 ? dark : muted,
                  fontWeight: i === 1 ? 600 : 400,
                }}
              >
                {step}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "14px 20px 20px" }}>
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: dark,
            marginBottom: 12,
          }}
        >
          Payment details
        </h3>
        <label style={labelStyle}>Card number</label>
        <div style={{ ...inputStyle, marginBottom: 12 }}>
          4242 4242 4242 4242
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Expiry</label>
            <div style={inputStyle}>12 / 28</div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>CVC</label>
            <div style={inputStyle}>&bull;&bull;&bull;</div>
          </div>
        </div>
        <label style={labelStyle}>Name on card</label>
        <div style={{ ...inputStyle, marginBottom: 16 }}>Card holder</div>
        <div
          style={{
            borderTop: `1px solid ${border}`,
            paddingTop: 12,
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 14,
            fontWeight: 600,
            color: dark,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>Order total</span>
          <span>$138.24</span>
        </div>
        <div
          style={{
            width: "100%",
            borderRadius: 8,
            padding: "10px 16px",
            background: teal,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          Pay $138.24
        </div>
      </div>
    </div>
  );
}
