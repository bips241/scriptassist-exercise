import { RedisProvider } from '@config/redis.config';
import { Module } from '@nestjs/common';
import { CacheService } from './services/cache.service';


@Module({
  providers: [RedisProvider, CacheService],
  exports: [CacheService],
})
export class CommonModule {}
