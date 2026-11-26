import { MigrationInterface, QueryRunner } from "typeorm";

export class Effects1795698108405 implements MigrationInterface {
    name = 'Effects1795698108405'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "effects" ("idempotency_key" text NOT NULL, "run_id" uuid NOT NULL, "label" text NOT NULL, "executions" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_af19b92f423278e4c8db81ba024" PRIMARY KEY ("idempotency_key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "effects"`);
    }

}
