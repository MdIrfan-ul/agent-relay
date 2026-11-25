import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRunDto {
    @IsString() @IsNotEmpty()
    agent: string;

    @IsObject()
    input: Record<string, unknown>;

    @IsOptional() @IsInt() @Min(1) @Max(50)
    maxSteps?: number;

    @IsOptional() @IsInt() @Min(1000) @Max(200000)
    tokenBudget?: number;
}