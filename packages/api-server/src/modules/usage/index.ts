// Public module API — only domain event types and type guards belong here
// per TSEng. The composition root imports from `compose.ts` directly.
//
// No events emitted yet. When the usage module starts publishing —
// e.g. `ActivityRecorded` — they go in `domain/events/` and re-export here.
export {};
