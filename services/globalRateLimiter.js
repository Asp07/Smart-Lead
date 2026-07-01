const pool = require("../db/postgres");

async function reserveToken() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `
            SELECT *
            FROM global_rate_limiter
            WHERE id = 1
            FOR UPDATE
            `
        );

        const bucket = rows[0];
        const now = Date.now();
        const lastRefill = new Date(bucket.last_refill_at).getTime();
        const elapsedSeconds = (now - lastRefill) / 1000;
        const tokens = Math.min(Number(bucket.capacity),Number(bucket.tokens) + elapsedSeconds * Number(bucket.refill_rate));

        if (tokens < 1) {
            const retryAfter = Math.ceil((1 - tokens) / Number(bucket.refill_rate));
            await client.query(
                `
                UPDATE global_rate_limiter
                SET
                    tokens=$1,
                    last_refill_at=NOW()
                WHERE id=1
                `,
                [tokens]
            );
            await client.query("COMMIT");
            return {
                allowed: false,
                retryAfter
            };
        }

        await client.query(
            `
            UPDATE global_rate_limiter
            SET
                tokens=$1,
                last_refill_at=NOW()
            WHERE id=1
            `,
            [tokens - 1]
        );
        await client.query("COMMIT");
        return {
            allowed: true,
            retryAfter: 0
        };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    reserveToken
};