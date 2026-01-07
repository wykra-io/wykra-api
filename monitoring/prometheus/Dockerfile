FROM prom/prometheus:v2.52.0

# Railway: use a config that supports env var expansion for scrape targets.
# We enable it via --enable-feature=expand-env in CMD.
COPY prometheus.railway.yml /etc/prometheus/prometheus.yml
COPY alerts.yml /etc/prometheus/alerts.yml

EXPOSE 9090

# prom/prometheus image entrypoint is /bin/prometheus; CMD provides args.
CMD ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=200h", "--web.enable-lifecycle", "--enable-feature=expand-env"]


