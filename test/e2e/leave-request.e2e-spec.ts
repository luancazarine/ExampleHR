import request from 'supertest';
import {
  TestContext,
  setupTestContext,
  teardownTestContext,
  cleanDatabase,
  seedTestData,
} from './setup';

describe('Leave Request E2E', () => {
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

  describe('Happy Path: Full lifecycle', () => {
    it('should create, approve, and confirm a leave request via HCM', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
          reason: 'Family vacation',
        })
        .expect(201);

      expect(createRes.body.status).toBe('PENDING');
      expect(createRes.body.id).toBeDefined();
      const requestId = createRes.body.id;

      const balanceAfterCreate = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balanceAfterCreate.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.reservedDays).toBe(2);
      expect(vacBalance.availableDays).toBe(18);

      const approveRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${requestId}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      expect(approveRes.body.status).toBe('CONFIRMED_BY_HCM');
      expect(approveRes.body.hcmReference).toBeTruthy();

      const balanceAfterApprove = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalanceAfter = balanceAfterApprove.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalanceAfter.usedDays).toBe(2);
      expect(vacBalanceAfter.reservedDays).toBe(0);
      expect(vacBalanceAfter.availableDays).toBe(18);
    });
  });

  describe('Insufficient Balance', () => {
    it('should reject request locally when balance is insufficient', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          days: 25,
          reason: 'Extended trip',
        })
        .expect(400);

      expect(res.body.message).toContain('Insufficient balance');
    });

    it('should account for reserved days when checking balance', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-10',
          days: 18,
        })
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          days: 5,
        })
        .expect(400);

      expect(res.body.message).toContain('Insufficient balance');
    });
  });

  describe('HCM Rejection', () => {
    it('should rollback when HCM rejects the absence', async () => {
      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 20, 19);

      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const approveRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      expect(approveRes.body.status).toBe('HCM_REJECTED');

      const balance = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balance.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.reservedDays).toBe(0);
    });
  });

  describe('HCM Error Mode (reject_all)', () => {
    it('should handle HCM rejecting all absences', async () => {
      ctx.mockHcmService.setErrorMode('reject_all');

      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const approveRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      expect(approveRes.body.status).toBe('HCM_REJECTED');
    });
  });

  describe('Manager Rejection', () => {
    it('should reject a pending request and release reserved days', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const rejectRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/reject`)
        .send({ reviewedBy: 'MGR001', reason: 'Team coverage' })
        .expect(200);

      expect(rejectRes.body.status).toBe('REJECTED');

      const balance = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balance.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.reservedDays).toBe(0);
      expect(vacBalance.availableDays).toBe(20);
    });
  });

  describe('Cancellation', () => {
    it('should cancel a PENDING request', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const cancelRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const balance = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balance.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.reservedDays).toBe(0);
    });

    it('should cancel a CONFIRMED_BY_HCM request and release used days', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      const cancelRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const balance = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balance.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.usedDays).toBe(0);
      expect(vacBalance.availableDays).toBe(20);
    });

    it('should not cancel a REJECTED request', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/reject`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/cancel`)
        .expect(409);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle concurrent requests and prevent overdraw', async () => {
      await ctx.prisma.leaveBalance.update({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
          },
        },
        data: { totalDays: 5 },
      });

      const promises = Array.from({ length: 3 }, (_, i) =>
        request(ctx.app.getHttpServer())
          .post('/leave-requests')
          .send({
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
            startDate: `2026-0${5 + i}-01`,
            endDate: `2026-0${5 + i}-02`,
            days: 2,
          }),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 400);

      expect(successes.length).toBe(2);
      expect(failures.length).toBe(1);

      const balance = await request(ctx.app.getHttpServer())
        .get('/leave-balances/EMP001')
        .expect(200);

      const vacBalance = balance.body.balances.find(
        (b: any) => b.leaveType === 'VACATION',
      );
      expect(vacBalance.reservedDays).toBe(4);
      expect(vacBalance.availableDays).toBe(1);
    });
  });

  describe('Query Endpoints', () => {
    it('should get a request by ID', async () => {
      const createRes = await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const getRes = await request(ctx.app.getHttpServer())
        .get(`/leave-requests/${createRes.body.id}`)
        .expect(200);

      expect(getRes.body.id).toBe(createRes.body.id);
      expect(getRes.body.employeeId).toBe('EMP001');
    });

    it('should return 404 for unknown request ID', async () => {
      await request(ctx.app.getHttpServer())
        .get('/leave-requests/nonexistent-id')
        .expect(404);
    });

    it('should list requests by employee', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const listRes = await request(ctx.app.getHttpServer())
        .get('/leave-requests/employee/EMP001')
        .expect(200);

      expect(listRes.body).toHaveLength(1);
    });

    it('should filter requests by status', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(201);

      const pendingRes = await request(ctx.app.getHttpServer())
        .get('/leave-requests/employee/EMP001?status=PENDING')
        .expect(200);
      expect(pendingRes.body).toHaveLength(1);

      const approvedRes = await request(ctx.app.getHttpServer())
        .get('/leave-requests/employee/EMP001?status=APPROVED')
        .expect(200);
      expect(approvedRes.body).toHaveLength(0);
    });
  });

  describe('Stale Cache Scenario', () => {
    it('should reject at HCM when local cache is stale (more than HCM allows)', async () => {
      ctx.mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 20, 18);

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

      const approveRes = await request(ctx.app.getHttpServer())
        .patch(`/leave-requests/${createRes.body.id}/approve`)
        .send({ reviewedBy: 'MGR001' })
        .expect(200);

      expect(approveRes.body.status).toBe('HCM_REJECTED');
    });
  });

  describe('Validation', () => {
    it('should reject invalid request body', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
        })
        .expect(400);
    });

    it('should reject request with days less than 0.5', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-01',
          days: 0.1,
        })
        .expect(400);
    });

    it('should reject request for nonexistent employee', async () => {
      await request(ctx.app.getHttpServer())
        .post('/leave-requests')
        .send({
          employeeId: 'NONEXISTENT',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          days: 2,
        })
        .expect(404);
    });
  });
});
