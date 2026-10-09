import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { EnvVars } from '../../config/env.validation';
import { UsersModule } from '../../modules/users/users.module';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { NoTechnicianProfileStatus, TechnicianProfileStatusPort } from './technician-profile-status.port';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    JwtModule.register({}), // secrets are passed per call: access and refresh tokens use different ones
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.get('GLOBAL_RATE_LIMIT', { infer: true }) }],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: TechnicianProfileStatusPort, useClass: NoTechnicianProfileStatus },
    // Guard order matters: rate limit, then authentication, then roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
