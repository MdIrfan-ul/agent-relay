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
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatLlmClient } from './llm/openai-compat-llm.client';
import type { LlmClient } from './llm/llm.types';
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
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmClient =>
        config.get<string>('LLM_PROVIDER', 'scripted') === 'openai-compat'
          ? new OpenAiCompatLlmClient({
              baseUrl: config.getOrThrow<string>('LLM_BASE_URL'),
              model: config.getOrThrow<string>('LLM_MODEL'),
              apiKey: config.get<string>('LLM_API_KEY') || undefined,
            })
          : new ScriptedLlmClient(),
    }, 
  ],
})
export class WorkerModule {}