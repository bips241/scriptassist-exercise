import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TaskProcessorService } from './task-processor.service';
import { TasksModule } from '../../modules/tasks/tasks.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'task-processing',
    }),
    TasksModule, // Needed for TasksService
  ],
  providers: [TaskProcessorService],
})
export class TaskProcessorModule {}
