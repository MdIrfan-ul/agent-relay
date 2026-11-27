import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { enqueueRun } from '../queue/enqueue';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { Run } from '../runs/run.entity';

/**
 * Repairs the gap between Postgres and Redis: a run row that is 'queued' but has no live job
 * (the API died between insert and enqueue, or Redis lost the job). Safe to run on every worker,
 * because enqueueing uses jobId = run id.
 */
@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ReconcilerService.name);
    private timer?: NodeJS.Timeout;
    private busy = false;

    constructor(
        @InjectRepository(Run) private readonly runs: Repository<Run>,
        @InjectQueue(AGENT_RUNS_QUEUE) private readonly queue: Queue,
    ) { }

    onModuleInit() {
        const every = Number(process.env.RECONCILER_INTERVAL_MS ?? 30_000);
        if (every > 0) this.timer = setInterval(() => void this.tick(), every);
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    async tick(): Promise<number> {
        if (this.busy) return 0;
        this.busy = true;
        try {
            const graceMs = Number(process.env.RECONCILER_GRACE_MS ?? 30_000);
            const stuck = await this.runs.find({
                select: { id: true },
                where: { status: 'queued', createdAt: LessThan(new Date(Date.now() - graceMs)) },
                order: { createdAt: 'ASC' },
                take: 200,
            });

            let repaired = 0;
            for (const { id } of stuck) {
                const job = await this.queue.getJob(id);
                if (job) {
                    const state = await job.getState();
                    if (state !== 'completed' && state !== 'failed') continue; // still in play
                    await job.remove(); // a finished job would block re-adding the same id
                }
                await enqueueRun(this.queue, id);
                repaired++;
            }
            if (repaired > 0) this.logger.warn(`re-enqueued ${repaired} queued run(s) that had no live job`);
            return repaired;
        } catch (e) {
            this.logger.error(`reconciler tick failed: ${e instanceof Error ? e.message : String(e)}`);
            return 0;
        } finally {
            this.busy = false;
        }
    }
}