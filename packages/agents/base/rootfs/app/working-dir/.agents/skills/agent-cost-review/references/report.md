# The report's data

`fill-report.py` puts `report.json` into `report.html`, a page that draws the report: the headline, the changes with their buttons, the spend as tiles and bars, every run, and what you could not see.
Amounts are in whole units (dollars, Bobcoins), not micros.
A unit is `usd` (paid), `usd_list` (covered by a subscription), `bobcoin` or `free`; the page never adds different units together.

```json
{
  "agent": "Theodore",
  "window": "Oct 28 – Nov 3",
  "interactive": true,
  "headline": "You could save about",
  "headlineAmount": "$32 a week",
  "summary": "Theodore spent $38.79 this week. Most of it went to runs that found nothing to do.",
  "changes": [
    {
      "title": "Skip runs with nothing to review",
      "evidence": "41 of 56 runs found no new pull requests.",
      "saving": { "unit": "usd", "amount": 22 },
      "action": "fix",
      "prompt": "Make change 1 from the cost review: add a precheck to \"PR review\" so it skips runs with no new pull requests."
    },
    {
      "title": "Add jq to the image",
      "evidence": "Missing on every run, so Theodore works around it.",
      "saving": { "unit": "usd", "amount": 3 },
      "action": "how",
      "prompt": "Show me how to do change 2 from the cost review: add jq to your image."
    }
  ],
  "total": {
    "label": "Both",
    "saving": { "unit": "usd", "amount": 25 },
    "from": { "unit": "usd", "amount": 38.79 },
    "to": { "unit": "usd", "amount": 14 }
  },
  "tiles": [
    { "label": "Spent", "value": "$38.79" },
    { "label": "Runs", "value": "56" },
    { "label": "Found nothing", "value": "41" }
  ],
  "buckets": [
    { "label": "Runs that found nothing", "note": "41 runs", "unit": "usd", "amount": 24.1, "kind": "cut" },
    { "label": "Real reviews", "note": "15 runs", "unit": "usd", "amount": 11.2, "kind": "useful" }
  ],
  "runs": [
    { "when": "Nov 3, 21:00", "what": "PR review (schedule)", "outcome": "Found no new pull requests", "cost": { "unit": "usd", "amount": 0.55 } }
  ],
  "unseen": ["Two runs on Oct 30 have no transcript, so I could not tell what they did."]
}
```

- `agent`, `window`: your name and the dates the review covers, as the owner reads them.
- `interactive`: the same as `create_artifact`'s `interactive`.
  With it, the page shows the buttons only to the owner, beside your chat; everywhere else, and without it, the page tells the reader to reply in your chat.
- `headline`, `headlineAmount`: the answer; the amount is drawn bold.
  With nothing to cut, `"headline": "Nothing to cut this week"`, no `headlineAmount`, no `changes` and no `total`.
- `summary`: one or two sentences on where the money went.
- `changes`: the list from your chat reply, in the same order and numbering.
  `saving` is per week, or leave it out and give `savingNote` (a few words) when there is no fair estimate.
  `action` is `fix` for a change you can make (its button says "Fix it for me"), `how` for one only the owner can make ("Show me how"), or left out for no button.
  `prompt` is the chat message the button sends: a full sentence that names the change, since it arrives without the page.
- `total`: only with two or more changes in one unit; `from` is this week's spend in that unit and `to` what it would be after all of them.
- `tiles`: three numbers that frame the biggest change, such as spent, runs and runs that found nothing.
- `buckets`: what the spend went to, one row per kind of work, largest first.
  `kind` is `cut` for spend your changes remove, `useful` for work worth its cost, `unknown` for spend you cannot explain.
- `runs`: every run in the window, newest first; `what` is the schedule's title or the chat's title, never an id.
- `unseen`: what you could not see, one sentence each; leave it empty when you saw everything.
