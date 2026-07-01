const os = require("os");
const crypto = require("crypto");
const pool = require("../db/postgres");
const { leaseDurationSeconds, maxRetries } = require("../config/config");
const WORKER_ID = `${os.hostname()}-${crypto.randomUUID()}`;

/**
 * Claims a batch of emails for this worker.
 *
 * Concurrency:
 *  - Uses FOR UPDATE SKIP LOCKED so multiple workers never
 *    claim the same email.
 *
 * Lease recovery:
 *  - If a worker crashes after claiming a job, another worker
 *    can reclaim it once the lease expires.
 */
async function claimJobs(limit) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        /**
         * Select jobs that are:
         * 1. Pending and ready to run.
         * 2. Previously claimed but whose lease expired.
         */
        const { rows: claimedJobs } = await client.query(
            `
            WITH jobs AS (
                WITH ranked_jobs AS (
                    SELECT
                        id,
                        scheduled_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY campaign_id
                            ORDER BY scheduled_at
                        ) AS campaign_rank
                    FROM scheduled_emails
                    WHERE (
                        (
                            status = 'pending'
                            AND (
                                next_retry_at IS NULL
                                OR next_retry_at <= NOW()
                            )
                            AND attempts < $4
                        )
                        OR (
                            status = 'sending'
                            AND lease_expires_at <= NOW()
                            AND attempts < $4
                        )
                    )
                    AND scheduled_at <= NOW()
                )
                SELECT se.id
                FROM scheduled_emails se
                JOIN ranked_jobs r
                    ON se.id = r.id
                ORDER BY
                    r.campaign_rank,
                    r.scheduled_at
                FOR UPDATE OF se SKIP LOCKED
                LIMIT $3
            )
            UPDATE scheduled_emails se
            SET
                status = 'sending',
                leased_by = $1,
                lease_expires_at = NOW() + ($2 * INTERVAL '1 second'),
                attempts = attempts + 1,
                updated_at = NOW()
            FROM jobs
            WHERE se.id = jobs.id
            RETURNING se.*;
            `,
            [
                WORKER_ID,
                leaseDurationSeconds,
                limit,
                maxRetries
            ]
        );
        await client.query("COMMIT");
        console.log(`[ClaimJobs] Worker ${WORKER_ID} claimed ${claimedJobs.length} email(s).`);
        return claimedJobs;
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[ClaimJobs] Worker ${WORKER_ID} failed to claim jobs.`,err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = claimJobs;