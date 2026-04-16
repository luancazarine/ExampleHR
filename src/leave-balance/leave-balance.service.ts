import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HcmService } from '../hcm/hcm.service';
import { HcmBalanceRecord } from '../hcm/hcm.interface';

@Injectable()
export class LeaveBalanceService {
  private readonly logger = new Logger(LeaveBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmService: HcmService,
  ) {}

  async getBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId },
    });

    return {
      employeeId,
      balances: balances.map((b) => ({
        id: b.id,
        locationId: b.locationId,
        leaveType: b.leaveType,
        totalDays: b.totalDays,
        usedDays: b.usedDays,
        reservedDays: b.reservedDays,
        availableDays: b.totalDays - b.usedDays - b.reservedDays,
        lastSyncedAt: b.lastSyncedAt,
      })),
    };
  }

  async refreshFromHcm(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    const hcmBalances =
      await this.hcmService.getEmployeeBalances(employeeId);

    await this.upsertBalances(hcmBalances);

    await this.prisma.syncLog.create({
      data: {
        syncType: 'REAL_TIME',
        status: 'SUCCESS',
        details: JSON.stringify({
          employeeId,
          recordsProcessed: hcmBalances.length,
        }),
      },
    });

    return this.getBalances(employeeId);
  }

  async triggerBatchSync() {
    try {
      const response = await this.hcmService.fetchAllBalances();
      const result = await this.upsertBalances(response.balances);

      const syncLog = await this.prisma.syncLog.create({
        data: {
          syncType: 'BATCH',
          status: result.discrepancies > 0 ? 'PARTIAL' : 'SUCCESS',
          details: JSON.stringify({
            recordsProcessed: result.processed,
            discrepancies: result.discrepancies,
          }),
        },
      });

      return {
        syncId: syncLog.id,
        status: syncLog.status,
        recordsProcessed: result.processed,
        discrepancies: result.discrepancies,
      };
    } catch (error) {
      const syncLog = await this.prisma.syncLog.create({
        data: {
          syncType: 'BATCH',
          status: 'FAILED',
          details: JSON.stringify({
            error: (error as Error).message,
          }),
        },
      });

      return {
        syncId: syncLog.id,
        status: 'FAILED',
        recordsProcessed: 0,
        discrepancies: 0,
      };
    }
  }

  async processWebhook(balances: HcmBalanceRecord[]) {
    const result = await this.upsertBalances(balances);

    const syncLog = await this.prisma.syncLog.create({
      data: {
        syncType: 'BATCH',
        status: result.discrepancies > 0 ? 'PARTIAL' : 'SUCCESS',
        details: JSON.stringify({
          recordsProcessed: result.processed,
          discrepancies: result.discrepancies,
        }),
      },
    });

    return {
      syncId: syncLog.id,
      status: syncLog.status,
      recordsProcessed: result.processed,
    };
  }

  private async upsertBalances(
    hcmBalances: HcmBalanceRecord[],
  ): Promise<{ processed: number; discrepancies: number }> {
    let processed = 0;
    let discrepancies = 0;

    for (const hcmBalance of hcmBalances) {
      const existing = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: hcmBalance.employeeId,
            locationId: hcmBalance.locationId,
            leaveType: hcmBalance.leaveType,
          },
        },
      });

      const confirmedUsedDays = await this.calculateConfirmedUsedDays(
        hcmBalance.employeeId,
        hcmBalance.locationId,
        hcmBalance.leaveType,
      );

      if (existing) {
        if (
          Math.abs(existing.usedDays - confirmedUsedDays) > 0.001
        ) {
          discrepancies++;
          this.logger.warn(
            `Discrepancy for ${hcmBalance.employeeId}/${hcmBalance.locationId}/${hcmBalance.leaveType}: ` +
              `local usedDays=${existing.usedDays}, calculated=${confirmedUsedDays}`,
          );
        }

        await this.prisma.leaveBalance.update({
          where: { id: existing.id },
          data: {
            totalDays: hcmBalance.totalDays,
            usedDays: confirmedUsedDays,
            lastSyncedAt: new Date(),
          },
        });
      } else {
        await this.prisma.leaveBalance.create({
          data: {
            employeeId: hcmBalance.employeeId,
            locationId: hcmBalance.locationId,
            leaveType: hcmBalance.leaveType,
            totalDays: hcmBalance.totalDays,
            usedDays: confirmedUsedDays,
            reservedDays: 0,
            lastSyncedAt: new Date(),
          },
        });
      }

      processed++;
    }

    return { processed, discrepancies };
  }

  private async calculateConfirmedUsedDays(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<number> {
    const result = await this.prisma.leaveRequest.aggregate({
      where: {
        employeeId,
        locationId,
        leaveType,
        status: 'CONFIRMED_BY_HCM',
      },
      _sum: {
        days: true,
      },
    });

    return result._sum.days || 0;
  }
}
