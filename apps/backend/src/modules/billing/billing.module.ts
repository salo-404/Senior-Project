import { Module } from '@nestjs/common';
import { CommissionTiersService } from './commission-tiers.service';

// Billing flows (invoice, payment, commission, ledger) arrive in Stage 4. For now the module exports read-only tier data.
@Module({
  providers: [CommissionTiersService],
  exports: [CommissionTiersService],
})
export class BillingModule {}
