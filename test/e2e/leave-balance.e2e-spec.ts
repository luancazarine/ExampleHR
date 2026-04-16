import request from 'supertest';
import {
  TestContext,
  setupTestContext,
  teardownTestContext,
  cleanDatabase,
  seedTestData,
} from './setup';

describe('Leave Balance E2E', () => {
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
    ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'SICK', 10, 0);
    ctx.mockHcmService.setBalance('EMP002', 'LOC_EU', 'VACATION', 25, 0);
  });

  describe('GET /leave-balances/:employeeId', () => {
    it('should return balances for an employee', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      expect(res.body.employeeId).toBe('EMP001');
      expect(res.body.balances).toHaveLength(2);

      const vacation = res.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(20);
      expect(vacation.availableDays).toBe(20);
    });

    it('should return 404 for nonexistent employee', async () => {
      await request(ctx.app.getHttpServer())
        .get('/leave-balances/NONEXISTENT')
        .expect(404);
    });
  });

  describe('GET /leave-balances/:employeeId/refresh', () => {
    it('should refresh balances from HCM', async () => {
      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 22, 0);

      const res = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001/refresh')
        .expect(200);

      const vacation = res.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(22);
    });

    it('should reflect anniversary bonus after refresh', async () => {
      ctx.mockHcmService.addBonus('EMP001', 'LOC_US', 'VACATION', 3);

      const res = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001/refresh')
        .expect(200);

      const vacation = res.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(23);
    });
  });

  describe('POST /leave-balances/sync', () => {
    it('should trigger batch sync from HCM', async () => {
      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 25, 3);

      const res = await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      expect(res.body.status).toMatch(/SUCCESS|PARTIAL/);
      expect(res.body.recordsProcessed).toBeGreaterThan(0);

      const balances = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacation = balances.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(25);
    });

    it('should handle HCM failure during batch sync', async () => {
      ctx.mockHcmService.setErrorMode('server_error');

      const res = await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      expect(res.body.status).toBe('FAILED');
    });

    it('should report discrepancies when usedDays differ', async () => {
      await ctx.prisma.leaveBalance.update({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
          },
        },
        data: { usedDays: 10 },
      });

      const res = await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      expect(res.body.discrepancies).toBeGreaterThan(0);
    });
  });

  describe('POST /leave-balances/webhook', () => {
    it('should process webhook balance updates', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/leave-balances/webhook')
        .send({
          balances: [
            {
              employeeId: 'EMP001',
              locationId: 'LOC_US',
              leaveType: 'VACATION',
              totalDays: 30,
            },
          ],
        })
        .expect(200);

      expect(res.body.recordsProcessed).toBe(1);

      const balances = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacation = balances.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(30);
    });

    it('should create new balance records from webhook', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/leave-balances/webhook')
        .send({
          balances: [
            {
              employeeId: 'EMP001',
              locationId: 'LOC_US',
              leaveType: 'PERSONAL',
              totalDays: 5,
            },
          ],
        })
        .expect(200);

      expect(res.body.recordsProcessed).toBe(1);

      const balances = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      expect(balances.body.balances).toHaveLength(3);
    });
  });

  describe('Batch Sync with In-Flight Requests', () => {
    it('should preserve reservedDays during batch sync', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-03',
          days: 3,
        })
        .expect(201);

      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 22, 0);

      await request(ctx.app.getHttpServer())
        .post('/leave-balances/sync')
        .expect(200);

      const balances = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacation = balances.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacation.totalDays).toBe(22);
      expect(vacation.reservedDays).toBe(3);
      expect(vacation.availableDays).toBe(19);
    });
  });
});
