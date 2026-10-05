# Types

**Read when:** typing a prop, API response, error, Zustand slice or hook return; adding a type assertion; hitting a `tsc` error; reviewing typed code.

## Principles

**[CRITICAL] Types are contracts at boundaries, not obstacles inside.** Type props, API responses, hook returns and store state tightly; inside a function, trust inference and don't annotate what TypeScript already knows.

**[CRITICAL] `any` is a bug.** One `any` at a boundary deletes type safety for everything touching it. Use `unknown` and narrow, define the type, or infer it from Zod.

## `type` vs `interface`

**[MODERATE]** `interface` for object shapes that might be extended (props, context values, module augmentation; errors show the interface name). `type` for everything else: unions, intersections, tuples, mapped/conditional types, records, function types. Within a file, be consistent for similar things.

```ts
✅ interface AgentCardProps { agent: Agent; onSelect?: (id: string) => void }
✅ type AgentStatus = "idle" | "running" | "failed";
✅ type AgentMap = Record<string, Agent>;
```

## Props

**[HIGH] No `React.FC<>`**; plain function declarations with a `Props` parameter (`references/components.md`).

```tsx
interface Props {
  agent: Agent;
  variant?: "compact" | "full";
  onSelect?: (id: string) => void;
  children?: ReactNode;
}
export function AgentCard({ agent, variant = "full", onSelect, children }: Props) { ... }
```

Optional props use `?`; children are typed explicitly as `ReactNode` (not `PropsWithChildren`, whose indirection buys nothing); handlers get specific signatures, never `(e: any) => void`.

## Zod-inferred types

**[CRITICAL]** Shapes to/from the server are Zod schemas with inferred types: one source of truth, runtime validation matching compile-time types, schema changes propagating automatically.

```ts
export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["idle", "running", "failed"]),
  tools: z.array(z.string()),
});
export type Agent = z.infer<typeof agentSchema>;
```

**[HIGH] Export the schema *and* the type**: validators import the schema, everyone else the type.

## `unknown` over `any`

Type genuinely unknown shapes (library returns, parsed JSON, errors) as `unknown` and narrow:

```ts
✅ function parseConfig(raw: unknown): Config { return configSchema.parse(raw); }
❌ function parseConfig(raw: any): Config { return raw; }

✅ try { ... } catch (err: unknown) {
     if (err instanceof ApiError) { ... }
     if (err instanceof Error) { console.error(err.message); }
   }
```

## `as`: last resort

**[HIGH]** In order of preference: type guards (`isAgent(x): x is Agent`); Zod parsing at boundaries; discriminated unions matched on a tag; only then `as`, isolated in a well-named helper so the name says why.

Allowed: `as const`; `as CSSProperties` where React's `style` type rejects CSS custom properties; narrowing after an `if` TS can't express, inside a named type guard.

```ts
✅ const tuple = ["hello", 42] as const;
✅ <div style={{ "--width": `${pct}%` } as CSSProperties} />
❌ const agent = maybeAgent as Agent;
❌ const fn = handler as (e: any) => void;
```

Casting to narrow after a conditional (`colors[state as Status]`) is the common smell; fix it with a guard or a discriminated union.

## Discriminated unions + `ts-pattern`

**[HIGH]** Model tagged variants as discriminated unions and match exhaustively; `.exhaustive()` fails to type-check when a new variant goes unhandled.

```ts
type FormField =
  | { type: "text"; name: string; maxLength?: number }
  | { type: "number"; name: string; min?: number; max?: number }
  | { type: "select"; name: string; options: string[] };

const element = match(field)
  .with({ type: "text" }, (f) => <TextField field={f} />)
  .with({ type: "number" }, (f) => <NumberField field={f} />)
  .with({ type: "select" }, (f) => <SelectField field={f} />)
  .exhaustive();
```

## Generics

Use them only when the function truly parameterizes over its input; no `<T>` for speculative flexibility.

```ts
✅ export function isNotNull<T>(v: T | null | undefined): v is T { return v != null; }
✅ export function useToggleSet<T>(initial: T[] = []) {
     const [set, setSet] = useState<Set<T>>(() => new Set(initial));
   }
```

## Hook return types

**[MODERATE]** Let inference type hook returns. Annotate only to hide implementation detail (a narrower interface) or ugly internal types (a giant `QueryObserverResult<A, B, C>`).

```ts
✅ export function useAgents() { return useQuery(trpc.agents.list.queryOptions()); }
```

## Errors

**[HIGH]** Use a typed error hierarchy (`class ApiError extends Error { status; body }`, `class ValidationError extends Error`) so `instanceof` narrows in `catch` blocks and toast/logging code. No duck-typing (`"status" in err`) when a class exists. End-to-end contract: `references/api-layer.md`.

## Constants & literals

**[HIGH] No magic strings/numbers.** Name a literal when it carries meaning beyond its value or appears more than once, i.e. when a reader would have to read surrounding code to understand `3000` or `"idle"`. Single-use, self-explanatory values stay inline.

```ts
❌ if (agent.status === "running" && Date.now() - agent.startedAt > 30_000) { ... }
❌ await fetch(`/api/v2/agents/${id}`);
❌ setTimeout(refetch, 5000);

✅ if (agent.status === AGENT_STATUS.RUNNING && Date.now() - agent.startedAt > AGENT_STALL_MS) { ... }
✅ await fetch(`${API_BASE}/agents/${id}`);
✅ setTimeout(refetch, REFETCH_INTERVAL_MS);
```

Where they live: domain-scoped → `modules/{domain}/constants.ts`; app-wide (API base, page size, animation durations) → `src/constants.ts`; single-use → module-scope `const` at the top of that file (don't relocate it just to satisfy the rule).

Inline is fine when self-explanatory (`arr.slice(0, 1)`, `disabled={count === 0}`, `flex: 1`, `opacity-0`), for math whose meaning is the literal (`width / 2`), and in test fixtures.

Repeated Tailwind arbitrary values → theme token (`references/styling.md`). Query keys → `queryKey()` or the domain factory (`references/async-data.md`).

### Union literals, never TS `enum`

`enum` emits a runtime object, doesn't tree-shake, doesn't compose with Zod and has surprising numeric semantics. The source of truth is a Zod enum or an `as const` tuple:

```ts
✅ export const agentStatusSchema = z.enum(["idle", "running", "failed"]);
   export type AgentStatus = z.infer<typeof agentStatusSchema>;
   export const AGENT_STATUSES = agentStatusSchema.options;

✅ export const AGENT_STATUSES = ["idle", "running", "failed"] as const;
   export type AgentStatus = (typeof AGENT_STATUSES)[number];

❌ enum AgentStatus { Idle = "idle", Running = "running", Failed = "failed" }
```

When the tuple must cover every union member (exhaustiveness, not just typo-safety), use the Zod form: `.options` is complete by construction.

## Anti-patterns

- `any` anywhere.
- `as` to silence the compiler (it's telling you something is off); non-null assertions (`x!`), the same smell: prove it with a guard or handle null.
- `@ts-ignore`, or `@ts-expect-error` without the reason on the same line (`// @ts-expect-error <why>`).
- Redundant annotations (`const name: string = getName()`).
- Unannotated parameters on exported functions.
- `type Props = {}`: omit the parameter.
- Magic strings/numbers; TypeScript `enum`.
