import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Run } from '../runs/run.entity';

export type StepKind = 'llm_call' | 'tool_call';
export type StepStatus = 'pending' | 'done' | 'failed';

@Entity('steps')
@Unique(['runId', 'stepIndex'])
export class Step {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId: string;

  @ManyToOne(() => Run, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: Run;

  @Column({ type: 'int', name: 'step_index' })
  stepIndex: number;

  @Column({ type: 'text' })
  kind: StepKind;

  @Column({ type: 'jsonb', nullable: true })
  request: unknown;

  @Column({ type: 'jsonb', nullable: true })
  response: unknown;

  @Column({ type: 'int', name: 'tokens_in', nullable: true })
  tokensIn: number | null;

  @Column({ type: 'int', name: 'tokens_out', nullable: true })
  tokensOut: number | null;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'text' })
  status: StepStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}