---
id: 011
title: Skills via Claude plugin marketplace
status: accepted
subsystem: skills
summary: Source and manage skills through Claude's plugin marketplace rather than cross-harness registries or git-committed files.
---
# ADR-011: Skills via Claude plugin marketplace

**Date:** 2026-04-03
**Status:** Superseded by ADR-030
**Owner:** @pilartomas

## Context

Skills (markdown + YAML files that configure agent behavior) can be sourced from multiple ecosystems: Claude's curated plugin marketplace, Vercel's cross-harness skills.sh registry, Gemini CLI extensions, or simply committed to the repo as files. The team needs a single approach for discovering, installing, and sharing skills across the project.

## Decision

Use the Claude plugin marketplace as the primary source for skills. Team members install and manage skills through Claude's native plugin system.

The entire team works within the Claude ecosystem, so standardizing on Claude's marketplace avoids fragmentation across multiple skill registries and ensures consistent tooling.

## Alternatives Considered

**Vercel skills.sh.** A cross-harness skill registry aiming to be a universal distribution point. Rejected: the team doesn't use multiple harnesses, so cross-harness portability adds complexity without benefit.

**Gemini CLI extensions.** Google's extension ecosystem for Gemini CLI. Rejected: the team doesn't use Gemini CLI — adopting its extension system would mean maintaining skills in an ecosystem nobody uses.

**Git-committed skill files.** Check skill files directly into the repo with no marketplace. Rejected: loses the discovery, versioning, and community curation that a marketplace provides. Skills would need manual distribution and updates.

## Consequences

- Skills are managed through a single, well-known ecosystem — reduces onboarding friction
- Team members benefit from Claude marketplace's curation and trust infrastructure
- No cross-harness skill portability — if the team adopts a second harness later, skills won't transfer. Acceptable given the current single-harness setup
- Dependency on Claude's marketplace availability and policies for skill distribution
