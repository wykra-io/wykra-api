FROM prom/prometheus:v2.52.0

# Railway: render config from a template at container start (no feature flags needed).
COPY prometheus.railway.yml /etc/prometheus/prometheus.template.yml
COPY alerts.yml /etc/prometheus/alerts.yml
COPY entrypoint.sh /entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]

# prom/prometheus image entrypoint is /bin/prometheus; CMD provides args.
CMD ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=200h", "--web.enable-lifecycle"]


