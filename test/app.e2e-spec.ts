import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import Redis from 'ioredis';

let app: INestApplication;
let accessToken: string;
let redisClient: Redis;
let refreshToken: string;

jest.setTimeout(600_000); // 10 minutes for CI

const waitForQueue = async (ms = 100) => new Promise((res) => setTimeout(res, ms));

beforeAll(async () => {
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });
  await redisClient.flushall(); // clear cache/queue

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'StrongPassword123!';

await request(app.getHttpServer())
  .post('/users')
  .send({
    email: testEmail,
    name: 'Test User',
    password: testPassword,
  });

const login = await request(app.getHttpServer())
  .post('/auth/login')
  .send({ email: testEmail, password: testPassword });

  console.log('Login response:', login.body);


accessToken = login.body.accessToken;
refreshToken = login.body.refreshToken;

console.log('Access Token:', accessToken);
console.log('Refresh Token:', refreshToken);

});

afterAll(async () => {
  await app.close();
  await redisClient.quit();
});

describe('AppController (e2e)', () => {
  it('/ (GET) - should reject unauthenticated access', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  it('POST /tasks - should create a task and return it', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Test Task',
        description: 'E2E task description',
        status: 'PENDING',
        priority: 'MEDIUM',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('Test Task');
  });

  it('GET /tasks - should return filtered paginated tasks', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Task One',
        description: 'First',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      });

    const res = await request(app.getHttpServer())
      .get('/tasks')
      .query({ status: 'IN_PROGRESS', priority: 'HIGH', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('total');
  });

  it('PATCH /tasks/:id - should update and enqueue', async () => {
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'To Update',
        description: 'Needs update',
        status: 'PENDING',
        priority: 'LOW',
      });

    const patch = await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    expect(patch.body.status).toBe('COMPLETED');
    await waitForQueue();
  });

  it('GET /tasks/:id - should return 404 for non-existent task', async () => {
    await request(app.getHttpServer())
      .get('/tasks/123e4567-e89b-12d3-a456-426614174999')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('DELETE /tasks/:id - should delete task', async () => {
    const create = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Delete Me',
        description: 'To be removed',
        status: 'PENDING',
        priority: 'LOW',
      });

    await request(app.getHttpServer())
      .delete(`/tasks/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('POST /tasks/batch - should complete multiple tasks', async () => {
    const task1 = await request(app.getHttpServer()).post('/tasks').set('Authorization', `Bearer ${accessToken}`).send({
      title: 'Batch Task 1',
      description: 'Desc',
      status: 'PENDING',
      priority: 'LOW',
    });

    const task2 = await request(app.getHttpServer()).post('/tasks').set('Authorization', `Bearer ${accessToken}`).send({
      title: 'Batch Task 2',
      description: 'Desc',
      status: 'PENDING',
      priority: 'LOW',
    });

    const response = await request(app.getHttpServer())
      .post('/tasks/batch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taskIds: [task1.body.id, task2.body.id], action: 'complete' })
      .expect(201);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.every((r: any) => r.status === 'fulfilled')).toBe(true);
    await waitForQueue();
  });

  it('GET /tasks/stats - should return stats', async () => {
    const res = await request(app.getHttpServer())
      .get('/tasks/stats')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('completed');
    expect(res.body).toHaveProperty('inProgress');
    expect(res.body).toHaveProperty('pending');
  });

  it('should return 404 when deleting a non-existent task', async () => {
    await request(app.getHttpServer())
      .delete('/tasks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('should return 400 on invalid task creation', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '', status: 'INVALID_STATUS' })
      .expect(400);
  });

  it('should return 400 on bad filter', async () => {
    const res = await request(app.getHttpServer())
      .get('/tasks')
      .query({ status: 'NON_EXISTENT', priority: 'EXTREME' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('should return 400 for invalid UUID', async () => {
    const res = await request(app.getHttpServer())
      .get('/tasks/invalid-id')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(res.body.message).toContain('uuid is expected');
  });

  it('should reject invalid JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/tasks')
      .set('Authorization', 'Bearer INVALID_TOKEN');

    expect(res.status).toBe(401);
  });

  it('should reject empty taskIds in batch', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks/batch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taskIds: [] })
      .expect(400);

    expect(res.body.message).toContain('taskIds must be a non-empty array');
  });

  it('should return 400 for excessively long title', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'A'.repeat(10000),
        description: 'desc',
        status: 'PENDING',
        priority: 'LOW',
      })
      .expect(400);

    expect(res.body.message[0]).toContain('Title is too long');
  });

  it('should update stats after deletion', async () => {
    const task = await request(app.getHttpServer()).post('/tasks').set('Authorization', `Bearer ${accessToken}`).send({
      title: 'To Delete',
      description: 'Track Stats',
      status: 'PENDING',
      priority: 'LOW',
    });

    const before = await request(app.getHttpServer()).get('/tasks/stats').set('Authorization', `Bearer ${accessToken}`);
    await request(app.getHttpServer()).delete(`/tasks/${task.body.id}`).set('Authorization', `Bearer ${accessToken}`);
    const after = await request(app.getHttpServer()).get('/tasks/stats').set('Authorization', `Bearer ${accessToken}`);

    expect(after.body.total).toBeLessThan(before.body.total);
  });

  it('should accept patch with no changes', async () => {
    const task = await request(app.getHttpServer()).post('/tasks').set('Authorization', `Bearer ${accessToken}`).send({
      title: 'Patch No Change',
      description: 'Still same',
      status: 'PENDING',
      priority: 'LOW',
    });

    const patch = await request(app.getHttpServer())
      .patch(`/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(patch.status).toBe(200);
    expect(patch.body.id).toBe(task.body.id);
  });

  it('should handle concurrent task creation', async () => {
    const payload = {
      title: 'Concurrent',
      description: 'Test',
      status: 'PENDING',
      priority: 'LOW',
    };

    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app.getHttpServer()).post('/tasks').set('Authorization', `Bearer ${accessToken}`).send(payload),
      ),
    );

    results.forEach((res) => {
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });
  });
});
