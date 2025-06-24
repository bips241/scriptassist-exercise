import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource, LessThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskFilterDto } from './dto/task-filter.dto';
import { CacheService } from '@common/services/cache.service';


@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing') private taskQueue: Queue,
    private dataSource: DataSource,
    private cacheService: CacheService,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = queryRunner.manager.create(Task, createTaskDto);
      const savedTask = await queryRunner.manager.save(Task, task);

      await this.taskQueue.add('task-status-update', {
        taskId: savedTask.id,
        status: savedTask.status,
      });

      await this.cacheService.del('tasks:stats');
      await this.cacheService.flushByPrefix('tasks:findAll');

      await queryRunner.commitTransaction();
      return savedTask;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(filter: TaskFilterDto): Promise<{ data: Task[]; total: number }> {
    const cacheKey = `tasks:findAll:${JSON.stringify(filter)}`;
    const cached = await this.cacheService.get<typeof result>(cacheKey);
    if (cached) return cached;

    const { status, priority, search, page = 1, limit = 10 } = filter;
    const query = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.user', 'user');

    if (status) query.andWhere('task.status = :status', { status });
    if (priority) query.andWhere('task.priority = :priority', { priority });
    if (search) {
      query.andWhere(
        '(LOWER(task.title) LIKE :search OR LOWER(task.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const [data, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const result = { data, total };
    await this.cacheService.set(cacheKey, result, 60);
    return result;
  }

  async findOne(id: string): Promise<Task> {
    const cacheKey = `tasks:findOne:${id}`;
    const cached = await this.cacheService.get<Task>(cacheKey);
    if (cached) return cached;

    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) throw new NotFoundException(`Task with ID ${id} not found`);

    await this.cacheService.set(cacheKey, task, 120);
    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = await this.findOne(id);
      const originalStatus = task.status;

      const updatedTask = queryRunner.manager.merge(Task, task, updateTaskDto);
      const savedTask = await queryRunner.manager.save(Task, updatedTask);

      if (originalStatus !== savedTask.status) {
        await this.taskQueue.add('task-status-update', {
          taskId: savedTask.id,
          status: savedTask.status,
        });
      }

      await this.cacheService.del(`tasks:findOne:${id}`);
      await this.cacheService.flushByPrefix('tasks:findAll');
      await this.cacheService.del('tasks:stats');

      await queryRunner.commitTransaction();
      return savedTask;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOne(id);
    await this.tasksRepository.delete(task.id);

    await this.cacheService.del(`tasks:findOne:${id}`);
    await this.cacheService.flushByPrefix('tasks:findAll');
    await this.cacheService.del('tasks:stats');
  }

  async batchProcess(taskIds: string[], action: 'complete' | 'delete'): Promise<any[]> {
    const results = [];
    for (const id of taskIds) {
      try {
        let result;
        switch (action) {
          case 'complete':
            result = await this.update(id, { status: TaskStatus.COMPLETED });
            break;
          case 'delete':
            await this.remove(id);
            result = { message: 'Deleted' };
            break;
          default:
            throw new BadRequestException(`Invalid action: ${action}`);
        }
        results.push({ taskId: id, success: true, result });
      } catch (err) {
        results.push({
          taskId: id,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.tasksRepository.find({ where: { status } });
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.findOne(id);
    task.status = status;
    const saved = await this.tasksRepository.save(task);

    await this.cacheService.del(`tasks:findOne:${id}`);
    await this.cacheService.flushByPrefix('tasks:findAll');
    await this.cacheService.del('tasks:stats');

    return saved;
  }

  async getStats() {
    const cacheKey = 'tasks:stats';
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.tasksRepository
      .createQueryBuilder('task')
      .select([
        `COUNT(*) AS total`,
        `SUM(CASE WHEN task.status = :completed THEN 1 ELSE 0 END) AS completed`,
        `SUM(CASE WHEN task.status = :inProgress THEN 1 ELSE 0 END) AS inProgress`,
        `SUM(CASE WHEN task.status = :pending THEN 1 ELSE 0 END) AS pending`,
        `SUM(CASE WHEN task.priority = :high THEN 1 ELSE 0 END) AS highPriority`,
      ])
      .setParameters({
        completed: TaskStatus.COMPLETED,
        inProgress: TaskStatus.IN_PROGRESS,
        pending: TaskStatus.PENDING,
        high: 'HIGH',
      })
      .getRawOne();

    const formatted = {
      total: Number(result.total),
      completed: Number(result.completed),
      inProgress: Number(result.inProgress),
      pending: Number(result.pending),
      highPriority: Number(result.highPriority),
    };

    await this.cacheService.set(cacheKey, formatted, 30);
    return formatted;
  }

  async findOverdue(): Promise<Task[]> {
    return this.tasksRepository.find({
      where: {
        dueDate: LessThan(new Date()),
        status: TaskStatus.PENDING,
      },
    });
  }
}
