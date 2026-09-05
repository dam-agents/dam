---
name: dam-leads-agenda
description: Compile the prioritised DAM leads meeting agenda and post it to #dam-leads. Use when the Tuesday 8:30 AM schedule fires (compile and post in one run), and when asked to redraft or tweak the leads agenda. No approval is needed and there is no DM step — Jenna released this meeting from her review on 2026-09-04 and asked on the same day not to be DM'd the agenda at all; the core meeting's agenda still needs her explicit go-ahead. Also covers capturing items leads tag the bot with in #dam-leads into the tracker.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__platform-outbound__send_channel_message, mcp__platform-outbound__reply, mcp__platform-outbound__react, mcp__platform-outbound__describe_channel, mcp__platform-outbound__describe_channel_users
---

# DAM leads meeting agenda

The leads meeting runs **Tuesday 9:00 AM ET**. I **compile and post at 8:30 AM**,
in one run, on one Platform schedule.

> ## One step: compile, then post. No review, no DM.
>
> **Jenna, 2026-09-04 in `#dam-leads`** — *"you dont need to run the agenda by me for
> this dam leads, thats only for dam core meeting agendas."* Then, in the same thread:
> **"no don't dm me at all for the dam leads agenda just post it at 830."**
>
> So this agenda is **entirely mine to run** — ordering, speakers and wording are my
> call, and at 8:30 it goes straight to `#dam-leads`. There is **nothing to wait for
> and nobody to check with.**
>
> **Do not DM her the leads agenda.** Not as a draft, not as a heads-up, not as an
> FYI, not "here's what I'm about to post". She asked twice to be taken out of this
> loop; a courtesy DM puts her back in it. The channel post *is* how she sees it —
> she is in `#dam-leads`.
>
> **This does NOT extend to the core meeting.** `#dam-dev` still posts only on her
> explicit go-ahead, and the core draft still goes to
> `#dam-core-meeting-assistant` first — see `dam-agenda-draft`. Do not let this
> skill's flow leak into that one.
>
> **The DM is not sealed shut — it is just not part of the routine.** A genuine
> question still goes there (see "When the DM is still right", below). The thing she
> removed is the recurring drop, not her availability.

## Step 0 — is it a US holiday? If so, stop.

**Run this before anything else** — before reading the tracker, before any knowledge
base or Airtable call, and well before Slack:

```bash
/home/agent/work/holiday-check.sh
```

| Exit | Meaning | Do |
|---|---|---|
| `0` | not a holiday | continue and compile |
| `10` | **US holiday** | **stop.** Nothing posts to `#dam-leads`, no DM, no history row |
| `2` | list missing, unreadable, or out of dates | **stop**, and send Jenna one line in the DM that the gate could not decide |

Jenna's rule, 2026-09-04: *"before executing the skill check if its a US holiday. if
it is, do not run."* On a holiday the leads are not working, so there is no meeting —
**exit silently.** Do not post a "no agenda today" note to `#dam-leads`; the channel
staying quiet is the correct outcome.

**This gate is the one thing that stops the 8:30 post besides Jenna saying hold.**
Everywhere else this skill says the post is unconditional — a holiday is now the second
exception, and it is checked *before* any compile work happens.

Dates live in `/home/agent/work/us-holidays.md`; the script reads that file. Edit
**that file only** to add or fix a holiday. The gate **fails closed** — if it cannot
tell, nothing goes to the leadership channel.

**Tracked items do not expire on a holiday.** Leave `leads-items.md` untouched; items
stay `open` and compete normally at the next Tuesday's 8:30 run. Nothing is dropped for
having been skipped by a holiday, and a holiday week does **not** count toward the
two-weeks-deferred trigger — that rule is about items I passed over, not weeks with no
meeting.

*(No US holiday falls on a Tuesday through the end of 2027, so this will not fire soon
— it is wired in now so it is already there when the calendar moves.)*

This is the **sibling of `dam-agenda-draft`**, which does the same job for the
Mon/Wed core meeting. The differences that matter:

| | Core meeting | **Leads meeting** |
|---|---|---|
| When | Mon & Wed 9:30 AM | **Tue 9:00 AM** |
| Stages | **Three** — draft, review, post | **One** — compile and post |
| Draft goes | `#dam-core-meeting-assistant` `C0BR0NX7YAE` — for **review** | **nowhere.** No draft channel, no DM |
| Posts to | `#dam-dev` `C0B09BF65CP` | **`#dam-leads` `C0B4M8W3M28`** |
| Posting trigger | **Jenna's explicit approval.** No timer | **The 8:30 AM schedule.** No approval |
| Topics from | the last core transcript | **items leads tag me with**, tracked in `leads-items.md` |

One schedule: **`sched-ae111df78fa7`** — `FREQ=WEEKLY;BYDAY=TU;BYHOUR=8;BYMINUTE=30`,
`America/New_York`. Compile and post in that single run.

> **Known stale wording in that schedule's task prompt — ignore it.** It was written
> before she dropped the DM and still says a 7:00 AM schedule
> (`sched-26aa51061fc9`) *"already compiled the agenda and DM'd it to her"*, then
> tells me to read that DM for changes. **That 7:00 AM schedule is deleted and there
> is no DM.** Compile from scratch in the 8:30 run. **This skill is authoritative**
> — CLAUDE.md: *"Edit the skill to change how the work is done."* Deleting and
> recreating the 8:30 schedule to fix the prompt text was blocked as too risky to the
> one job she wants kept, so the wording stays until she clears a replacement.

**Three things get stricter with nobody reviewing**, because nothing at all now stands
between my judgement and a leadership channel — not even 90 minutes' notice:

- **The discretion rule** — no personnel content, and a genuinely ambiguous item
  stays **off** the agenda until she has answered a direct question about it. See
  `dam-leads-track`.
- **Speaker evidence** — never a name on a line without a transcript, `feedback.md`
  or issue-assignee basis, and never a guessed handle. Resolve from Airtable.
- **My own reasoning is now unwitnessed**, so it has to be written down. Everything
  that used to go in the DM — why these five, who I left out, the context behind each
  line — goes into `leads-agenda-history.md` at post time instead. See below.

Post via `platform-outbound` (`send_channel_message` with `chatId`, or `reply`) —
that is the agent's own bot identity. `mcp__slack__*` is Jenna's personal
account: **read only**, never post or react through it.

## Where the topics come from — the tracker

**The leads meeting is never transcribed** — the leads do not record it (Jenna,
2026-08-26). Topics reach me one way: **leads share them in `#dam-leads` and I
track them** in `/home/agent/work/leads-items.md`. That file is this agenda's only
real source.

Capturing those items is a separate, all-week job with its own skill:
**`dam-leads-track`**, which fires when a lead tags me rather than on a schedule.
Read it if anything about capture, acknowledgement or the discretion rule comes up.
This skill **consumes** the tracker; that one fills it.

If a lead tags me while I am mid-compile, capture it there first, then continue.

## Before compiling

Read all three, every time:

- `/home/agent/work/leads-items.md` — the tracked items. **Primary source.**
- `/home/agent/work/leads-agenda-history.md` — past *leads* agendas, my reasoning at
  the time, anything Jenna changed after the fact, and what the meeting actually
  covered. Separate from the core meeting's history on purpose; don't let one teach
  the other's lessons. **With no review step and no DM this is the only feedback loop
  there is** — read it before compiling and write to it every week.
- `/home/agent/work/CLAUDE.md` — the operating context.

Then top up from the knowledge base — see `references/sources.md`.

## The agenda

**Five topics, priority order.** Five is the target, not a ceiling to approach.
Propose five unless the material genuinely cannot support that many, and say so
if it can't.

**Tagged items outrank knowledge-base finds.** A lead who asked for something in
the channel has already said it needs this meeting; that beats anything I
inferred. Among tagged items, rank by decision urgency — what blocks other
people, what has waited longest, what has a date attached.

**This is a leadership meeting, so prefer items that need a decision** over items
that need a status readout. If two topics compete, the one where a lead is
blocked waiting on a call from this room wins.

**Each numbered line: a short label plus the speaker.**

- Label is 2–5 words. Prefer her `"<topic> update"` phrasing.
- **Never post a line without a speaker.** Derive each name from evidence. On a leads
  agenda the natural speaker is often the lead who raised it — name them, plus the
  person who decides where those differ.
- **I assign the speaker, and nobody sees it before it pings a real person** in a
  leadership channel. That raises the bar, not lowers it. No evidence, no name — put
  the topic up without one rather than guessing, and record why in the history file.
- Resolve every mention to a real Slack ID from Airtable before posting — see
  `references/sources.md` (read only). Never invent or approximate a handle; an `@`
  that pings the wrong person is worse than an untagged name. If one will not resolve,
  use the plain name.

**Context does not go in the post.** The `#dam-leads` message is bare labels — she
asked for it *"concisely"*. The 2–4 sentences per topic that used to go in the DM now
go into `leads-agenda-history.md`: what the open thread is, what was said, what is
undecided, the issue or S/T ID. Same rigour, different destination.

**If the tracker is empty**, say so plainly in the history file and compile from the
knowledge base's standing candidates instead. Never invent a topic or a speaker; an
honest gap beats a guessed agenda. If there is genuinely nothing worth five lines,
post the shorter agenda rather than padding it.

## Carry-forward and the items left out

Both used to be the DM's job. Neither disappears with it.

- **Name the tagged items left out, with one line each on why** — in
  `leads-agenda-history.md`. A lead who tagged me and sees nothing deserves a real
  answer if they ask, and I will not remember the reason a week later.
- **An `open` item passed over two weeks running is a problem, not a rounding
  error.** Nothing else catches it now. First choice: **put it on the agenda** — two
  weeks of deferral is itself evidence it needs the room. If it genuinely cannot go
  on, that is the point for a **direct one-line question to Jenna** (below) — a
  question about one stuck item, not a return of the weekly drop.

## When the DM is still right

She removed the routine agenda DM. She did not make herself unreachable. The DM
(`chatId: U02JVA1K5K8`) is still correct for a **specific question that needs her
answer**:

- A **discretion-rule call** — an item that might be personnel-related. Ask, and
  keep it off the agenda until she replies. This one is not optional.
- An **item stuck two weeks** that I cannot place and will not silently drop.
- A **name I cannot resolve or evidence I cannot find** for someone who clearly
  should be on a line.

The test: am I asking her something, or reporting to her? A question is fine. A
recap of what I am about to post is the thing she cancelled. One question, in one
line, and never as a wrapper around the agenda.

## Posting to #dam-leads

Single top-level message to `C0B4M8W3M28`, exactly:

```
:thread: DAM leads meeting agenda
1. <topic> @<person giving the update>
2. <topic> @<person giving the update>
3. <topic> @<person giving the update>
4. ... other topics?
```

Priority order as compiled. Mention format is `<@SLACKID|Display Name>`. Keep the
trailing catch-all line. No preamble, no decoration, and **no note about the process**
— nothing like "as discussed, posting without review". Brevity is the feature.

**It posts unconditionally.** The only thing that stops it is Jenna explicitly saying
so — in `#dam-leads`, in the DM, or anywhere else she has told me to hold. Her silence
is not a signal; it is the normal case and always will be.

**Then do both:**

1. Append a row to `/home/agent/work/leads-agenda-history.md` — the agenda as
   posted, the per-topic context, **why these five and not the others**, and
   afterwards what the meeting actually covered. **This is the entire feedback loop
   now**, and the only record of my reasoning. Signals to capture: what she
   reordered or skipped live, a line that drew no discussion, anything a lead said
   was mis-framed or mis-assigned, and whether the person I named actually spoke.
2. Update `/home/agent/work/leads-items.md` — set the posted items to `agenda`,
   and after the meeting to `done` with the outcome. Record why anything was
   `dropped` — **the reason is mine now, so it only exists if I write it.**

## Dry runs

Use `#test-environment` (`C02U453MY5V`). Always pass the channel ID explicitly —
the bot is bound to 40+ channels, so a mistargeted `chatId` lands somewhere real.
`#dam-leads` is a leadership channel; a misfire there is expensive.
