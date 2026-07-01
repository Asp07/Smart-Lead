const crypto = require("crypto");
const { provider, cleanupInterval } = require("../../config/config");
const pool = require("../../db/postgres");

const Outcome = {
    SUCCESS: "SUCCESS",
    TRANSIENT: "TRANSIENT",
    THROTTLED: "THROTTLED",
    HARD_BOUNCE: "HARD_BOUNCE",
    AMBIGUOUS: "AMBIGUOUS"
};

validateConfiguration();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function validateConfiguration() {
    const total = provider.successRate + provider.transientRate + provider.throttledRate + provider.hardBounceRate + provider.ambiguousRate;

    if (Math.abs(total - 1) > 0.0001) {
        throw new Error("Provider rates must sum to 1.");
    }
}

function getProviderMessageId() {
    return `msg_${crypto.randomUUID()}`;
}

function getRandomOutcome() {
    const random = Math.random();

    let cumulative = provider.successRate;
    if (random < cumulative) {
        return Outcome.SUCCESS;
    }

    cumulative += provider.transientRate;
    if (random < cumulative) {
        return Outcome.TRANSIENT;
    }

    cumulative += provider.throttledRate;
    if (random < cumulative) {
        return Outcome.THROTTLED;
    }

    cumulative += provider.hardBounceRate;
    if (random < cumulative) {
        return Outcome.HARD_BOUNCE;
    }

    cumulative += provider.ambiguousRate;
    if (random < cumulative) {
        return Outcome.AMBIGUOUS;
    }

    // Should never happen because validateConfiguration() guarantees total = 1
    throw new Error("Invalid provider probability configuration.");
}
async function send(message) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `SELECT provider_message_id
             FROM scheduled_emails
             WHERE idempotency_key = $1
             FOR UPDATE`,
            [message.idempotency_key]
        );

        if (!rows.length) {
            throw new Error(`Email with idempotency key ${message.idempotency_key} not found`);
        }

        if (rows[0].provider_message_id) {
            await client.query("COMMIT");
            console.log(`[Provider] Duplicate request for email ${message.id}`);
            return {
                success: true,
                duplicate: true,
                providerMessageId: rows[0].provider_message_id
            };
        }

        const latency = provider.minLatency + Math.floor(Math.random() * (provider.maxLatency - provider.minLatency + 1));
        await sleep(latency);

        const outcome = getRandomOutcome();
        switch (outcome) {
            case Outcome.SUCCESS: {
                const providerMessageId = getProviderMessageId();
                await client.query(
                    `UPDATE scheduled_emails
                     SET provider_message_id = $1
                     WHERE idempotency_key = $2`,
                    [providerMessageId, message.idempotency_key]
                );
                await client.query("COMMIT");
                console.log(`[Provider] Accepted email ${message.id}`);
                return {
                    success: true,
                    duplicate: false,
                    providerMessageId,
                    acceptedAt: new Date()
                };
            }

            case Outcome.AMBIGUOUS: {
                const providerMessageId = getProviderMessageId();
                await client.query(
                    `UPDATE scheduled_emails
                     SET provider_message_id = $1
                     WHERE idempotency_key = $2`,
                    [providerMessageId, message.idempotency_key]
                );
                await client.query("COMMIT");
                console.log(`[Provider] Accepted email ${message.id} but acknowledgement was lost`);
                const err = new Error("Provider accepted email but acknowledgement was lost");
                err.type = Outcome.AMBIGUOUS;
                err.retryable = true;
                err.providerMessageId = providerMessageId;
                throw err;
            }

            case Outcome.TRANSIENT: {
                console.log(`[Provider] Transient failure for email ${message.id}`);
                const err = new Error("Transient provider failure");
                err.type = Outcome.TRANSIENT;
                err.retryable = true;
                throw err;
            }

            case Outcome.THROTTLED: {
                console.log(`[Provider] Mailbox throttled for email ${message.id}`);
                const err = new Error("Mailbox throttled");
                err.type = Outcome.THROTTLED;
                err.retryable = true;
                err.retryAfter = provider.throttleRetryAfterSeconds;
                throw err;
            }

            case Outcome.HARD_BOUNCE: {
                console.log(`[Provider] Hard bounce for email ${message.id}`);
                const err = new Error("Recipient rejected");
                err.type = Outcome.HARD_BOUNCE;
                err.retryable = false;
                throw err;
            }

            default:
                throw new Error(`Unknown provider outcome: ${outcome}`);
        }
    } catch (err) {
        try {
            if(err.type !== Outcome.AMBIGUOUS) {
                await client.query("ROLLBACK");
            }
        } catch (e) {
            console.error('Error in rollback', e);
        }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    send,
    Outcome
};