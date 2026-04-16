import { Test, TestingModule } from '@nestjs/testing';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';

describe('LeaveRequestController', () => {
  let controller: LeaveRequestController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmployee: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveRequestController],
      providers: [
        { provide: LeaveRequestService, useValue: service },
      ],
    }).compile();

    controller = module.get<LeaveRequestController>(LeaveRequestController);
  });

  it('should create a leave request', async () => {
    const dto = {
      employeeId: 'EMP001',
      locationId: 'LOC_US',
      leaveType: 'VACATION',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
    };
    const mockResult = { id: 'req-1', ...dto, status: 'PENDING' };
    service.create.mockResolvedValue(mockResult);

    const result = await controller.create(dto);
    expect(result).toEqual(mockResult);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('should find by id', async () => {
    const mockResult = { id: 'req-1', status: 'PENDING' };
    service.findById.mockResolvedValue(mockResult);

    const result = await controller.findById('req-1');
    expect(result).toEqual(mockResult);
  });

  it('should find by employee', async () => {
    service.findByEmployee.mockResolvedValue([]);

    const result = await controller.findByEmployee('EMP001', 'PENDING');
    expect(result).toEqual([]);
    expect(service.findByEmployee).toHaveBeenCalledWith('EMP001', 'PENDING');
  });

  it('should approve', async () => {
    const mockResult = { id: 'req-1', status: 'CONFIRMED_BY_HCM' };
    service.approve.mockResolvedValue(mockResult);

    const result = await controller.approve('req-1', { reviewedBy: 'MGR001' });
    expect(result).toEqual(mockResult);
    expect(service.approve).toHaveBeenCalledWith('req-1', 'MGR001');
  });

  it('should reject', async () => {
    const mockResult = { id: 'req-1', status: 'REJECTED' };
    service.reject.mockResolvedValue(mockResult);

    const result = await controller.reject('req-1', {
      reviewedBy: 'MGR001',
      reason: 'No coverage',
    });
    expect(result).toEqual(mockResult);
    expect(service.reject).toHaveBeenCalledWith(
      'req-1',
      'MGR001',
      'No coverage',
    );
  });

  it('should cancel', async () => {
    const mockResult = { id: 'req-1', status: 'CANCELLED' };
    service.cancel.mockResolvedValue(mockResult);

    const result = await controller.cancel('req-1');
    expect(result).toEqual(mockResult);
    expect(service.cancel).toHaveBeenCalledWith('req-1');
  });
});
