import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ArtifactKind } from "api-server-api";
import { fn } from "storybook/test";

import {
  ArtifactDeletionChip,
  ArtifactInteractiveBadge,
  ArtifactKindBadge,
  ArtifactStatusBadge,
} from "@/modules/artifacts/components/artifact-badges";

import { ago } from "../../backend/scenario";
import { ART, getArtifact } from "./artifact-fixtures";

const KINDS: ArtifactKind[] = [
  "html",
  "jsx",
  "markdown",
  "code",
  "text",
  "binary",
];

const loadArtifacts = async () => ({
  privateArtifact: await getArtifact(ART.code),
  restricted: await getArtifact(ART.restricted),
  publicArtifact: await getArtifact(ART.html),
  expiring: await getArtifact(ART.expiring),
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

const meta = {
  title: "Components/Artifacts/ArtifactBadges",
  parameters: { layout: "padded" },
  loaders: [loadArtifacts],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** `ArtifactKindBadge` for every artifact kind. */
export const KindBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {KINDS.map((kind) => (
        <ArtifactKindBadge key={kind} kind={kind} />
      ))}
    </div>
  ),
};

/** `ArtifactStatusBadge`, read-only (no `onShare`). */
export const StatusBadges: Story = {
  render: (_, { loaded }) => {
    const { privateArtifact, restricted, publicArtifact } = loaded as Loaded;
    return (
      <div className="flex gap-2">
        <ArtifactStatusBadge artifact={privateArtifact} />
        <ArtifactStatusBadge artifact={restricted} />
        <ArtifactStatusBadge artifact={publicArtifact} />
      </div>
    );
  },
};

/** `ArtifactStatusBadge` with `onShare` — a button that opens sharing. */
export const StatusBadgesClickable: Story = {
  render: (_, { loaded }) => {
    const { privateArtifact, restricted, publicArtifact } = loaded as Loaded;
    const onShare = fn();
    return (
      <div className="flex gap-2">
        <ArtifactStatusBadge artifact={privateArtifact} onShare={onShare} />
        <ArtifactStatusBadge artifact={restricted} onShare={onShare} />
        <ArtifactStatusBadge artifact={publicArtifact} onShare={onShare} />
      </div>
    );
  },
};

/** `ArtifactDeletionChip`: scheduled (fixture), due soon, expired. Renders nothing when never deleted. */
export const DeletionChips: Story = {
  render: (_, { loaded }) => {
    const { expiring } = loaded as Loaded;
    return (
      <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
        <ArtifactDeletionChip expiresAt={expiring.expiresAt} />
        <ArtifactDeletionChip expiresAt={ago(-60)} />
        <ArtifactDeletionChip expiresAt={ago(60)} />
        <ArtifactDeletionChip expiresAt={null} />
      </div>
    );
  },
};

export const InteractiveBadge: Story = {
  render: () => <ArtifactInteractiveBadge />,
};
