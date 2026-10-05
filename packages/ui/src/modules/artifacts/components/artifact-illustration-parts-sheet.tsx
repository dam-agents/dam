import { Checkmark, Download, Share, Time } from "@carbon/icons-react";

import { getBrand } from "@/brand";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { ArtifactStatusBadge } from "./artifact-badges.js";
import {
  ArtifactsEmptyIllustration,
  CheckoutPrototype,
} from "./artifacts-empty-illustration.js";

const brand = getBrand();
const MOCK_SHARE_URL = "share-dam.res.ibm.com/a/pw4SYBykUQQMrw";

const MOCK_PRIVATE = {
  id: "illust-art-1",
  title: "Checkout redesign #482",
  slug: "checkout-redesign",
  kind: "html" as const,
  contentType: "text/html",
  fileName: "checkout-redesign.html",
  sizeBytes: 43_008,
  version: 1,
  folderId: null,
  agentId: "a1b2c3d4-0001-4000-8000-000000000001",
  visibility: "private" as const,
  expiresAt: null,
  viewCount: 0,
  shareUrl: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_PUBLIC = {
  ...MOCK_PRIVATE,
  id: "illust-art-2",
  visibility: "public" as const,
  shareUrl: `https://${MOCK_SHARE_URL}`,
};

export function ArtifactIllustrationPartsSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-8 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Artifact Illustration Parts
          </h1>
          <p className="text-sm text-muted-foreground">
            Components for artifacts empty-state collage. Capture to Figma and
            arrange freely.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Close sheet
        </button>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-12 px-8 py-10">
        <PartGroup title="Reference — Agents empty-state illustration (style guide)">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6">
            <img
              src="/illustrations/agents-empty-state.svg"
              alt="Agents empty-state illustration — style reference"
              className="max-w-[600px]"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              Floating cards with slight rotation, transparent background,
              subtle shadows. Match this style.
            </p>
          </div>
        </PartGroup>

        <PartGroup title="Artifacts empty-state illustration (composed)">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6">
            <div className="bg-white">
              <ArtifactsEmptyIllustration />
            </div>
          </div>
        </PartGroup>

        <PartGroup title="1 — Schedule card (cropped)">
          <ScheduleCardElement />
        </PartGroup>

        <PartGroup title="2 — Preview dialog (hero, 640 px)">
          <PreviewDialogPanel />
        </PartGroup>

        <PartGroup title="3 — Share dialog (public selected, no link row)">
          <ShareDialogPanel />
        </PartGroup>

        <PartGroup title="4 — Copy link row (copied state)">
          <CopyLinkRow />
        </PartGroup>

        <PartGroup title="5 — Slack post">
          <SlackPostCard />
        </PartGroup>

        <PartGroup title="6 — Private badge">
          <ArtifactStatusBadge artifact={MOCK_PRIVATE as never} />
        </PartGroup>

        <PartGroup title="7 — Public badge">
          <ArtifactStatusBadge artifact={MOCK_PUBLIC as never} />
        </PartGroup>
      </div>
    </div>
  );
}

function PartGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

function ScheduleCardElement() {
  return (
    <div className="w-[320px] rounded-lg border border-border bg-card p-4">
      <p className="text-[15px] font-semibold text-foreground">
        Prototype open tickets
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
        <span>every weekday</span>
        <span>&middot;</span>
        <span className="flex items-center gap-1">
          <Time size={12} />
          in 7 h
        </span>
      </p>
    </div>
  );
}

function PreviewDialogPanel() {
  return (
    <div className="w-[640px] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <DialogHeader title="Checkout redesign #482" onClose={() => {}} />
      <DialogBody>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <ArtifactStatusBadge artifact={MOCK_PRIVATE as never} />
          <span className="truncate">checkout-redesign.html</span>
          <span>&middot;</span>
          <span>42 KB</span>
        </div>
        <div className="h-[300px] w-full overflow-hidden rounded border border-border bg-white">
          <CheckoutPrototype />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => {}}>
          <Share size={16} />
          Share
        </Button>
        <Button variant="outline" onClick={() => {}}>
          <Download size={16} />
          Download
        </Button>
      </DialogFooter>
    </div>
  );
}

function ShareDialogPanel() {
  return (
    <div className="w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <DialogHeader
        title={"Share \u201cCheckout redesign #482\u201d"}
        onClose={() => {}}
      />
      <DialogBody>
        <RadioGroup value="public" onValueChange={() => {}}>
          <RadioGroupItem
            value="private"
            label="Private"
            description="Only you"
          />
          <RadioGroupItem
            value="restricted"
            label="Restricted"
            description="Only invited people"
          />
          <RadioGroupItem
            value="public"
            label="Public"
            description="Anyone with the link"
          />
        </RadioGroup>
      </DialogBody>
      <DialogActions
        onCancel={() => {}}
        cancelLabel="Close"
        label="Save"
        pendingLabel={"Saving\u2026"}
        onSubmit={() => {}}
      />
    </div>
  );
}

function CopyLinkRow() {
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={MOCK_SHARE_URL}
        size="sm"
        variant="monospace"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy link"
        tooltip="Copy link"
        onClick={() => {}}
      >
        <Checkmark size={14} className="text-success" />
      </Button>
    </div>
  );
}

function SlackPostCard() {
  return (
    <div className="w-[480px] overflow-hidden rounded-lg border border-border bg-card shadow-md">
      <div className="flex gap-3 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
          <span className="text-[10px] font-bold text-foreground">
            {brand.name}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-foreground">
              {brand.name}
            </span>
            <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase leading-none text-muted-foreground">
              Agent
            </span>
            <span className="text-sm text-muted-foreground">7:02 AM</span>
          </div>

          <p
            className="mt-1 text-[15px] leading-relaxed"
            style={{ color: "#1d1c1d" }}
          >
            Checkout redesign for #482 is ready.
            <br />
            <span style={{ color: "#1264a3" }}>{MOCK_SHARE_URL}</span>
          </p>

          <div className="mt-2 flex overflow-hidden rounded border border-[#e8e8e8]">
            <div className="w-1 shrink-0 bg-accent" />
            <div className="flex-1 bg-[#f8f8f8] px-3 py-2">
              <p className="text-xs font-semibold" style={{ color: "#1264a3" }}>
                {MOCK_SHARE_URL}
              </p>
              <p className="mt-0.5 text-xs text-[#616061]">
                Checkout redesign #482 &middot; HTML &middot; 42 KB
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
