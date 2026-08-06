# Types

**Read when:** typing a prop, API response, error, Zustand slice, hook return; adding a type assertion; hitting a `tsc` error; reviewing typed code.

## Principles

**[CRITICAL] Types are contracts at boundaries, not obstacles inside.** Tight types at module boundaries (props, API responses, hook returns, store state) buy you safety everywhere else. Inside a function, trust the inferred types; don't annotate what TypeScript already knows.

**[CRITICAL] `any` is a bug.** Every `any` at a module boundary silently deletes type safety for everything that touches it. Use `unknown` and narrow, or define the type, or infer from Zod.

## `type` vs `interface`

**[MODERATE]** Both work. Use:
- **`interface`** for **object shapes that might be extended** (props, context values, module augmentation). Named in errors as the interface name.
- **`type`** for **everything else** — unions, intersections, tuples, mapped types, conditional types, records, function types.

```ts
✅ interface AgentCardProps { agent: Agent; onSelect?: (id: string) => void }
✅ type AgentStatus = "idle" | "running" | "failed";
✅ type AgentMap = Record<string, Agent>;
```

Don't alternate randomly — within a single file, stick with one style for similar things.

## No `React.FC<>`

**[HIGH]** See `references/components.md`. Plain function declarations with a `Props` parameter.

## Props typing

```tsx
interface Props {
  agent: Agent;
  variant?: "compact" | "full";
  onSelect?: (id: string) => void;
  children?: ReactNode;
}
export function AgentCard({ agent, variant = "full", onSelect, children }: Props) { ... }
```

- Optional props: `?` in the type.
- Children typed explicitly with `ReactNode` (don't use `PropsWithChildren` — the extra indirection buys nothing).
- Handlers typed as specific function signatures. Avoid `(e: any) => void`.

## Zod-inferred types

**[CRITICAL]** Data shapes that come from/go to the server are defined as Zod schemas; the TypeScript type is inferred:

```ts
// modules/agents/api/schemas.ts
export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["idle", "running", "failed"]),
  tools: z.array(z.string()),
});
export type Agent = z.infer<typeof agentSchema>;
```

Benefits:
- Single source of truth.
- Runtime validation matches compile-time types.
- Refactoring the schema updates the type automatically.

**[HIGH] Export the schema *and* the type.** Consumers that validate import the schema; consumers that just type their variables import the type.

## `unknown` over `any`

When a value genuinely has an unknown shape — an external library return, a parsed JSON, an error — type it as `unknown` and narrow before use:

```ts
✅ function parseConfig(raw: unknown): Config {
     return configSchema.parse(raw);  // throws if invalid — narrows to Config
   }

❌ function parseConfig(raw: any): Config { return raw; }
```

For errors:
```ts
✅ try { ... } catch (err: unknown) {
     if (err instanceof ApiError) { ... }
     if (err instanceof Error) { console.error(err.message); }
   }
```

## `as` — last resort

**[HIGH]** Type assertions are a tool of last resort. Prefer:

1. **Type guards** (`isAgent(x)` returns `x is Agent`).
2. **Zod parsing** at boundaries (`agentSchema.parse(raw)`).
3. **Discriminated unions** with `match` / `switch` on a `type` field.
4. **Only then** `as`, with a comment explaining why.

Allowed `as` patterns:
- **`as const`** for literal-type narrowing — totally fine.
- **`as CSSProperties`** when React's type for `style` is stricter than CSS custom properties allow. Fine.
- **Narrowing after an `if` you can't express in TS** — acceptable with a comment.

```ts
✅ const tuple = ["hello", 42] as const;
✅ <div style={{ "--width": `${pct}%` } as CSSProperties} />
❌ const agent = maybeAgent as Agent;            // no narrowing justification
❌ const fn = handler as (e: any) => void;        // hides a real mismatch
```

A common smell is casting to narrow after a conditional (e.g., `colors[state as Status]`). The right fix is a type guard or a discriminated union, not an `as`.

## Discriminated unions + `ts-pattern`

**[HIGH]** When a value has multiple variants distinguished by a tag, model it as a discriminated union:

```ts
type FormField =
  | { type: "text"; name: string; maxLength?: number }
  | { type: "number"; name: string; min?: number; max?: number }
  | { type: "select"; name: string; options: string[] };
```

Exhaustive matching with `ts-pattern`:

```ts
import { match } from "ts-pattern";

const element = match(field)
  .with({ type: "text" }, (f) => <TextField field={f} />)
  .with({ type: "number" }, (f) => <NumberField field={f} />)
  .with({ type: "select" }, (f) => <SelectField field={f} />)
  .exhaustive();  // compile error if a variant is missing
```

`.exhaustive()` is the key: when someone adds a new variant, this call will fail to type-check until they update the match.

## Generics

Use them when a function or type genuinely parameterizes over its input:

```ts
✅ export function isNotNull<T>(v: T | null | undefined): v is T {
     return v != null;
   }

✅ export function useToggleSet<T>(initial: T[] = []) {
     const [set, setSet] = useState<Set<T>>(() => new Set(initial));
     // ...
   }
```

Don't over-generic — if a function only ever takes one concrete type, don't add a `<T>` for future flexibility that may never come.

## Hook return types

**[MODERATE]** Let inference do the work for hook return types. Only annotate when:
- You want to hide implementation details (e.g., return a narrower interface than inference gives).
- The inference surfaces ugly internal types (e.g., a giant `QueryObserverResult<A, B, C>`).

```ts
✅ export function useAgents() {
     return trpc.agents.list.useQuery();  // return type inferred, tRPC keeps it typed
   }
```

## Errors

**[HIGH]** Typed error hierarchy for your domain:

```ts
export class ApiError extends Error {
  constructor(public status: number, public body?: unknown, message?: string) {
    super(message ?? `Request failed with ${status}`);
  }
}
export class ValidationError extends Error { ... }
```

Then `err instanceof ApiError` narrows in `catch` blocks and toast/logging code. Don't type-guard with duck-typing (`if ("status" in err)`) when a proper class exists.

See `references/api-layer.md` for the end-to-end error contract.

## Constants & literals

**[HIGH] No magic strings/numbers.** A literal that carries meaning beyond its value, or appears more than once, becomes a named constant. The bar isn't "extract every literal" — single-use, self-explanatory values stay inline. It's "if a future reader has to read surrounding code to understand what `3000` or `"idle"` means, name it."

Common offenders:

```ts
❌ if (agent.status === "running" && Date.now() - agent.startedAt > 30_000) { ... }
❌ await fetch(`/api/v2/agents/${id}`);
❌ setTimeout(refetch, 5000);
```

Fixed:

```ts
✅ if (agent.status === AGENT_STATUS.RUNNING && Date.now() - agent.startedAt > AGENT_STALL_MS) { ... }
✅ await fetch(`${API_BASE}/agents/${id}`);
✅ setTimeout(refetch, REFETCH_INTERVAL_MS);
```

### Where constants live

- **Domain-scoped** (a status set, a domain-specific limit) → `modules/{domain}/constants.ts`.
- **App-wide** (API base path, default page size, shared animation durations) → `src/utils/constants.ts` or `src/lib/constants.ts`.
- **Single-use in one file** → module-scope `const` at the top of the same file. Don't relocate it to a constants file just to satisfy the rule.

### Union literals — no TS `enum`

For sets of allowed string values, the source of truth is a Zod schema or an `as const` tuple — **never a TypeScript `enum`** (emits a runtime object, doesn't tree-shake, doesn't compose with Zod, has surprising numeric-enum semantics).

```ts
// Pattern A — Zod schema is the source; type and tuple both fall out of it.
✅ export const agentStatusSchema = z.enum(["idle", "running", "failed"]);
   export type AgentStatus = z.infer<typeof agentStatusSchema>;
   export const AGENT_STATUSES = agentStatusSchema.options; // readonly ["idle", "running", "failed"]

// Pattern B — tuple is the source; type is derived from it.
✅ export const AGENT_STATUSES = ["idle", "running", "failed"] as const;
   export type AgentStatus = (typeof AGENT_STATUSES)[number];

❌ enum AgentStatus { Idle = "idle", Running = "running", Failed = "failed" }
```

If you need a tuple guaranteed to cover every union member (i.e. exhaustiveness, not just no-typos), use Pattern A — Zod's `.options` gives you the full tuple by construction.

### When inline is fine

- Self-explanatory at the call site: `arr.slice(0, 1)`, `disabled={count === 0}`, `flex: 1`, `opacity-0`.
- Math constants whose meaning is the literal itself: `width / 2` for centering.
- Test fixtures and one-off mock data.

Extracting these adds noise without adding meaning.

### Already covered elsewhere

- **Tailwind arbitrary values** repeated 3+ times → theme token. See `references/styling.md`.
- **Query keys** → always come from the per-domain factory, never string literals. See `references/async-data.md`.

## Anti-patterns

- **`any` anywhere except in a temporary migration comment with a `TODO` deadline.**
- **`as` used to "shut up the compiler"** — the compiler is telling you something is off.
- **Non-null assertions (`x!`, `undefined!`)** — same smell as `as`, just narrower. If the value really can't be null, prove it with a guard or refactor the API; if it can, handle it.
- **`@ts-ignore` / `@ts-expect-error`** without a comment explaining why — if it's needed, it's needed *and* explained.
- **Redundant annotations** (`const name: string = getName()` when `getName` is typed).
- **Missing types on exported function parameters** — always annotate the public surface.
- **`type Props = {}`** (empty props) — omit the parameter.
- **Magic strings / numbers** — repeated literals with semantic meaning belong in a named constant.
- **TypeScript `enum`** — use Zod enums or `as const` tuples instead.
