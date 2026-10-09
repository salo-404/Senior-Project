/**
 * Loads the reference data the app needs: equipment types, the skill catalogue and the
 * three commission tiers. Idempotent (upserts by name) and never overwrites values a manager changed.
 *
 *   npm run seed:reference
 *
 * Commission rates are percentages (10.00 = 10%) and are PLACEHOLDERS until the business confirms them.
 */
import 'dotenv/config';
import { CommissionTierName, MaintenanceCategory, PrismaClient } from '@prisma/client';

const TIERS = [
  { name: CommissionTierName.BRONZE, commission_rate: 15 },
  { name: CommissionTierName.SILVER, commission_rate: 12, min_rating: 4.0, min_experience_years: 3, min_completed_jobs: 30 },
  { name: CommissionTierName.GOLD, commission_rate: 10, min_rating: 4.5, min_experience_years: 5, min_completed_jobs: 100 },
];

const SKILLS = [
  { name: 'AC installation', category: MaintenanceCategory.HVAC },
  { name: 'AC repair', category: MaintenanceCategory.HVAC },
  { name: 'Refrigerant recharge', category: MaintenanceCategory.HVAC },
  { name: 'Ducting and ventilation', category: MaintenanceCategory.HVAC },
  { name: 'Refrigerator repair', category: MaintenanceCategory.HOME_APPLIANCES },
  { name: 'Washing machine repair', category: MaintenanceCategory.HOME_APPLIANCES },
  { name: 'Dishwasher repair', category: MaintenanceCategory.HOME_APPLIANCES },
];

const EQUIPMENT_TYPES = [
  { name: 'Split air conditioner', category: MaintenanceCategory.HVAC },
  { name: 'Central air conditioning', category: MaintenanceCategory.HVAC },
  { name: 'Window air conditioner', category: MaintenanceCategory.HVAC },
  { name: 'Refrigerator', category: MaintenanceCategory.HOME_APPLIANCES },
  { name: 'Washing machine', category: MaintenanceCategory.HOME_APPLIANCES },
  { name: 'Dishwasher', category: MaintenanceCategory.HOME_APPLIANCES },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // equipment_types.name is not unique, so look it up by name + category first.
    for (const t of EQUIPMENT_TYPES) {
      const found = await prisma.equipmentType.findFirst({ where: { name: t.name, category: t.category } });
      if (!found) await prisma.equipmentType.create({ data: t });
    }
    for (const t of TIERS) {
      await prisma.commissionTier.upsert({ where: { name: t.name }, update: {}, create: t });
    }
    for (const s of SKILLS) {
      await prisma.skill.upsert({ where: { name: s.name }, update: {}, create: s });
    }
    console.log(`Reference data ready: ${TIERS.length} commission tiers, ${SKILLS.length} skills, ${EQUIPMENT_TYPES.length} equipment types.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
