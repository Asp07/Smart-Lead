const pool = require("../../db/postgres");
const { send, Outcome } = require("./provider");
const { reserveSlot } = require("../mailBoxLimiter");
const config = require("../../config/config");
const { reserveToken } = require("../globalRateLimiter");

async function processEmail(email) {
    console.log(`[Email ${email.id}] Processing`);
    // Reserve mailbox capacity before sending.
    const reservation = await reserveSlot(email.mailbox_id, email.id);
    if (!reservation.allowed) {
        console.log(`[Email ${email.id}] Mailbox hourly limit reached. Retry after ${reservation.retryAfter}s`);
        await scheduleRetry(email, "Mailbox hourly limit exceeded", reservation.retryAfter, false);
        return;
    }
    // Checking global provider token
    const token = await reserveToken();
    if (!token.allowed) {
        console.log(`[Email ${email.id}] Global rate limit reached. Retry after ${token.retryAfter}s`);
        await scheduleRetry(email, "Global provider rate limit exceeded", token.retryAfter, false);
        return;
    }
    try {
        console.log(`[Email ${email.id}] Sending...`);
        // Sending email with idempotency, retry attempts
        const response = await send(email);
        // Marking email as sent attempts
        await markAsSent(email.id, response.providerMessageId);
        console.log(`[Email ${email.id}] Successfully sent`);
    } catch (err) {
        console.error(`[Email ${email.id}] ${err.type}: ${err.message}`);
        /*
        Handling custom provider errors and performing action based on error type
        */
        switch (err.type) {
            case Outcome.TRANSIENT:
                await releaseSlotAndScheduleRetry(email, err.message, 30);
                break;

            case Outcome.THROTTLED:
                await releaseSlotAndScheduleRetry(email, err.message, err.retryAfter);
                break;

            case Outcome.HARD_BOUNCE:
                await releaseSlotAndMarkDead(email, err.message);
                break;

            case Outcome.AMBIGUOUS:

                /**
                 * DO NOT release reservation.
                 *
                 * Provider may already have accepted
                 * this email.
                 *
                 * Since retries use the same
                 * idempotency_key, retrying won't create duplicate emails.
                 */
                await scheduleRetry(email, err.message, 60);
                break;

            default:
                await releaseSlotAndScheduleRetry(email, err.message, 30);
        }
    }
}

async function markAsSent(id, providerMessageId) {
    await pool.query(
        `
        UPDATE scheduled_emails
        SET
            status='sent',
            provider_message_id=$1,
            sent_at=NOW(),
            last_error=NULL,
            next_retry_at=NULL,
            leased_by=NULL,
            lease_expires_at=NULL,
            updated_at=NOW()
        WHERE id=$2
        `,
        [
            providerMessageId,
            id
        ]
    );
}

async function markDead(email, reason) {
    await pool.query(
        `
        UPDATE scheduled_emails
        SET
            status='dead',
            last_error=$1,
            leased_by=NULL,
            lease_expires_at=NULL,
            updated_at=NOW()
        WHERE id=$2
        `,
        [
            reason,
            email.id
        ]
    );

    console.log(`[Email ${email.id}] Dead-lettered`);
}

async function scheduleRetry(email, reason, baseDelaySeconds, exponential = true) {
    const attempts = email.attempts;
    if (attempts >= config.maxRetries) {
        return markDead(email, `Maximum retries exceeded. Last error: ${reason}`);
    }

    const retryAfter = exponential ? baseDelaySeconds * Math.pow(2, attempts) : baseDelaySeconds;
    await pool.query(
        `
        UPDATE scheduled_emails
        SET
            status='pending',
            attempts=$1,
            last_error=$2,
            next_retry_at= NOW() + ($3 * INTERVAL '1 second'),
            leased_by=NULL,
            lease_expires_at=NULL,
            updated_at=NOW()
        WHERE id=$4
        `,
        [
            attempts,
            reason,
            retryAfter,
            email.id
        ]
    );
    console.log(`[Email ${email.id}] Retry #${attempts} scheduled after ${retryAfter}s`);
}

async function releaseSlotAndScheduleRetry(email, reason, baseDelaySeconds, exponential = true) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const attempts = email.attempts;
        await client.query(
            `
            DELETE FROM mailbox_send_slots
            WHERE mailbox_id = $1
            AND email_id = $2
            `,
            [email.mailbox_id, email.id]
        );

        if (attempts >= config.maxRetries) {
            await client.query(
                `
                UPDATE scheduled_emails
                SET
                    status = 'dead',
                    last_error = $1,
                    leased_by = NULL,
                    lease_expires_at = NULL,
                    updated_at = NOW()
                WHERE id = $2
                `,
                [`Maximum retries exceeded. Last error: ${reason}`, email.id]
            );
            await client.query("COMMIT");
            console.log(`[Email ${email.id}] Dead-lettered`);
            return;
        }

        const retryAfter = exponential ? baseDelaySeconds * Math.pow(2, attempts) : baseDelaySeconds;
        await client.query(
            `
            UPDATE scheduled_emails
            SET
                status = 'pending',
                attempts = $1,
                last_error = $2,
                next_retry_at = NOW() + ($3 * INTERVAL '1 second'),
                leased_by = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $4
            `,
            [attempts, reason, retryAfter, email.id]
        );

        await client.query("COMMIT");
        console.log(`[Email ${email.id}] Retry #${attempts} scheduled after ${retryAfter}s`);
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

async function releaseSlotAndMarkDead(email, reason) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(
            `
            DELETE FROM mailbox_send_slots
            WHERE mailbox_id = $1
            AND email_id = $2
            `,
            [email.mailbox_id, email.id]
        );

        await client.query(
            `
            UPDATE scheduled_emails
            SET
                status = 'dead',
                last_error = $1,
                leased_by = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $2
            `,
            [reason, email.id]
        );
        await client.query("COMMIT");
        console.log(`[Email ${email.id}] Dead-lettered`);
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

module.exports = processEmail;