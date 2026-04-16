import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HcmModule } from './hcm/hcm.module';
import { LeaveBalanceModule } from './leave-balance/leave-balance.module';
import { LeaveRequestModule } from './leave-request/leave-request.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HcmModule,
    LeaveBalanceModule,
    LeaveRequestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
