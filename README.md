# HookRelay

A reliable webhook delivery service. Your application publishes an event through one API call; HookRelay delivers it to the customer's URL with a **signed payload**, **automatic retries with exponential backoff**, and a **full delivery log**.

This is the same problem Stripe, GitHub, and Shopify solve internally, built as a small production-style Node.js system.

## Architecture

```
            POST /events                 enqueue job
 Client  ───────────────►  API (Express) ───────────►  Redis (BullMQ)
                              │                             │
                              │ write                       │ consume
                              ▼                             ▼
                         PostgreSQL  ◄─────────────  Worker (Node)
                  endpoints / events /                 │ signed POST, 10s timeout
                  deliveries / attempts                ▼
                                                 Customer's URL
                                       2xx = delivered, otherwise retry
```

- **API** (`src/server.js`): registers endpoints, accepts events, exposes delivery status. Returns `202 Accepted` immediately; delivery is asynchronous.
- **Worker** (`src/worker.js`): pulls jobs, sends the HTTP request, records every attempt, retries on failure.
- **PostgreSQL**: source of truth for endpoints, events, deliveries, and per-attempt logs.
- **Redis + BullMQ**: durable job queue, retry scheduling, and concurrency control.

The API and worker are separate processes so each can be scaled independently.

## Design decisions

| Decision | Why |
|---|---|
| HMAC-SHA256 signature over `timestamp.body` | Receivers can verify authenticity, and the timestamp stops replay attacks (5 minute tolerance). Same scheme Stripe uses. |
| Exponential backoff, 6 attempts (5s, 10s, 20s, 40s, 80s) | Gives a temporarily-down receiver time to recover without hammering it. |
| `jobId = deliveryId` | Enqueueing is idempotent; the same delivery can't be queued twice. |
| Postgres as source of truth, Redis only for scheduling | If Redis is lost, no event or delivery history is lost. |
| SSRF guard + no redirects | Webhook URLs are user-supplied, so the worker must not be usable to reach internal services or cloud metadata (`169.254.169.254`). |
| Timing-safe comparisons | API key and signature checks avoid timing side channels. |
| Graceful shutdown | The worker finishes in-flight deliveries on SIGTERM before exiting. |

## Run it locally

Requires Docker.

```bash
docker compose up --build
```

The API is now on `http://localhost:3000`. Default API key: `dev-api-key-change-me`.

```bash
# 1. Register an endpoint (the secret is shown only once)
curl -s -X POST localhost:3000/endpoints \
  -H 'x-api-key: dev-api-key-change-me' -H 'content-type: application/json' \
  -d '{"url":"https://webhook.site/your-unique-id"}'

# 2. Publish an event
curl -s -X POST localhost:3000/events \
  -H 'x-api-key: dev-api-key-change-me' -H 'content-type: application/json' \
  -d '{"endpointId":"<id from step 1>","type":"order.created","payload":{"orderId":42}}'

# 3. Check delivery status and attempt log
curl -s localhost:3000/deliveries/<deliveryId> -H 'x-api-key: dev-api-key-change-me'
```

To test signature verification end to end, run `examples/receiver.js` with the endpoint's secret.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Checks Postgres and Redis (no auth) |
| `POST` | `/endpoints` | Register `{ url }`, returns `{ id, secret, ... }` |
| `POST` | `/events` | Publish `{ endpointId, type, payload }`, returns `202` |
| `GET` | `/deliveries/:id` | Status, attempt count, and every attempt's result |
| `POST` | `/deliveries/:id/retry` | Manually retry a permanently failed delivery |

All routes except `/health` require the `x-api-key` header.

## Verifying a webhook (receiver side)

Each request carries `X-Hookrelay-Signature: t=<unix>,v1=<hmac>`. See `src/signing.js` (`verify`) and `examples/receiver.js`.

## Tests

```bash
npm install
npm test
```

CI (GitHub Actions) runs tests and builds the Docker image on every push and pull request.

## Deploy

The app is stateless, so any container host works. A simple path:

1. **Render / Railway / Fly.io**: create a Postgres and a Redis instance, then deploy this repo as two services from the same Dockerfile: `node src/server.js` (web) and `node src/worker.js` (worker).
2. Set `DATABASE_URL`, `REDIS_URL`, and a long random `API_KEY`.
3. Run `node src/migrate.js` once as a release command.
4. **Do not** set `ALLOW_PRIVATE_URLS` in production.

On AWS the same layout maps to ECS Fargate (two services), RDS, and ElastiCache.

## Next steps

Good extensions that make strong talking points:

- Resolve DNS at delivery time and re-check the IP (full DNS-rebinding protection).
- Per-tenant API keys and rate limits.
- Multiple endpoints per account with event-type subscriptions.
- Dead-letter queue UI and delivery dashboard.
- Prometheus metrics and Grafana dashboard.
- Terraform for the AWS deployment.
- Integration tests with Testcontainers.

## License

MIT
