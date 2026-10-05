# Design Mode

High-level design of a TypeScript client-server project following this architecture. No concrete names, file paths or implementation details unless the user asks.

Read [../architecture/index.md](../architecture/index.md), then deeper files only as the conversation reaches their topic. Use the docs as the agenda: surface the architectural concerns this request touches, one at a time, until the design is coherent with them, asking only what the output needs.

## Output

An issue comment for an implementer: short, scannable, constraining the shape and leaving naming, file layout and internal structure to their judgment.

1. **Coupling**: which modules talk to which, in what direction, through what (events, ports, shared types); only meaningful new dependencies.
2. **Net-new components**: modules, events, ports, adapters, services that don't exist yet, each placed in its module and layer. Names are illustrative.
3. **Watch out for**: breaking changes and hidden complexity to know upfront, only what could bite: contract ripples to clients, event shape changes affecting subscribers, conflicting invariants, cross-module transaction boundaries, ordering or consistency assumptions, missing infra. Skip the obvious.

End with unresolved questions, terse. No code, file paths or internal API shapes.
