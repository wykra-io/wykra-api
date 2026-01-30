# Wykra API Endpoints Documentation

This document provides comprehensive documentation for all Wykra API endpoints and Postman configuration.

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
  - [Health & Status](#health--status)
  - [Authentication](#authentication-endpoints)
  - [Instagram](#instagram)
  - [TikTok](#tiktok)
  - [Chat](#chat)
  - [Tasks](#tasks)
  - [BrightData](#brightdata)
  - [Perplexity](#perplexity)
  - [Metrics](#metrics)
- [Postman Configuration](#postman-configuration)
- [Error Responses](#error-responses)

## Base URL

- **Local Development**: `http://localhost:3011`
- **Production**: `https://api.wykra.io`
- **API Prefix**: `/api/v1` (all endpoints except `/metrics`)

## Authentication

Most endpoints require authentication using a Bearer token in the Authorization header:

```
Authorization: Bearer <your_api_token>
```

### Getting an API Token

1. **GitHub Authentication** (POST `/api/v1/auth/githubAuth`)
   - Requires: `Authorization: Bearer <github_token>`
   - Returns: `{ "token": "<api_token>" }`

2. **Social Authentication** (POST `/api/v1/auth/social`)
   - Supports Telegram WebApp authentication
   - Body: `{ "provider": "telegram", "code": "<telegram_initData>" }`
   - Returns: `{ "token": "<api_token>" }`

3. **GitHub OAuth Flow** (GET `/api/v1/auth/github/app/start`)
   - Redirects to GitHub for OAuth
   - Callback returns token via redirect or JSON

## API Endpoints

### Health & Status

#### GET `/`
Check API health status.

**Authentication**: Public (no auth required)

**Response**:
```json
{
  "status": "OK"
}
```

**Example**:
```bash
curl http://localhost:3011/
```

#### GET `/proxy-image`
Proxy external images to bypass CORS restrictions.

**Authentication**: Public (no auth required)

**Query Parameters**:
- `url` (required): URL-encoded image URL

**Example**:
```bash
curl "http://localhost:3011/proxy-image?url=https%3A%2F%2Fexample.com%2Fimage.jpg"
```

---

### Authentication Endpoints

#### POST `/api/v1/auth/githubAuth`
Authenticate with GitHub token and receive API token.

**Authentication**: Public (requires GitHub token in header)

**Headers**:
```
Authorization: Bearer <github_token>
```

**Response**:
```json
{
  "token": "your_api_token_here"
}
```

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/auth/githubAuth" \
  -H "Authorization: Bearer <github_token>"
```

#### POST `/api/v1/auth/social`
Social authentication (Telegram, etc.).

**Authentication**: Public

**Request Body**:
```json
{
  "provider": "telegram",
  "code": "<telegram_initData_string>"
}
```

**Response**:
```json
{
  "token": "your_api_token_here"
}
```

#### GET `/api/v1/auth/me`
Get current authenticated user information.

**Authentication**: Required

**Response**:
```json
{
  "githubLogin": "username",
  "githubAvatarUrl": "https://avatar.url"
}
```

#### POST `/api/v1/auth/logout`
Logout and invalidate current API token.

**Authentication**: Required

**Response**:
```json
{
  "ok": true
}
```

#### GET `/api/v1/auth/github/app/start`
Start GitHub OAuth flow (redirects to GitHub).

**Authentication**: Public

**Query Parameters**:
- `returnTo` (optional): Absolute URL to redirect to after callback

**Example**:
```
http://localhost:3011/api/v1/auth/github/app/start?returnTo=https://app.wykra.io
```

#### GET `/api/v1/auth/github/app/callback`
GitHub OAuth callback endpoint.

**Authentication**: Public

**Query Parameters**:
- `code` (required): OAuth code from GitHub
- `state` (required): State parameter for CSRF protection

#### GET `/api/v1/auth/github`
Alias for GitHub OAuth callback (simpler redirect URI).

---

### Instagram

#### POST `/api/v1/instagram/analysis`
Create a new Instagram profile analysis task (queued).

**Authentication**: Required

**Request Body**:
```json
{
  "profile": "username"
}
```

**Response**:
```json
{
  "taskId": "task-uuid-here"
}
```

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/instagram/analysis" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"profile": "username"}'
```

#### POST `/api/v1/instagram/search`
Search for Instagram profiles based on a query.

**Status**: ⚠️ **Currently Disabled** (returns 410 Gone)

**Authentication**: Required

**Request Body**:
```json
{
  "query": "Find up to 15 public Instagram accounts from Portugal who post about cooking and have not more than 50000 followers"
}
```

**Response** (when enabled):
```json
{
  "taskId": "task-uuid-here"
}
```

**Note**: This endpoint currently throws `GoneException` with message "Instagram profile search is currently disabled."

---

### TikTok

#### POST `/api/v1/tiktok/profile`
Create a new TikTok profile analysis task (queued).

**Authentication**: Required

**Request Body**:
```json
{
  "profile": "username"
}
```

**Response**:
```json
{
  "taskId": "task-uuid-here"
}
```

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/tiktok/profile" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"profile": "username"}'
```

#### POST `/api/v1/tiktok/search`
Search for TikTok profiles based on a query.

**Status**: ⚠️ **Currently Disabled** (returns 410 Gone)

**Authentication**: Required

**Request Body**:
```json
{
  "query": "Find up to 15 public TikTok creators from Portugal who post about baking or sourdough bread and have between 5k and 50k followers"
}
```

**Response** (when enabled):
```json
{
  "taskId": "task-uuid-here"
}
```

**Note**: This endpoint currently throws `GoneException` with message "TikTok profile search is currently disabled."

---

### Chat

#### POST `/api/v1/chat`
Handle user chat queries as an AI assistant. Detects requests to Instagram and TikTok endpoints.

**Authentication**: Required

**Rate Limit**: 10 requests per hour

**Request Body**:
```json
{
  "message": "Find Instagram profiles about AI tools"
}
```

**Response**:
```json
{
  "response": "AI assistant response text",
  "detectedEndpoint": "/api/v1/instagram/search",
  "endpointData": {
    "query": "AI tools"
  }
}
```

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/chat" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Find Instagram profiles about AI tools"}'
```

#### GET `/api/v1/chat/history`
Get chat history for the authenticated user.

**Authentication**: Required

**Response**:
```json
[
  {
    "id": 1,
    "role": "user",
    "content": "Find Instagram profiles about AI tools",
    "detectedEndpoint": "/api/v1/instagram/search",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  {
    "id": 2,
    "role": "assistant",
    "content": "I'll help you find Instagram profiles...",
    "detectedEndpoint": null,
    "createdAt": "2024-01-15T10:30:05Z"
  }
]
```

---

### Tasks

#### GET `/api/v1/tasks/:id`
Get the status of a task by its ID.

**Authentication**: Required (but throttling is skipped)

**Response**:
```json
{
  "taskId": "task-uuid-here",
  "status": "completed",
  "result": "Task completed successfully",
  "error": null,
  "startedAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:35:00Z",
  "instagramProfiles": [
    {
      "id": 1,
      "username": "example_user",
      "followers": 50000,
      "bio": "Profile bio text"
    }
  ],
  "tiktokProfiles": []
}
```

**Task Status Values**:
- `pending`: Task is queued but not started
- `running`: Task is currently being processed
- `completed`: Task finished successfully
- `failed`: Task encountered an error

**Example**:
```bash
curl "http://localhost:3011/api/v1/tasks/task-uuid-here" \
  -H "Authorization: Bearer <api_token>"
```

---

### BrightData

#### POST `/api/v1/brightdata/google-serp`
Fetch Google SERP (Search Engine Results Page) data from BrightData.

**Authentication**: Required

**Request Body**:
```json
{
  "keyword": "site:instagram.com \"AI tools\" OR \"data engineer\" OR \"#buildinpublic\"",
  "url": "https://www.google.com/",
  "language": "en",
  "country": "US",
  "startPage": 1,
  "endPage": 5
}
```

**Response**: BrightData SERP results

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/brightdata/google-serp" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "site:instagram.com \"AI tools\"",
    "url": "https://www.google.com/",
    "language": "en",
    "country": "US",
    "startPage": 1,
    "endPage": 5
  }'
```

#### POST `/api/v1/brightdata/google-ai-mode`
Fetch Google AI Mode data from BrightData.

**Authentication**: Required

**Request Body**:
```json
{
  "url": "https://google.com/aimode",
  "prompt": "Find Instagram profiles of NYC sourdough bakers. Use the Google query: site:instagram.com 'sourdough' 'NYC baker'. Return profile URLs only.",
  "country": "US"
}
```

**Response**: BrightData AI Mode results

#### POST `/api/v1/brightdata/perplexity-search`
Fetch Perplexity search data from BrightData.

**Authentication**: Required

**Request Body**:
```json
{
  "url": "https://www.perplexity.ai",
  "prompt": "Find Instagram profiles of NYC sourdough bakers. Return 15 profile URLs only (one per line). Prefer individual bakers (not brands or agencies). NYC includes Manhattan, Brooklyn, Queens.",
  "index": 1
}
```

**Response**: BrightData Perplexity search results

---

### Perplexity

#### POST `/api/v1/perplexity/search`
Search for micro-influencers on Instagram based on the provided query using Perplexity.

**Authentication**: Required

**Request Body**:
```json
{
  "query": "Give me a list of 10 micro-influencers (5K–50K followers) on Instagram who post about tech gadgets and AI tools"
}
```

**Response**: Perplexity chat response with influencer data in JSON format

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/perplexity/search" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Give me a list of 10 micro-influencers (5K–50K followers) on Instagram who post about tech gadgets and AI tools"
  }'
```

#### POST `/api/v1/perplexity/search-chain`
Get Instagram hashtags and then find micro-influencers using those hashtags. Makes two sequential Perplexity calls.

**Authentication**: Required

**Request Body**:
```json
{
  "query": "indie makers and AI builders"
}
```

**Response**:
```json
{
  "hashtags": ["#buildinpublic", "#indiemaker"],
  "influencers": [
    {
      "username": "example_user",
      "followers": 25000
    }
  ]
}
```

**Example**:
```bash
curl -X POST "http://localhost:3011/api/v1/perplexity/search-chain" \
  -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"query": "indie makers and AI builders"}'
```

---

### Metrics

#### GET `/metrics`
Get Prometheus metrics in text format.

**Authentication**: Public (no auth required)

**Content-Type**: `text/plain`

**Response**: Prometheus metrics format

**Example**:
```bash
curl http://localhost:3011/metrics
```

**Note**: This endpoint is excluded from the global API prefix.

---

## Postman Configuration

### Importing Collections

Postman collections are available in the `postman-api/` directory:

- `Auth API.postman_collection.json`
- `BrightData API.postman_collection.json`
- `Instagram API.postman_collection.json`
- `Metrics API.postman_collection.json`
- `Perplexity API.postman_collection.json`
- `Tasks API.postman_collection.json`
- `TikTok API.postman_collection.json`

### Setting Up Postman Environment

1. **Create a new Environment** in Postman (or use the default)

2. **Add Environment Variables**:

   | Variable Name | Initial Value | Current Value | Description |
   |--------------|---------------|---------------|-------------|
   | `apiUrl` | `http://localhost:3011` | `http://localhost:3011` | Base API URL |
   | `apiToken` | (leave empty) | (leave empty) | API authentication token |
   | `githubToken` | (leave empty) | (leave empty) | GitHub token for authentication |

3. **For Production**:
   - Set `apiUrl` to `https://api.wykra.io`

### Using the Collections

1. **Import Collections**:
   - File → Import → Select all JSON files from `postman-api/` directory
   - Or drag and drop the files into Postman

2. **Authenticate First**:
   - Use the "GitHub authentication" request in the "Auth API" collection
   - Set your `githubToken` variable
   - Run the request
   - The response will automatically set `apiToken` (if the collection includes test scripts)

3. **Manual Token Setup**:
   - If auto-setup doesn't work, copy the token from the authentication response
   - Manually set the `apiToken` environment variable

4. **Select Environment**:
   - Use the environment dropdown in Postman to select your configured environment
   - All requests will use the variables from the selected environment

### Postman Collection Structure

Each collection uses the following variables:
- `{{apiUrl}}` - Base URL (e.g., `http://localhost:3011`)
- `{{apiToken}}` - Bearer token for authenticated requests

### Example Workflow

1. **Setup**:
   ```
   1. Import all Postman collections
   2. Create/select environment
   3. Set apiUrl = http://localhost:3011
   4. Set githubToken = your_github_token
   ```

2. **Authenticate**:
   ```
   1. Open "Auth API" collection
   2. Run "GitHub authentication" request
   3. apiToken is automatically set (or copy manually)
   ```

3. **Use API**:
   ```
   1. Open any collection (Instagram, TikTok, etc.)
   2. Select your environment
   3. Run requests - they'll use apiToken automatically
   ```

### Testing with Postman

- All authenticated endpoints automatically include: `Authorization: Bearer {{apiToken}}`
- Update `apiUrl` to switch between local and production
- Collections are organized by feature area for easy navigation

---

## Error Responses

### Standard Error Format

```json
{
  "statusCode": 400,
  "message": "Error message here",
  "error": "Bad Request"
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `410` - Gone (endpoint disabled)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

### Rate Limiting

- **Chat endpoint**: 10 requests per hour
- Other endpoints may have rate limits configured
- Rate limit headers are included in responses:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Time when limit resets

---