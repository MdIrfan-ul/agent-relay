// src/runs/runs.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
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

    // jobId = run id, so adding the same run twice is a no-op in BullMQ
    if (run.status === 'queued') {
      await this.queue.add(
        'execute-run',
        { runId: run.id },
        { jobId: run.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    }
    return { id: run.id, status: run.status };
  }

  async get(id: string) {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('run not found');
    return run;
  }
}