import { REDIS_CLIENT } from '@config/redis.config';
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';


@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async flushByPrefix(prefix: string): Promise<void> {
    const keys = await this.redis.keys(`${prefix}*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async flushAll(): Promise<void> {
    await this.redis.flushall();
  }
}
