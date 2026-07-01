require('dotenv').config();

module.exports = {
    db: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    },
    seed: {
        immediateEmailPercentage: parseFloat(process.env.IMMEDIATE_EMAIL_PERCENTAGE),
        immediateEmailPastWindowMs: parseInt(process.env.IMMEDIATE_EMAIL_PAST_WINDOW_MS, 10),
        futureEmailWindowMs: parseInt(process.env.FUTURE_EMAIL_WINDOW_MS, 10)
    },
    provider: {
        successRate: Number(process.env.PROVIDER_SUCCESS_RATE),
        transientRate: Number(process.env.PROVIDER_TRANSIENT_RATE),
        throttledRate: Number(process.env.PROVIDER_THROTTLED_RATE),
        hardBounceRate: Number(process.env.PROVIDER_HARD_BOUNCE_RATE),
        ambiguousRate: Number(process.env.PROVIDER_AMBIGUOUS_RATE),

        minLatency: Number(process.env.PROVIDER_MIN_LATENCY),
        maxLatency: Number(process.env.PROVIDER_MAX_LATENCY),
        throttleRetryAfterSeconds: Number(process.env.PROVIDER_THROTTLE_RETRY_AFTER_SECONDS),
        batchSize: Number(process.env.PROVIDER_BATCH_SIZE),
    },
    errorRetryDelay: Number(process.env.ERROR_RETRY_DELAY),
    reservationWindow: Number(process.env.RESERVATION_WINDOW),
    maxRetries: Number(process.env.MAX_RETRIES),
    mailBoxes: Number(process.env.MAILBOXES),
    minHourlyLimit: Number(process.env.MAILBOX_MIN_HOURLY_LIMIT),
    maxHourlyLimit: Number(process.env.MAILBOX_MAX_HOURLY_LIMIT),
    campaigns: Number(process.env.CAMPAIGNS),
    emails: Number(process.env.EMAILS),
    emailBatchSize: Number(process.env.EMAIL_BATCH_SIZE),
    globalRateLimitCapacity: Number(process.env.GLOBAL_RATE_LIMIT_CAPACITY),
    globalRateLimitInitialTokens: Number(process.env.GLOBAL_RATE_LIMIT_INITIAL_TOKENS),
    globalRateLimitRefillRate: Number(process.env.GLOBAL_RATE_LIMIT_REFILL_RATE),
    pollInterval: Number(process.env.POLL_INTERVAL),
    leaseDurationSeconds: Number(process.env.LEASE_DURATION_SECONDS),
    batchSize: Number(process.env.BATCH_SIZE)
};