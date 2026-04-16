import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import axios from 'axios';
import { HcmService } from './hcm.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HcmService', () => {
  let service: HcmService;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    mockedAxios.isAxiosError.mockImplementation(
      (error: any) => error?.isAxiosError === true,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'HCM_BASE_URL') return 'http://mock-hcm:3001';
              if (key === 'HCM_MAX_RETRIES') return 2;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<HcmService>(HcmService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEmployeeBalances', () => {
    it('should return balances from HCM', async () => {
      const mockBalances = [
        {
          employeeId: 'EMP001',
          locationId: 'LOC_US',
          leaveType: 'VACATION',
          totalDays: 20,
        },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: { balances: mockBalances },
      });

      const result = await service.getEmployeeBalances('EMP001');
      expect(result).toEqual(mockBalances);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/hcm/balances/EMP001',
      );
    });

    it('should retry on failure and eventually succeed', async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: { balances: [] },
        });

      const result = await service.getEmployeeBalances('EMP001');
      expect(result).toEqual([]);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries exhausted', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(
        service.getEmployeeBalances('EMP001'),
      ).rejects.toThrow(HttpException);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('registerAbsence', () => {
    const absence = {
      employeeId: 'EMP001',
      locationId: 'LOC_US',
      leaveType: 'VACATION',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
    };

    it('should return confirmation on success', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { hcmReference: 'HCM-ABS-1', status: 'CONFIRMED' },
      });

      const result = await service.registerAbsence(absence);
      expect(result.status).toBe('CONFIRMED');
      expect(result.hcmReference).toBe('HCM-ABS-1');
    });

    it('should return REJECTED on 400 error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Insufficient balance' },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      const result = await service.registerAbsence(absence);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toBe('Insufficient balance');
    });

    it('should return REJECTED on 422 error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 422,
          data: { message: 'Invalid dimensions' },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      const result = await service.registerAbsence(absence);
      expect(result.status).toBe('REJECTED');
    });

    it('should throw on 500 error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { message: 'Server down' },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(service.registerAbsence(absence)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw on network error without response', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.registerAbsence(absence)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('cancelAbsence', () => {
    it('should cancel absence successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({
        data: { status: 'CANCELLED' },
      });

      const result = await service.cancelAbsence('HCM-ABS-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('should retry on failure', async () => {
      mockAxiosInstance.delete
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          data: { status: 'CANCELLED' },
        });

      const result = await service.cancelAbsence('HCM-ABS-1');
      expect(result.status).toBe('CANCELLED');
      expect(mockAxiosInstance.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchAllBalances', () => {
    it('should return all balances', async () => {
      const mockResponse = {
        balances: [
          {
            employeeId: 'EMP001',
            locationId: 'LOC_US',
            leaveType: 'VACATION',
            totalDays: 20,
          },
        ],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: mockResponse,
      });

      const result = await service.fetchAllBalances();
      expect(result.balances).toHaveLength(1);
    });
  });
});
