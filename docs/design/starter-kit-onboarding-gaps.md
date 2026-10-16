# Starter Kit Onboarding — Step-by-Step Gap Analysis

Per-step playthrough of each kit's onboarding, cataloging what happens in-chat vs. outside-chat vs. agent-only, and whether outside-chat steps have a pointer leading the user to the right screen location.

---

## Code Reviewer (31 steps)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | GitHub connection | outside-chat | Configure > Connections | No (gap) |
| 2 | Agent checks GitHub | agent | — | N/A |
| 3 | GH Enterprise host | outside-chat | Configure > Connections | No (gap) |
| 4 | Work backup setup | in-chat | — | N/A |
| 5 | Repository selection | in-chat | — | N/A |
| 6 | Bot account name | in-chat | — | N/A |
| 7 | Review display name | in-chat | — | N/A |
| 8 | Diff marker style | in-chat | — | N/A |
| 9 | Review labels | in-chat | — | N/A |
| 10 | Label delivery | in-chat | — | N/A |
| 11 | Auto-approve scope | in-chat | — | N/A |
| 12 | Max file size | in-chat | — | N/A |
| 13 | Language priority | in-chat | — | N/A |
| 14 | Security scanning | in-chat | — | N/A |
| 15 | Test coverage | in-chat | — | N/A |
| 16 | Performance flags | in-chat | — | N/A |
| 17 | Documentation rules | in-chat | — | N/A |
| 18 | Naming conventions | in-chat | — | N/A |
| 19 | Custom lint rules | in-chat | — | N/A |
| 20 | Review skills | in-chat | — | N/A |
| 21 | Artifact output | in-chat | — | N/A |
| 22 | Slack notifications | in-chat | — | N/A |
| 23 | Escalation path | in-chat | — | N/A |
| 24 | Benchmark repo | in-chat | — | N/A |
| 25 | Nudge behavior | in-chat | — | N/A |
| 26 | Feedback survey | in-chat | — | N/A |
| 27 | Review cadence | in-chat | — | N/A |
| 28 | Tracking dashboard | in-chat | — | N/A |
| 29 | Health alerts | in-chat | — | N/A |
| 30 | Agent configures | agent | — | N/A |
| 31 | Final report | agent | — | N/A |

**Summary:** 26 in-chat, 2 outside-chat (both unpointed), 3 agent

---

## Personal Assistant (14 steps)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | Slack/Telegram connection | outside-chat | Configure > Connections | No (gap) |
| 2 | Check tools | agent | — | N/A |
| 3 | Schedules setup | outside-chat | Schedules UI | No (gap) |
| 4 | What to call the agent | in-chat | — | N/A |
| 5 | What to call the user | in-chat | — | N/A |
| 6 | Communication style | in-chat | — | N/A |
| 7 | Guardrails | in-chat | — | N/A |
| 8 | Capability priorities | in-chat | — | N/A |
| 9 | Off-limits topics | in-chat | — | N/A |
| 10 | Messaging channel | in-chat | — | N/A |
| 11 | Messaging preferences | in-chat | — | N/A |
| 12 | Timezone | in-chat | — | N/A |
| 13 | Access level | in-chat | — | N/A |
| 14 | Task prefix convention | in-chat | — | N/A |

**Summary:** 11 in-chat, 2 outside-chat (both unpointed), 1 agent

---

## Quality Inspector (12 steps)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | Product profile skill | outside-chat | Configure > Skills | No (gap) |
| 2 | Backend connection | outside-chat | Configure > Connections | No (gap) |
| 3 | Egress rules | outside-chat | Configure > Networking | No (gap) |
| 4 | Model credential | outside-chat | Configure > Model | No (gap) |
| 5 | Target repository | in-chat | — | N/A |
| 6 | Issue comment style | in-chat | — | N/A |
| 7 | Profile settings | in-chat | — | N/A |
| 8 | Spec feedback | in-chat | — | N/A |
| 9 | Slack channel | in-chat | — | N/A |
| 10 | Candidate channels | in-chat | — | N/A |
| 11 | Baseline channels | in-chat | — | N/A |
| 12 | Scenario discovery | in-chat | — | N/A |

**Summary:** 8 in-chat, 4 outside-chat (all unpointed), 0 agent

---

## LLM Wiki (7 steps)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | Wiki name | in-chat | — | N/A |
| 2 | Wiki purpose | in-chat | — | N/A |
| 3 | Source material | in-chat | — | N/A |
| 4 | Backup preference | in-chat | — | N/A |
| 5 | Maintenance plan | in-chat | — | N/A |
| 6 | Git remote | outside-chat | Configure > Connections | No (gap) |
| 7 | Maintenance schedule | outside-chat | Schedules UI | No (gap) |

**Summary:** 5 in-chat (conversational, no forms), 2 outside-chat (both unpointed), 0 agent

---

## Plain Wiki (5 steps)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | Wiki purpose | in-chat | — | N/A |
| 2 | First material | in-chat | — | N/A |
| 3 | Publish channel | in-chat | — | N/A |
| 4 | Import and publish | agent | — | N/A |
| 5 | Published KB location | outside-chat | Knowledge Base screen | No (gap) |

**Summary:** 3 in-chat (conversational), 1 outside-chat (unpointed), 1 agent

---

## Nous (0 steps)

Empty. No onboarding at all. The agent starts with a blank chat.

**Gap:** Nothing tells the user what this agent does or how to start using it.

---

## K-Search (1 step)

| # | Step | Kind | Pointer target | Has pointer? |
|---|------|------|---------------|-------------|
| 1 | Configure connection | outside-chat | Configure > Connections | No (gap) |

**Summary:** 0 in-chat, 1 outside-chat (unpointed), 0 agent

**Gap:** The entire onboarding is one outside-chat step with no pointer. The user has no guidance.

---

## Aggregate tallies

| Kit | In-chat | Outside-chat | Agent | Total | Unpointed gaps |
|-----|---------|-------------|-------|-------|---------------|
| Code Reviewer | 26 | 2 | 3 | 31 | 2 |
| Personal Assistant | 11 | 2 | 1 | 14 | 2 |
| Quality Inspector | 8 | 4 | 0 | 12 | 4 |
| LLM Wiki | 5 | 2 | 0 | 7 | 2 |
| Plain Wiki | 3 | 1 | 1 | 5 | 1 |
| Nous | 0 | 0 | 0 | 0 | — |
| K-Search | 0 | 1 | 0 | 1 | 1 |
| **Total** | **53** | **12** | **5** | **70** | **12** |

Every outside-chat step across all kits lacks a pointer. 12 out of 12 outside-chat steps are unpointed gaps.

---

## Screen locations needing pointer design (priority order)

1. **Configure > Connections** — used by 5 kits (Code Reviewer ×2, Personal Assistant, Quality Inspector, LLM Wiki, K-Search). Most common gap.
2. **Configure > Skills** — Quality Inspector.
3. **Configure > Networking** — Quality Inspector (egress rules).
4. **Configure > Model** — Quality Inspector (model credential).
5. **Schedules UI** — Personal Assistant, LLM Wiki.
6. **Knowledge Base screen** — Plain Wiki (published KB location).

### Recommended design work

- Pointer markers that float near the target `data-pointer-target` element, guiding the user's eye to the correct section.
- If the target is inside a modal not yet open, show a hint ("Open Configure > Connections") with a clickable action that opens the modal to that section.
- Nous needs an empty-state / getting-started treatment (not a pointer, but a welcome message or first-step prompt).
- K-Search's single outside-chat step needs especially clear guidance since there's no in-chat warmup.
