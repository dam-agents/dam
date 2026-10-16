---
name: zooming-review
description: 'A skill for conducting a "zooming review" of a PR. The idea is to start from a high-level overview and gradually zoom in to lower-level details as needed, based on the user''s interest or concerns. This approach helps users understand the purpose of the code, its technical implementation, and any potential challenges without overwhelming them with unnecessary details upfront.'
---

Give me an HTML artifact that helps me answer these key questions:

- What is the purpose of the code from the perspective of a DAM user?
- How is it solved technically, at a high level and at a low level?

If the user hasn't provided a PR, ask them for a PR number or a link.

Structure the artifact around a concept called "zooming review". You start by looking at the PR from a high level. The human zooms in only when they spot something important, either for the product or something they think might be technically challenging.

Zooming in means going down one level at a time, giving information that helps them understand the lower level.

The user does not jump straight to the code. Sometimes it is enough to know how the feature works. Sometimes the user wants to know what the technical challenges are. Sometimes they are even interested in how the components are coupled. Each of these steps is a "zoom in".

The goal is for the user to start looking at the PR from a high level and decide for themselves when they need the low-level details.

Keep the language extremely concise and clear. Reader's time is precious, they need to get potentially the most important information as quickly as possible. If visualizations help, use them.
