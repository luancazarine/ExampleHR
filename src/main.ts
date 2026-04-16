import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('ExampleHR Leave Microservice')
    .setDescription(
      'Manages the lifecycle of employee leave requests and synchronizes ' +
        'leave balances with an external HCM system (source of truth). ' +
        'Implements the Reserve-then-Confirm pattern for balance integrity.',
    )
    .setVersion('1.0')
    .addTag('Leave Balances', 'Cached balance queries, HCM refresh, and batch sync')
    .addTag('Leave Requests', 'Leave request lifecycle: create, approve, reject, cancel')
    .addTag('Admin', 'Health checks and sync logs')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
