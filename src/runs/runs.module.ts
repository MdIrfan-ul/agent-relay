// src/runs/runs.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AGENT_RUNS_QUEUE } from '../queue/queue.constants';
import { Run } from './run.entity';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
    imports: [TypeOrmModule.forFeature([Run]), BullModule.registerQueue({ name: AGENT_RUNS_QUEUE })],
    controllers: [RunsController],
    providers: [RunsService],
})
export class RunsModule { }