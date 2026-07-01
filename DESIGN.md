# 1. How does claiming stay race-free under N workers, and what is the database actually doing for you?

The worker uses PostgreSQL row-level locking to ensure that multiple workers cannot claim the same email.

When a worker polls for work, it executes a transaction that:

- selects eligible emails using `FOR UPDATE SKIP LOCKED`
- marks them as leased to the current worker
- sets a lease expiration timestamp
- commits the transaction

Because PostgreSQL acquires row-level locks during the transaction:

- one worker locks the selected rows
- other workers automatically skip those locked rows
- no two workers can lease the same email simultaneously

`SKIP LOCKED` allows workers to continue claiming other available jobs instead of waiting on locks, enabling horizontal scaling without serializing the fleet.

The database provides:

- transactional consistency
- row-level locking
- atomic leasing
- crash-safe ownership transfer


---

# 2. What's your delivery guarantee, and how do you achieve it? How do you handle the ambiguous provider timeout?

The worker provides **at-least-once delivery**.

Each email has an idempotency key that remains unchanged across retries.

Delivery outcomes are handled as follows:

### Success

The email is marked as SENT.

### Transient failure

The email is retried using exponential backoff.

### Provider throttling

The provider supplies a retry-after duration which is respected before retrying.

### Hard bounce

The email is immediately dead-lettered since retrying cannot succeed.

### Ambiguous provider timeout

This represents the situation where the provider may have accepted the email but the acknowledgement was lost.

Since delivery status is unknown, the worker retries using the same idempotency key.

This avoids treating the retry as a completely new send and allows providers supporting idempotency to safely identify duplicate requests.

---

# 3. How do you enforce per-mailbox limits without serialising the whole fleet?

Each mailbox maintains its own reservation table.

Before sending an email:

- expired reservations are cleaned up
- active reservations are counted
- if capacity exists, a reservation is inserted
- otherwise the email is retried after the reservation window expires

Only reservations belonging to the specific mailbox are examined.

Workers processing different mailboxes never block each other.

The global fleet therefore remains parallel while each mailbox independently enforces its own hourly quota.

A separate global token bucket limits total provider throughput across all workers.

---

# 4. What's your retry, backoff, and dead-letter policy?

The retry policy depends on failure type.

### Transient failure

Retries use exponential backoff.

### Provider throttling

Retries respect the provider supplied retry-after duration.

### Mailbox hourly limit

Retry occurs after the reservation window becomes available.

### Global provider rate limit

Retry occurs after the calculated token refill time.

### Ambiguous timeout

The email is retried using the same idempotency key.

Retries continue until the configured maximum retry count is reached.

After exceeding the retry limit, the email is moved to the dead-letter state.

Hard bounces are dead-lettered immediately because retrying is not useful.

---

# 5. What did you deliberately cut, and what would you change to handle 10M+ sends/day across many machines?

This implementation prioritizes correctness and simplicity over production-scale optimization.

## Deliberately omitted

- Dedicated Dead Letter Queue 
- Distributed cache for high-throughput rate limiting
- Circuit Breaker
- Metrics and monitoring
- Real email provider integration
- Automated Integration Tests

---

## For production-scale workloads (10M+ sends/day), I would make the following improvements:

### Queueing

Replace database polling with a durable message queue such as Kafka or Amazon SQS.

Instead of workers continuously polling PostgreSQL, a scheduler would publish ready emails to the queue and workers would consume directly from it.

Introduce a Dead Letter Queue (DLQ) so permanently failed emails are moved out of the main processing pipeline while remaining available for inspection or replay.

---

### Database

- Partition large email tables by creation date or campaign.
- Archive completed emails to reduce table size.
- Add read replicas for reporting workloads.
- Periodically clean expired leases and old reservation records.

---

### Rate Limiting

Move mailbox reservation tracking and global token bucket management to Redis using atomic Lua scripts.

Redis provides much higher throughput while PostgreSQL remains the system of record.

---

### Worker Fleet

Keep workers completely stateless so they can scale horizontally.

Auto-scale workers based on queue depth or processing throughput.

---

### Provider Integrations

Use real provider APIs supporting idempotency.

Implement provider-specific retry policies and automatic failover to secondary providers when necessary.

---

### Observability

Add basic operational visibility through metrics, structured logging, and alerting to monitor worker health, retries, failures, and queue depth.

---

### Reliability

Deploy PostgreSQL with replication and automatic failover.

Run workers across multiple machines or availability zones to eliminate single points of failure.

---

# Validation

A concurrency verification script (`test-script/concurrency-test.sh`) is included.

The script starts five workers concurrently, waits for processing to finish, and verifies that:

- all emails reach a terminal state,
- no emails remain pending or sending,
- the total number of processed emails equals the number of seeded emails.

This demonstrates that concurrent workers do not process the same email simultaneously.

---

# Time Spent

Approximately **7 hours** were spent implementing, testing, and documenting this assignment.

Time was primarily spent on:

- Designing race-free claiming
- Implementing leasing
- Retry and rate limiting logic
- Failure simulation
- Concurrency testing
- Documentation

---