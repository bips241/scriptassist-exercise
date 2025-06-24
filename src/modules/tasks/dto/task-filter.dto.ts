import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

export class TaskFilterDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  @ApiPropertyOptional({ enum: TaskStatus })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  @ApiPropertyOptional({ enum: TaskPriority })
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional()
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional()
  limit?: number = 10;
}
