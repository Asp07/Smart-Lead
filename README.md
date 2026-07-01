# Smartlead Email Worker

A distributed email worker built with Node.js and PostgreSQL that simulates a production-grade email delivery system. It supports concurrent workers, lease-based job claiming, retry and backoff policies, per-mailbox and global rate limiting, worker crash recovery, and at-least-once delivery semantics while preventing concurrent processing of the same email.

The worker supports running multiple instances concurrently while guaranteeing that an email is never processed by more than one worker at a time.

---

# Features

- Concurrent workers
- Race-free job claiming using PostgreSQL row locking
- Lease-based job ownership
- At-least-once delivery
- Idempotent email processing
- Per-mailbox hourly rate limiting
- Global provider rate limiting (Token Bucket)
- Retry with exponential backoff
- Dead-letter handling
- Graceful worker shutdown
- Mock email provider with configurable failures

---

# Tech Stack

- Node.js
- PostgreSQL
- Docker

---

# Project Structure

```
.
├── config
│   └── config.js
├── db
│   ├── initDB.js
│   ├── postgres.js
│   ├── resetDB.js
│   └── seed.js
├── services
│   ├── claimJobs.js
│   ├── globalRateLimiter.js
│   ├── mailBoxLimiter.js
│   └── sendEmails
│       ├── processEmails.js
│       └── provider.js
├── test-script
│   ├── concurrency-test.sh
│   └── reset-db.sh
├── utils
│   └── utility.js
├── worker.js
├── index.js
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
└── DESIGN.md
```

---

# Configuration

Configuration is provided using environment variables.

Example:

```env
POLL_INTERVAL=10000
SEED_DB=true

LEASE_DURATION_SECONDS=30
BATCH_SIZE=30

PROVIDER_SUCCESS_RATE=0.80
PROVIDER_TRANSIENT_RATE=0.10
PROVIDER_THROTTLED_RATE=0.02
PROVIDER_HARD_BOUNCE_RATE=0.03
PROVIDER_AMBIGUOUS_RATE=0.05

PROVIDER_MIN_LATENCY=50
PROVIDER_MAX_LATENCY=250
PROVIDER_THROTTLE_RETRY_AFTER_SECONDS=300

PROVIDER_BATCH_SIZE=20

ERROR_RETRY_DELAY=3000
RESERVATION_WINDOW=3600000
MAX_RETRIES=5

DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=smartlead
```

---

# Running Locally

## Build

```bash
docker compose build
```

---

## Start PostgreSQL + Worker

```bash
docker compose up
```

---

## Start Multiple Workers

Example:

```bash
docker compose up --scale worker=5
```

This starts:

- PostgreSQL
- 5 worker containers

All workers safely compete for jobs.

---

## Seeding

Database initialization and seeding happen automatically on startup when

```env
SEED_DB=true
```

is set.

The generated seed data is fully configurable through environment variables.

Example:

```env
MAILBOXES=3
CAMPAIGNS=2
EMAILS=100
EMAIL_BATCH_SIZE=20

MAILBOX_MIN_HOURLY_LIMIT=25
MAILBOX_MAX_HOURLY_LIMIT=74

GLOBAL_RATE_LIMIT_CAPACITY=100
GLOBAL_RATE_LIMIT_INITIAL_TOKENS=100
GLOBAL_RATE_LIMIT_REFILL_RATE=10
```

Meaning:

- **MAILBOXES** – number of mailboxes to create
- **CAMPAIGNS** – number of campaigns to generate
- **EMAILS** – total emails to seed
- **EMAIL_BATCH_SIZE** – number of emails inserted per database batch
- **MAILBOX_MIN_HOURLY_LIMIT / MAILBOX_MAX_HOURLY_LIMIT** – random hourly limit range assigned to each mailbox
- **GLOBAL_RATE_LIMIT_CAPACITY** – token bucket capacity
- **GLOBAL_RATE_LIMIT_INITIAL_TOKENS** – initial available tokens
- **GLOBAL_RATE_LIMIT_REFILL_RATE** – tokens added per second

The seed script generates realistic test data, and the scheduling distribution is configurable using the following environment variables:

```env
IMMEDIATE_EMAIL_PERCENTAGE=0.7
IMMEDIATE_EMAIL_PAST_WINDOW_MS=300000
FUTURE_EMAIL_WINDOW_MS=120000
```

- **IMMEDIATE_EMAIL_PERCENTAGE** – Percentage of emails that are immediately eligible for processing.
- **IMMEDIATE_EMAIL_PAST_WINDOW_MS** – Random time window in the past (in milliseconds) for immediately eligible emails.
- **FUTURE_EMAIL_WINDOW_MS** – Random time window in the future (in milliseconds) for emails scheduled for later delivery.

For example, with the configuration above:

- Approximately **70%** of emails are scheduled randomly within the last **5 minutes**.
- Approximately **30%** of emails are scheduled randomly within the next **2 minutes**.

---

---

# Resetting the Database

If you want to rerun the application with a fresh dataset without recreating the PostgreSQL volume, a helper reset script is provided.

Run:

```bash
sh test-script/reset-db.sh
```

The script:

- Truncates all application tables while preserving the database schema.
- Resets auto-incrementing IDs.
- Removes mailbox reservations and global rate limiter state.
- Leaves the database ready for a fresh seed.

> **Note:** The script does not reseed the database. It only clears existing data.

To generate a new dataset after resetting, ensure:

```env
SEED_DB=true
```

and start the application again:

```bash
docker compose up
```

The newly generated seed data will use the current values configured in your `.env` file, including:

- `MAILBOXES`
- `CAMPAIGNS`
- `EMAILS`
- `EMAIL_BATCH_SIZE`
- `MAILBOX_MIN_HOURLY_LIMIT`
- `MAILBOX_MAX_HOURLY_LIMIT`
- `GLOBAL_RATE_LIMIT_CAPACITY`
- `GLOBAL_RATE_LIMIT_INITIAL_TOKENS`
- `GLOBAL_RATE_LIMIT_REFILL_RATE`
- `IMMEDIATE_EMAIL_PERCENTAGE`
- `IMMEDIATE_EMAIL_PAST_WINDOW_MS`
- `FUTURE_EMAIL_WINDOW_MS`


---

# Concurrency Test

A helper script is included to verify that the worker processes emails safely under concurrent execution.

Run:

```bash
sh test-script/concurrency-test.sh
```

> **Note:** The script uses the same configuration defined in the project's `.env` file. Any changes to the seed data, provider behavior, rate limits, batch sizes, or retry configuration should be made in `.env` before running the test.

The script will:

1. Stop any existing containers.
2. Rebuild the Docker images.
3. Start PostgreSQL and **5 worker** instances.
4. Seed the database using the configuration from `.env`.
5. Wait until all emails reach a terminal state.
6. Verify that:
   - Every email is processed exactly once.
   - No emails remain in `pending` or `sending`.
   - `sent + dead == total seeded emails`.

If all checks pass, the script prints:

```
✅ PASS
Concurrency test passed.
```

---

# Reproducing Concurrency and Rate-Limit Behaviour

## 1. No-Duplicate Processing

Start multiple workers:

```bash
docker compose up --scale worker=5
```

Set `SEED_DB=true` so fresh emails are generated.

Observe the worker logs.

Expected behavior:

- Every email ID is claimed by exactly one worker.
- Different workers process different emails in parallel.
- No email is processed concurrently by multiple workers.

Example:

```
Worker A claimed Email 15
Worker B claimed Email 16
Worker C claimed Email 17
```

The same email ID should never appear as claimed by two workers at the same time because claiming uses PostgreSQL row-level locking (`FOR UPDATE SKIP LOCKED`) together with leasing.

You can also verify this in PostgreSQL:

```sql
SELECT id, leased_by, lease_expires_at
FROM emails
WHERE status = 'sending';
```

Each email will have only one active lease.

---

## 2. Per-Mailbox Rate Limiting

Reduce the mailbox hourly limits in the database using .env.

With: Reduce MAILBOX_MIN_HOURLY_LIMIT and MAILBOX_MAX_HOURLY_LIMIT in .env (for example, set both to 1).

Seed multiple emails that belong to the same mailbox and start multiple workers.

Expected behavior:

- The first email reserves the available mailbox slot.
- Remaining emails are **not sent immediately**.
- They are rescheduled after the reservation window expires.

Worker logs should contain messages similar to:

```
Mailbox hourly limit reached.
Retry scheduled after 3600s.
```

Emails assigned to other mailboxes continue processing normally.

---

## 3. Global Provider Rate Limiting

Reduce the global token bucket capacity using .env.

With: Reduce GLOBAL_RATE_LIMIT_CAPACITY, GLOBAL_RATE_LIMIT_INITIAL_TOKENS, and GLOBAL_RATE_LIMIT_REFILL_RATE in .env (for example, set all to 0.1).

Start multiple workers:

```bash
docker compose up --scale worker=5
```

Expected behavior:

- One worker successfully consumes the available token.
- Remaining workers receive a global rate-limit response.
- Those emails are retried after the calculated refill time.

Worker logs should contain messages similar to:

```
Global rate limit reached.
Retry after 9s.
```

When enough tokens are refilled, the pending emails are automatically retried.

---

# Job Lifecycle

```
PENDING
    │
    ▼
CLAIMED (leased)
    │
    ▼
PROCESSING
    │
    ├────────────► SENT
    │
    ├────────────► RETRY
    │
    └────────────► DEAD LETTER
```

---

# Failure Handling

The mock provider simulates:

- Successful send
- Transient failure
- Provider throttling
- Hard bounce
- Ambiguous timeout

Behavior is configurable using the following environment variables:

- PROVIDER_SUCCESS_RATE
- PROVIDER_TRANSIENT_RATE
- PROVIDER_THROTTLED_RATE
- PROVIDER_HARD_BOUNCE_RATE
- PROVIDER_AMBIGUOUS_RATE

---

# Delivery Guarantee

The worker provides **at-least-once delivery**.

Duplicate processing is prevented using database leasing and idempotency keys. Ambiguous provider acknowledgements are retried until they succeed or reach the retry limit.

---

# Worker Crash Recovery

If a worker crashes after claiming emails, the lease eventually expires.

Another worker can safely reclaim and continue processing those emails.

This prevents jobs from remaining permanently stuck while still avoiding concurrent processing.

---

# Idempotency

Each email has a unique idempotency key.

Retries reuse the same idempotency key so repeated delivery attempts can be safely deduplicated by the provider.

---

# Rate Limiting

## Per Mailbox

Each mailbox has its own hourly quota.

Workers reserve mailbox capacity independently, allowing different mailboxes to continue processing without blocking each other.

---

## Global Provider Limit

A shared token bucket stored in PostgreSQL limits the total provider throughput across all workers.

Workers consume one token before sending.

If no token is available, the email is retried after the calculated refill time.

---

# Retry Policy

Transient failures are retried using exponential backoff.

Retries continue until:

- email succeeds
- maximum retries reached

After exceeding the retry limit the email is moved to the dead-letter state.

---

# Graceful Shutdown

Workers listen for:

- SIGINT
- SIGTERM

On shutdown the worker:

- stops polling
- finishes the current batch
- releases database connections
- exits cleanly

---

# Demonstrating No-Duplicate Processing

Start multiple workers:

```bash
docker compose up --scale worker=5
```

Seed a batch of emails.

Observe worker logs.

Example:

```
Worker A claimed Email 15
Worker B claimed Email 16
Worker C claimed Email 17
```

Each email ID is claimed by exactly one worker.

No duplicate sends occur because claiming uses PostgreSQL row-level locking (`FOR UPDATE SKIP LOCKED`) and leasing.

---

# Testing Rate Limits

### Mailbox Hourly Limit

Set mailbox hourly limits to a small value (for example 1 or 2) in the database.

Seed multiple emails for the same mailbox.

Observe:

```
Mailbox hourly limit reached.
Retry scheduled.
```

---

### Global Rate Limit

Reduce the global token bucket capacity.

Example:

```
capacity = 0.1
tokens = 0.1
refill_rate = 0.1
```

Run multiple workers.

Observe:

```
Global rate limit reached.
Retry after 9s.
```

Only one send proceeds when sufficient tokens become available.

---

# Notes

This project focuses on correctness under concurrent execution rather than production-scale optimizations.

Design decisions and scalability considerations are documented separately in `DESIGN.md`.