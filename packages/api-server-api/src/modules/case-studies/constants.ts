import { STAGED_SKILLS_DIR } from "agent-runtime-api";

export const CASE_STUDY_CONTENT_MAX_CHARS = 262_144;

export const CASE_STUDY_SKILL_NAME = "agent-case-study";

export const CASE_STUDY_SKILL_PATH = `${STAGED_SKILLS_DIR}/${CASE_STUDY_SKILL_NAME}/SKILL.md`;

export const CASE_STUDY_SCHEDULE_TASK = `Read ${CASE_STUDY_SKILL_PATH} and follow it to produce this week's edition of your case study. If that file does not exist, reply that this image does not ship the case-study skill and stop — do not attempt the task without it.`;
