const pool = require("./postgres");

async function initializeDatabase() {
    // Mailboxes
    await pool.query(`
        CREATE TABLE IF NOT EXISTS mailboxes (
            id              BIGSERIAL PRIMARY KEY,
            email_address   VARCHAR(255) NOT NULL UNIQUE,
            hourly_limit    INTEGER NOT NULL CHECK(hourly_limit > 0),
            created_at      TIMESTAMP NOT NULL DEFAULT NOW()
        );
    `);

    // Email Queue
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scheduled_emails (
            id                  BIGSERIAL PRIMARY KEY,
            campaign_id         BIGINT NOT NULL,
            mailbox_id          BIGINT NOT NULL REFERENCES mailboxes(id),
            to_address          TEXT NOT NULL,
            subject             TEXT NOT NULL,
            body                TEXT NOT NULL,
            scheduled_at        TIMESTAMP NOT NULL,
            status              VARCHAR(20) NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            provider_message_id TEXT,
            idempotency_key     UUID NOT NULL UNIQUE,
            leased_by           TEXT,
            lease_expires_at    TIMESTAMP,
            next_retry_at       TIMESTAMP,
            sent_at             TIMESTAMP,
            last_error          TEXT,
            created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
        );
    `);

    // Mailbox rate limiting reservations
    await pool.query(`
        CREATE TABLE IF NOT EXISTS mailbox_send_slots (
            id              BIGSERIAL PRIMARY KEY,
            mailbox_id      BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
            email_id        BIGINT NOT NULL REFERENCES scheduled_emails(id) ON DELETE CASCADE,
            reserved_at     TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(mailbox_id, email_id)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS global_rate_limiter (
            id BIGINT PRIMARY KEY,
            capacity INTEGER NOT NULL,
            tokens NUMERIC(12,4) NOT NULL,
            refill_rate NUMERIC(12,4) NOT NULL,
            last_refill_at TIMESTAMP NOT NULL
        );
`   );

    /**
     * Queue polling index.
     *
     * Used by claimJobs():
     */
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_email_queue
        ON scheduled_emails (
            status,
            campaign_id,
            scheduled_at,
            next_retry_at
        );
    `);

    /**
     * Lease recovery.
     */
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_email_lease
        ON scheduled_emails (
            status,
            lease_expires_at
        );
    `);

    /**
     * Mailbox lookup.
     */
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_email_mailbox
        ON scheduled_emails (
            mailbox_id
        );
    `);

    /**
     * Reservation cleanup.
     */
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_mailbox_slots
        ON mailbox_send_slots (
            mailbox_id,
            reserved_at
        );
    `);

    console.log("Database initialized.");
}

module.exports = initializeDatabase;