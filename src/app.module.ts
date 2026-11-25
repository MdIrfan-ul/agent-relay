import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RunsModule } from './runs/runs.module';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, RunsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
