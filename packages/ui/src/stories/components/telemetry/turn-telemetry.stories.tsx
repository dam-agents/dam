import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { trpc } from "@/trpc";

import { TurnTelemetry } from "../../../modules/telemetry/components/turn-telemetry.js";
import { resetState, seedQuery } from "../agents/story-helpers";
import { TURN, TURN_DETAIL, TURN_REF } from "./turn-detail-fixture";

/** The telemetry line under an agent reply (shown with the "agent-telemetry"
 *  flag). Expanding it loads the turn's spans; the fixture backend doesn't
 *  serve `telemetry.turn`, so the expanded stories seed that query. */
const seedTurn = () => {
  resetState();
  seedQuery(
    trpc.telemetry.turn.queryKey({
      ...TURN_REF,
      from: TURN.startedAt,
      to: TURN.endedAt,
    }),
    { available: true as const, turn: TURN_DETAIL },
  );
  return {};
};

const expand = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(
    within(canvasElement).getByRole("button", { expanded: false }),
  );
};

const meta = {
  title: "Components/Telemetry/TurnTelemetry",
  component: TurnTelemetry,
  parameters: { layout: "padded" },
  loaders: [seedTurn],
  decorators: [
    (Story) => (
      <div className="max-w-[813px] pt-8">
        <Story />
      </div>
    ),
  ],
  args: { ...TURN_REF, turn: TURN },
} satisfies Meta<typeof TurnTelemetry>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = { play: expand };

export const WithErrors: Story = { args: { turn: { ...TURN, errorCount: 1 } } };

export const Unavailable: Story = {
  loaders: [
    () => {
      resetState();
      seedQuery(
        trpc.telemetry.turn.queryKey({
          ...TURN_REF,
          from: TURN.startedAt,
          to: TURN.endedAt,
        }),
        {
          available: false as const,
          // The api-server's TELEMETRY_DISABLED_REASON.
          reason:
            "The telemetry backend is not enabled on this deployment, so agent traces and logs are not recorded here.",
        },
      );
      return {};
    },
  ],
  play: expand,
};
