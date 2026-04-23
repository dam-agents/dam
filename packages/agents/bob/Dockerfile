ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}


RUN curl -s https://s3.us-south.cloud-object-storage.appdomain.cloud/bobshell/install-bobshell.sh | bash -s -- --pm npm

COPY workspace/ /app/working-dir/
COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs

ENV AGENT_COMMAND="node /app/bob-acp-shim.mjs"
