import { NestFactory } from '@nestjs/core';
import { MockHcmModule } from './mock-hcm.module';
import { MockHcmService } from './mock-hcm.service';

async function bootstrap() {
  const app = await NestFactory.create(MockHcmModule);
  const port = process.env.MOCK_HCM_PORT || 3001;

  const mockHcmService = app.get(MockHcmService);
  mockHcmService.setBalance('EMP001', 'LOC_US', 'VACATION', 20, 0);
  mockHcmService.setBalance('EMP001', 'LOC_US', 'SICK', 10, 0);
  mockHcmService.setBalance('EMP002', 'LOC_EU', 'VACATION', 25, 0);

  await app.listen(port);
  console.log(`Mock HCM server running on http://localhost:${port}`);
  console.log('Pre-seeded balances: EMP001 (VACATION:20, SICK:10), EMP002 (VACATION:25)');
  console.log('Test endpoints available at /hcm/__test__/*');
}
bootstrap();
