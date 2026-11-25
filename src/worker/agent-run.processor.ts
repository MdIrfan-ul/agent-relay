// src/worker/agent-run.processor.ts
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { Run } from '../runs/run.entity';

@Processor(AGENT_RUNS_QUEUE, { concurrency: 5 })
export class AgentRunProcessor extends WorkerHost {
    private readonly logger = new Logger(AgentRunProcessor.name);

    constructor(@InjectRepository(Run) private readonly runs: Repository<Run>) {
        super();
    }

    async process(job: Job<{ runId: string }>): Promise<void> {
        const { runId } = job.data;

        // take ownership: bump the fencing token atomically
        const claimed = await this.runs
            .createQueryBuilder()
            .update(Run)
            .set({ status: 'running', attempt: () => 'attempt + 1' })
            .where('id = :runId AND status IN (:...ok)', { runId, ok: ['queued', 'running'] })
            .returning('attempt')
            .execute();

        const attempt: number | undefined = claimed.raw[0]?.attempt;
        if (attempt === undefined) {
            this.logger.warn(`run ${runId} not claimable, skipping`);
            return;
        }
        this.logger.log(`run ${runId} claimed (attempt ${attempt}, job ${job.id})`);

        await new Promise((r) => setTimeout(r, 2000)); // stub: the agent loop goes here

        // fenced write: only succeeds if we still own the run
        const done = await this.runs.update({ id: runId, attempt }, { status: 'succeeded', result: { stub: true } });
        if (done.affected === 0) throw new Error(`run ${runId}: lost ownership (fenced)`);
        this.logger.log(`run ${runId} succeeded`);
    }
}