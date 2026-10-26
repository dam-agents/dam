import {
  ArrowLeft,
  Gift,
  Launch,
  PlayFilledAlt,
  WarningAlt,
} from "@carbon/icons-react";
import {
  ChannelType,
  type ConnectionTemplateView,
  formatEgressRuleInline,
  LINKED_KIT_CATALOG,
  requirementAccepts,
  type StarterKitView,
} from "api-server-api";
import { isAvatarCharacter } from "api-server-api/avatar/svg";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { Tooltip } from "@/components/ui/tooltip";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { EditableIdentity } from "../../agents/components/editable-agent-identity.js";
import { defaultAvatar } from "../../agents/lib/default-avatar.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { SignedInParentDialog } from "../../connections/components/signed-in-parent-dialog.js";
import { isGrantable } from "../../connections/lib/connection-hierarchy.js";
import { useFeatures } from "../../features/api/queries.js";
import { useUnlockedAvatars } from "../../getting-started/hooks/use-unlocked-avatars.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { useApplyStarterKit } from "../api/mutations.js";
import { useStarterKit } from "../api/queries.js";
import { ClampedText } from "../components/clamped-text.js";
import { KitCategoryTag } from "../components/kit-category-tag.js";
import { KitChannelsSection } from "../components/kit-channels-section.js";
import { KitRequirementsList } from "../components/kit-requirements-list.js";
import { KitScheduleCard } from "../components/kit-schedule-card.js";
import {
  EGRESS_PRESET_DETAIL,
  EGRESS_PRESET_LABEL,
  kitEgressPreset,
} from "../lib/catalog-cards.js";
import {
  buildStarterKitApplyInput,
  connectionRequirements,
  describeAccepts,
  isStarterKitSetupComplete,
  preselectedGrants,
  shortKitVersion,
  startupItemCommandLine,
  toggleSkipped,
  withOverride,
} from "../lib/setup.js";

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

interface FamilyTag {
  id: string;
  title: string;
  iconSlug?: string;
}

function connectionFamilyTags(
  requirements: StarterKitView["connections"],
  templates: readonly ConnectionTemplateView[],
): FamilyTag[] {
  const tags = new Map<string, FamilyTag>();
  for (const req of requirements) {
    for (const t of acceptedTemplates(req.accepts, templates)) {
      if (!t.family) continue;
      const tag = tags.get(t.family.id) ?? { ...t.family };
      tag.iconSlug ??= t.iconSlug;
      tags.set(t.family.id, tag);
    }
  }
  return [...tags.values()];
}

function Row({
  icon,
  iconSlug,
  title,
  tag,
  detail,
  code,
  action,
}: {
  icon?: React.ReactNode;
  iconSlug?: string;
  title: string;
  tag?: React.ReactNode;
  detail?: string;
  code?: string;
  action?: React.ReactNode;
}) {
  const tile =
    icon ??
    (iconSlug && (
      <ConnectionIcon
        iconSlug={iconSlug}
        alt=""
        size={16}
        className="text-foreground/80"
      />
    ));
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {tile && (
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
          {tile}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {tag}
        </div>
        {detail && (
          <ClampedText
            text={detail}
            className="mt-0.5 text-sm text-muted-foreground"
          />
        )}
        {code !== undefined && (
          <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
            {code}
          </pre>
        )}
      </div>
      {action}
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
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const close = () => setView("home");
  const back = () => {
    close();
    setKitBrowserOpen(true);
  };

  if (!kit.isPending && (kit.isError || kit.data === undefined)) {
    return (
      <KitLoadErrorModal
        linkReason={
          catalog === LINKED_KIT_CATALOG ? (kit.error?.message ?? null) : null
        }
        onRetry={() => void kit.refetch()}
        onClose={close}
        onBack={back}
      />
    );
  }

  return (
    <Modal size="xl" heightClass={KIT_MODAL_HEIGHT} onClose={close}>
      {kit.data === undefined || kitId === null ? (
        <KitDetailSkeleton onClose={close} onBack={back} />
      ) : (
        <KitDetail
          kit={kit.data}
          routeKit={kitId}
          onClose={close}
          onBack={back}
        />
      )}
    </Modal>
  );
}

function KitLoadErrorModal({
  linkReason,
  onRetry,
  onClose,
  onBack,
}: {
  linkReason: string | null;
  onRetry: () => void;
  onClose: () => void;
  onBack: () => void;
}) {
  return (
    <Modal size="md" onClose={onClose}>
      <DialogHeader title="Starter kit unavailable" onClose={onClose} />
      <DialogBody>
        <Callout tone="danger">
          <p className="text-sm text-foreground">
            {linkReason !== null
              ? `Couldn't use the kit at this link: ${linkReason}`
              : "Couldn't load this starter kit. It may have been removed from the catalog, or the catalog is unreachable."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack}>
              All kits
            </Button>
          </div>
        </Callout>
      </DialogBody>
    </Modal>
  );
}

function KitDetailSkeleton({
  onClose,
  onBack,
}: {
  onClose: () => void;
  onBack: () => void;
}) {
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
        <DialogFooter className="justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </Button>
          <TextSkeleton width={260} className="h-10" />
        </DialogFooter>
      </div>
      <KitVideoPanel video={undefined} />
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A kit from a link is in no catalog, so nobody on
 * this platform reviewed it; the notice says so above everything the kit sets
 * up, and names the repository and the commit the agent is created from. For
 * such a kit the modal also lists its install command and environment, which
 * a catalog kit's review already covered.
 */
function LinkedKitNotice({
  kit,
  link,
}: {
  kit: StarterKitView;
  link: { url: string };
}) {
  return (
    <Callout
      tone="warning"
      size="sm"
      className="mb-6 flex gap-2.5"
      data-testid="linked-kit-notice"
    >
      <WarningAlt size={16} className="mt-px shrink-0 text-warning-fg" />
      <div className="min-w-0 text-sm leading-snug">
        <p className="font-semibold text-warning-fg">
          This kit is not in a catalog
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Nobody on this platform reviewed it. Check what it sets up below
          before you create the agent: it is created from{" "}
          <a
            href={`${link.url}/tree/${kit.version}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground underline underline-offset-2"
          >
            {link.url.replace("https://github.com/", "")}@
            {shortKitVersion(kit.version)}
          </a>
          .
        </p>
      </div>
    </Callout>
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
  routeKit,
  onClose,
  onBack,
}: {
  kit: StarterKitView;
  routeKit: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const selectAgent = useStore((s) => s.selectAgent);
  const templates = useConnectionTemplates();
  const connections = useAppConnections();
  const agentsData = useAgents().data;
  const agents = agentsData?.list;
  const availableChannels = agentsData?.availableChannels ?? {};
  const offersChannels = !!(
    availableChannels[ChannelType.Slack] ||
    availableChannels[ChannelType.Telegram]
  );
  const apply = useApplyStarterKit();
  const returnPath = routeToPath({
    view: "starter-kit",
    catalog: kit.catalog,
    kit: routeKit,
  });
  const {
    form,
    update,
    toggleConnection,
    reset,
    signedInParentId,
    clearSignedIn,
  } = useSetupForm("starter-kit", {
    namePrefix: kit.id,
    returnPath,
    scope: `${kit.catalog}/${routeKit}`,
  });
  const [invalidSchedules, setInvalidSchedules] = useState<readonly string[]>(
    [],
  );
  const [connectAccepts, setConnectAccepts] = useState<
    readonly string[] | null
  >(null);

  const templateById: TemplateIndex = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );
  const owned = useMemo(
    () => (connections.data ?? []).filter(isGrantable),
    [connections.data],
  );
  const grantedIds = useMemo(
    () => new Set(form.connectionIds),
    [form.connectionIds],
  );

  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current) return;
    if (connections.data === undefined || templates.data === undefined) return;
    preselected.current = true;
    for (const id of preselectedGrants(
      kit,
      owned,
      form.connectionIds,
      templateById,
    ))
      toggleConnection(id, true);
  }, [
    kit,
    connections.data,
    owned,
    templates.data,
    templateById,
    form.connectionIds,
    toggleConnection,
  ]);

  const canCreate =
    agents !== undefined &&
    !apply.isPending &&
    !invalidSchedules.some((n) => !form.skippedSchedules.includes(n)) &&
    isStarterKitSetupComplete(kit, form, owned, templateById);

  const unlocked = useUnlockedAvatars();
  const customAvatars = useFeatures().data?.["custom-avatars"] ?? false;
  const kitAvatar =
    customAvatars || isAvatarCharacter(kit.avatar) ? kit.avatar : undefined;
  const avatar = useMemo(
    () =>
      form.avatar ??
      kitAvatar ??
      defaultAvatar(form.name, unlocked, agents ?? []),
    [form.avatar, kitAvatar, form.name, unlocked, agents],
  );

  const create = async () => {
    if (!canCreate) return;
    try {
      const result = await apply.mutateAsync({
        ...buildStarterKitApplyInput(kit, form, owned, templateById),
        avatar,
      });
      reset();
      const skipped = result.skills?.skipped.length ?? 0;
      if (result.skillsError) {
        emitToast({
          kind: "error",
          message: `Agent created, but its external skills could not be installed: ${result.skillsError}`,
        });
      } else if (skipped > 0) {
        emitToast({
          kind: "warning",
          message: `Agent created; ${skipped} external skill${skipped === 1 ? "" : "s"} could not be installed — see the Skills panel.`,
        });
      }
      selectAgent(result.agent.id);
    } catch {}
  };

  const skillCount = kit.skillsInKit.length + kit.skills.length;
  const kbSeed = kit.knowledgeBase ? kit.seed : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader
          title={kit.name}
          titleAccessory={<KitCategoryTag category={kit.category} />}
          subtitle={kit.description}
          onClose={onClose}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {connectionFamilyTags(kit.connections, templates.data ?? []).map(
              (family) => (
                <Badge key={family.id} variant="muted" size="sm">
                  <span className="flex items-center gap-1.5">
                    {family.iconSlug && (
                      <ConnectionIcon
                        iconSlug={family.iconSlug}
                        alt=""
                        size={14}
                      />
                    )}
                    {family.title}
                  </span>
                </Badge>
              ),
            )}
            {skillCount > 0 && (
              <Badge variant="muted" size="sm">
                {skillCount} {skillCount === 1 ? "skill" : "skills"}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <DialogBody>
          {kit.link && <LinkedKitNotice kit={kit} link={kit.link} />}
          {form.name && (
            <div
              className="mb-8 flex min-w-0 items-center gap-3"
              data-testid="kit-agent-identity"
            >
              <EditableIdentity
                name={form.name}
                avatar={avatar}
                onRename={(name) => update({ name })}
                onAvatarChange={(next) => update({ avatar: next })}
                avatarSize={36}
                mood="awake"
                nameClassName="text-base font-semibold text-foreground"
                nameTag="h2"
              />
            </div>
          )}
          {kbSeed && (
            <Section label="Knowledge base">
              <Row
                title={`${kit.name} knowledge base skills`}
                detail="Installed by the kit's own bootstrap from its repository, so they are not listed under Skills."
                action={
                  <Tooltip content="Open repository">
                    <a
                      href={kbSeed.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open the ${kit.name} repository`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Launch size={16} />
                    </a>
                  </Tooltip>
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
                />
              ))}
              {kit.skills.map((skill) => (
                <Row
                  key={`external:${skill.source}:${skill.name}`}
                  title={skill.name}
                  detail={skill.source}
                  tag={
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
                tag={
                  <Badge variant="muted" size="sm">
                    brings its own agent
                  </Badge>
                }
              />
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
                action={
                  <Tooltip content="Open repository">
                    <a
                      href={kit.seed.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open the repository"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Launch size={16} />
                    </a>
                  </Tooltip>
                }
              />
            </Section>
          )}

          <Section label="Network access">
            <Row
              title={EGRESS_PRESET_LABEL[kitEgressPreset(kit)]}
              detail={EGRESS_PRESET_DETAIL[kitEgressPreset(kit)]}
            />
            {kit.egressRules.map((rule) => (
              <Row
                key={formatEgressRuleInline(rule)}
                title={formatEgressRuleInline(rule)}
                tag={
                  <Badge variant="muted" size="sm">
                    added by the kit
                  </Badge>
                }
              />
            ))}
          </Section>

          {kit.startupItems.length > 0 && (
            <Section label="Login items">
              {kit.startupItems.map((item) => (
                <Row
                  key={item.name}
                  title={item.name}
                  detail={item.description}
                  code={startupItemCommandLine(item)}
                  tag={
                    <Badge variant="muted" size="sm">
                      {item.enabled ? "starts at every boot" : "off at boot"}
                    </Badge>
                  }
                />
              ))}
            </Section>
          )}

          {kit.link && kit.install && (
            <Section label="Install command">
              <Row
                title="Runs in the agent's workspace when it is created"
                code={kit.install.command}
              />
            </Section>
          )}

          {kit.link && kit.env.length > 0 && (
            <Section label="Environment">
              {kit.env.map((variable) => (
                <Row
                  key={variable.name}
                  title={variable.name}
                  code={variable.value}
                />
              ))}
            </Section>
          )}

          {(connectionRequirements(kit).length > 0 ||
            kit.schedules.length > 0 ||
            offersChannels) && (
            <h2 className="mb-3 mt-8 text-base font-semibold text-foreground">
              You&apos;ll set up
            </h2>
          )}

          {connectionRequirements(kit).length > 0 && (
            <section className="mb-6">
              <SectionLabel spaced>Connections</SectionLabel>
              <KitRequirementsList
                kit={kit}
                granted={owned.filter((c) => grantedIds.has(c.id))}
                templateById={templateById}
                templates={templates.data ?? []}
                onRevoke={(id) => toggleConnection(id, false)}
                onConnect={setConnectAccepts}
              />
            </section>
          )}

          {kit.schedules.length > 0 && (
            <section className="mb-6">
              <SectionLabel spaced>Schedules</SectionLabel>
              <ul className="flex flex-col gap-3">
                {kit.schedules.map((schedule) => (
                  <KitScheduleCard
                    key={schedule.name}
                    schedule={schedule}
                    override={form.scheduleOverrides.find(
                      (o) => o.name === schedule.name,
                    )}
                    skipped={form.skippedSchedules.includes(schedule.name)}
                    onChange={(patch) =>
                      update({
                        scheduleOverrides: withOverride(
                          form.scheduleOverrides,
                          schedule.name,
                          patch,
                        ),
                      })
                    }
                    onInvalid={(invalid) =>
                      setInvalidSchedules((prev) =>
                        invalid
                          ? [...new Set([...prev, schedule.name])]
                          : prev.filter((n) => n !== schedule.name),
                      )
                    }
                    onToggleSkipped={() =>
                      update({
                        skippedSchedules: toggleSkipped(
                          form.skippedSchedules,
                          schedule.name,
                        ),
                      })
                    }
                  />
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                {kit.onboarding === false
                  ? "Created with the kit author's defaults."
                  : "Created with the kit author's defaults and held until onboarding finishes."}{" "}
                Adjust any of them, or skip what you do not want.
              </p>
            </section>
          )}

          <KitChannelsSection
            kit={kit}
            available={availableChannels}
            slackChannelIds={form.slackChannelIds}
            onSlackChannelIdsChange={(slackChannelIds) =>
              update({ slackChannelIds })
            }
          />
        </DialogBody>

        <DialogFooter className="justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </Button>
          <Button onClick={() => void create()} disabled={!canCreate}>
            <Gift size={16} aria-hidden />
            {apply.isPending ? "Creating…" : "Use this starter kit"}
          </Button>
        </DialogFooter>
        {connectAccepts && (
          <ConnectionCatalogModal
            accepts={connectAccepts}
            title={`Connect ${describeAccepts(connectAccepts, templateById)}`}
            subtitle="Pick one of your connections, or add a new one."
            onClose={() => setConnectAccepts(null)}
            sandbox={{
              grantedIds,
              onToggleGrant: toggleConnection,
              onRevoke: (ids) => {
                for (const id of ids) toggleConnection(id, false);
              },
            }}
            oauthReturnView={returnPath}
          />
        )}
        {signedInParentId && (
          <SignedInParentDialog
            connectionId={signedInParentId}
            onClose={clearSignedIn}
            onCreated={(id) => {
              clearSignedIn();
              toggleConnection(id, true);
            }}
          />
        )}
      </div>
      <KitVideoPanel video={kit.video} />
    </div>
  );
}
