// Public module API — by TSEng, only domain event types and type guards
// belong here. The composition root imports from `compose.ts` directly.
//
// No events emitted yet. When the approvals module starts publishing —
// e.g. `ApprovalGranted`, `EgressRequestExpired` — they go in
// `domain/events/` and re-export here.
export {};
