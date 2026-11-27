import type { Queue } from 'bullmq';

export const RUN_JOB_NAME = 'execute-run';

/** jobId = run id, so adding the same run twice is a no-op while the job exists. */
export function enqueueRun(queue: Queue, runId: string) {
    return queue.add(
        RUN_JOB_NAME,
        { runId },
        { jobId: runId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
}