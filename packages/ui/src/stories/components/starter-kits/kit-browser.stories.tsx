import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  KitBadges,
  KitCard,
  KitFilterBar,
  KitIllustration,
  useKitFilter,
} from "@/modules/starter-kits/components/kit-browser";

import { TEMPLATES } from "../../backend/fixtures/connections";
import { KITS } from "../../backend/fixtures/kits";

const templateById = new Map(TEMPLATES.map((t) => [t.id, t]));

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

const meta = {
  title: "Components/Starter kits/KitBrowser",
  component: KitCard,
  parameters: { layout: "padded" },
  args: {
    kit: kit("code-guardian"),
    templates: TEMPLATES,
    templateById,
    onOpen: fn(),
  },
} satisfies Meta<typeof KitCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-[260px]">
        <Story />
      </div>
    ),
  ],
};

/** Every fixture kit, as the Starter Kits page lays them out. */
export const CardGrid: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {KITS.map((k) => (
        <KitCard
          key={`${k.catalog}/${k.id}`}
          kit={k}
          templates={TEMPLATES}
          templateById={templateById}
          onOpen={fn()}
        />
      ))}
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {["code-guardian", "personal-assistant", "micro-manager"].map((id) => (
        <KitBadges
          key={id}
          kit={kit(id)}
          templates={TEMPLATES}
          templateById={templateById}
        />
      ))}
    </div>
  ),
};

export const Illustration: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {KITS.map((k) => (
        <KitIllustration
          key={k.id}
          kit={k}
          className="size-24 rounded-xl border border-kit-line"
        />
      ))}
    </div>
  ),
};

function LiveFilterBar() {
  const { query, setQuery, filter, setFilter, shown, tabs } =
    useKitFilter(KITS);
  return (
    <div>
      <KitFilterBar
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        tabs={tabs}
      />
      <p className="text-sm text-muted-foreground">
        {shown.map((k) => k.name).join(", ") || "No matches"}
      </p>
    </div>
  );
}

/** Search box plus category tabs; type or switch tabs to filter. */
export const FilterBar: Story = { render: () => <LiveFilterBar /> };
