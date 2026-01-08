#!/bin/sh
set -eu

if [ -z "${API_METRICS_TARGET:-}" ]; then
  echo "ERROR: API_METRICS_TARGET is required (e.g. api:3000)" >&2
  exit 1
fi

TEMPLATE="/etc/prometheus/prometheus.template.yml"
OUT="/etc/prometheus/prometheus.yml"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: Missing Prometheus config template at $TEMPLATE" >&2
  exit 1
fi

# Render template -> config. Use '|' delimiter so targets like host:port don't need escaping.
sed "s|__API_METRICS_TARGET__|${API_METRICS_TARGET}|g" "$TEMPLATE" > "$OUT"

exec /bin/prometheus "$@"


