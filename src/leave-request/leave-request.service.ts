import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HcmService } from '../hcm/hcm.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONFIRMED_BY_HCM = 'CONFIRMED_BY_HCM',
  PENDING_HCM_CONFIRMATION = 'PENDING_HCM_CONFIRMATION',
  HCM_REJECTED = 'HCM_REJECTED',
  CANCELLED = 'CANCELLED',
}

@Injectable()
export class LeaveRequestService {
  private readonly logger = new Logger(LeaveRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmService: HcmService,
  ) {}

  async create(dto: CreateLeaveRequestDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee ${dto.employeeId} not found`,
      );
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: dto.employeeId,
            locationId: dto.locationId,
            leaveType: dto.leaveType,
          },
        },
      });

      if (!balance) {
        throw new BadRequestException(
          `No balance found for employee ${dto.employeeId}, ` +
            `location ${dto.locationId}, type ${dto.leaveType}`,
        );
      }

      const availableDays =
        balance.totalDays - balance.usedDays - balance.reservedDays;

      if (availableDays < dto.days) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${availableDays}, Requested: ${dto.days}`,
        );
      }

      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: {
          reservedDays: { increment: dto.days },
        },
      });

      return tx.leaveRequest.create({
        data: {
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          leaveType: dto.leaveType,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          days: dto.days,
          status: LeaveRequestStatus.PENDING,
          reason: dto.reason,
        },
      });
    });

    return request;
  }

  async findById(id: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }

    return request;
  }

  async findByEmployee(employeeId: string, status?: string) {
    const where: any = { employeeId };
    if (status) {
      where.status = status;
    }

    return this.prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(id: string, reviewedBy: string) {
    const request = await this.findById(id);

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot approve request in status ${request.status}`,
      );
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveRequestStatus.APPROVED,
        reviewedBy,
      },
    });

    try {
      const hcmResponse = await this.hcmService.registerAbsence({
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        days: request.days,
      });

      if (hcmResponse.status === 'CONFIRMED') {
        return this.confirmByHcm(id, hcmResponse.hcmReference);
      } else {
        return this.rejectByHcm(id, hcmResponse.message);
      }
    } catch (error) {
      this.logger.warn(
        `HCM communication failed for request ${id}, marking as pending confirmation`,
      );
      return this.prisma.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.PENDING_HCM_CONFIRMATION,
        },
      });
    }
  }

  async reject(id: string, reviewedBy: string, reason?: string) {
    const request = await this.findById(id);

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot reject request in status ${request.status}`,
      );
    }

    await this.releaseReservedDays(request);

    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveRequestStatus.REJECTED,
        reviewedBy,
        reason: reason || request.reason,
      },
    });
  }

  async cancel(id: string) {
    const request = await this.findById(id);

    const cancellableStatuses = [
      LeaveRequestStatus.PENDING,
      LeaveRequestStatus.APPROVED,
      LeaveRequestStatus.CONFIRMED_BY_HCM,
      LeaveRequestStatus.PENDING_HCM_CONFIRMATION,
    ];

    if (!cancellableStatuses.includes(request.status as LeaveRequestStatus)) {
      throw new ConflictException(
        `Cannot cancel request in status ${request.status}`,
      );
    }

    if (request.status === LeaveRequestStatus.CONFIRMED_BY_HCM) {
      await this.releaseUsedDays(request);

      if (request.hcmReference) {
        try {
          await this.hcmService.cancelAbsence(request.hcmReference);
        } catch (error) {
          this.logger.warn(
            `Failed to cancel absence in HCM for request ${id}: ${(error as Error).message}`,
          );
        }
      }
    } else {
      await this.releaseReservedDays(request);
    }

    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.CANCELLED },
    });
  }

  async retryHcmConfirmation(id: string) {
    const request = await this.findById(id);

    if (
      request.status !== LeaveRequestStatus.PENDING_HCM_CONFIRMATION
    ) {
      throw new ConflictException(
        `Request ${id} is not pending HCM confirmation`,
      );
    }

    try {
      const hcmResponse = await this.hcmService.registerAbsence({
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        days: request.days,
      });

      if (hcmResponse.status === 'CONFIRMED') {
        return this.confirmByHcm(id, hcmResponse.hcmReference);
      } else {
        return this.rejectByHcm(id, hcmResponse.message);
      }
    } catch (error) {
      this.logger.warn(`Retry failed for request ${id}`);
      throw error;
    }
  }

  private async confirmByHcm(id: string, hcmReference: string) {
    const request = await this.findById(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.leaveBalance.update({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
          },
        },
        data: {
          reservedDays: { decrement: request.days },
          usedDays: { increment: request.days },
        },
      });

      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.CONFIRMED_BY_HCM,
          hcmReference,
        },
      });
    });

    return this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  private async rejectByHcm(id: string, message?: string) {
    const request = await this.findById(id);

    await this.releaseReservedDays(request);

    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveRequestStatus.HCM_REJECTED,
        reason: message || 'Rejected by HCM',
      },
    });
  }

  private async releaseReservedDays(request: any) {
    await this.prisma.leaveBalance.update({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
        },
      },
      data: {
        reservedDays: { decrement: request.days },
      },
    });
  }

  private async releaseUsedDays(request: any) {
    await this.prisma.leaveBalance.update({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
        },
      },
      data: {
        usedDays: { decrement: request.days },
      },
    });
  }
}
