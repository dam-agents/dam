// All connection lifecycle now flows through tRPC: see queries.ts +
// mutations.ts. Legacy /api/oauth/apps, /api/mcp/connections, and the
// stand-alone discovery endpoint were retired alongside the
// K8sConnectionsPort-based engine (ADR-051).
//
// File kept (empty) to keep the import graph stable until the next sweep
// renames the api/ directory.

export {};
