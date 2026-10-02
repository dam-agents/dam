import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { useAppConnections } from "@/modules/connections/api/queries";
import { useCatalogGroups } from "@/modules/connections/hooks/use-catalog-groups";
import { GrantedConnectionsPanel } from "@/modules/sandboxes/components/granted-connections-panel";
import { excludeProviderConnections } from "@/modules/sandboxes/lib/provider-connections";

type Props = ComponentProps<typeof GrantedConnectionsPanel>;
type Args = Omit<Props, "groups" | "granted" | "templateById">;

/** Derives groups the way the sandbox page does: every connection the fake
 *  backend lists, minus provider connections, grouped by the real hook. */
function WithAllConnections(args: Args) {
  const { data = [] } = useAppConnections();
  const { populated, templateById } = useCatalogGroups(
    excludeProviderConnections(data),
  );
  return (
    <GrantedConnectionsPanel
      {...args}
      groups={populated}
      granted={data}
      templateById={templateById}
    />
  );
}

const meta = {
  title: "Components/Sandboxes/GrantedConnectionsPanel",
  parameters: { layout: "padded" },
  args: { onToggleGrant: fn(), onOpenCatalog: fn() },
  render: (args) => (
    <div className="max-w-[760px]">
      <WithAllConnections {...args} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

/** The setup page's title. */
export const SetupTitle: Story = { args: { title: "Connections" } };

export const Empty: Story = {
  render: (args) => (
    <div className="max-w-[760px]">
      <GrantedConnectionsPanel
        {...args}
        groups={[]}
        granted={[]}
        templateById={new Map()}
      />
    </div>
  ),
};
