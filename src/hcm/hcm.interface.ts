export interface HcmBalanceRecord {
  employeeId: string;
  locationId: string;
  leaveType: string;
  totalDays: number;
}

export interface HcmAbsenceRegistration {
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
}

export interface HcmAbsenceResponse {
  hcmReference: string;
  status: 'CONFIRMED' | 'REJECTED';
  message?: string;
}

export interface HcmBatchSyncResponse {
  balances: HcmBalanceRecord[];
}

export interface HcmCancelResponse {
  status: 'CANCELLED' | 'NOT_FOUND';
  message?: string;
}
