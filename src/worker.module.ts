// src/worker.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InfraModule } from './infra/infra.module';
import { AGENT_RUNS_QUEUE } from './queue/queue.constants';
import { Run } from './runs/run.entity';
import { AgentRunProcessor } from './worker/agent-run.processor';
import { Step } from './steps/step.entity';
import { ToolCall } from './tools/tool-call.entity';
@Module({
    imports: [InfraModule, TypeOrmModule.forFeature([Run, Step, ToolCall]), BullModule.registerQueue({ name: AGENT_RUNS_QUEUE })],
    providers: [AgentRunProcessor],
})
export class WorkerModule { }