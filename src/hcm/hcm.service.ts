import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  HcmBalanceRecord,
  HcmAbsenceRegistration,
  HcmAbsenceResponse,
  HcmBatchSyncResponse,
  HcmCancelResponse,
} from './hcm.interface';

@Injectable()
export class HcmService {
  private readonly logger = new Logger(HcmService.name);
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;

  constructor(private readonly configService: ConfigService) {
    const baseURL =
      this.configService.get<string>('HCM_BASE_URL') ||
      'http://localhost:3001';
    this.maxRetries =
      this.configService.get<number>('HCM_MAX_RETRIES') || 3;

    this.client = axios.create({
      baseURL,
      timeout: 5000,
    });
  }

  async getEmployeeBalances(
    employeeId: string,
  ): Promise<HcmBalanceRecord[]> {
    return this.withRetry(async () => {
      const response = await this.client.get(
        `/hcm/balances/${employeeId}`,
      );
      return response.data.balances;
    });
  }

  async registerAbsence(
    absence: HcmAbsenceRegistration,
  ): Promise<HcmAbsenceResponse> {
    try {
      const response = await this.client.post('/hcm/absences', absence);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 400 || status === 409 || status === 422) {
          return {
            hcmReference: '',
            status: 'REJECTED',
            message: data.message || 'HCM rejected the absence registration',
          };
        }

        if (status >= 500) {
          throw new HttpException(
            'HCM service unavailable',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
      }

      throw new HttpException(
        'HCM communication failure',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async cancelAbsence(hcmReference: string): Promise<HcmCancelResponse> {
    return this.withRetry(async () => {
      const response = await this.client.delete(
        `/hcm/absences/${hcmReference}`,
      );
      return response.data;
    });
  }

  async fetchAllBalances(): Promise<HcmBatchSyncResponse> {
    return this.withRetry(async () => {
      const response = await this.client.post('/hcm/batch-sync');
      return response.data;
    });
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.maxRetries,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `HCM request failed (attempt ${attempt}/${retries}): ${lastError.message}`,
        );

        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new HttpException(
      'HCM service unavailable after retries',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
