# Async data (TanStack Query)

**Read when:** fetching or mutating server state, caching/invalidation, configuring the QueryClient.

## The rule

**[CRITICAL] All server state goes through TanStack Query.** No `useEffect` + `fetch` in components, no `useState` loading/error/data trios, no Zustand slices holding server lists. Anything from or to the server is a `useQuery` or `useMutation`.

Why: TQ provides what hand-rolled fetch layers get wrong: deduplication, stale-while-revalidate, invalidation, cache GC, focus refetch, cancellation, paginated/infinite queries, optimistic updates with rollback, and one place for cross-cutting error handling.

## Setup: `@trpc/tanstack-react-query`

**[HIGH]** For a tRPC backend, `createTRPCOptionsProxy` turns each procedure into typed `queryOptions` / `mutationOptions` / `queryKey` factories consumed by plain TQ hooks. No fetcher wrapper for tRPC calls.

```ts
// src/trpc.ts
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "api-server-api";
import { api } from "./api.js";
import { queryClient } from "./query-client.js";

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: api, queryClient });
```

`api` (`src/api.ts`) is the vanilla `createTRPCClient<AppRouter>` over a `wsLink`; `queryClient` is the app singleton below. Call sites:

```ts
const agents = useQuery(trpc.agents.list.queryOptions());
const createAgent = useMutation(trpc.agents.create.mutationOptions());
```

For per-scope tRPC clients (one per authenticated entity or runtime instance), use a scoped provider around the subtree (`references/api-layer.md`).

## QueryClient config

**[HIGH]** Centralize defaults in `src/query-client.ts`. That is where "every mutation toasts its error" and "every mutation invalidates its related queries" happen, exactly once:

```ts
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const toast = query.meta?.errorToast;
      if (toast) emitToast({ kind: "warning", message: toast });
    },
  }),
  defaultOptions: {
    queries: { retry: 3, staleTime: 30_000 },
    mutations: {
      onSuccess: (_data, _vars, _ctx, mutation) => {
        mutation.meta?.invalidates?.forEach((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        );
      },
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.suppressErrorToast) return;
        const title = mutation.meta?.errorToast;
        const detail = getErrorMessage(error, "");
        emitToast({ kind: "error", message: title && detail ? `${title}: ${detail}` : title || detail || "Action failed" });
      },
    },
  },
});
```

(The real file also suppresses toasts while the API is reconnecting or terms are stale, and dedupes outage toasts per query.)

### Typed `meta`

**[HIGH]** Module augmentation (in `src/query-client.ts`) types `meta`:

```ts
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { invalidates?: QueryKey[]; errorToast?: string; suppressErrorToast?: boolean };
    queryMeta: { errorToast?: string };
  }
}
```

## Query keys

**[CRITICAL] One source of truth per query shape; no string-literal keys, no duplicated hierarchies.** For tRPC, use the procedure's own `trpc.x.y.queryKey()` / `pathFilter()`. For non-tRPC fetchers, one hierarchical factory per domain:

```ts
// src/modules/files/api/keys.ts
export const fileKeys = {
  root: (agentId: string) => ["files", agentId] as const,
  tree: (agentId: string) => [...fileKeys.root(agentId), "tree"] as const,
  content: (agentId: string, path: string) => [...fileKeys.root(agentId), "content", path] as const,
};
```

Hierarchy lets you invalidate wide (`fileKeys.root(id)`) or narrow (`fileKeys.content(id, path)`).

## Query hook pattern

Wrap each query in a named hook in the domain's `api/`:

```ts
export function useAgents() {
  return useQuery({
    ...trpc.agents.list.queryOptions(),
    meta: { errorToast: "Couldn't load agents" },
  });
}
```

**[HIGH] Use TQ's state directly**, never copied into `useState`:

```tsx
const { data, isLoading, error } = useAgents();
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <AgentList agents={data ?? []} />;
```

`isLoading` is true only on the first fetch (big empty-state spinner); `isFetching` on any in-flight refetch (subtle "refreshing…" indicator).

## Mutation hook pattern

```ts
export function useCreateAgent(options: { onSuccess?: (agent: Agent) => void } = {}) {
  return useMutation({
    ...trpc.agents.create.mutationOptions(),
    onSuccess: options.onSuccess,
    meta: { invalidates: [trpc.agents.list.queryKey()], errorToast: "Couldn't create agent" },
  });
}
```

```tsx
const createAgent = useCreateAgent({ onSuccess: closeDialog });
<Button onClick={() => createAgent.mutate({ name, model })} disabled={createAgent.isPending}>Create</Button>
```

Call `mutate` when `onSuccess` handles everything; `mutateAsync` when the submit handler must chain (toast, then close).

### Invalidation

**[CRITICAL] Use `meta.invalidates`.** Don't call `queryClient.invalidateQueries()` in `onSuccess`; the default mutation handler does it for every mutation. When the key depends on the *response* (a server-returned id), extend the handler to accept `invalidates: (data) => [...]`, or call `invalidateQueries` in the mutation's own `onSuccess`.

- **Invalidate narrowly.** After an agent create/update/delete, the list key is usually right; invalidate the domain root only when every query in it changed.
- Overlapping invalidations in one tick refetch once (TQ dedupes), but keep each mutation's declared effect narrow and explicit.

### Optimistic updates

Use `onMutate`/`onError`/`onSettled`; never shadow-copy server data into Zustand or `useState`.

```ts
const detailKey = trpc.agents.get.queryKey({ id });
return useMutation(trpc.agents.update.mutationOptions({
  onMutate: async (updated) => {
    await queryClient.cancelQueries({ queryKey: detailKey });
    const prev = queryClient.getQueryData(detailKey);
    queryClient.setQueryData(detailKey, updated);
    return { prev };
  },
  onError: (_err, _updated, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(detailKey, ctx.prev);
  },
  meta: { invalidates: [detailKey], errorToast: "Update failed" },
}));
```

## Non-tRPC fetchers

For endpoints outside tRPC (OAuth redirects, uploads, plain REST), write a typed fetcher over `authFetch` (`src/auth.ts`) and wrap it:

```ts
const oauthStartResponseSchema = z.object({ redirectUrl: z.string().url() });

export async function startOauth(connectorId: string) {
  const res = await authFetch(`/api/oauth/start?connector=${encodeURIComponent(connectorId)}`);
  if (!res.ok) throw new Error(`OAuth start failed: ${res.status}`);
  return oauthStartResponseSchema.parse(await res.json());
}

export function useStartOauth() {
  return useMutation({
    mutationFn: startOauth,
    meta: { invalidates: [connectionKeys.list()], errorToast: "Couldn't start OAuth" },
  });
}
```

**[HIGH] Zod-validate every non-tRPC response.** tRPC types end to end; raw `fetch` doesn't, so the parser is the only guard between a server bug and a runtime crash.

## `useSuspenseQuery`

**[MODERATE] Opt-in.** It removes the `isLoading` ladder but needs `<Suspense>` + `<ErrorBoundary>` around it. Default to `useQuery`; use suspense only in subtrees already wrapped, and pair each with a recoverable error boundary (`useQueryErrorResetBoundary`).

## Migration

```tsx
// before
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [data, setData] = useState<Connection[]>([]);
useEffect(() => {
  (async () => {
    try { setData(await api.connections.list.query()); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setLoading(false); }
  })();
}, []);

// after
const { data, isLoading, error } = useConnections();
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <ConnectionsList connections={data ?? []} />;
```

`useConnections` wraps `trpc.connections.list.queryOptions()` (or a `useQuery` over a Zod-validated fetcher).

## Consuming query and mutation hooks

**[HIGH] Destructure queries; keep mutations encapsulated.**

Objects returned by `useQuery`/`useMutation` get a new identity every render. Their callables (`refetch`, `mutate`) are stable, but `react-hooks/exhaustive-deps` can't see that and demands the whole object, which re-fires the effect every render.

```tsx
const { data = [], refetch, isFetching } = useSecrets();
useEffect(() => { refetch(); }, [refetch]);

const updateSecret = useUpdateSecret();
<button onClick={() => updateSecret.mutate(values)} disabled={updateSecret.isPending}>
```

Queries yield render values (`data`, `isPending`) and stable callables that belong in deps (`refetch`), so destructure. Mutations fire from event handlers and their state is read inline, so `mutate` rarely lands in deps; `createSecret.mutate(...)` keeps the "this is a mutation" signal.

**[CRITICAL] Never `eslint-disable react-hooks/exhaustive-deps` to hide the object-in-deps problem.** Destructure the stable field and the warning disappears.

```tsx
❌ }, [fetchX, fetchY, query.refetch]);
   // eslint-disable-next-line react-hooks/exhaustive-deps

✅ const { refetch } = useXxx();
   }, [fetchX, fetchY, refetch]);
```

## Anti-patterns

- `useEffect` + `fetch`/tRPC in a component → `useQuery`.
- `loading`/`error`/`saving` `useState` trio → TQ state.
- String-literal query keys → `queryKey()` or the domain factory.
- `invalidateQueries` in `onSuccess` → `meta.invalidates`.
- Shadow-copying TQ data for optimism → `onMutate`.
- A Zustand slice holding a server list → TQ.
- The whole query/mutation object in a deps array → destructure.
- `eslint-disable react-hooks/exhaustive-deps` to silence the loop → destructure the stable field.
