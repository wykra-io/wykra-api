FROM grafana/grafana:latest

# Provision datasource + dashboards at image build time (Railway-friendly).
COPY provisioning /etc/grafana/provisioning
COPY dashboards /etc/grafana/provisioning/dashboards

EXPOSE 3000


