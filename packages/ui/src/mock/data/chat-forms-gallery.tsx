/**
 * Chat Forms Gallery — every a2ui v1.0 component rendered in a mock chat.
 * Copied from origin/main at commit 54ad4d874.
 */
import { A2UI_PLATFORM_CATALOG_ID, A2UI_VERSION } from "api-server-api/chat-forms";

import { ChatMessage } from "../../modules/sessions/components/chat-message.js";
import type { Message } from "../../types.js";

const noop = () => {};

function a2uiBlock(messages: unknown[]): string {
  return `<a2ui-json>${JSON.stringify(messages)}</a2ui-json>`;
}

function surface(
  surfaceId: string,
  components: unknown[],
  dataModel?: Record<string, unknown>,
): unknown {
  return {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: A2UI_PLATFORM_CATALOG_ID,
      components,
      ...(dataModel ? { dataModel } : {}),
    },
  };
}

function msg(
  id: string,
  role: "assistant" | "user",
  text: string,
): Message {
  return {
    id,
    role,
    parts: [{ kind: "text" as const, text }],
    streaming: false,
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 mt-12 border-t-2 border-foreground/10 pt-8 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        {children}
      </h2>
    </div>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-sm font-medium text-muted-foreground/60">
      {children}
    </p>
  );
}

function MessageSlot({ message }: { message: Message }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-4">
      <ChatMessage
        message={message}
        isLast={false}
        hasPendingPermission={false}
        onRetry={noop}
        onFileClick={noop}
      />
    </div>
  );
}

// ─── Input components ─────────────────────────────────────────────────────────

const textFieldMessage = msg(
  "g-textfield",
  "assistant",
  `Enter a project name:\n${a2uiBlock([
    surface("textfield-demo", [
      { id: "root", component: "Column", children: ["field", "longField", "numField", "obscured"] },
      {
        id: "field",
        component: "TextField",
        label: "Project name",
        value: "my-project",
        placeholder: "e.g. acme-api",
      },
      {
        id: "longField",
        component: "TextField",
        label: "Description",
        value: "",
        placeholder: "A brief description...",
        variant: "longText",
      },
      {
        id: "numField",
        component: "TextField",
        label: "Port number",
        value: "3000",
        variant: "number",
      },
      {
        id: "obscured",
        component: "TextField",
        label: "API key",
        value: "sk-abc123",
        variant: "obscured",
      },
    ]),
  ])}`,
);

const checkboxMessage = msg(
  "g-checkbox",
  "assistant",
  `Select your preferences:\n${a2uiBlock([
    surface("checkbox-demo", [
      { id: "root", component: "Column", children: ["cb1", "cb2", "cb3"] },
      { id: "cb1", component: "CheckBox", label: "Enable auto-save", value: true },
      { id: "cb2", component: "CheckBox", label: "Show line numbers", value: false },
      { id: "cb3", component: "CheckBox", label: "Dark mode", value: true },
    ]),
  ])}`,
);

const switchMessage = msg(
  "g-switch",
  "assistant",
  `Toggle these settings:\n${a2uiBlock([
    surface("switch-demo", [
      { id: "root", component: "Column", children: ["sw1", "sw2"] },
      {
        id: "sw1",
        component: "Switch",
        label: "Notifications",
        description: "Receive email notifications for new deployments",
        value: true,
      },
      {
        id: "sw2",
        component: "Switch",
        label: "Telemetry",
        description: "Share anonymous usage data",
        value: false,
      },
    ]),
  ])}`,
);

const choicePickerMessage = msg(
  "g-choice",
  "assistant",
  `Choose your stack:\n${a2uiBlock([
    surface("choice-demo", [
      { id: "root", component: "Column", children: ["single", "multi", "chips"] },
      {
        id: "single",
        component: "ChoicePicker",
        label: "Runtime",
        variant: "mutuallyExclusive",
        options: [
          { label: "Node.js", value: "node" },
          { label: "Deno", value: "deno" },
          { label: "Bun", value: "bun" },
        ],
        value: ["node"],
      },
      {
        id: "multi",
        component: "ChoicePicker",
        label: "Features",
        variant: "multipleSelection",
        options: [
          { label: "TypeScript", value: "ts" },
          { label: "ESLint", value: "eslint" },
          { label: "Prettier", value: "prettier" },
          { label: "Vitest", value: "vitest" },
        ],
        value: ["ts", "prettier"],
      },
      {
        id: "chips",
        component: "ChoicePicker",
        label: "Tags",
        displayStyle: "chips",
        options: [
          { label: "Frontend", value: "fe" },
          { label: "Backend", value: "be" },
          { label: "DevOps", value: "devops" },
          { label: "ML", value: "ml" },
        ],
        value: ["fe"],
      },
    ]),
  ])}`,
);

const sliderMessage = msg(
  "g-slider",
  "assistant",
  `Adjust these parameters:\n${a2uiBlock([
    surface("slider-demo", [
      { id: "root", component: "Column", children: ["sl1", "sl2"] },
      {
        id: "sl1",
        component: "Slider",
        label: "Temperature",
        min: 0,
        max: 2,
        value: 0.7,
        steps: 20,
      },
      {
        id: "sl2",
        component: "Slider",
        label: "Max tokens",
        min: 100,
        max: 4096,
        value: 2048,
        steps: 40,
      },
    ]),
  ])}`,
);

const dateTimeMessage = msg(
  "g-datetime",
  "assistant",
  `Schedule your deployment:\n${a2uiBlock([
    surface("datetime-demo", [
      { id: "root", component: "Column", children: ["dt1", "dt2"] },
      {
        id: "dt1",
        component: "DateTimeInput",
        label: "Deploy date",
        value: "2026-10-20",
        enableDate: true,
        enableTime: false,
      },
      {
        id: "dt2",
        component: "DateTimeInput",
        label: "Deploy date & time",
        value: "2026-10-20T14:30",
        enableDate: true,
        enableTime: true,
      },
    ]),
  ])}`,
);

// ─── Display components ───────────────────────────────────────────────────────

const textMessage = msg(
  "g-text",
  "assistant",
  `Here is some formatted text:\n${a2uiBlock([
    surface("text-demo", [
      { id: "root", component: "Column", children: ["body", "caption"] },
      { id: "body", component: "Text", text: "This is body text with the default variant." },
      { id: "caption", component: "Text", text: "This is caption text, smaller and secondary.", variant: "caption" },
    ]),
  ])}`,
);

const calloutMessage = msg(
  "g-callout",
  "assistant",
  `Important notices:\n${a2uiBlock([
    surface("callout-demo", [
      { id: "root", component: "Column", children: ["c1", "c2", "c3", "c4", "c5"] },
      { id: "c1", component: "Callout", title: "Note", text: "This is a neutral callout.", tone: "neutral" },
      { id: "c2", component: "Callout", title: "Info", text: "Deployment will begin shortly.", tone: "info" },
      { id: "c3", component: "Callout", title: "Success", text: "All tests passed.", tone: "success" },
      { id: "c4", component: "Callout", title: "Warning", text: "Disk usage is at 85%.", tone: "warning" },
      { id: "c5", component: "Callout", title: "Error", text: "Build failed with 3 errors.", tone: "danger" },
    ]),
  ])}`,
);

const badgeMessage = msg(
  "g-badge",
  "assistant",
  `Status badges:\n${a2uiBlock([
    surface("badge-demo", [
      { id: "root", component: "Row", children: ["b1", "b2", "b3", "b4", "b5"] },
      { id: "b1", component: "Badge", text: "Default", tone: "neutral" },
      { id: "b2", component: "Badge", text: "Info", tone: "info" },
      { id: "b3", component: "Badge", text: "Success", tone: "success" },
      { id: "b4", component: "Badge", text: "Warning", tone: "warning" },
      { id: "b5", component: "Badge", text: "Danger", tone: "danger" },
    ]),
  ])}`,
);

const iconMessage = msg(
  "g-icon",
  "assistant",
  `Some icons:\n${a2uiBlock([
    surface("icon-demo", [
      { id: "root", component: "Row", children: ["i1", "i2", "i3", "i4"] },
      { id: "i1", component: "Icon", name: "check" },
      { id: "i2", component: "Icon", name: "close" },
      { id: "i3", component: "Icon", name: "warning" },
      { id: "i4", component: "Icon", name: "info" },
    ]),
  ])}`,
);

const imageMessage = msg(
  "g-image",
  "assistant",
  `Image display:\n${a2uiBlock([
    surface("image-demo", [
      { id: "root", component: "Column", children: ["img1"] },
      {
        id: "img1",
        component: "Image",
        url: "https://placehold.co/400x200/1a1a2e/e0e0e0?text=Placeholder",
        description: "A placeholder image",
        variant: "mediumFeature",
      },
    ]),
  ])}`,
);

const dividerMessage = msg(
  "g-divider",
  "assistant",
  `Content with dividers:\n${a2uiBlock([
    surface("divider-demo", [
      { id: "root", component: "Column", children: ["t1", "d1", "t2"] },
      { id: "t1", component: "Text", text: "Above the divider" },
      { id: "d1", component: "Divider" },
      { id: "t2", component: "Text", text: "Below the divider" },
    ]),
  ])}`,
);

const codeBlockMessage = msg(
  "g-codeblock",
  "assistant",
  `Here is a code snippet:\n${a2uiBlock([
    surface("codeblock-demo", [
      { id: "root", component: "Column", children: ["cb1"] },
      {
        id: "cb1",
        component: "CodeBlock",
        code: 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}',
        language: "typescript",
      },
    ]),
  ])}`,
);

const diffMessage = msg(
  "g-diff",
  "assistant",
  `Here is a code change:\n${a2uiBlock([
    surface("diff-demo", [
      { id: "root", component: "Column", children: ["d1"] },
      {
        id: "d1",
        component: "Diff",
        title: "config.ts",
        diff: '--- a/config.ts\n+++ b/config.ts\n@@ -1,3 +1,3 @@\n export const config = {\n-  port: 3000,\n+  port: 8080,\n   host: "0.0.0.0",\n };',
      },
    ]),
  ])}`,
);

// ─── Layout components ────────────────────────────────────────────────────────

const cardMessage = msg(
  "g-card",
  "assistant",
  `A card layout:\n${a2uiBlock([
    surface("card-demo", [
      { id: "root", component: "Column", children: ["card1", "card2"] },
      { id: "card1", component: "Card", child: "card1-content" },
      {
        id: "card1-content",
        component: "Column",
        children: ["card1-title", "card1-body", "card1-badge"],
      },
      { id: "card1-title", component: "Text", text: "Deployment Summary" },
      { id: "card1-body", component: "Text", text: "3 services updated, 0 errors", variant: "caption" },
      { id: "card1-badge", component: "Badge", text: "Success", tone: "success" },
      { id: "card2", component: "Card", child: "card2-content" },
      {
        id: "card2-content",
        component: "Column",
        children: ["card2-title", "card2-body"],
      },
      { id: "card2-title", component: "Text", text: "Resource Usage" },
      { id: "card2-body", component: "Text", text: "CPU: 45% | Memory: 1.2 GiB / 2 GiB", variant: "caption" },
    ]),
  ])}`,
);

const listMessage = msg(
  "g-list",
  "assistant",
  `A vertical list:\n${a2uiBlock([
    surface("list-demo", [
      { id: "root", component: "List", children: ["item1", "item2", "item3"], direction: "vertical" },
      { id: "item1", component: "Text", text: "1. Initialize repository" },
      { id: "item2", component: "Text", text: "2. Install dependencies" },
      { id: "item3", component: "Text", text: "3. Run test suite" },
    ]),
  ])}`,
);

const tabsMessage = msg(
  "g-tabs",
  "assistant",
  `Tabbed content:\n${a2uiBlock([
    surface("tabs-demo", [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "Overview", child: "tab-overview" },
          { title: "Logs", child: "tab-logs" },
          { title: "Config", child: "tab-config" },
        ],
      },
      { id: "tab-overview", component: "Text", text: "Service is running on port 8080 with 2 replicas." },
      {
        id: "tab-logs",
        component: "CodeBlock",
        code: "[2026-10-16 14:00:01] INFO  Server started\n[2026-10-16 14:00:02] INFO  Connected to database\n[2026-10-16 14:00:03] INFO  Ready to accept connections",
        language: "log",
      },
      {
        id: "tab-config",
        component: "Column",
        children: ["cfg-field1", "cfg-field2"],
      },
      { id: "cfg-field1", component: "TextField", label: "Replicas", value: "2", variant: "number" },
      { id: "cfg-field2", component: "TextField", label: "Memory limit", value: "2Gi" },
    ]),
  ])}`,
);

const modalMessage = msg(
  "g-modal",
  "assistant",
  `A modal trigger:\n${a2uiBlock([
    surface("modal-demo", [
      { id: "root", component: "Modal", trigger: "trigger-btn", content: "modal-content" },
      {
        id: "trigger-btn",
        component: "Button",
        child: "trigger-text",
        variant: "primary",
        action: { event: { name: "noop" } },
      },
      { id: "trigger-text", component: "Text", text: "View details" },
      {
        id: "modal-content",
        component: "Column",
        children: ["modal-title", "modal-body"],
      },
      { id: "modal-title", component: "Text", text: "Deployment Details" },
      { id: "modal-body", component: "Text", text: "Version 2.4.1 deployed to production at 14:00 UTC.", variant: "caption" },
    ]),
  ])}`,
);

const rowColumnMessage = msg(
  "g-rowcol",
  "assistant",
  `Row and Column layout:\n${a2uiBlock([
    surface("rowcol-demo", [
      { id: "root", component: "Column", children: ["row1", "row2"] },
      { id: "row1", component: "Row", children: ["r1c1", "r1c2", "r1c3"], justify: "spaceBetween" },
      { id: "r1c1", component: "Badge", text: "Frontend", tone: "info" },
      { id: "r1c2", component: "Badge", text: "Backend", tone: "success" },
      { id: "r1c3", component: "Badge", text: "DevOps", tone: "warning" },
      { id: "row2", component: "Row", children: ["r2c1", "r2c2"] },
      {
        id: "r2c1",
        component: "Column",
        children: ["left-title", "left-body"],
      },
      { id: "left-title", component: "Text", text: "Left column" },
      { id: "left-body", component: "Text", text: "Some content here", variant: "caption" },
      {
        id: "r2c2",
        component: "Column",
        children: ["right-title", "right-body"],
      },
      { id: "right-title", component: "Text", text: "Right column" },
      { id: "right-body", component: "Text", text: "More content here", variant: "caption" },
    ]),
  ])}`,
);

// ─── States ───────────────────────────────────────────────────────────────────

const validationErrorMessage = msg(
  "g-validation",
  "assistant",
  `Form with validation:\n${a2uiBlock([
    surface(
      "validation-demo",
      [
        { id: "root", component: "Column", children: ["email", "submit"] },
        {
          id: "email",
          component: "TextField",
          label: "Email",
          value: { "@path": "/email" },
          checks: [
            {
              condition: {
                "@call": "test",
                args: { value: { "@path": "/email" }, pattern: "@" },
              },
              message: "Must be a valid email address",
            },
          ],
        },
        {
          id: "submit",
          component: "Button",
          child: "submit-text",
          variant: "primary",
          action: { event: { name: "submit" } },
          checks: [
            {
              condition: {
                "@call": "test",
                args: { value: { "@path": "/email" }, pattern: "@" },
              },
              message: "Fix the email above first",
            },
          ],
        },
        { id: "submit-text", component: "Text", text: "Submit" },
      ],
      { email: "not-an-email" },
    ),
  ])}`,
);

const composerLockMessage = msg(
  "g-composer-lock",
  "assistant",
  `This form locks the composer:\n${a2uiBlock([
    surface("lock-demo", [
      {
        id: "root",
        component: "Column",
        children: ["lockLabel", "lockField"],
        metadata: { extensions: { "chat:lockComposer": true } },
      },
      { id: "lockLabel", component: "Callout", text: "The text input is locked while this form is active.", tone: "info" },
      {
        id: "lockField",
        component: "TextField",
        label: "Answer here instead",
        value: "",
        placeholder: "Type your response in the form...",
      },
    ]),
  ])}`,
);

// ─── Realistic onboarding form ────────────────────────────────────────────────

const onboardingMessage = msg(
  "g-onboarding",
  "assistant",
  `Welcome! Let me set up your agent. Fill in the details below:\n${a2uiBlock([
    surface(
      "onboarding",
      [
        { id: "root", component: "Column", children: ["header", "divider1", "basics", "divider2", "prefs", "divider3", "submit-row"] },
        { id: "header", component: "Text", text: "Agent Onboarding" },
        { id: "divider1", component: "Divider" },
        { id: "basics", component: "Column", children: ["name-field", "desc-field", "runtime-picker"] },
        {
          id: "name-field",
          component: "TextField",
          label: "Agent name",
          value: { "@path": "/name" },
          placeholder: "e.g. deploy-bot",
        },
        {
          id: "desc-field",
          component: "TextField",
          label: "Description",
          value: { "@path": "/description" },
          placeholder: "What does this agent do?",
          variant: "longText",
        },
        {
          id: "runtime-picker",
          component: "ChoicePicker",
          label: "Harness",
          variant: "mutuallyExclusive",
          options: [
            { label: "Claude Code", value: "claude-code" },
            { label: "Codex", value: "codex" },
            { label: "Gemini CLI", value: "gemini" },
          ],
          value: { "@path": "/harness" },
        },
        { id: "divider2", component: "Divider" },
        { id: "prefs", component: "Column", children: ["size-slider", "auto-hibernate", "notify-switch"] },
        {
          id: "size-slider",
          component: "Slider",
          label: "Compute (CPU cores)",
          min: 1,
          max: 8,
          value: { "@path": "/cpu" },
          steps: 7,
        },
        {
          id: "auto-hibernate",
          component: "Switch",
          label: "Auto-hibernate",
          description: "Hibernate after 30 minutes of inactivity",
          value: { "@path": "/autoHibernate" },
        },
        {
          id: "notify-switch",
          component: "Switch",
          label: "Slack notifications",
          description: "Post session summaries to your channel",
          value: { "@path": "/slackNotify" },
        },
        { id: "divider3", component: "Divider" },
        { id: "submit-row", component: "Row", children: ["cancel-btn", "create-btn"], justify: "end" },
        {
          id: "cancel-btn",
          component: "Button",
          child: "cancel-text",
          variant: "default",
          action: { event: { name: "cancel" } },
        },
        { id: "cancel-text", component: "Text", text: "Cancel" },
        {
          id: "create-btn",
          component: "Button",
          child: "create-text",
          variant: "primary",
          action: { event: { name: "create", userMessage: "Create the agent" } },
        },
        { id: "create-text", component: "Text", text: "Create Agent" },
      ],
      {
        name: "",
        description: "",
        harness: ["claude-code"],
        cpu: 2,
        autoHibernate: true,
        slackNotify: false,
      },
    ),
  ])}`,
);

// ─── Gallery component ────────────────────────────────────────────────────────

export function ChatFormsGallery() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Chat Forms Gallery
      </h1>
      <p className="text-sm text-muted-foreground">
        Every a2ui v1.0 component rendered inside the chat message system.
        Origin/main commit: <code className="text-xs">54ad4d874</code>
      </p>

      <SectionTitle>Inputs</SectionTitle>

      <StateLabel>TextField (short, long, number, obscured)</StateLabel>
      <MessageSlot message={textFieldMessage} />

      <StateLabel>CheckBox</StateLabel>
      <MessageSlot message={checkboxMessage} />

      <StateLabel>Switch</StateLabel>
      <MessageSlot message={switchMessage} />

      <StateLabel>ChoicePicker (single, multi, chips)</StateLabel>
      <MessageSlot message={choicePickerMessage} />

      <StateLabel>Slider</StateLabel>
      <MessageSlot message={sliderMessage} />

      <StateLabel>DateTimeInput</StateLabel>
      <MessageSlot message={dateTimeMessage} />

      <SectionTitle>Display</SectionTitle>

      <StateLabel>Text (body + caption)</StateLabel>
      <MessageSlot message={textMessage} />

      <StateLabel>Callout (all tones)</StateLabel>
      <MessageSlot message={calloutMessage} />

      <StateLabel>Badge (all tones)</StateLabel>
      <MessageSlot message={badgeMessage} />

      <StateLabel>Icon</StateLabel>
      <MessageSlot message={iconMessage} />

      <StateLabel>Image</StateLabel>
      <MessageSlot message={imageMessage} />

      <StateLabel>Divider</StateLabel>
      <MessageSlot message={dividerMessage} />

      <StateLabel>CodeBlock</StateLabel>
      <MessageSlot message={codeBlockMessage} />

      <StateLabel>Diff</StateLabel>
      <MessageSlot message={diffMessage} />

      <SectionTitle>Layout</SectionTitle>

      <StateLabel>Card</StateLabel>
      <MessageSlot message={cardMessage} />

      <StateLabel>List</StateLabel>
      <MessageSlot message={listMessage} />

      <StateLabel>Tabs</StateLabel>
      <MessageSlot message={tabsMessage} />

      <StateLabel>Modal</StateLabel>
      <MessageSlot message={modalMessage} />

      <StateLabel>Row + Column</StateLabel>
      <MessageSlot message={rowColumnMessage} />

      <SectionTitle>States</SectionTitle>

      <StateLabel>Validation error</StateLabel>
      <MessageSlot message={validationErrorMessage} />

      <StateLabel>Composer lock</StateLabel>
      <MessageSlot message={composerLockMessage} />

      <SectionTitle>Realistic Form</SectionTitle>

      <StateLabel>Agent onboarding form</StateLabel>
      <MessageSlot message={onboardingMessage} />
    </div>
  );
}
