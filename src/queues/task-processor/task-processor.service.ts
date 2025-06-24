import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

type TaskStatusUpdatePayload = {
  taskId: string;
  status: TaskStatus;
};

type OverdueTasksNotificationPayload = {
  notify?: boolean; // extendable metadata
};

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  constructor(private readonly tasksService: TasksService) {
    super();
  }

  /**
   * Main job processor for task-processing queue
   */
  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
    
    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job.data as TaskStatusUpdatePayload);

        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job.data as OverdueTasksNotificationPayload);

        default:
          const msg = `Unknown job type: ${job.name}`;
          this.logger.warn(msg);
          return { success: false, error: msg };
      }
    } catch (error) {
      this.logger.error(
        `Error in job ${job.name} [${job.id}]`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Handles status update jobs
   */
  private async handleStatusUpdate(payload: TaskStatusUpdatePayload) {
    const { taskId, status } = payload;

    if (!taskId || !status) {
      const err = 'Missing taskId or status in payload';
      this.logger.warn(err, JSON.stringify(payload));
      return { success: false, error: err };
    }

    if (!Object.values(TaskStatus).includes(status)) {
      const err = `Invalid status value: ${status}`;
      this.logger.warn(err);
      return { success: false, error: err };
    }

    try {
      const updated = await this.tasksService.updateStatus(taskId, status);
      this.logger.log(`Updated task ${taskId} to status ${status}`);
      return { success: true, taskId: updated.id, newStatus: updated.status };
    } catch (err) {
      const msg = `Failed to update task ${taskId}`;
      this.logger.error(msg, err instanceof Error ? err.stack : String(err));
      throw err;
    }
  }

  /**
   * Processes all overdue tasks (e.g., mark as overdue or notify)
   */
  private async handleOverdueTasks(payload: OverdueTasksNotificationPayload) {
    this.logger.debug('Starting overdue tasks processing...');
    
    try {
      const overdueTasks = await this.tasksService.findOverdue(); // must be implemented in service

      if (overdueTasks.length === 0) {
        this.logger.log('No overdue tasks found');
        return { success: true, message: 'No overdue tasks' };
      }

      // Example action: auto-update their status to 'OVERDUE' or notify
      const results: { id: string; status: string }[] = [];

      for (const task of overdueTasks) {
        const updated = await this.tasksService.updateStatus(task.id, TaskStatus.OVERDUE);
        results.push({ id: updated.id, status: updated.status });
      }

      this.logger.log(`Processed ${results.length} overdue tasks`);
      return { success: true, processed: results.length, updated: results };
    } catch (err) {
      this.logger.error('Failed to process overdue tasks', err instanceof Error ? err.stack : String(err));
      throw err;
    }
  }
}
