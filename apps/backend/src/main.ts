import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import type { EnvVars } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);
  await app.listen(config.get('API_PORT', { infer: true }));
}
bootstrap();
