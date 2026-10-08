# API layer

**Read when:** writing a fetch call, setting up tRPC, error handling, organizing API modules, validating responses, consuming a new endpoint.

## Principles

**[CRITICAL] Server I/O is isolated from UI.** Components never call `fetch`, `authFetch` or tRPC procedures; they import a query/mutation hook from their module's `api/`. The fetcher layer knows URLs, auth, parsing and typed errors; the UI knows hooks returning `{ data, isLoading, error, mutate }`.

**[HIGH] Every non-tRPC response is Zod-validated** before reaching application code; tRPC is typed end to end, raw `fetch` is not.

## Layers

```
UI component
    ↓ imports
Query/mutation hook  (modules/{domain}/api/)
    ↓ calls
Fetcher              (modules/{domain}/api/ — non-tRPC)
                     (trpc.{domain}.{proc}.queryOptions() — tRPC)
    ↓ uses
Root client          (src/api.ts, src/trpc.ts, src/auth.ts → authFetch)
```

One concern per layer; crossing one in either direction is a smell.

## Root clients

The only places that make raw calls:

```ts
// src/api.ts
export const api = createTRPCClient<AppRouter>({ links: [wsLink({ client: wsClient })] });

// src/trpc.ts
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: api, queryClient });

// src/auth.ts
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
```

`src/query-client.ts` holds the QueryClient (`references/async-data.md`).

## Fetcher functions (non-tRPC)

```ts
// src/modules/connections/api/oauth.ts
const oauthStartResponseSchema = z.object({ redirectUrl: z.string().url() });

export async function startOauth(connectorId: string) {
  const res = await authFetch(`/api/oauth/start?connector=${encodeURIComponent(connectorId)}`);
  if (!res.ok) throw await ApiError.fromResponse(res);
  return oauthStartResponseSchema.parse(await res.json());
}

export async function disconnectMcp(connectionId: string) {
  const res = await authFetch(`/api/mcp/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
  if (!res.ok) throw await ApiError.fromResponse(res);
}
```

- One exported function per endpoint, with typed parameters (no `any` or untyped records).
- Only a 204 needs no schema.
- `encodeURIComponent` every user-supplied URL value; never concatenate raw input into paths.
- Throw on non-OK; a returned error object can't be told apart from success.

## Errors

**[HIGH]** Use a typed error hierarchy; at minimum:

```ts
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message?: string) {
    super(message ?? `Request failed with ${status}`);
  }
  static async fromResponse(res: Response) {
    const body = await safeJson(res);
    return new ApiError(res.status, body, extractMessage(body) ?? res.statusText);
  }
}

export function isUnauthorized(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}
```

Messages for toasts and inline errors come from `getErrorMessage(err, fallback?)` in `src/lib/errors.ts`, which the QueryClient's central error handlers use; status-specific titles (403 "Permission denied", 404 "Not found", 401 "Session expired") belong in one `getErrorTitle(err)` beside it, not at call sites. Distinguish domain errors worth branching on by extending `ApiError` (`class QuotaExceededError extends ApiError`), thrown from the fetcher when the body matches, so consumers can `instanceof`.

## tRPC

The tRPC layer collapses into query/mutation options:

```ts
const agents = useQuery(trpc.agents.list.queryOptions());
const createAgent = useMutation({
  ...trpc.agents.create.mutationOptions(),
  meta: { invalidates: [trpc.agents.list.queryKey()], errorToast: "Couldn't create agent" },
});
```

tRPC throws `TRPCClientError`, carrying `shape` and `data` (with status info). Branch on it with a helper, and route its message through `getErrorMessage` so the app doesn't care whether an error came from tRPC or `fetch`:

```ts
export function isTrpcUnauthorized(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.httpStatus === 401;
}
```

## Per-instance clients

For per-scope tRPC clients (one per runtime instance or tenant), provide them through a scoped context:

```tsx
const InstanceTrpcContext = createContext<InstanceTrpc | null>(null);

export function InstanceTrpcProvider({ instanceId, children }: Props) {
  const client = useMemo(() => createInstanceTrpc(instanceId), [instanceId]);
  return <InstanceTrpcContext.Provider value={client}>{children}</InstanceTrpcContext.Provider>;
}

export function useInstanceTrpc() {
  const ctx = useContext(InstanceTrpcContext);
  if (!ctx) throw new Error("useInstanceTrpc must be used within InstanceTrpcProvider");
  return ctx;
}
```

Consumers call `useInstanceTrpc()` and pass its `queryOptions()` / `mutationOptions()` to `useQuery` / `useMutation`.

## Migrating a fetch-site

When you touch a component doing `useEffect` + `useState` fetching: find its domain, add a typed fetcher (or use the tRPC procedure), add a query/mutation hook, replace the effect with the hook.

## Anti-patterns

- `catch {}` swallowing errors → let the QueryClient's `onError` handle it.
- Per-call `try/catch` + toast → `meta.errorToast`.
- Retry/cache logic in a store slice → TQ owns it.
