ARG BASE_IMAGE=platform-claude-code:latest
FROM ${BASE_IMAGE}

USER root

COPY --chown=65532:0 skills/ /app/working-dir/.agents/skills/
COPY --chown=65532:0 workspace/ /app/working-dir/work/

USER 65532
