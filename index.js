const worker = require("./worker");
const initializeDatabase = require("./db/initDB");
const seed = require("./db/seed");
const pool = require("./db/postgres");

let shuttingDown = false;

/**
 * Gracefully shutdown the application.
 */
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[System] Received ${signal}. Shutting down...`);
    try {
        await worker.stop();          // waits for in-flight batch to finish
        await pool.end();
        console.log("[System] connection closed.");
        process.exit(0);
    } catch (err) {
        console.error("[System] Shutdown failed:", err);
        process.exit(1);
    }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

(async () => {
    try {
        console.log("[System] Initializing database...");
        await initializeDatabase();
        console.log("[System] Database initialized.");
        if (process.env.SEED_DB === "true") {
            console.log("[System] Seeding database...");
            await seed();
            console.log("[System] Database seeded.");
        }
        console.log("[System] Starting email worker...");
        await worker.poll();
    } catch (err) {
        console.error("[System] Failed to start application:", err);
        await pool.end();
        process.exit(1);
    }
})();