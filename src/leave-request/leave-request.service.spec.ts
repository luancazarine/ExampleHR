import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HcmService } from '../hcm/hcm.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeaveRequestService,
  LeaveRequestStatus,
} from './leave-request.service';

describe('LeaveRequestService', () => {
  let service: LeaveRequestService;
  let prisma: any;
  let hcmService: any;

  const mockEmployee = { id: 'EMP001', name: 'John', email: 'j@test.com', locationId: 'LOC_US' };
  const mockBalance = {
    id: 'bal-1',
    employeeId: 'EMP001',
    locationId: 'LOC_US',
    leaveType: 'VACATION',
    totalDays: 20,
    usedDays: 5,
    reservedDays: 2,
  };
  const mockRequest = {
    id: 'req-1',
    employeeId: 'EMP001',
    locationId: 'LOC_US',
    leaveType: 'VACATION',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-02'),
    days: 2,
    status: LeaveRequestStatus.PENDING,
    hcmReference: null,
    reason: 'Vacation',
    reviewedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const txProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'leaveBalance') return prisma?.leaveBalance;
          if (prop === 'leaveRequest') return prisma?.leaveRequest;
          return undefined;
        },
      },
    );

    prisma = {
      employee: {
        findUnique: jest.fn(),
      },
      leaveBalance: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      leaveRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(txProxy)),
    };

    hcmService = {
      registerAbsence: jest.fn(),
      cancelAbsence: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: HcmService, useValue: hcmService },
      ],
    }).compile();

    service = module.get<LeaveRequestService>(LeaveRequestService);
  });

  describe('create', () => {
    const createDto = {
      employeeId: 'EMP001',
      locationId: 'LOC_US',
      leaveType: 'VACATION',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      reason: 'Vacation',
    };

    it('should create a leave request and reserve days', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.leaveBalance.findUnique.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.leaveRequest.create.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.PENDING,
      });

      const result = await service.create(createDto);
      expect(result.status).toBe(LeaveRequestStatus.PENDING);
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reservedDays: { increment: 2 } },
        }),
      );
    });

    it('should throw NotFoundException if employee not found', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if no balance found', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if insufficient balance', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.leaveBalance.findUnique.mockResolvedValue({
        ...mockBalance,
        totalDays: 7,
        usedDays: 5,
        reservedDays: 2,
      });

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findById', () => {
    it('should return a request by id', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(mockRequest);

      const result = await service.findById('req-1');
      expect(result.id).toBe('req-1');
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmployee', () => {
    it('should return requests for employee', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([mockRequest]);

      const result = await service.findByEmployee('EMP001');
      expect(result).toHaveLength(1);
    });

    it('should filter by status when provided', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.findByEmployee('EMP001', 'APPROVED');
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'EMP001', status: 'APPROVED' },
        }),
      );
    });
  });

  describe('approve', () => {
    it('should approve and confirm via HCM', async () => {
      prisma.leaveRequest.findUnique
        .mockResolvedValueOnce(mockRequest)
        .mockResolvedValueOnce({
          ...mockRequest,
          status: LeaveRequestStatus.APPROVED,
        })
        .mockResolvedValueOnce({
          ...mockRequest,
          status: LeaveRequestStatus.CONFIRMED_BY_HCM,
          hcmReference: 'HCM-ABS-1',
        });

      prisma.leaveRequest.update.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      prisma.leaveBalance.update.mockResolvedValue({});

      hcmService.registerAbsence.mockResolvedValue({
        hcmReference: 'HCM-ABS-1',
        status: 'CONFIRMED',
      });

      const result = await service.approve('req-1', 'MGR001');
      expect(result.status).toBe(LeaveRequestStatus.CONFIRMED_BY_HCM);
    });

    it('should handle HCM rejection', async () => {
      prisma.leaveRequest.findUnique
        .mockResolvedValueOnce(mockRequest)
        .mockResolvedValueOnce({
          ...mockRequest,
          status: LeaveRequestStatus.APPROVED,
        });

      prisma.leaveRequest.update.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.HCM_REJECTED,
      });
      prisma.leaveBalance.update.mockResolvedValue({});

      hcmService.registerAbsence.mockResolvedValue({
        hcmReference: '',
        status: 'REJECTED',
        message: 'Insufficient balance in HCM',
      });

      const result = await service.approve('req-1', 'MGR001');
      expect(result.status).toBe(LeaveRequestStatus.HCM_REJECTED);
    });

    it('should mark as PENDING_HCM_CONFIRMATION on HCM failure', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValueOnce(mockRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.PENDING_HCM_CONFIRMATION,
      });

      hcmService.registerAbsence.mockRejectedValue(
        new Error('HCM unavailable'),
      );

      const result = await service.approve('req-1', 'MGR001');
      expect(result.status).toBe(
        LeaveRequestStatus.PENDING_HCM_CONFIRMATION,
      );
    });

    it('should throw ConflictException if not PENDING', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.APPROVED,
      });

      await expect(
        service.approve('req-1', 'MGR001'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('should reject and release reserved days', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(mockRequest);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.REJECTED,
      });

      const result = await service.reject('req-1', 'MGR001', 'No coverage');
      expect(result.status).toBe(LeaveRequestStatus.REJECTED);
    });

    it('should throw ConflictException if not PENDING', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.CONFIRMED_BY_HCM,
      });

      await expect(
        service.reject('req-1', 'MGR001'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('should cancel a PENDING request and release reserved days', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(mockRequest);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.CANCELLED,
      });

      const result = await service.cancel('req-1');
      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    });

    it('should cancel a CONFIRMED_BY_HCM request and release used days + notify HCM', async () => {
      const confirmedRequest = {
        ...mockRequest,
        status: LeaveRequestStatus.CONFIRMED_BY_HCM,
        hcmReference: 'HCM-ABS-1',
      };
      prisma.leaveRequest.findUnique.mockResolvedValue(confirmedRequest);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.leaveRequest.update.mockResolvedValue({
        ...confirmedRequest,
        status: LeaveRequestStatus.CANCELLED,
      });
      hcmService.cancelAbsence.mockResolvedValue({ status: 'CANCELLED' });

      const result = await service.cancel('req-1');
      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
      expect(hcmService.cancelAbsence).toHaveBeenCalledWith('HCM-ABS-1');
    });

    it('should still cancel even if HCM cancellation fails', async () => {
      const confirmedRequest = {
        ...mockRequest,
        status: LeaveRequestStatus.CONFIRMED_BY_HCM,
        hcmReference: 'HCM-ABS-1',
      };
      prisma.leaveRequest.findUnique.mockResolvedValue(confirmedRequest);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.leaveRequest.update.mockResolvedValue({
        ...confirmedRequest,
        status: LeaveRequestStatus.CANCELLED,
      });
      hcmService.cancelAbsence.mockRejectedValue(
        new Error('HCM unavailable'),
      );

      const result = await service.cancel('req-1');
      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    });

    it('should throw ConflictException for non-cancellable status', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.REJECTED,
      });

      await expect(service.cancel('req-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException for HCM_REJECTED status', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: LeaveRequestStatus.HCM_REJECTED,
      });

      await expect(service.cancel('req-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('retryHcmConfirmation', () => {
    it('should retry and confirm on success', async () => {
      const pendingHcmRequest = {
        ...mockRequest,
        status: LeaveRequestStatus.PENDING_HCM_CONFIRMATION,
      };

      prisma.leaveRequest.findUnique
        .mockResolvedValueOnce(pendingHcmRequest)
        .mockResolvedValueOnce(pendingHcmRequest)
        .mockResolvedValueOnce({
          ...pendingHcmRequest,
          status: LeaveRequestStatus.CONFIRMED_BY_HCM,
        });

      prisma.leaveRequest.update.mockResolvedValue({});
      prisma.leaveBalance.update.mockResolvedValue({});

      hcmService.registerAbsence.mockResolvedValue({
        hcmReference: 'HCM-ABS-1',
        status: 'CONFIRMED',
      });

      const result = await service.retryHcmConfirmation('req-1');
      expect(result.status).toBe(LeaveRequestStatus.CONFIRMED_BY_HCM);
    });

    it('should throw ConflictException if not in PENDING_HCM_CONFIRMATION', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(mockRequest);

      await expect(
        service.retryHcmConfirmation('req-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
