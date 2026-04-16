import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'examplehr-leave-microservice',
    };
  }

  async getSyncLogs() {
    return this.prisma.syncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
