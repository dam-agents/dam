# Async data (TanStack Query)

**Read when:** fetching data, mutating server state, touching code that talks to the backend, setting up caching/invalidation, configuring the QueryClient.

## The rule

**[CRITICAL] All server state goes through TanStack Query.** No `useEffect` + `fetch` in components. No manual `useState(loading)` / `useState(error)` / `useState(data)` trios. No Zustand slices holding server lists. If it came from the server or will be sent to the server, it's a `useQuery` or `useMutation`.

Why: TQ gives you, for free, all the pieces a hand-rolled `useState`/`useEffect` fetch layer fails at — request deduplication, stale-while-revalidate, invalidation, cache GC, focus refetch, query cancellation, paginated & infinite queries, optimistic updates with rollback, and a single place for cross-cutting error handling.

## Setup: `@trpc/react-query`

**[HIGH]** When the backend is tRPC, integrate via `@trpc/react-query` so tRPC procs become typed TQ hooks directly. No separate fetcher wrapper needed for tRPC calls.

```ts
// src/api/trpc.ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../server/router";
export const trpc = createTRPCReact<AppRouter>();
```

```tsx
// src/api/trpc-provider.tsx
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => buildQueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", fetch: authFetch })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

Call sites:
```ts
const agents = trpc.agents.list.useQuery();             // typed, cached, invalidatable
const createAgent = trpc.agents.create.useMutation();   // typed mutation
```

For per-scope tRPC clients (e.g., one client per authenticated entity or per runtime instance), mirror the pattern with a scoped provider that wraps the subtree.

## QueryClient config

**[HIGH]** Centralize defaults in `src/api/query-client.ts`. Inherit from adk-ui:

```ts
export function buildQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,        // 60s — avoid thrashing on remount
        gcTime: 24 * 60 * 60_000, // 24h — large cache, cheap
        retry: (failureCount, error) => {
          if (isUnauthorized(error)) return false;  // don't retry 401s
          return failureCount < 3;
        },
      },
    },
    queryCache: new QueryCache({ onError: handleQueryError }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => {
        const invalidates = mutation.meta?.invalidates;
        if (Array.isArray(invalidates)) {
          invalidates.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
        }
      },
      onError: (error, _vars, _ctx, mutation) => {
        handleMutationError(error, mutation.meta?.errorToast);
      },
    }),
  });
}
```

This is where "all mutations toast their errors" and "all mutations invalidate their related queries" happens exactly once.

### Typed `meta`

**[HIGH]** Add module augmentation so `meta.invalidates` and `meta.errorToast` are typed:

```ts
// src/api/trpc-meta.d.ts
import "@tanstack/react-query";
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      invalidates?: readonly unknown[][];
      errorToast?: { title?: string; includeErrorMessage?: boolean };
    };
    queryMeta: {
      errorToast?: { title?: string; includeErrorMessage?: boolean };
    };
  }
}
```

## Query key factories

**[CRITICAL] One factory per domain.** No string-literal keys, no duplicated hierarchies. The factory is the single source of truth for every query shape in the domain.

```ts
// src/modules/agents/api/keys.ts
export const agentKeys = {
  all: () => ["agents"] as const,
  list: () => [...agentKeys.all(), "list"] as const,
  listWithFilter: (filter: string) => [...agentKeys.list(), { filter }] as const,
  detail: (id: string) => [...agentKeys.all(), "detail", id] as const,
  access: (id: string) => [...agentKeys.all(), "access", id] as const,
};
```

Hierarchical keys let you invalidate wide (`agentKeys.all()` — all agent queries) or narrow (`agentKeys.detail(id)` — just this agent). With `@trpc/react-query`, the trpc client auto-generates keys for its procedures — use those for tRPC calls and the factory for non-tRPC fetchers.

## Query hook pattern

One query per file for discoverability. Name the file after the hook:

```ts
// src/modules/agents/api/queries/use-agents.ts
export function useAgents(params?: { filter?: string }) {
  return trpc.agents.list.useQuery(params ?? {}, {
    // meta for custom error-toast if the default isn't right
    meta: { errorToast: { title: "Couldn't load agents" } },
  });
}
```

Component:
```tsx
const { data, isLoading, error } = useAgents({ filter });
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <AgentList agents={data ?? []} />;
```

### Loading and error UI

**[HIGH] Use TQ's state directly** — don't copy it into `useState`. The standard triad:

```tsx
if (isLoading) return <Spinner />;      // first-time load
if (error) return <ErrorMessage ... />;  // failed
return <List items={data ?? []} />;      // data (or empty)
```

For background refetches, check `isFetching` vs `isLoading`. `isLoading` is only true on the first fetch; `isFetching` is true for any in-flight refetch. Use `isFetching` for a subtle "refreshing…" indicator, `isLoading` for the big empty-state spinner.

## Mutation hook pattern

```ts
// src/modules/agents/api/mutations/use-create-agent.ts
interface Options {
  onSuccess?: (agent: Agent) => void;
}
export function useCreateAgent(options: Options = {}) {
  return trpc.agents.create.useMutation({
    onSuccess: options.onSuccess,
    meta: {
      invalidates: [agentKeys.list()],
      errorToast: { title: "Couldn't create agent", includeErrorMessage: true },
    },
  });
}
```

Component:
```tsx
const createAgent = useCreateAgent({ onSuccess: () => closeDialog() });
// ...
<Button onClick={() => createAgent.mutate({ name, model })} disabled={createAgent.isPending}>
  Create
</Button>
```

### Invalidation

**[CRITICAL] Use `meta.invalidates`.** Do not call `queryClient.invalidateQueries()` by hand inside `onSuccess` — the MutationCache handler does it centrally for every mutation.

If a mutation needs to invalidate something that depends on its *response* (e.g., an id returned by the server), the handler supports functions too — extend the MutationCache `onSuccess` to accept a function form (`invalidates: (data) => [...]`). Or call `queryClient.invalidateQueries` in the mutation's own `onSuccess` when truly dynamic.

### Optimistic updates

Use TQ's `onMutate`/`onError`/`onSettled` pattern — don't shadow-copy server data into Zustand for optimism.

```ts
return trpc.agents.update.useMutation({
  onMutate: async (updated) => {
    await queryClient.cancelQueries({ queryKey: agentKeys.detail(updated.id) });
    const prev = queryClient.getQueryData(agentKeys.detail(updated.id));
    queryClient.setQueryData(agentKeys.detail(updated.id), updated);
    return { prev };
  },
  onError: (_err, updated, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(agentKeys.detail(updated.id), ctx.prev);
  },
  meta: { invalidates: [agentKeys.detail], errorToast: { title: "Update failed" } },
});
```

### Mutations returning a mutation call

Inside a form's submit handler, call `mutate` (fire-and-forget) or `mutateAsync` (awaitable). Use `mutateAsync` when the form needs to chain behavior (show toast then close). Use `mutate` when `onSuccess` can handle everything.

## Non-tRPC fetchers

For endpoints not served by tRPC (e.g., OAuth redirect endpoints, file upload, legacy REST):

```ts
// src/modules/connections/api/index.ts
import { z } from "zod";

const oauthStartResponseSchema = z.object({ redirectUrl: z.string().url() });

export async function startOauth(connectorId: string) {
  const res = await authFetch(`/api/oauth/start?connector=${connectorId}`);
  if (!res.ok) throw new ApiError(res);
  return oauthStartResponseSchema.parse(await res.json());
}
```

Wrap in a mutation hook:
```ts
export function useStartOauth() {
  return useMutation({
    mutationFn: startOauth,
    meta: {
      invalidates: [connectionKeys.list()],
      errorToast: { title: "Couldn't start OAuth", includeErrorMessage: true },
    },
  });
}
```

**[HIGH] Zod-validate every non-tRPC response.** tRPC brings its own types end-to-end; raw `fetch` does not — the parser is the only thing standing between a server bug and a runtime crash.

## `useSuspenseQuery`

**[MODERATE] Opt-in.** `useSuspenseQuery` removes the `isLoading` ladder but requires proper `<Suspense>` + `<ErrorBoundary>` wrapping. Default to `useQuery`; reach for suspense queries only in sub-trees already wrapped in the boundaries.

If you use it, pair every suspense query with an error boundary that can recover (reset via `useQueryErrorResetBoundary`).

## Query invalidation hygiene

- **Invalidate narrowly.** `agentKeys.list()` is usually the right level after a create/update/delete of agents. Don't invalidate `agentKeys.all()` unless you actually changed something that affects every agent query.
- **Don't overlap.** Two mutations invalidating the same key in the same tick still refetch once — TQ dedupes — but your mental model of what each mutation affects should be narrow and explicit.
- **Tests for invalidation** (future): assert that the mutation's `meta.invalidates` matches the queries the user would see.

## Migration pattern

A fetch-in-component block converts cleanly to a TQ hook:

```tsx
// BEFORE
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [data, setData] = useState<Connection[]>([]);
useEffect(() => {
  (async () => {
    try { setData(await api.connections.list()); }
    catch (e) { setError(toErrorMessage(e)); }
    finally { setLoading(false); }
  })();
}, []);
```

```tsx
// AFTER
const { data, isLoading, error } = useConnections();
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <ConnectionsList connections={data ?? []} />;
```

Where `useConnections` is a `trpc.connections.list.useQuery()` wrapper (or a `useQuery` with a Zod-validated fetcher for non-tRPC endpoints).

## Consuming query and mutation hooks

**[HIGH] Destructure queries. Keep mutations encapsulated.**

The objects returned by `useQuery` / `useMutation` have a **new identity every render** — they're snapshots of the current state. Their callable fields (`refetch`, `mutate`, `mutateAsync`) are stable refs under the hood, but `react-hooks/exhaustive-deps` can't see that: it flags any access through the object as "you used `query`, put `query` in deps." Putting the object in deps re-invalidates every render and loops the effect.

The rule that avoids both the runtime loop and the lint noise:

```tsx
// Query — destructure up top. Deps arrays reference local variables.
const { data = [], refetch, isFetching, isPending } = useSecrets();

useEffect(() => { refetch(); }, [refetch]);   // ✅ exhaustive-deps satisfied

// Mutation — keep encapsulated. Fields are consumed at event handlers,
// not deps arrays, so the object's per-render identity never bites.
const updateSecret = useUpdateSecret();
<button onClick={() => updateSecret.mutate(values)} disabled={updateSecret.isPending}>
```

Why the asymmetry:

- Queries produce values the render consumes (`data`, `isPending`) and stable callables that genuinely land in deps (`refetch`). Destructuring makes both flow cleanly.
- Mutations are almost always fired from event handlers and render state (`isPending`) read inline. Their `mutate` rarely needs to be in deps. Encapsulating them (`createSecret.mutate(...)`) keeps the name signal — you're calling a mutation — without forcing a destructure that most consumers don't benefit from.

**[CRITICAL] Never `eslint-disable react-hooks/exhaustive-deps` to paper over the object-in-deps problem.** If the rule complains, you're putting something non-stable into deps. Destructure the stable field as a local variable and the warning disappears on its own.

```tsx
❌ // Disabling the rule because "we know refetch is stable":
   }, [fetchX, fetchY, query.refetch]);
   // eslint-disable-next-line react-hooks/exhaustive-deps

✅ // Destructure so exhaustive-deps has nothing to complain about:
   const { refetch } = useXxx();
   …
   }, [fetchX, fetchY, refetch]);
```

## Anti-patterns

- **`useEffect` + `fetch`/`tRPC` in a component** — convert to `useQuery`.
- **`loading/error/saving` useState trio** — let TQ provide them.
- **String-literal query keys** (`queryKey: ["agents"]`) — use the factory.
- **Inline `queryClient.invalidateQueries` in `onSuccess`** — use `meta.invalidates`.
- **Shadow-copying TQ data into local `useState` for optimism** — use `onMutate`.
- **A Zustand slice holding a server list** — migrate to TQ.
- **The whole query/mutation object in a deps array** — see "Consuming query and mutation hooks".
- **`eslint-disable react-hooks/exhaustive-deps` to silence the loop warning** — destructure the stable field instead; the rule exists to catch real bugs.
