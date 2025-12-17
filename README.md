# Wykra API

Wykra is an open-source, build-in-public discovery agent that helps founders, marketers and small teams find the people and communities shaping attention in their niche.

Originally built as a [hackathon prototype](http://dev.to/olgabraginskaya/wykra-web-you-know-real-time-analysis-20i3?ref=datobra.com) (“find people talking about bread in Barcelona”), it’s now being rebuilt as a clean, self-hostable NestJS backend with a simple API for influencer and community discovery powered by Bright Data and LLM analysis.

## Why

Discovery shouldn’t mean ten open tabs, half-broken spreadsheets, and guessing which voices actually matter.

Our goals:

- Make discovery transparent, not a black box.
- Balance real-time data with realistic costs.
- Keep it open-source, so anyone can self-host, extend or contribute.

## Current functionality (Week 1 snapshot)

- Provide an Instagram username.
- The API uses [Bright Data’s Scraper](https://brightdata.com/products/web-scraper/instagram/profiles) to fetch public profile details.
- It selects key fields (bio, followers, engagement, categories, etc.).
- Builds a natural-language prompt.
- Sends it to an LLM via OpenRouter for contextual analysis.
- Returns a structured insight about the profile.

## Tech stack snapshot

- **Framework**: NestJS 11 (TypeScript)
- **Database**: PostgreSQL + TypeORM
- **Cache**: Redis
- **LLM orchestration**: LangChain (Anthropic Claude, OpenAI, others via provider adapters)
- **Observability**: Sentry

## Getting started

We are building everything in the open from the first commit. If documentation is missing or unclear, open an issue or ping us. We would rather answer questions than ship guesswork.

### Bright Data setup

Bright Data offers free starter credits so you can test the setup without paying upfront, claim them here: [Bright Data free trial](https://get.brightdata.com/30ufd).

1. Generate a Bright Data API key from the account dashboard. Follow the steps in the Bright Data docs: [How do I generate a new API key?](https://docs.brightdata.com/api-reference/authentication#how-do-i-generate-a-new-api-key%3F).
2. Make sure you have access to the Instagram Web Scraper. The scraper capabilities are documented here: [Instagram API Scrapers](https://docs.brightdata.com/api-reference/web-scraper-api/social-media-apis/instagram).
3. Review the available datasets and pick the one that fits your use case (Instagram is the default). Dataset terminology and the dataset catalog live here: [Dataset ID](https://docs.brightdata.com/api-reference/terminology#dataset-id) and [Get dataset list](https://docs.brightdata.com/api-reference/marketplace-dataset-api/get-dataset-list).
4. Copy the API key into `.env` (see `.env.example` for the exact variable name).

### OpenRouter setup

OpenRouter provides unified access to multiple LLMs (Claude, GPT-4, Gemini, etc.) without hard rate limits.

1. Create an account on OpenRouter and generate an API key in the dashboard: [OpenRouter API keys](https://openrouter.ai/docs/quickstart).
2. Drop the key into `.env` as `OPENROUTER_API_KEY`.
3. (Optional) Pick a model from the [OpenRouter catalog](https://openrouter.ai/models) and set `OPENROUTER_MODEL` if you want something other than the default.
4. Leave `OPENROUTER_BASE_URL` and timeout as-is unless you have a custom proxy or need different latency settings.

### Clone and configure

```bash
git clone https://github.com/wykra-io/wykra-api
cd wykra-api
cp .env.example .env  # add your keys here
```

<details>
<summary><strong>Run the project</strong></summary>

### Local setup

```bash
npm install

# run in watch mode
npm run start:dev

# production build
npm run build
npm run start:prod
```

Migrations:

```bash
npm run migration:create -- --name=my_migration
npm run migration:run
npm run migration:revert
```

### Docker

```bash
docker build -t wykra-api .
docker run --env-file .env -p 3000:3000 wykra-api
```

Run migrations inside the container:

```bash
docker exec -it wykra-api npm run migration:run
```

### Docker Compose

**Full stack (API + PostgreSQL + Redis):**

```bash
docker-compose up -d
docker-compose logs -f api
docker-compose down
# remove persistent volumes if needed
docker-compose down -v
```

**Dev services only (Postgres + Redis, run API locally):**

```bash
docker-compose -f docker-compose.dev.yml up -d
docker-compose -f docker-compose.dev.yml down
```

Execute migrations via Compose:

```bash
docker-compose exec api npm run migration:run
```

</details>

### Monitoring

<details>
<summary><strong>Monitoring Stack (Prometheus + Alertmanager + Grafana)</strong></summary>

The project includes a complete monitoring stack for metrics collection, alerting, and visualization.

**Start the monitoring stack:**

```bash
# Production
docker-compose up -d prometheus alertmanager grafana

# Development (uses different ports)
docker-compose -f docker-compose.dev.yml up -d prometheus alertmanager grafana
```

**Access the services:**

- **Grafana** (Visualization):
  - Production: http://localhost:3001
  - Development: http://localhost:3002
  - Default credentials: `admin` / `admin` (change on first login)

- **Prometheus** (Metrics):
  - Production: http://localhost:9090
  - Development: http://localhost:9091
  - Query metrics, view targets, and check alert rules

- **Alertmanager** (Alerts):
  - Production: http://localhost:9093
  - Development: http://localhost:9094
  - View active alerts and silence rules

**API Metrics Endpoint:**

Your API automatically exposes metrics at:
```
http://localhost:3011/metrics
```

Prometheus scrapes this endpoint every 15 seconds to collect:
- HTTP request rates and durations
- Error rates by status code
- CPU and memory usage
- Custom application metrics

**Using Grafana:**

1. **Login**: Use default credentials (`admin`/`admin`) or your configured credentials
2. **View Dashboard**: The "Wykra API Dashboard" is automatically provisioned and includes:
   - Request rate graphs
   - Error rate monitoring
   - Response time percentiles (p50, p95)
   - Memory and CPU usage
   - Active alerts count
3. **Explore Metrics**: Go to Explore → Select Prometheus datasource → Write PromQL queries
4. **Create Custom Dashboards**: Build your own visualizations using the available metrics

**Available Metrics:**

- **HTTP**: `http_requests_total`, `http_request_duration_seconds`, `http_request_errors_total`
- **Tasks/Queue**: `tasks_created_total`, `tasks_completed_total`, `tasks_failed_total`, `task_processing_duration_seconds`, `tasks_status_total`, `task_queue_size`, `task_queue_wait_time_seconds`
- **LLM**: `llm_calls_total`, `llm_prompt_tokens_total`, `llm_completion_tokens_total`, `llm_total_tokens_total`, `llm_input_tokens_per_request`, `llm_output_tokens_per_request`, `llm_call_duration_seconds`, `llm_call_errors_total`
- **BrightData**: `brightdata_calls_total`, `brightdata_call_duration_seconds`, `brightdata_call_errors_total`
- **Database**: `db_queries_total`, `db_query_duration_seconds`, `db_query_errors_total`
- **Redis**: `redis_operations_total`, `redis_operation_duration_seconds`, `redis_operation_errors_total`
- **System**: `process_cpu_user_seconds_total`, `process_resident_memory_bytes`, plus all default Node.js process metrics

**Task Metrics Queries (Prometheus):**

```promql
# All tasks - creation rate
rate(tasks_created_total[5m])

# Instagram search tasks - creation rate
rate(tasks_created_total{task_type="instagram_search"}[5m])

# Generic tasks - creation rate
rate(tasks_created_total{task_type="generic"}[5m])

# Task completion rate (all types)
rate(tasks_completed_total[5m])

# Instagram search tasks - completion rate
rate(tasks_completed_total{task_type="instagram_search"}[5m])

# Task failure rate (all types)
rate(tasks_failed_total[5m])

# Instagram search tasks - failure rate
rate(tasks_failed_total{task_type="instagram_search"}[5m])

# Task success rate by type
rate(tasks_completed_total[5m]) / rate(tasks_created_total[5m])

# Instagram search success rate
rate(tasks_completed_total{task_type="instagram_search"}[5m]) / rate(tasks_created_total{task_type="instagram_search"}[5m])

# Average task processing time by type
rate(task_processing_duration_seconds_sum[5m]) / rate(task_processing_duration_seconds_count[5m])

# Instagram search processing time (95th percentile)
histogram_quantile(0.95, rate(task_processing_duration_seconds_bucket{task_type="instagram_search"}[5m]))

# Current task status distribution by type
sum(tasks_status_total) by (status, task_type)

# Instagram search endpoint request rate
rate(http_requests_total{route="/api/v1/instagram/search"}[5m])

# Task endpoint request rate
rate(http_requests_total{route=~"/api/v1/tasks.*"}[5m])
```

**Configuring Alerts:**

1. **Edit Alert Rules**: Modify `monitoring/prometheus/alerts.yml` to customize alert conditions
2. **Configure Notifications**: Edit `monitoring/alertmanager/alertmanager.yml` to add:
   - Slack webhooks
   - Email notifications
   - Custom webhooks
   - PagerDuty integration

Example Slack configuration:
```yaml
slack_configs:
  - api_url: 'YOUR_SLACK_WEBHOOK_URL'
    channel: '#alerts'
    title: 'Alert: {{ .GroupLabels.alertname }}'
    text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
```

**Pre-configured Alerts:**

- **HighErrorRate**: Error rate > 5% for 5 minutes
- **HighResponseTime**: p95 response time > 2s for 5 minutes
- **ServiceDown**: API unreachable for 1 minute
- **HighMemoryUsage**: Memory > 1GB for 5 minutes
- **HighCPUUsage**: CPU usage > 80% for 5 minutes
- **HighLLMErrorRate**: LLM error spike
- **HighDatabaseErrorRate / SlowDatabaseQueries**: DB errors or slow queries
- **HighRedisErrorRate**: Redis errors
- **LargeTaskQueueBacklog / LongTaskQueueWaitTime**: Queue congestion
- **HighBrightDataErrorRate**: BrightData failures
- **SlowLLMCalls / HighTokenUsageRate**: LLM latency or token burn

**Key Monitoring Files:**

- `monitoring/grafana/dashboards/wykra-api-dashboard.json` — prebuilt Grafana dashboard
- `monitoring/prometheus/prometheus.yml` — Prometheus scrape targets
- `monitoring/prometheus/alerts.yml` — alert rules
- `monitoring/alertmanager/alertmanager.yml` — alert notifications
- `src/metrics/metrics.service.ts` — metric definitions
- `src/metrics/queue-metrics.service.ts` — queue size updater
- `src/metrics/metrics.interceptor.ts` — HTTP metrics interceptor
- `src/brightdata/brightdata.service.ts` — BrightData metrics recording
- `src/instagram/instagram.service.ts` & `src/perplexity/perplexity.service.ts` — LLM token and call metrics
- `libs/repositories/src/*.repository.ts` — DB metrics wrapping

</details>

### Try the API

Once the server is running (locally or via Docker), you can hit the analysis endpoint in two ways:

**Instagram profile analysis endpoint:**

- **Browser**: open `http://localhost:3011/api/v1/instagram/analysis?profile=<profile_name>` to view the JSON response. A short video walkthrough is coming soon.
- **cURL**:
  ```bash
  curl "http://localhost:3011/api/v1/instagram/analysis?profile=<profile_name>"
  ```
  Replace `<profile_name>` with the Instagram handle you want to inspect.

**Instagram search endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/instagram/search" \
    -H "Content-Type: application/json" \
    -d '{
      "query": "Find up to 15 public Instagram accounts from Portugal who post about cooking and have not more than 50000 followers"
    }'
  ```

**TikTok search endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/tiktok/search" \
    -H "Content-Type: application/json" \
    -d '{
      "query": "Find up to 15 public TikTok creators from Portugal who post about baking or sourdough bread and have between 5k and 50k followers"
    }'
  ```

**Google SERP endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/brightdata/google-serp" \
    -H "Content-Type: application/json" \
    -d '{
      "keyword": "site:instagram.com \"AI tools\" OR \"data engineer\" OR \"#buildinpublic\"",
      "url": "https://www.google.com/",
      "language": "en",
      "country": "US",
      "startPage": 1,
      "endPage": 5
    }'
  ```

**Google AI Mode endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/brightdata/google-ai-mode" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://google.com/aimode",
      "prompt": "Find Instagram profiles of NYC sourdough bakers. Use the Google query: site:instagram.com '\''sourdough'\'' '\''NYC baker'\''. Return profile URLs only.",
      "country": "US"
    }'
  ```

**Perplexity Search endpoint (Bright Data):**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/brightdata/perplexity-search" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.perplexity.ai",
      "prompt": "Find Instagram profiles of NYC sourdough bakers. Return 15 profile URLs only (one per line). Prefer individual bakers (not brands or agencies). NYC includes Manhattan, Brooklyn, Queens.",
      "index": 1
    }'
  ```

**Perplexity Search endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/perplexity/search" \
    -H "Content-Type: application/json" \
    -d '{
      "query": "Give me a list of 10 micro-influencers (5K–50K followers) on Instagram who post about tech gadgets and AI tools"
    }'
  ```

**Perplexity Search Chain endpoint:**

- **cURL**:
  ```bash
  curl -X POST "http://localhost:3011/api/v1/perplexity/search-chain" \
    -H "Content-Type: application/json" \
    -d '{
      "query": "indie makers and AI builders"
    }'
  ```

### Environment variables

Required core config:

- `NODE_ENV`, `APP_HOST`, `APP_PORT`, `APP_GLOBAL_PREFIX`, `APP_SECRET_KEY`
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`

Optional integrations:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`
- `SENTRY_DSN`, `REDIS_HOST`, `REDIS_PORT`

Check `.env.example` for defaults and comments.

## Contributing

- Open an issue for any bug report, feature idea or question. Context helps — include logs, steps to reproduce or links to relevant discussions.
- Before starting bigger changes, propose them in an issue so we can confirm scope and direction together.
- Keep pull requests focused. Describe your approach, any trade-offs, and how you tested the change.
- Reference the issue number in your PR description and include screenshots or sample responses when it clarifies the outcome.
- We build everything in public, from commits to mistakes. Be kind, be curious, and let’s keep the conversation welcoming.

## Project structure

```
wykra-api/
├── src/              # Main NestJS modules
│   └── app/          # Root application module
├── libs/             # Shared libraries and cross-cutting pieces
│   ├── config/       # Configuration services
│   ├── entities/     # TypeORM entities
│   ├── repositories/ # Data access helpers
│   ├── exceptions/   # Custom exception handling
│   ├── interfaces/   # Shared TypeScript interfaces
│   ├── utils/        # Utility helpers
│   ├── sentry/       # Observability wiring
│   └── interceptors/ # HTTP interceptors
├── db/               # Database migrations
└── test/             # E2E and unit test setup
```

## Staying in the loop

- Weekly build-in-public posts on Dev.to (https://dev.to/olgabraginskaya/build-in-public-day-zero-end).
- Quick updates and questions on X/Twitter: [@ohthatdatagirl](https://x.com/ohthatdatagirl).
- Star or watch the repo to see weekly progress.

## Thanks

If you are using Wykra, contributing code or sharing feedback, you are part of this build. Let’s make “find the right people to talk to” a workflow instead of a stress test.
