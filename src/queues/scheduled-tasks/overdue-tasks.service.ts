import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);

  constructor(
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.debug('Starting overdue tasks check...');

    const now = new Date();
    const overdueTasks = await this.tasksRepository.find({
      where: {
        dueDate: LessThan(now),
        status: TaskStatus.PENDING,
      },
    });

    this.logger.log(`Found ${overdueTasks.length} overdue tasks`);

    if (overdueTasks.length > 0) {
      const jobs = overdueTasks.map(task => ({
        name: 'overdue-tasks-notification',
        data: { taskId: task.id },
      }));

      await this.taskQueue.addBulk(jobs);
      this.logger.log(`Added ${jobs.length} overdue tasks to the processing queue`);
    }

    this.logger.debug('Overdue tasks check completed');
  }
}
