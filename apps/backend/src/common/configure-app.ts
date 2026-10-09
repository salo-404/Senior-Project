import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { EnvVars } from '../config/env.validation';
import { ErrorFilter } from './error.filter';
import { correlationMiddleware } from './request-context';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);

  app.use(correlationMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.useLogger(app.get(Logger));
}
