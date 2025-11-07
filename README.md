# Wykra API

## Description

This is a NestJS-based API application designed for:
- Calling third-party APIs
- Processing API results using LLM with LangChain
- Managing integrations and data processing workflows

## Tech Stack

- **Framework**: NestJS 11.1.0
- **Language**: TypeScript
- **Database**: PostgreSQL with TypeORM
- **Caching**: Redis
- **AI/LLM**: LangChain (Anthropic Claude / OpenAI)
- **Monitoring**: Sentry

## Project Setup

```bash
npm install
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Update the `.env` file with your actual configuration values. The required variables are:

**Required:**
- `NODE_ENV` - Environment (development/production)
- `APP_HOST` - Application host
- `APP_PORT` - Application port
- `APP_GLOBAL_PREFIX` - API prefix
- `APP_SECRET_KEY` - Secret key for encryption
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_USERNAME` - Database username
- `DB_PASSWORD` - Database password
- `DB_DATABASE` - Database name

**Optional (for LLM features):**
- `ANTHROPIC_API_KEY` - Anthropic Claude API key
- `OPENAI_API_KEY` - OpenAI API key
- `LLM_PROVIDER` - LLM provider (anthropic/openai)
- `LLM_MODEL` - Model name to use

**Optional (for additional features):**
- `SENTRY_DSN` - Sentry DSN for error tracking
- `REDIS_HOST` - Redis host for caching
- `REDIS_PORT` - Redis port

## Running the Application

### Local Development

```bash
# development
npm run start:dev

# production mode
npm run start:prod
```

### Docker

#### Using Docker Compose (Recommended)

**Production:**
```bash
# Build and start all services (API, PostgreSQL, Redis)
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

**Development (Database and Redis only):**
```bash
# Start only PostgreSQL and Redis for local development
docker-compose -f docker-compose.dev.yml up -d

# Stop services
docker-compose -f docker-compose.dev.yml down
```

#### Using Docker directly

```bash
# Build the image
docker build -t wykra-api .

# Run the container
docker run -p 3000:3000 --env-file .env wykra-api
```

**Note:** When using Docker Compose, make sure your `.env` file is configured. The database and Redis services will be automatically started and connected.

## Database Migrations

### Local Development

```bash
# Create a new migration
npm run migration:create --name=your_migration_name

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

### Docker

```bash
# Run migrations inside the container
docker-compose exec api npm run migration:run

# Or if running migrations from host (requires DB_PORT exposed)
npm run migration:run
```

## Testing

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e

# test coverage
npm run test:cov
```

## Project Structure

```
wykra-api/
├── src/              # Main application source
│   └── app/          # Root application module
├── libs/             # Shared libraries
│   ├── config/       # Configuration services
│   ├── entities/     # TypeORM entities
│   ├── repositories/ # Data repositories
│   ├── exceptions/   # Custom exceptions
│   ├── interfaces/   # TypeScript interfaces
│   ├── utils/        # Utility functions
│   ├── sentry/       # Sentry integration
│   └── interceptors/ # HTTP interceptors
├── db/               # Database migrations
└── test/             # E2E tests
```
