---
name: dam-leads-track
description: Capture a topic a DAM lead wants discussed at the leads meeting into the tracker. Use whenever someone tags or mentions the bot in #dam-leads (C0B4M8W3M28) with something to cover, raises a topic for the Tuesday leads meeting, asks to add or drop an item, or asks what is currently tracked. Runs all week on arrival of a message, not on a schedule — the Tuesday draft itself is the separate dam-leads-agenda skill.
allowed-tools: Read, Write, Edit, Grep, mcp__platform-outbound__reply, mcp__platform-outbound__react, mcp__platform-outbound__send_channel_message, mcp__platform-outbound__describe_channel_users
---

# Track a leads-meeting topic

**The leads meeting has no transcripts and never will — the leads do not record
them.** Jenna stated this plainly on 2026-08-26. Topics reach me one way only:
**a lead shares them in `#dam-leads` (`C0B4M8W3M28`) and I track them.**

So this is not a nice-to-have alongside the drafting job. **The tracker is the
agenda's only real source.** An item not captured when it arrives does not exist
by Tuesday, and the lead who raised it has no way to know it was lost.

Tracker: **`/home/agent/work/leads-items.md`**.

## Do this on arrival, not on Tuesday

When a lead tags me in `#dam-leads` with something to discuss:

1. **`react` with `eyes`** on their message — immediate, silent acknowledgement.
2. **Append a row** to `leads-items.md` (format below).
3. **`reply` in-thread**, one line: that it is **tracked** for the next leads meeting
   (name the date if it is close). Tracked, not "on the agenda" — see below.
4. **Ask in-thread if the wanted decision is unclear.** "Let's discuss X" with no
   decision attached is hard to rank and hard to close. One question is fine.

Nothing here waits for the Tuesday schedule. Capture is the whole job.

## The row format

```
| n | <their ask, in their own words> | <who> | #dam-leads | YYYY-MM-DD | open |
```

- **Their words, quoted.** Not my paraphrase — the framing is theirs, and Jenna
  reads the framing as evidence when she ranks it.
- **Note any `S`/`T`/`F` ID or `dam#` issue** the ask maps onto. Most leads asks
  are a new turn on something the knowledge base already tracks; the link is what
  lets the Tuesday draft add context.
- **Link the thread** where it helps someone find the original.
- Resolve the raiser's name from Airtable if the Slack ID is unfamiliar — see the
  `dam-leads-agenda` skill's `references/sources.md`.

### Status values

| Status | Meaning |
|---|---|
| `open` | Candidate for a future agenda |
| `considered` | Weighed for a Tuesday agenda and not posted — the reason goes in `leads-agenda-history.md` |
| `agenda` | It went on a posted agenda |
| `done` | Discussed and closed — record the outcome |
| `dropped` | Left off — **record why**; that is the useful part, **including when the call was mine rather than hers** |

## A tracked item is not an agenda item

The tracker holds **candidates**. The agenda is five lines and this file holds more
than five, so tracking something is not a promise of a slot.

**Since 2026-09-04 I do the selecting.** Jenna, in `#dam-leads`: *"you dont need to
run the agenda by me for this dam leads, thats only for dam core meeting agendas."*
So the accurate acknowledgement is **"tracked — a candidate for Tuesday"**. Do not
say "Jenna will decide" (no longer true for this meeting) and do not say "it's on the
agenda" (still not mine to promise on the spot).

**Don't let the new authority inflate the agenda.** Telling each lead in turn "I'll
put it on" is how five lines become eight. Track it, then rank it at 8:30 AM Tuesday
against everything else in the file.

The **core meeting is unchanged — Jenna still approves that agenda.** Don't let this
flow leak into `dam-agenda-draft`.

## Carry-forward

Items do not age out silently. An `open` item passed over **two consecutive weeks**
should generally just **go on the next agenda** — two weeks of deferral is itself
evidence it needs the room, and I am the one choosing now, so I can simply put it on.
If it genuinely cannot go on, that is worth **one line to Jenna in the DM** as a
question about that item — not a return of the weekly agenda drop she cancelled on
2026-09-04.

**Nobody else reviews this list**, so this only happens if I do it, and a lead whose
item is quietly skipped three weeks running has no way to find out.

## The discretion rule — check before writing

`#dam-leads` is a leadership channel, recorded in the knowledge base under a
**discretion rule: strategy, access policy and direction only; no personnel
content** (internal Slack sweeps, e.g. 2026-08-25: *"No personnel content from
this channel is recorded, per the discretion rule; the affected person is not
named here"*).

**It governs this tracker.** If a lead raises something personnel-related:

- Do **not** write it into `leads-items.md`.
- Do **not** let it become an agenda line.
- **Ask Jenna in the DM** (`chatId: U02JVA1K5K8`) how she wants it handled.

Second, independent reason: the agenda is posted **back into `#dam-leads` itself**,
so every line is visible to everyone in that room. Strategy and direction belong
there; anything about a person does not.

**Third, new on 2026-09-04:** Jenna no longer reviews the leads agenda **and no longer
sees it before it posts** — she dropped the review, then the heads-up DM. So **nothing
at all sits between my judgement and that room.** When unsure about an item's nature,
it goes to her as a **DM question** rather than into the file, **and stays out of the
8:30 post until she answers**. The tracker is durable and the agenda is public to that
room — both are the wrong place to discover I misjudged it.

**Asking is not the drop she cancelled.** She removed a recurring report, not her
availability; a direct question about one item is exactly what the DM is still for.
This is the one case where waiting for her reply is correct.

## If asked what is tracked

Read `leads-items.md` and answer from it — open items first, with who raised each
and when. Keep it short. If asked in `#dam-leads`, reply there; if the answer would
touch anything the discretion rule covers, take it to the DM instead.

## Related

- **`dam-leads-agenda`** — the Tuesday **8:30 AM** run that consumes this tracker and
  posts to `#dam-leads` in one step. **No approval and no DM there since 2026-09-04.**
- `/home/agent/work/CLAUDE.md` — surrounding context for both.
