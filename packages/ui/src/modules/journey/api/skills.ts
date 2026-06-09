import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Skill } from "api-server-api";

import { api } from "../../../api.js";

export interface BrowsableSkill extends Skill {
  sourceName: string;
}

const BROWSABLE_SKILLS_KEY = ["journey", "browsable-skills"] as const;

/**
 * All skills available to install, flattened across every connected source.
 * Browsed without an agent (no agentId) since the new sandbox doesn't exist
 * yet — the selection is installed after the agent is created.
 */
export function useBrowsableSkills() {
  return useQuery({
    queryKey: BROWSABLE_SKILLS_KEY,
    queryFn: async (): Promise<BrowsableSkill[]> => {
      const sources = await api.skills.sources.list.query({});
      const perSource = await Promise.all(
        sources.map(async (source) => {
          const skills = await api.skills.list.query({ sourceId: source.id });
          return skills.map((skill) => ({ ...skill, sourceName: source.name }));
        }),
      );
      return perSource.flat();
    },
    meta: { errorToast: "Couldn't load skills" },
  });
}

/** Link a new skills source (public git repo). On success the browsable-skills
 *  list refetches so the new repo's skills become selectable immediately. */
export function useLinkSkillSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; gitUrl: string }) =>
      api.skills.sources.create.mutate(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: BROWSABLE_SKILLS_KEY }),
    meta: { errorToast: "Couldn't link skills repo" },
  });
}
