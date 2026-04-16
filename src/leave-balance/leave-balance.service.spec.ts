import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LeaveBalanceService } from './leave-balance.service';
import { PrismaService } from '../prisma/prisma.service';
import { HcmService } from '../hcm/hcm.service';

describe('LeaveBalanceService', () => {
  let service: LeaveBalanceService;
  let prisma: any;
  let hcmService: any;

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
      leaveBalance: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      leaveRequest: {
        aggregate: jest.fn(),
      },
      syncLog: {
        create: jest.fn(),
      },
    };

    hcmService = {
      getEmployeeBalances: jest.fn(),
      fetchAllBalances: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveBalanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: HcmService, useValue: hcmService },
      ],
    }).compile();

    service = module.get<LeaveBalanceService>(LeaveBalanceService);
  });

  describe('getBalances', () => {
    it('should return formatted balances for an employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'EMP001' });
      prisma.leaveBalance.findMany.mockResolvedValue([
        {
          id: 'bal-1',
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 20,
          usedDays: 5,
          reservedDays: 2,
          lastSyncedAt: new Date('2026-04-15'),
        },
      ]);

      const result = await service.getBalances('EMP001');
      expect(result.employeeId).toBe('EMP001');
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0].availableDays).toBe(13);
    });

    it('should throw NotFoundException for unknown employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.getBalances('UNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('refreshFromHcm', () => {
    it('should fetch balances from HCM and upsert locally', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'EMP001' });
      hcmService.getEmployeeBalances.mockResolvedValue([
        {
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 22,
        },
      ]);

      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        employeeId: 'EMP001',
        locationId: 'LOC_US',
        leaveType: 'VACATION',
        totalDays: 20,
        usedDays: 5,
        reservedDays: 2,
      });

      prisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days: 5 },
      });

      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.syncLog.create.mockResolvedValue({ id: 'sync-1' });

      prisma.leaveBalance.findMany.mockResolvedValue([
        {
          id: 'bal-1',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 22,
          usedDays: 5,
          reservedDays: 2,
          lastSyncedAt: new Date(),
        },
      ]);

      const result = await service.refreshFromHcm('EMP001');
      expect(result.balances[0].totalDays).toBe(22);
      expect(hcmService.getEmployeeBalances).toHaveBeenCalledWith('EMP001');
    });

    it('should throw NotFoundException for unknown employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.refreshFromHcm('UNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('triggerBatchSync', () => {
    it('should process batch sync successfully', async () => {
      hcmService.fetchAllBalances.mockResolvedValue({
        balances: [
          {
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
            totalDays: 20,
          },
        ],
      });

      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days: 0 },
      });
      prisma.leaveBalance.create.mockResolvedValue({});
      prisma.syncLog.create.mockResolvedValue({
        id: 'sync-1',
        status: 'SUCCESS',
      });

      const result = await service.triggerBatchSync();
      expect(result.status).toBe('SUCCESS');
      expect(result.recordsProcessed).toBe(1);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: 'EMP001' }),
        }),
      );
    });

    it('should report discrepancies when usedDays mismatch', async () => {
      hcmService.fetchAllBalances.mockResolvedValue({
        balances: [
          {
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
            totalDays: 20,
          },
        ],
      });

      prisma.employee.findUnique.mockResolvedValue({ id: 'EMP001' });
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        usedDays: 10,
      });
      prisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days: 5 },
      });
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.syncLog.create.mockResolvedValue({
        id: 'sync-1',
        status: 'PARTIAL',
      });

      const result = await service.triggerBatchSync();
      expect(result.discrepancies).toBe(1);
    });

    it('should handle HCM failure during batch sync', async () => {
      hcmService.fetchAllBalances.mockRejectedValue(
        new Error('HCM unavailable'),
      );

      prisma.syncLog.create.mockResolvedValue({
        id: 'sync-1',
        status: 'FAILED',
      });

      const result = await service.triggerBatchSync();
      expect(result.status).toBe('FAILED');
    });
  });

  describe('processWebhook', () => {
    it('should process webhook balances and create sync log', async () => {
      const balances = [
        {
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 25,
        },
      ];

      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days: 0 },
      });
      prisma.leaveBalance.create.mockResolvedValue({});
      prisma.syncLog.create.mockResolvedValue({
        id: 'sync-1',
        status: 'SUCCESS',
      });

      const result = await service.processWebhook(balances);
      expect(result.recordsProcessed).toBe(1);
      expect(prisma.employee.create).toHaveBeenCalled();
    });

    it('should skip employee creation if employee already exists', async () => {
      const balances = [
        {
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 25,
        },
      ];

      prisma.employee.findUnique.mockResolvedValue({ id: 'EMP001' });
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        usedDays: 0,
      });
      prisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days: 0 },
      });
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.syncLog.create.mockResolvedValue({
        id: 'sync-1',
        status: 'SUCCESS',
      });

      const result = await service.processWebhook(balances);
      expect(result.recordsProcessed).toBe(1);
      expect(prisma.employee.create).not.toHaveBeenCalled();
    });
  });
});
