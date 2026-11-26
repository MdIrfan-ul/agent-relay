import { Module } from '@nestjs/common';
import { RunsModule } from './runs/runs.module';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, RunsModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
