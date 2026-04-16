import request from 'supertest';
import {
  TestContext,
  setupTestContext,
  teardownTestContext,
  cleanDatabase,
  seedTestData,
} from './setup';

describe('Sync & Health E2E', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });

  afterAll(async () => {
    await teardownTestContext(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    await seedTestData(ctx.prisma);
    ctx.mockHcmService.reset();
    ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 20, 0);
    ctx.mockHcmService.setBalance('EMP002', 'LOC_EU', 'VACATION', 25, 0);
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('examplehr-leave-microservice');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /sync-logs', () => {
    it('should return empty logs initially', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/sync-logs')
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it('should return logs after sync operations', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      const res = await request(ctx.app.getHttpServer())
        .get('/sync-logs')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].syncType).toBe('BATCH');
    });

    it('should track multiple sync operations', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001/refresh')
        .expect(200);

      const res = await request(ctx.app.getHttpServer())
        .get('/sync-logs')
        .expect(200);

      expect(res.body).toHaveLength(2);

      const syncTypes = res.body.map((l: any) => l.syncType);
      expect(syncTypes).toContain('BATCH');
      expect(syncTypes).toContain('REAL_TIME');
    });
  });

  describe('Independent HCM Changes', () => {
    it('should reflect anniversary bonus after refresh', async () => {
      const beforeRefresh = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBefore = beforeRefresh.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBefore.totalDays).toBe(20);

      ctx.mockHcmService.addBonus('EMP001', 'LOC_US', 'VACATION', 2);

      const afterRefresh = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001/refresh')
        .expect(200);

      const vacAfter = afterRefresh.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacAfter.totalDays).toBe(22);
      expect(vacAfter.availableDays).toBe(22);
    });

    it('should detect independent HCM changes via batch sync', async () => {
      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 25, 0);
      ctx.mockHcmService.setBalance('EMP002', 'LOC_EU', 'VACATION', 30, 0);

      await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      const emp1 = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const emp1Vac = emp1.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(emp1Vac.totalDays).toBe(25);

      const emp2 = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP002')
        .expect(200);

      const emp2Vac = emp2.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(emp2Vac.totalDays).toBe(30);
    });
  });

  describe('End-to-End Lifecycle with Sync', () => {
    it('should handle full lifecycle: request -> approve -> sync -> verify', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          days: 5,
        })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      ctx.mockHcmService.addBonus('EMP001', 'LOC_US', 'VACATION', 3);

      await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      const balances = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacation = balances.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );

      expect(vacation.totalDays).toBe(23);
      expect(vacation.usedDays).toBe(5);
      expect(vacation.availableDays).toBe(18);
    });
  });
});
