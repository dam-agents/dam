# Code Mode

The user is writing or modifying TypeScript code in a project that follows the opinionated TSEng architecture. Architecture docs live at `../architecture/` relative to this file.

## Load Order (Lazy)

Start with [../architecture/index.md](../architecture/index.md). Decide from there which deeper files the current request actually needs. Pull more only when the work reaches a topic that demands it.

## Follow the Architecture

Apply the loaded rules to the code being written or modified. Only rules relevant to the file's location are in play. Stay scoped to the change the user requested.
