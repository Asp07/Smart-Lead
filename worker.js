const claimJobs = require("./services/claimJobs");
const processEmail = require("./services/sendEmails/processEmails");
const config = require("./config/config");
const sleep = require("./utils/utility");

let shuttingDown = false;
let isPolling = false;
let currentBatchPromise = Promise.resolve(); // tracks in-flight batch

async function poll() {
    if (isPolling) {
        console.warn("[Worker] Poller already running.");
        return;
    }
    isPolling = true;
    console.log("[Worker] Started.");

    while (!shuttingDown) {
        try {
            console.log(`[Worker] Polling at ${new Date().toISOString()}.`);
            /*
            Claiming jobs in batches with fairness based on campaign_id, scheduled date lower then current date
            */
            const jobs = await claimJobs(config.batchSize);
            if (jobs.length === 0) {
                console.log(`[Worker] No pending emails. Sleeping for ${config.pollInterval} ms.`);
                await sleep(config.pollInterval);
                continue;
            }
            console.log(`[Worker] Claimed ${jobs.length} email(s).`);

            /*
            Track this batch so stop() can await it.
            processing email for each job
             */
            currentBatchPromise = Promise.allSettled(jobs.map(job => processEmail(job)));
            const results = await currentBatchPromise;
            const successCount = results.filter(r => r.status === "fulfilled").length;
            const failureCount = results.length - successCount;
            console.log(`[Worker] Batch completed. Success=${successCount}, Failed=${failureCount}`);
        } catch (err) {
            console.error("[Worker] Polling failed:", err);
            await sleep(config.errorRetryDelay);
        }
    }
    isPolling = false;
    console.log("[Worker] Shutdown complete.");
}

function stop() {
    console.log("[Worker] Shutdown requested.");
    shuttingDown = true;
    return currentBatchPromise; // caller can await this
}

module.exports = { poll, stop };