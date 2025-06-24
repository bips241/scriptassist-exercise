import {
  IsArray,
  ArrayNotEmpty,
  IsUUID,
  IsIn,
} from 'class-validator';

export class BatchTasksDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'taskIds must be a non-empty array' })
  @IsUUID('all', { each: true })
  taskIds: string[];

  @IsIn(['complete', 'delete'])
  action: 'complete' | 'delete';
}