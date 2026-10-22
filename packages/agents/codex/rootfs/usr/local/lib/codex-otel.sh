# Sourced by the launch scripts before they exec codex: puts the -c flags that
# turn on the telemetry rail's export in front of "$@". Codex reads its
# exporters only from the [otel] table of config.toml, never from the OTEL_*
# env the rail delivers. A -c flag outranks every config file, so while the rail
# is on, no [otel] in ~/.codex/config.toml can turn prompt or response logging on.
codex_otel_endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT%/}"
if [ -n "$codex_otel_endpoint" ]; then
  if [ "$OTEL_TRACES_EXPORTER" = otlp ]; then
    set -- -c "otel.trace_exporter={otlp-http={endpoint=\"$codex_otel_endpoint/v1/traces\",protocol=\"binary\"}}" "$@"
  fi
  if [ "$OTEL_LOGS_EXPORTER" = otlp ]; then
    set -- -c "otel.exporter={otlp-http={endpoint=\"$codex_otel_endpoint/v1/logs\",protocol=\"binary\"}}" \
      -c otel.log_user_prompt=false -c otel.log_agent_responses=false -c otel.log_guardian_assessments=false "$@"
  fi
fi
unset codex_otel_endpoint
