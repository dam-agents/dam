// UNIT_BOUNDARY_DESCRIPTION: a request carries one host, and several stored egress rules can speak for it: the host itself, a `*.parent` wildcard, and the bare `*`. Turning the request's host into that short list of literal patterns keeps the lookup an equality match the host index can serve, and keeps one definition of what a wildcard covers. A wildcard stands for exactly one label, the same as the SNI filter chain and the leaf certificate SAN that enforce the rule downstream, so `*.pkg.dev` speaks for `us-docker.pkg.dev` and never for `a.b.pkg.dev`.
export function hostMatchCandidates(host: string): string[] {
  const parent = host.slice(host.indexOf(".") + 1);
  return host.includes(".") ? [host, `*.${parent}`, "*"] : [host, "*"];
}
