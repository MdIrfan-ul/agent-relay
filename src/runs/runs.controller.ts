// src/runs/runs.controller.ts
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsService } from './runs.service';
import { ListRunsDto } from './dto/list-runs.dto';

@Controller('runs')
export class RunsController {
    constructor(private readonly runs: RunsService) { }

    @Post()
    @HttpCode(202)
    create(@Body() dto: CreateRunDto, @Headers('idempotency-key') idempotencyKey?: string) {
        return this.runs.create(dto, idempotencyKey);
    }

    @Get(':id')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.runs.get(id);
    }
    @Post(':id/cancel')
    @HttpCode(202)
    cancel(@Param('id', ParseUUIDPipe) id: string) {
        return this.runs.cancel(id);
    }

    @Get()
    list(@Query() query: ListRunsDto) {
        return this.runs.list(query);
    }

    @Get(':id/steps')
    steps(@Param('id', ParseUUIDPipe) id: string) {
        return this.runs.steps(id);
    }
}