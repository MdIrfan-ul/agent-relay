import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1795614128408 implements MigrationInterface {
    name = 'Init1795614128408'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "idempotency_key" text, "agent_name" text NOT NULL, "input" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'queued', "attempt" integer NOT NULL DEFAULT '0', "max_steps" integer NOT NULL DEFAULT '20', "token_budget" integer NOT NULL DEFAULT '50000', "tokens_used" integer NOT NULL DEFAULT '0', "cost_usd" numeric(10,5) NOT NULL DEFAULT '0', "result" jsonb, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4532d804ae44cf47f4bbbc5e7f9" UNIQUE ("idempotency_key"), CONSTRAINT "PK_46d6a1e257c38ba58f1a3c30836" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_47c664242658f711316eedd34e" ON "runs"  ("status", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_47c664242658f711316eedd34e"`);
        await queryRunner.query(`DROP TABLE "runs"`);
    }

}
