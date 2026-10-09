import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { getCorrelationId } from './common/request-context';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './infra/audit/audit.module';
import { AuthModule } from './infra/auth/auth.module';
import { HealthModule } from './infra/health/health.module';
import { NotificationsModule } from './infra/notifications/notifications.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { SafetyModule } from './infra/safety/safety.module';
import { StorageModule } from './infra/storage/storage.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { CasesModule } from './modules/cases/cases.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { RequestsModule } from './modules/requests/requests.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'test' ? 'silent' : 'info',
          // The correlation id is created by the middleware in configureApp and added to every log line.
          genReqId: () => getCorrelationId() ?? 'no-correlation-id',
          mixin: () => ({ correlationId: getCorrelationId() }),
          // Never log credentials or tokens.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.old_password',
              'req.body.new_password',
              'req.body.token',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
    PrismaModule,
    AuditModule,
    QueueModule,
    HealthModule,
    SafetyModule,
    StorageModule,
    UsersModule,
    TechniciansModule,
    AddressesModule,
    EquipmentModule,
    CasesModule,
    RequestsModule,
    AssignmentsModule,
    NotificationsModule,
    AuthModule,
  ],
})
export class AppModule {}
