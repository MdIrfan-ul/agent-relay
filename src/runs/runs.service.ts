import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { maybeCrashApiAfterInsert } from '../agent/chaos';
import { enqueueRun } from '../queue/enqueue';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { CreateRunDto } from './dto/create-run.dto';
import { Run } from './run.entity';
import { Step } from '../steps/step.entity';
import { ListRunsDto } from './dto/list-runs.dto';

@Injectable()
export class RunsService {
  constructor(
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    @InjectRepository(Step) private readonly stepRepo: Repository<Step>,
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
  async list(q: ListRunsDto) {
    const where: FindOptionsWhere<Run> = {};
    if (q.status) where.status = q.status;
    if (q.agent) where.agentName = q.agent;

    const [items, total] = await this.runs.findAndCount({
      select: {
        id: true,
        agentName: true,
        status: true,
        attempt: true,
        tokensUsed: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
      where,
      order: { createdAt: 'DESC' },
      take: q.limit,
      skip: q.offset,
    });
    return { total, limit: q.limit, offset: q.offset, items };
  }

  /** The trace of a run: every saved step with latency and tokens. */
  async steps(id: string) {
    const run = await this.runs.findOne({
      where: { id },
      select: { id: true, status: true, attempt: true, tokensUsed: true },
    });
    if (!run) throw new NotFoundException('run not found');

    const steps = await this.stepRepo.find({
      where: { runId: id },
      order: { stepIndex: 'ASC' },
      select: {
        stepIndex: true,
        kind: true,
        status: true,
        tokensIn: true,
        tokensOut: true,
        latencyMs: true,
        request: true,
        response: true,
        createdAt: true,
      },
    });
    return { runId: run.id, status: run.status, attempt: run.attempt, tokensUsed: run.tokensUsed, steps };
  }
}