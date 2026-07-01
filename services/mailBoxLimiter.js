const pool = require("../db/postgres");
const config = require("../config/config");

/**
 * Reserves one hourly sending slot for a mailbox.
 *
 * Guarantees:
 * - Multiple workers cannot exceed mailbox hourly limit.
 * - Reservation is idempotent.
 * - Expired reservations are cleaned automatically.
 */
async function reserveSlot(mailboxId, emailId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Lock mailbox so only one worker can reserve
        // capacity for this mailbox at a time.
        const { rows: mailboxRows } = await client.query(
            `SELECT id, hourly_limit
            FROM mailboxes
            WHERE id = $1
            FOR UPDATE`,
            [mailboxId]
        );

        if (!mailboxRows.length) {
            throw new Error(`Mailbox ${mailboxId} not found`);
        }

        const hourlyLimit = Number(mailboxRows[0].hourly_limit);
        const { rows: statsRows } = await client.query(
            `
            WITH deleted AS (
                DELETE
                FROM mailbox_send_slots
                WHERE
                    mailbox_id = $1
                    AND reserved_at < NOW() - INTERVAL '1 hour'
            )
            SELECT
                COUNT(*) AS active_reservations,
                MIN(reserved_at) AS oldest_reservation
            FROM mailbox_send_slots
            WHERE mailbox_id = $1
            `,
            [mailboxId]
        );

        const activeReservations = Number(statsRows[0].active_reservations);
        console.log(`[RateLimiter] Mailbox ${mailboxId}: ${activeReservations}/${hourlyLimit} slots in use`);

        if (activeReservations >= hourlyLimit) {
            await client.query("COMMIT");
            return {
                allowed: false,
                retryAfter: secondsUntilExpiry(
                    new Date(statsRows[0].oldest_reservation)
                )
            };
        }

        // Reserve slot.
        // If this email already has a reservation
        // (worker retry / recovery), do nothing.
        const reservation = await client.query(
            `INSERT INTO mailbox_send_slots (
                mailbox_id,
                email_id
            )
            VALUES ($1, $2)
            ON CONFLICT (mailbox_id, email_id)
            DO NOTHING
            RETURNING id`,
            [
                mailboxId,
                emailId
            ]
        );

        await client.query("COMMIT");
        if (reservation.rows.length === 0) {
            console.log(`[RateLimiter] Existing reservation found for email ${emailId}`);

        } else {
            console.log(`[RateLimiter] Reserved slot for email ${emailId}`);
        }

        return {
            allowed: true,
            retryAfter: 0
        };
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[RateLimiter] Failed to reserve slot for email ${emailId}`, err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Returns seconds until the reservation
 * exits the one-hour window.
 */
function secondsUntilExpiry(reservedAt) {
    return Math.max(1, Math.ceil((reservedAt.getTime() + config.reservationWindow - Date.now()) / 1000));
}

module.exports = {
    reserveSlot
};