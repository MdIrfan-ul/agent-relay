import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentService } from '../agent/agent.service';
import { FencedError } from '../agent/errors';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { Run } from '../runs/run.entity';

// Short lock and stall settings so crash recovery is quick in dev and in chaos tests.
@Processor(AGENT_RUNS_QUEUE, { concurrency: 2, lockDuration: 10000, stalledInterval: 5000, maxStalledCount: 5 })
export class AgentRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor(
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    private readonly agent: AgentService,
  ) {
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

    try {
      await this.agent.run(runId, attempt);
      this.logger.log(`run ${runId} finished (attempt ${attempt})`);
    } catch (e) {
      if (e instanceof FencedError) {
        this.logger.warn(e.message); // another worker owns this run now; drop it quietly
        return;
      }
      throw e; // BullMQ retries with backoff
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ runId: string }> | undefined, err: Error) {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.runs.update({ id: job.data.runId }, { status: 'dead', error: err.message });
    }
  }
}