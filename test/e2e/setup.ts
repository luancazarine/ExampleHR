import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { HcmModule } from '../../src/hcm/hcm.module';
import { LeaveBalanceModule } from '../../src/leave-balance/leave-balance.module';
import { LeaveRequestModule } from '../../src/leave-request/leave-request.module';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { MockHcmModule } from '../mock-hcm-server/mock-hcm.module';
import { MockHcmService } from '../mock-hcm-server/mock-hcm.service';
import { execSync } from 'child_process';
import * as path from 'path';

export interface TestContext {
  app: INestApplication;
  mockHcmApp: INestApplication;
  prisma: PrismaService;
  mockHcmService: MockHcmService;
  mockHcmPort: number;
}

export async function setupTestContext(): Promise<TestContext> {
  const testDbPath = path.join(__dirname, '..', '..', 'prisma', 'test.db');
  process.env.DATABASE_URL = `file:${testDbPath}`;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
    cwd: path.join(__dirname, '..', '..'),
  });
  const mockHcmModule: TestingModule = await Test.createTestingModule({
    imports: [MockHcmModule],
  }).compile();

  const mockHcmApp = mockHcmModule.createNestApplication();
  await mockHcmApp.listen(0);
  const mockHcmUrl = await mockHcmApp.getUrl();
  const mockHcmPort = parseInt(new URL(mockHcmUrl).port, 10);

  const appModule: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            HCM_BASE_URL: mockHcmUrl,
            HCM_MAX_RETRIES: 2,
          }),
        ],
      }),
      PrismaModule,
      HcmModule,
      LeaveBalanceModule,
      LeaveRequestModule,
    ],
    controllers: [AppController],
    providers: [AppService],
  }).compile();

  const app = appModule.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  const prisma = appModule.get<PrismaService>(PrismaService);
  const mockHcmService =
    mockHcmModule.get<MockHcmService>(MockHcmService);

  return { app, mockHcmApp, prisma, mockHcmService, mockHcmPort };
}

export async function cleanDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
  await prisma.$executeRawUnsafe('DELETE FROM "LeaveRequest"');
  await prisma.$executeRawUnsafe('DELETE FROM "LeaveBalance"');
  await prisma.$executeRawUnsafe('DELETE FROM "SyncLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Employee"');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
}

export async function seedTestData(prisma: PrismaService) {
  await prisma.employee.create({
    data: {
      id: 'EMP001',
      name: 'John Doe',
      email: 'john@example.com',
      locationId: 'LOC_US',
    },
  });

  await prisma.employee.create({
    data: {
      id: 'EMP002',
      name: 'Jane Smith',
      email: 'jane@example.com',
      locationId: 'LOC_EU',
    },
  });

  await prisma.leaveBalance.create({
    data: {
      employeeId: 'EMP001',
      locationId: 'LOC_US',
      leaveType: 'VACATION',
      totalDays: 20,
      usedDays: 0,
      reservedDays: 0,
    },
  });

  await prisma.leaveBalance.create({
    data: {
      employeeId: 'EMP001',
      locationId: 'LOC_US',
      leaveType: 'SICK',
      totalDays: 10,
      usedDays: 0,
      reservedDays: 0,
    },
  });

  await prisma.leaveBalance.create({
    data: {
      employeeId: 'EMP002',
      locationId: 'LOC_EU',
      leaveType: 'VACATION',
      totalDays: 25,
      usedDays: 0,
      reservedDays: 0,
    },
  });
}

export async function teardownTestContext(ctx: TestContext) {
  await cleanDatabase(ctx.prisma);
  await ctx.app.close();
  await ctx.mockHcmApp.close();
}
