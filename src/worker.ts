import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule);
    app.enableShutdownHooks(); // lets BullMQ finish or release jobs on SIGTERM
    new Logger('Worker').log('worker started');
}
bootstrap();