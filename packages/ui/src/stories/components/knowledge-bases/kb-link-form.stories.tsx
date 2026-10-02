import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { KbLinkForm } from "@/modules/knowledge-bases/components/kb-link-form";

/** A share string in the shape `parseKbShareString` accepts:
 *  `kbshare_<12 hex>_<43 base64url>`. */
const VALID_LINK =
  "kbshare_3f9a1c2e7b4d_Zq8Lw2Vn5Rt1Xc7Kp0Hs4Jd9Gf3Ab6Me2Uy8Oi5Tr1Q";

const meta = {
  title: "Components/KnowledgeBases/KbLinkForm",
  component: KbLinkForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    link: "",
    setLink: fn(),
    error: null,
    formatOk: false,
    trimmed: "",
    busy: false,
    onConnect: fn(),
  },
} satisfies Meta<typeof KbLinkForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const ValidLink: Story = {
  args: { link: VALID_LINK, trimmed: VALID_LINK, formatOk: true },
};
export const IncompleteLink: Story = {
  args: { link: "kbshare_3f9a1c2e", trimmed: "kbshare_3f9a1c2e" },
};
export const NotAShareLink: Story = {
  args: {
    link: "https://example.com/kb",
    trimmed: "https://example.com/kb",
  },
};
export const Connecting: Story = {
  args: { ...ValidLink.args, busy: true },
};
/** Message `useConnectKnowledgeBase` sets when the link resolves invalid. */
export const RevokedLink: Story = {
  args: {
    ...ValidLink.args,
    error: "That link is unknown or revoked — ask the owner for a current one.",
  },
};
export const Disabled: Story = { args: { ...ValidLink.args, disabled: true } };
