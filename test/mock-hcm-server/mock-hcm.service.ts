import { Injectable } from '@nestjs/common';

interface BalanceKey {
  employeeId: string;
  locationId: string;
  leaveType: string;
}

interface Balance {
  employeeId: string;
  locationId: string;
  leaveType: string;
  totalDays: number;
  usedDays: number;
}

interface Absence {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
}

@Injectable()
export class MockHcmService {
  private balances = new Map<string, Balance>();
  private absences = new Map<string, Absence>();
  private absenceCounter = 0;
  private errorMode: 'none' | 'reject_all' | 'timeout' | 'server_error' =
    'none';
  private delayMs = 0;

  private balanceKey(b: BalanceKey): string {
    return `${b.employeeId}:${b.locationId}:${b.leaveType}`;
  }

  setBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    totalDays: number,
    usedDays = 0,
  ) {
    const key = this.balanceKey({ employeeId, locationId, leaveType });
    this.balances.set(key, {
      employeeId,
      locationId,
      leaveType,
      totalDays,
      usedDays,
    });
  }

  getEmployeeBalances(employeeId: string): Balance[] {
    const result: Balance[] = [];
    for (const balance of this.balances.values()) {
      if (balance.employeeId === employeeId) {
        result.push({ ...balance });
      }
    }
    return result;
  }

  getAllBalances(): Balance[] {
    return Array.from(this.balances.values()).map((b) => ({ ...b }));
  }

  registerAbsence(
    employeeId: string,
    locationId: string,
    leaveType: string,
    startDate: string,
    endDate: string,
    days: number,
  ): { hcmReference: string; status: string; message?: string } {
    const key = this.balanceKey({ employeeId, locationId, leaveType });
    const balance = this.balances.get(key);

    if (!balance) {
      return {
        hcmReference: '',
        status: 'REJECTED',
        message: `No balance found for ${employeeId}/${locationId}/${leaveType}`,
      };
    }

    const available = balance.totalDays - balance.usedDays;
    if (available < days) {
      return {
        hcmReference: '',
        status: 'REJECTED',
        message: `Insufficient balance. Available: ${available}, Requested: ${days}`,
      };
    }

    balance.usedDays += days;
    this.absenceCounter++;
    const hcmReference = `HCM-ABS-${this.absenceCounter}`;

    const absence: Absence = {
      id: hcmReference,
      employeeId,
      locationId,
      leaveType,
      startDate,
      endDate,
      days,
    };
    this.absences.set(hcmReference, absence);

    return { hcmReference, status: 'CONFIRMED' };
  }

  cancelAbsence(
    hcmReference: string,
  ): { status: string; message?: string } {
    const absence = this.absences.get(hcmReference);
    if (!absence) {
      return { status: 'NOT_FOUND', message: 'Absence not found' };
    }

    const key = this.balanceKey(absence);
    const balance = this.balances.get(key);
    if (balance) {
      balance.usedDays -= absence.days;
    }

    this.absences.delete(hcmReference);
    return { status: 'CANCELLED' };
  }

  addBonus(
    employeeId: string,
    locationId: string,
    leaveType: string,
    bonusDays: number,
  ) {
    const key = this.balanceKey({ employeeId, locationId, leaveType });
    const balance = this.balances.get(key);
    if (balance) {
      balance.totalDays += bonusDays;
    }
  }

  setErrorMode(mode: 'none' | 'reject_all' | 'timeout' | 'server_error') {
    this.errorMode = mode;
  }

  getErrorMode() {
    return this.errorMode;
  }

  setDelay(ms: number) {
    this.delayMs = ms;
  }

  getDelay() {
    return this.delayMs;
  }

  reset() {
    this.balances.clear();
    this.absences.clear();
    this.absenceCounter = 0;
    this.errorMode = 'none';
    this.delayMs = 0;
  }
}
