import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentService } from './agent/agent.service';
import { RunStateRepository } from './agent/run-state.repository';
import { InfraModule } from './infra/infra.module';
import { LLM_CLIENT } from './llm/llm.types';
import { ScriptedLlmClient } from './llm/scripted-llm.client';
import { AGENT_RUNS_QUEUE } from './queue/queue.constants';
import { Run } from './runs/run.entity';
import { Step } from './steps/step.entity';
import { ToolCall } from './tools/tool-call.entity';
import { AgentRunProcessor } from './worker/agent-run.processor';

@Module({
  imports: [
    InfraModule,
    TypeOrmModule.forFeature([Run, Step, ToolCall]),
    BullModule.registerQueue({ name: AGENT_RUNS_QUEUE }),
  ],
  providers: [
    AgentRunProcessor,
    AgentService,
    RunStateRepository,
    { provide: LLM_CLIENT, useClass: ScriptedLlmClient }, // Step 4 swaps this for a real model
  ],
})
export class WorkerModule {}