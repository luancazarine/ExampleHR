import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppService', () => {
  let service: AppService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      syncLog: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      const result = service.getHealth();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('examplehr-leave-microservice');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getSyncLogs', () => {
    it('should return sync logs from database', async () => {
      const mockLogs = [
        { id: '1', syncType: 'BATCH', status: 'SUCCESS', createdAt: new Date() },
      ];
      prisma.syncLog.findMany.mockResolvedValue(mockLogs);

      const result = await service.getSyncLogs();
      expect(result).toEqual(mockLogs);
      expect(prisma.syncLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });
});
