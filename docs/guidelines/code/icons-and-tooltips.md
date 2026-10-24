# Icons and Tooltips

The goal is that one action looks and reads the same everywhere in the web UI (`packages/ui`).
A user who learns an icon on one screen recognizes it on the next.

## One icon per action

Icons come from `@carbon/icons-react`.

| Action                                                      | Icon                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Rename (agent name, artifact, file, folder, session, skill) | `Edit`                                                   |
| Edit content (artifact, file, queued prompt, env var value) | `RequestQuote`                                           |
| Draft marker on a session row                               | `Pen`                                                    |
| Delete, and remove an item from a list                      | `TrashCan` (use `RemoveButton` for a row)                |
| Close a modal, panel, tab or search                         | `Close`                                                  |
| Attach a file in the composer                               | `Attachment`                                             |
| New session, discuss with agent                             | `AddComment` (`Add` in the JanUI experiment's sidebar)   |
| Generic add or new                                          | `Add`                                                    |
| Create agent                                                | `Add`                                                    |
| Create agent from a starter kit                             | `DataEnrichmentAdd`                                      |
| Starter kits destination, a starter kit                     | `Gift`                                                   |
| Connections destination, a connection                       | `DataStructured`                                         |
| Channels destination                                        | `LogoSlack`                                              |
| Skills destination                                          | `MachineLearningModel`                                   |
| Schedules destination                                       | `EventSchedule`                                          |
| External link, open in new tab                              | `Launch` (only for a link that leaves the app)           |
| Back                                                        | `ArrowLeft`                                              |
| Restart agent                                               | `Restart`                                                |
| Retry, update, reload                                       | `Renew`                                                  |
| Files destination                                           | `Folder`                                                 |
| Artifacts destination, an artifact (`ArtifactIcon`)         | `Folders` (`DocumentAttachment` in the JanUI experiment) |
| More actions                                                | `OverflowMenuVertical` (use `RowActionsMenu`)            |
| "About X" hint                                              | `Information`                                            |
| How-to explainer popover                                    | `Help`                                                   |

`TextCreation` and `NewTab` are not used.
A button that opens something inside the app carries no `Launch` icon.

## Tooltips

Every icon-only button has a tooltip: pass `tooltip=` to `Button`, or wrap a plain element in `Tooltip`.
Do not use a native `title=` on an icon-only button; a `title` that explains why a menu item is disabled stays.
The "More actions" (`RowActionsMenu`) trigger has no tooltip, only its `aria-label`.

The tooltip is the short verb phrase, in sentence case, with no trailing period.
The `aria-label` is the same phrase and may add the object name: tooltip "Remove", `aria-label` `Remove ${email}`.
A keyboard hint or side effect goes in parentheses in the tooltip only: "Stop (Esc)", "Send now (interrupts the agent)".

The same action uses the same words everywhere:

- Remove from a list: "Remove"; destroy: "Delete"; invalidate a credential or rule: "Revoke".
- GitHub: "Open on GitHub" on icon-only links, "View on GitHub" as menu text.
- Copy: "Copy <noun>".
- Back: "Back", or "Back to <place>" when the target is fixed.
