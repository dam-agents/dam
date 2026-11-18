# 03 — Only a finished call sets the day's most expensive call

**Part of:** A Messages stream counts the prompt twice — see [README](./README.md)

## Context

The daily rollup keeps the most expensive single call, and the api-server uses it to estimate the cost of a call that reports no usage.
Today every record of a call can raise it, a periodic record too.
With rule D, a periodic record can carry the whole prompt from `message_start` while the final record is lower.
The day's most expensive call then stays at the periodic record's cost, and later estimates come out too high.
This slice lets only a final record set it.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **`settle` in `packages/api-server/src/modules/spend/services/spend-ingest.ts`.**
   Today it calls `deps.ledger.add(applied.row, delta, amounts.costMicros)` only when the amounts difference is not zero.
   Change two things:
   - Call `deps.ledger.add` also when the record is final and the difference is zero, so a final record that changes no amount still sets the most expensive call.
   - Pass `final ? amounts.costMicros : 0` as the call cost.

   Keep the rest of the block: the restore on failure, and `countDay` only when the cost difference is not zero.

   The ledger's upsert (`spend-ledger.ts`) inserts the call cost on a new row and keeps `greatest()` on a conflict, so a `0` from a periodic record never lowers the value.
   A rollup row that only periodic records created starts at `0` until the call's final record comes.

2. **Make no other change in the ledger.**
   Re-pricing already computes the most expensive call again from the call rows, which only final records write.
   The session move (`spend-ledger.ts`, the `greatest()` in the move of rows to their session) keeps working with the new values.

3. **Docs.**
   In [spend-limits.md](../../architecture/spend-limits.md) ("Daily rollup"), "the most expensive single call" becomes "the most expensive finished call".
   If slice 01 already changed `Last verified:` on this page, keep that date.
   Run `mise run fix:markdown`.

## Acceptance criteria

- [ ] A periodic record never raises the day's most expensive call.
- [ ] A final record sets it, also when it changes no amount.
- [ ] A final record that is lower than the call's periodic records leaves the day's cost, token counts and day counters at the final values, as today.
- [ ] `mise run //packages/api-server:test` and `mise run //packages/api-server:check` pass.

## Smoke test

1. Run `mise run //packages/api-server:test` and `mise run //packages/api-server:check`.
2. With a throwaway script that you do not commit, drive `createSpendIngest` with local Redis and an in-memory ledger that copies the ledger's upsert (add on conflict, `greatest()` for the most expensive call).
   Send one call as two periodic records with a high cost, then a lower final record.
   Expect the row's cost to equal the final cost, and the most expensive call to equal the final cost too.
   Then send a second call whose final record repeats its last periodic record, and expect the most expensive call to take its cost.
3. Delete the script.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
