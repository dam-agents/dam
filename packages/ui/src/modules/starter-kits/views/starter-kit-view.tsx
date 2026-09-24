import { ArrowLeft, Launch, Meter, PlayFilledAlt } from "@carbon/icons-react";
import {
  type ConnectionTemplateView,
  requirementAccepts,
  type StarterKitView,
} from "api-server-api";
import { useMemo } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import {
  formatSizeLabel,
  sizeInMi,
  slotUnitOf,
} from "../../budgets/lib/slots.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useStarterKit } from "../api/queries.js";
import { ClampedText } from "../components/clamped-text.js";
import {
  CATEGORY_LABEL,
  EGRESS_PRESET_DETAIL,
  EGRESS_PRESET_LABEL,
  kitEgressPreset,
  VM_BACKEND_LABEL,
} from "../lib/catalog-cards.js";
import { kitIcon } from "../lib/kit-icon.js";
import {
  describeAccepts,
  harnessesLine,
  kitScheduleCadence,
  shortKitVersion,
} from "../lib/setup.js";

const KIT_MODAL_WIDTH = "w-[600px] max-w-full md:w-[980px]";
const KIT_MODAL_HEIGHT = "h-[85dvh] md:h-[85vh]";

type TemplateIndex = ReadonlyMap<string, ConnectionTemplateView>;

function acceptedTemplates(
  accepts: readonly string[],
  templates: readonly ConnectionTemplateView[],
): ConnectionTemplateView[] {
  return templates.filter((t) =>
    requirementAccepts({ accepts }, t.id, t.family?.id),
  );
}

function Row({
  icon,
  icons,
  title,
  detail,
  trailing,
}: {
  icon?: React.ReactNode;
  icons?: string[];
  title: string;
  detail?: string;
  trailing?: React.ReactNode;
}) {
  const tile = icon ?? (icons && icons.length > 0);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {tile && (
        <div className="flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2">
          {icon ??
            icons
              ?.slice(0, 3)
              .map((slug) => (
                <ConnectionIcon
                  key={slug}
                  iconSlug={slug}
                  alt=""
                  size={16}
                  className="text-foreground/80"
                />
              ))}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && (
          <ClampedText
            text={detail}
            className="mt-0.5 text-sm text-muted-foreground"
          />
        )}
      </div>
      {trailing}
    </li>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <SectionLabel spaced>{label}</SectionLabel>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

export function StarterKitDetailView() {
  const catalog = useStore((s) => s.starterKitCatalog);
  const kitId = useStore((s) => s.starterKitId);
  const kit = useStarterKit(catalog, kitId);
  const setView = useStore((s) => s.setView);
  const close = () => setView("starter-kits");

  if (!kit.isPending && (kit.isError || kit.data === undefined)) {
    return (
      <KitLoadErrorModal onRetry={() => void kit.refetch()} onClose={close} />
    );
  }

  return (
    <Modal
      widthClass={KIT_MODAL_WIDTH}
      heightClass={KIT_MODAL_HEIGHT}
      onClose={close}
    >
      {kit.data === undefined ? (
        <KitDetailSkeleton onClose={close} />
      ) : (
        <KitDetail kit={kit.data} onClose={close} />
      )}
    </Modal>
  );
}

function KitLoadErrorModal({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[600px] max-w-full" onClose={onClose}>
      <DialogBody>
        <Callout tone="danger">
          <p className="text-sm text-foreground">
            Couldn&apos;t load this starter kit. It may have been removed from
            the catalog, or the catalog is unreachable.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              All kits
            </Button>
          </div>
        </Callout>
      </DialogBody>
    </Modal>
  );
}

function KitDetailSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader
          title={<TextSkeleton width={240} />}
          subtitle={<TextSkeleton width="80%" tone="muted" />}
          onClose={onClose}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TextSkeleton width={24} className="h-6" />
            <TextSkeleton width={72} className="h-5" />
            <TextSkeleton width={56} className="h-5" />
          </div>
        </DialogHeader>
        <DialogBody>
          <ListSkeleton rows={4} rowHeight={72} />
        </DialogBody>
        <DialogFooter divided className="justify-between">
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft size={16} /> Back
          </Button>
          <TextSkeleton width={260} className="h-10" />
        </DialogFooter>
      </div>
      <KitVideoPanel video={undefined} />
    </div>
  );
}

function KitVideoPanel({ video }: { video: string | undefined }) {
  return (
    <aside className="hidden w-[380px] shrink-0 flex-col items-center justify-center gap-1 border-l border-kit-line bg-gradient-to-b from-kit-tint to-kit-surface px-8 text-center md:flex">
      <PlayFilledAlt size={56} className="mb-3 text-kit/40" aria-hidden />
      <p className="text-base font-semibold text-foreground">
        See it in action
      </p>
      {video ? (
        <a
          href={video}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm text-foreground underline underline-offset-2"
        >
          Watch the walkthrough <Launch size={14} />
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">Video coming soon</p>
      )}
    </aside>
  );
}

function KitDetail({
  kit,
  onClose,
}: {
  kit: StarterKitView;
  onClose: () => void;
}) {
  const KitIcon = kitIcon(kit);
  const setView = useStore((s) => s.setView);
  const navigateToStarterKitSetup = useStore(
    (s) => s.navigateToStarterKitSetup,
  );
  const templates = useConnectionTemplates();
  const budget = useBudgetReserved();

  const templateById: TemplateIndex = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );

  const size = useMemo(() => {
    if (!kit.resources || !budget.data) return null;
    const unit = slotUnitOf(budget.data);
    const mi = sizeInMi(kit.resources);
    if (mi.cpuMilli === 0 && mi.memoryMi === 0) return null;
    return { label: formatSizeLabel(mi, unit) };
  }, [kit.resources, budget.data]);

  const skillCount = kit.skillsInKit.length + kit.skills.length;
  const kbSeed = kit.knowledgeBase ? kit.seed : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader
          title={kit.name}
          titleAccessory={
            <Badge variant="kit">{CATEGORY_LABEL[kit.category]}</Badge>
          }
          subtitle={kit.description}
          onClose={onClose}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground">
              <KitIcon size={14} />
            </span>
            {kit.connections.flatMap((req) =>
              acceptedTemplates(req.accepts, templates.data ?? [])
                .flatMap((t) => (t.family ? [t.family] : []))
                .filter(
                  (f, i, all) => all.findIndex((x) => x.id === f.id) === i,
                )
                .map((family) => (
                  <Badge key={family.id} variant="muted" size="sm">
                    {family.title}
                  </Badge>
                )),
            )}
            {skillCount > 0 && (
              <Badge variant="muted" size="sm">
                {skillCount} {skillCount === 1 ? "skill" : "skills"}
              </Badge>
            )}
            {kit.backend === "vm" && (
              <Badge variant="muted" size="sm">
                {VM_BACKEND_LABEL}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <DialogBody>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Included
          </h2>
          {kbSeed && (
            <Section label="Knowledge base">
              <Row
                title={`${kit.name} knowledge base skills`}
                detail="Installed by the kit's own bootstrap from its repository, so they are not listed under Skills."
                trailing={
                  <a
                    href={kbSeed.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open the ${kit.name} repository`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Launch size={16} />
                  </a>
                }
              />
            </Section>
          )}

          {skillCount > 0 && (
            <Section label="Skills">
              {kit.skillsInKit.map((skill) => (
                <Row
                  key={`in-kit:${skill.name}`}
                  title={skill.name}
                  detail={skill.description}
                  trailing={
                    <Badge variant="muted" size="sm">
                      in the kit
                    </Badge>
                  }
                />
              ))}
              {kit.skills.map((skill) => (
                <Row
                  key={`external:${skill.source}:${skill.name}`}
                  title={skill.name}
                  detail={skill.source}
                  trailing={
                    <Badge variant="muted" size="sm">
                      installed at create
                    </Badge>
                  }
                />
              ))}
            </Section>
          )}

          {kit.image && (
            <Section label="Framework">
              <Row
                title={kit.name}
                detail={kit.image.ref}
                trailing={
                  <Badge variant="muted" size="sm">
                    brings its own agent
                  </Badge>
                }
              />
            </Section>
          )}

          {kit.schedules.length > 0 && (
            <Section label="Schedules">
              {kit.schedules.map((schedule) => (
                <Row
                  key={schedule.name}
                  title={schedule.name}
                  detail={kitScheduleCadence(schedule)}
                  trailing={
                    <Badge variant="muted" size="sm">
                      {schedule.enabled ? "on" : "off"}
                    </Badge>
                  }
                />
              ))}
              <li className="text-sm text-muted-foreground">
                {kit.onboarding === false
                  ? "Created on the new agent."
                  : "Created on the new agent. They stay held until onboarding is finished, so nothing runs against a half-configured agent."}
              </li>
            </Section>
          )}

          {kit.seed && (
            <Section label="Repository">
              <Row
                title={kit.seed.url.replace("https://github.com/", "")}
                detail={`Seeded into ${
                  kit.seed.into === "home"
                    ? "the agent's home directory"
                    : "the work directory"
                }${kit.seed.ref ? ` on ${kit.seed.ref}` : ""}${
                  kit.seed.commit
                    ? ` at ${shortKitVersion(kit.seed.commit)}`
                    : ""
                } before the first session`}
                trailing={
                  <a
                    href={kit.seed.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the repository"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Launch size={16} />
                  </a>
                }
              />
            </Section>
          )}

          <Section label="Network access">
            <Row
              title={EGRESS_PRESET_LABEL[kitEgressPreset(kit)]}
              detail={EGRESS_PRESET_DETAIL[kitEgressPreset(kit)]}
            />
          </Section>

          {size && (
            <Section label="Compute">
              <Row
                icon={<Meter size={16} className="text-muted-foreground" />}
                title={size.label}
                detail={
                  kit.resources?.storage
                    ? `${kit.resources.storage} disk. ${kit.resources.note ?? ""}`.trim()
                    : kit.resources?.note
                }
              />
            </Section>
          )}

          <h2 className="mb-3 mt-8 text-base font-semibold text-foreground">
            You&apos;ll set up
          </h2>

          {kit.connections.length > 0 && (
            <Section label="Connections">
              {kit.connections.map((req) => (
                <Row
                  key={req.accepts.join("|")}
                  icons={acceptedTemplates(req.accepts, templates.data ?? [])
                    .map((t) => t.iconSlug)
                    .filter((slug): slug is string => slug !== undefined)
                    .filter((slug, i, all) => all.indexOf(slug) === i)}
                  title={describeAccepts(req.accepts, templateById)}
                  detail={req.note}
                  trailing={
                    <Badge
                      variant={req.required ? "template" : "muted"}
                      size="sm"
                    >
                      {req.required ? "required" : "optional"}
                    </Badge>
                  }
                />
              ))}
            </Section>
          )}

          {kit.channels.length > 0 && (
            <Section label="Channels">
              {kit.channels.map((channel) => (
                <Row
                  key={channel.type}
                  icons={[channel.type]}
                  title={channel.type === "slack" ? "Slack" : "Telegram"}
                  detail={channel.note}
                  trailing={
                    <Badge variant="muted" size="sm">
                      optional
                    </Badge>
                  }
                />
              ))}
            </Section>
          )}

          {!kit.image && (
            <Section label="Harness">
              <Row
                title={harnessesLine(kit)}
                detail="Chosen on the next step, from the harnesses installed here."
              />
            </Section>
          )}
        </DialogBody>

        <DialogFooter divided className="justify-between">
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft size={16} /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setView("agent-new")}>
              Start from scratch instead
            </Button>
            <Button
              onClick={() => navigateToStarterKitSetup(kit.catalog, kit.id)}
            >
              Use this Starter Kit
            </Button>
          </div>
        </DialogFooter>
      </div>
      <KitVideoPanel video={kit.video} />
    </div>
  );
}
