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

### Try the API

Once the server is running (locally or via Docker), you can hit the analysis endpoint in two ways:

- **Browser**: open `http://localhost:3011/api/v1/instagram/analysis?profile=<profile_name>` to view the JSON response. A short video walkthrough is coming soon.
- **cURL**:
  ```bash
  curl "http://localhost:3011/api/v1/instagram/analysis?profile=<profile_name>"
  ```
  Replace `<profile_name>` with the Instagram handle you want to inspect.

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
