import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type ToolCallStatus = 'started' | 'done' | 'failed';

@Entity('tool_calls')
export class ToolCall {
  @PrimaryColumn({ type: 'text', name: 'idempotency_key' })
  idempotencyKey: string;

  @Index()
  @Column({ type: 'uuid', name: 'run_id' })
  runId: string;

  @Column({ type: 'text', name: 'tool_name' })
  toolName: string;

  @Column({ type: 'jsonb', nullable: true })
  args: unknown;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @Column({ type: 'text' })
  status: ToolCallStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}