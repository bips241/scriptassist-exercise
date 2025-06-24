import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  ValidationPipe,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaskStatus } from './enums/task-status.enum';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { BatchTasksDto } from './dto/batch-tasks.dto';


@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RateLimitGuard)
@UseInterceptors(LoggingInterceptor)
@RateLimit({ limit: 100, windowMs: 60000 })
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

@Post()
@ApiOperation({ summary: 'Create a new task' })
async create(
  @Body(ValidationPipe) createTaskDto: CreateTaskDto,
  @Req() req: Request & { user: { id: string } },
) {
  return this.tasksService.create({
    ...createTaskDto,
    userId: req.user.id,
  });
}

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering' })
  async findAll(
    @Query(new ValidationPipe({ transform: true }))
    filter: TaskFilterDto,
  ) {
    const { data, total } = await this.tasksService.findAll(filter);
    return {
      data,
      total,
      page: filter.page,
      limit: filter.limit,
      pageCount: Math.ceil(total / (filter.limit ?? 1)),
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated task statistics' })
  async getStats() {
    return this.tasksService.getStats();
  }

@Get(':id')
@ApiOperation({ summary: 'Find a task by ID' })
async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
  const task = await this.tasksService.findOne(id);
  if (!task) {
    throw new HttpException(
      `Task with ID ${id} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
  return task;
}

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task by ID' })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(id, updateTaskDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task by ID' })
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
    return { success: true };
  }

@Post('batch')
@ApiOperation({ summary: 'Batch update or delete tasks' })
async batchProcess(@Body(ValidationPipe) operations: BatchTasksDto) {
  const { taskIds, action } = operations;


  const results = await Promise.allSettled(
    taskIds.map(async (taskId) => {
      try {
        const result =
          action === 'complete'
            ? await this.tasksService.update(taskId, {
                status: TaskStatus.COMPLETED,
              })
            : await this.tasksService.remove(taskId);

        return { taskId, success: true, result };
      } catch (error) {
        return {
          taskId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }),
  );

  return results; // <-- Return raw array to satisfy test
}
}