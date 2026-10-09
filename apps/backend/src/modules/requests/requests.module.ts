import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { NotificationsModule } from '../../infra/notifications/notifications.module';
import { SafetyModule } from '../../infra/safety/safety.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { AddressesModule } from '../addresses/addresses.module';
import { CasesModule } from '../cases/cases.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { UsersModule } from '../users/users.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [AuditModule, NotificationsModule, SafetyModule, StorageModule, UsersModule, AddressesModule, EquipmentModule, CasesModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
