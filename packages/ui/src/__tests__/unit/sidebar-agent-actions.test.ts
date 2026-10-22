// TEST_OVERVIEW: an agent row in the sidebar shows New session and Configure agent as icons, and the Agent actions kebab only when a Slack or Telegram channel is there to add the agent to; Configure agent shows the wrench every other Configure agent button shows, opens the agent's configuration and is never inside the kebab.
import { Tools } from "@carbon/icons-react";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { SidebarAgentActions } from "../../modules/agents/components/sidebar-agent-actions.js";

function props(
  channels: { slack?: boolean; telegram?: boolean },
  onConfigure: () => void = () => {},
) {
  return { channels, onNewSession: () => {}, onConfigure, onBind: () => {} };
}

function html(channels: { slack?: boolean; telegram?: boolean }) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidebarAgentActions, props(channels)),
    ),
  );
}

type Props = {
  children?: ReactNode;
  label?: string;
  "aria-label"?: string;
  testId?: string;
  onClick?: () => void;
};

function find(
  node: ReactNode,
  match: (props: Props) => boolean,
): Props | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (match(child.props)) return child.props;
    const found = find(child.props.children, match);
    if (found) return found;
  }
  return undefined;
}

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<Props>(child) ? text(child.props.children) : String(child),
    )
    .join("");

// TEST_SCENARIO: with no channel available the row shows New session and Configure agent, and no kebab.
it("shows no kebab without a channel", () => {
  const out = html({});
  expect(out).toContain('aria-label="New session"');
  expect(out).toContain('aria-label="Configure agent"');
  expect(out).not.toContain('data-testid="sidebar-agent-menu"');
  expect(out).not.toContain('aria-label="Agent actions"');
});

// TEST_SCENARIO: with Slack or Telegram available the row shows New session, Configure agent and the kebab.
it.each([{ slack: true }, { telegram: true }, { slack: true, telegram: true }])(
  "shows the kebab next to Configure agent with %o",
  (channels) => {
    const out = html(channels);
    expect(out).toContain('aria-label="New session"');
    expect(out).toContain('aria-label="Configure agent"');
    expect(out).toContain('data-testid="sidebar-agent-menu"');
    expect(out.indexOf('aria-label="Configure agent"')).toBeLessThan(
      out.indexOf('data-testid="sidebar-agent-menu"'),
    );
  },
);

// TEST_SCENARIO: the Configure agent button opens the agent's configuration.
it("opens the configuration from the Configure agent button", () => {
  const onConfigure = vi.fn();
  const tree = SidebarAgentActions(props({ slack: true }, onConfigure));
  find(tree, (p) => p.label === "Configure agent")?.onClick?.();
  expect(onConfigure).toHaveBeenCalledOnce();
});

// TEST_SCENARIO: the Configure agent button shows the wrench (Tools), the icon of every other Configure agent button.
it("shows the wrench on the Configure agent button", () => {
  const tree = SidebarAgentActions(props({}));
  const icon = find(tree, (p) => p.label === "Configure agent")?.children;
  expect(isValidElement(icon) && icon.type).toBe(Tools);
});

// TEST_SCENARIO: the kebab holds the channel items alone, without Configure agent.
it("keeps Configure agent out of the kebab", () => {
  const tree = SidebarAgentActions(props({ slack: true, telegram: true }));
  const menu = find(tree, (p) => p.testId === "sidebar-agent-menu");
  expect(text(menu?.children)).toBe("Add to Slack channelAdd to Telegram chat");
});
