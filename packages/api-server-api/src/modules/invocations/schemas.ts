import { z } from "zod";
import { agentSetupSeedSchema, agentSetupShape } from "../agents/setup.js";
import { templateHarnessSchema } from "../templates/schemas.js";
import { agentConfigOptionsSchema } from "../harness-config/schemas.js";
import { egressHostSchema } from "../egress-rules/schemas.js";

export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

export const invocationHarnessConfigSchema = z
  .object({
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    configOptions: agentConfigOptionsSchema
      .refine((o) => Object.keys(o).length > 0, {
        message: "configOptions must name at least one option",
      })
      .optional(),
  })
  .refine(
    (c) =>
      c.model !== undefined ||
      c.mode !== undefined ||
      c.configOptions !== undefined,
    { message: "harnessConfig needs a model, a mode or configOptions" },
  );

// UNIT_BOUNDARY_DESCRIPTION: which of the launching agent's connections a child holds: `parent`, all of them, kept in step with the parent's own for as long as the child lives, revokes included; `none`; or the ids named, each one of the parent's own, copied once at launch.
export const childConnectionsSchema = z.union([
  z.literal("parent"),
  z.literal("none"),
  z.array(z.string().min(1)),
]);
export type ChildConnections = z.infer<typeof childConnectionsSchema>;

export const childEgressRuleSchema = z.object({
  host: egressHostSchema,
  port: z.number().int().min(1).max(65535).optional(),
  method: z.string().min(1).optional(),
  pathPattern: z.string().min(1).optional(),
  verdict: z.enum(["allow", "deny"]),
});
export type ChildEgressRule = z.infer<typeof childEgressRuleSchema>;

// UNIT_BOUNDARY_DESCRIPTION: whose egress rules decide a child's requests: `parent`, the root's, live; `open` (or `{ open: rules }`), rules of its own that the launching agent sets, with no prompt to the user and a host outside them denied; or `{ scoped: hosts }`, its own rules copied once from the parent's for those hosts (or all of them), widened only by the user's approval.
export const childEgressSchema = z.union([
  z.literal("parent"),
  z.literal("open"),
  z.object({ open: z.array(childEgressRuleSchema).max(200) }),
  z.object({
    scoped: z.union([z.literal("all"), z.array(z.string().min(1)).max(200)]),
  }),
]);
export type ChildEgress = z.infer<typeof childEgressSchema>;

const spawnTargetShape = {
  harness: templateHarnessSchema.optional(),
  image: z.string().min(1).optional(),
  connections: childConnectionsSchema.optional(),
  egress: childEgressSchema.optional(),
  keep: z.boolean().optional(),
  keepForMs: z.number().int().min(60_000).optional(),
  idleTimeoutMin: z.number().int().min(1).optional(),
  label: z.string().min(1).max(100).optional(),
  ttlMs: z
    .number()
    .int()
    .min(MIN_INVOCATION_TTL_MS)
    .max(MAX_INVOCATION_TTL_MS)
    .optional(),
  ...agentSetupShape,
  seed: agentSetupSeedSchema.optional(),
};

interface SpawnTargetFields {
  harness?: unknown;
  image?: unknown;
}

function refineSpawnTarget<S extends z.ZodType<SpawnTargetFields>>(
  schema: S,
): S {
  return schema.refine(
    (d) => d.harness !== undefined || d.image !== undefined,
    { message: "pass a harness, or an image" },
  );
}

export const spawnInvocationRequestSchema = refineSpawnTarget(
  z.object({
    ...spawnTargetShape,
    prompt: z.string().min(1),
    schema: z.unknown(),
    harnessConfig: invocationHarnessConfigSchema.optional(),
  }),
);

export const MAX_STOP_REASON_CHARS = 500;

export const stopReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STOP_REASON_CHARS);

export const stopInvocationRequestSchema = z.object({
  reason: stopReasonSchema.optional(),
});

export const stopInvocationResponseSchema = z.object({
  stopped: z.boolean(),
});

export const MAX_INVOCATION_SCRIPT_CHARS = 64 * 1024;

export const spawnScriptInvocationRequestSchema = refineSpawnTarget(
  z.object({
    ...spawnTargetShape,
    script: z.string().trim().min(1).max(MAX_INVOCATION_SCRIPT_CHARS),
  }),
);

// UNIT_BOUNDARY_DESCRIPTION: a rule of a child's open egress that its driver could not set itself, waiting for the owner's verdict: the host, and the id of the request the owner answers.
export const egressWaitingSchema = z.object({
  host: z.string().min(1),
  id: z.string().min(1),
});

export const spawnInvocationResponseSchema = z.object({
  id: z.string().min(1),
  egressWaitingForOwner: z.array(egressWaitingSchema).optional(),
});

// UNIT_BOUNDARY_DESCRIPTION: what replacing an open child's egress rules did not set: the rules that wait for the owner's approval, and the hosts the owner blocked on the child.
export const setEgressResponseSchema = z.object({
  waitingForOwner: z.array(egressWaitingSchema),
  blockedByOwner: z.array(z.object({ host: z.string().min(1) })),
});

export const OWNER_EGRESS_NOTE =
  "these rules were not set: each is your owner's to approve, and waits for their verdict (egress_proposal status with its id). Until then only your other rules apply, and a request to these hosts is denied. A rule waits when it allows a wildcard host (* or *.example.com), or lets through a request your own rules do not allow while your owner has not let your sub-agents and Environments have network access of their own";

export const INVOCATION_OUTPUT_STREAMS = ["stdout", "stderr"] as const;

export const invocationOutputStreamSchema = z.enum(INVOCATION_OUTPUT_STREAMS);

export const invocationOutputBlobSchema = z.object({
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const invocationOutputSchema = z.object({
  stdout: invocationOutputBlobSchema.optional(),
  stderr: invocationOutputBlobSchema.optional(),
});

export const MAX_OWNER_QUESTION_CHARS = 1_000;
export const MAX_OWNER_OPTION_CHARS = 80;
export const MAX_OWNER_DEFAULT_CHARS = 200;
export const MAX_OWNER_OPTIONS = 8;
export const MAX_OWNER_ANSWER_CHARS = 2_000;

// UNIT_BOUNDARY_DESCRIPTION: what a sub-agent asks its owner: the question, the answers it offers as buttons when the choice is between a few fixed ones (none for an open question, which the owner answers in their own words), what it goes on with when nobody answers in time, and optionally how long it waits for the answer.
export const ownerQuestionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(MAX_OWNER_QUESTION_CHARS)
    .describe(
      "One question, with what the owner needs to decide it. Ask everything you need in this one question: each further question costs the owner another wait.",
    ),
  options: z
    .array(z.string().trim().min(1).max(MAX_OWNER_OPTION_CHARS))
    .max(MAX_OWNER_OPTIONS)
    .optional()
    .describe(
      "Each answer the owner can pick with one click: every real choice as its own option. Up to eight are shown, so with five to eight choices list them all: do not cut the list to four. Leave it out for an open question (a number, a name, free wording). The owner can always type their own answer instead, so never add an option such as Other, and never group choices into one option or a range that would need a second question.",
    ),
  default: z
    .string()
    .trim()
    .min(1)
    .max(MAX_OWNER_DEFAULT_CHARS)
    .describe(
      "What you go on with when nobody answers in time: one of the options, written the same, or, with no options, the answer you would take.",
    ),
  answerWithinMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long to wait for the answer; a day when left out."),
});

export const ownerAnswerSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_OWNER_ANSWER_CHARS);

// UNIT_BOUNDARY_DESCRIPTION: a question a sub-agent's run ended on, as its driver reads it: `told` once a wait of the driver's handed it over.
export const invocationQuestionSchema = z.object({
  text: z.string(),
  options: z.array(z.string()),
  default: z.string(),
  answerBy: z.string(),
  told: z.boolean(),
});

export const invocationViewSchema = z.object({
  run: z.string().optional(),
  session: z.string().optional(),
  keepUntil: z.string().optional(),
  removed: z.literal(true).optional(),
  status: z.enum(["idle", "running", "done", "failed", "asking"]),
  question: invocationQuestionSchema.optional(),
  result: z.unknown(),
  errorReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  output: invocationOutputSchema.optional(),
  waiting: z.string().optional(),
  egress: z
    .object({
      allowed: z.array(z.string()),
      declined: z.array(z.string()),
      note: z.string(),
    })
    .optional(),
});

export const EGRESS_ANSWERS_NOTE =
  "your owner answered the network rules you set for it that had to wait. It reaches only what its rules allow: a request to any other host, a declined one included, is refused by closing the connection, with no response and no refusal header, so such a failure is the rule and not a network fault";

export const invocationOutputLinkSchema = invocationOutputBlobSchema.extend({
  url: z.string().min(1),
});

export const INVOCATIONS_TREE_MAX_IDS = 200;

export const invocationsTreeInputSchema = z.object({
  driverAgentId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(INVOCATIONS_TREE_MAX_IDS),
});

export const invocationsKeptInputSchema = z.object({
  driverAgentId: z.string().min(1),
});

export const invocationsRunningInputSchema = z.object({
  driverAgentId: z.string().min(1),
  sessionId: z.string().min(1).nullable().optional(),
});

export const invocationTranscriptInputSchema = z.object({
  driverAgentId: z.string().min(1),
  id: z.string().min(1),
});

export const invocationStopInputSchema = invocationTranscriptInputSchema;

export const invocationsQuestionsInputSchema = invocationsRunningInputSchema;

export const invocationAnswerInputSchema = z.object({
  driverAgentId: z.string().min(1),
  id: z.string().min(1),
  answer: ownerAnswerSchema,
});
