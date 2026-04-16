import { Test, TestingModule } from '@nestjs/testing';
import { LeaveBalanceController } from './leave-balance.controller';
import { LeaveBalanceService } from './leave-balance.service';

describe('LeaveBalanceController', () => {
  let controller: LeaveBalanceController;
  let service: any;

  beforeEach(async () => {
    service = {
      getBalances: jest.fn(),
      refreshFromHcm: jest.fn(),
      triggerBatchSync: jest.fn(),
      processWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveBalanceController],
      providers: [
        { provide: LeaveBalanceService, useValue: service },
      ],
    }).compile();

    controller = module.get<LeaveBalanceController>(LeaveBalanceController);
  });

  it('should call getBalances', async () => {
    const mockResult = { employeeId: 'EMP001', balances: [] };
    service.getBalances.mockResolvedValue(mockResult);

    const result = await controller.getBalances('EMP001');
    expect(result).toEqual(mockResult);
    expect(service.getBalances).toHaveBeenCalledWith('EMP001');
  });

  it('should call refreshFromHcm', async () => {
    const mockResult = { employeeId: 'EMP001', balances: [] };
    service.refreshFromHcm.mockResolvedValue(mockResult);

    const result = await controller.refreshFromHcm('EMP001');
    expect(result).toEqual(mockResult);
  });

  it('should call triggerBatchSync', async () => {
    const mockResult = { syncId: '1', status: 'SUCCESS' };
    service.triggerBatchSync.mockResolvedValue(mockResult);

    const result = await controller.triggerBatchSync();
    expect(result).toEqual(mockResult);
  });

  it('should call processWebhook', async () => {
    const dto = { balances: [{ employeeId: 'EMP001', locationId: 'LOC_US', leaveType: 'VACATION', totalDays: 20 }] };
    const mockResult = { syncId: '1', status: 'SUCCESS', recordsProcessed: 1 };
    service.processWebhook.mockResolvedValue(mockResult);

    const result = await controller.processWebhook(dto);
    expect(result).toEqual(mockResult);
    expect(service.processWebhook).toHaveBeenCalledWith(dto.balances);
  });
});
