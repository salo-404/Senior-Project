import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { TechniciansController } from './technicians.controller';
import { TechnicianProfileStatusProvider, TechniciansService } from './technicians.service';

// Must not import AuthModule: AuthModule imports this module (status port and the signup route).
@Module({
  imports: [AuditModule],
  controllers: [TechniciansController],
  providers: [TechniciansService, TechnicianProfileStatusProvider],
  exports: [TechniciansService, TechnicianProfileStatusProvider],
})
export class TechniciansModule {}
