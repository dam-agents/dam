/**
 * Initial discriminated-error seed for the `instances` module. The
 * resolver in issue 3 extends this with `NotFoundError` and
 * `AmbiguousError`; for now the surface covers the transport- and
 * auth-side failures the `list` / `get` ports can produce.
 *
 * The auth module owns the canonical token-provider error vocabulary in
 * its `domain/errors.ts`. This module deliberately does NOT re-export
 * those variants — verbs that target an Instance depend on a single
 * module's domain. The `AuthRequiredError` here is the adapter-level
 * boundary: it carries forward a human-readable reason from the auth
 * module without leaking its discriminant.
 */

export interface TransportError {
  kind: "transport";
  /** Free-form message for command-layer rendering. Originates from
   *  network failures, malformed responses, or unexpected non-tRPC
   *  errors bubbling up from the adapter. */
  reason: string;
}

export interface AuthRequiredError {
  kind: "auth-required";
  /** Pass-through of the underlying TokenProviderError's situation, so
   *  the command layer can map to the right auth exit code without
   *  importing the auth module's discriminant. */
  reason: string;
}

export type InstancesDomainError = TransportError | AuthRequiredError;
