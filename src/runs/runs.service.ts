import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { maybeCrashApiAfterInsert } from '../agent/chaos';
import { enqueueRun } from '../queue/enqueue';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { CreateRunDto } from './dto/create-run.dto';
import { Run } from './run.entity';

@Injectable()
export class RunsService {
  constructor(
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    @InjectQueue(AGENT_RUNS_QUEUE) private readonly queue: Queue,
  ) { }

  async create(dto: CreateRunDto, idempotencyKey?: string) {
    // INSERT ... ON CONFLICT DO NOTHING: a retried request returns the same run
    const insert = await this.runs
      .createQueryBuilder()
      .insert()
      .into(Run)
      .values({
        idempotencyKey: idempotencyKey ?? null,
        agentName: dto.agent,
        input: dto.input as never,
        maxSteps: dto.maxSteps,
        tokenBudget: dto.tokenBudget,
      })
      .orIgnore()
      .returning('id')
      .execute();

    const newId: string | undefined = insert.raw[0]?.id;
    const run = newId
      ? await this.runs.findOneByOrFail({ id: newId })
      : await this.runs.findOneByOrFail({ idempotencyKey: idempotencyKey as string });

    maybeCrashApiAfterInsert(); // test hook: the run exists but has no job yet

    // jobId = run id, so adding the same run twice is a no-op in BullMQ
    if (run.status === 'queued') await enqueueRun(this.queue, run.id);
    return { id: run.id, status: run.status };
  }

  async get(id: string) {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('run not found');
    return run;
  }

  /** Cooperative cancel: flips the status now; a running worker stops at its next loop iteration. */
  async cancel(id: string) {
    const rows: { id: string }[] = await this.runs.query(
      `WITH u AS (
         UPDATE runs SET status = 'cancelled', updated_at = now()
         WHERE id = $1::uuid AND status IN ('queued', 'running')
         RETURNING id
       )
       SELECT id FROM u`,
      [id],
    );
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('run not found');
    if (rows.length === 0) throw new ConflictException(`run is already ${run.status}`);
    return { id: run.id, status: run.status };
  }
}