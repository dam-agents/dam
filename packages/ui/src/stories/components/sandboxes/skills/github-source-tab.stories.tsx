import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SkillSource } from "api-server-api";
import { useEffect } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { DialogHeader, Modal } from "@/components/modal";
import { GithubSourceTab } from "@/modules/sandboxes/components/skills/github-source-tab";
import { useGithubSourceForm } from "@/modules/sandboxes/hooks/use-github-source-form";

import { ensureScenario } from "./skills-harness";

interface Args {
  /** Pre-fill the form with the URL of an existing fixture source. */
  prefill: "none" | "repo" | "repo-with-path";
  onClose: () => void;
}

const load = async () => {
  ensureScenario("populated");
  return { sources: await api.skills.sources.list.query() };
};
type Loaded = Awaited<ReturnType<typeof load>>;

function Tab({ sources, prefill, onClose }: Args & { sources: SkillSource[] }) {
  const github = useGithubSourceForm({
    sources: [],
    onCreate: async () => null,
    onClose,
  });
  const { setValue } = github.form;
  useEffect(() => {
    const src = sources.find((s) => s.path) ?? sources[0];
    if (!src || prefill === "none") return;
    setValue("name", src.name, { shouldValidate: true });
    setValue(
      "gitUrl",
      prefill === "repo-with-path" && src.path
        ? `${src.gitUrl}/tree/main/${src.path}`
        : src.gitUrl,
      { shouldValidate: true },
    );
  }, [sources, prefill, setValue]);
  return (
    <Modal>
      <DialogHeader
        title="Add skill source"
        onClose={onClose}
        divided={false}
      />
      <GithubSourceTab github={github} onClose={onClose} />
    </Modal>
  );
}

const meta = {
  title: "Components/Sandboxes/Skills/GithubSourceTab",
  loaders: [load],
  args: { prefill: "none", onClose: fn() },
  render: (args, { loaded }) => (
    <Tab {...args} sources={(loaded as Loaded).sources} />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { prefill: "repo" } };
/** A tree link: the resolved repo and path are spelled out under the URL. */
export const TreeLink: Story = { args: { prefill: "repo-with-path" } };
