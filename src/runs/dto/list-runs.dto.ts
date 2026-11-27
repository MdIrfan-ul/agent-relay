import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RUN_STATUSES } from '../run.entity';
import type { RunStatus } from '../run.entity';

export class ListRunsDto {
    @IsOptional()
    @IsIn([...RUN_STATUSES])
    status?: RunStatus;

    @IsOptional()
    @IsString()
    agent?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    offset: number = 0;
}