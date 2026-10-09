import { Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceCategory } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { Db } from '../../common/db';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AddressesService } from '../addresses/addresses.service';
import { CreateEquipmentDto, ListEquipmentQuery, UpdateEquipmentDto } from './dto/equipment.dto';

const EQUIPMENT_INCLUDE = {
  equipment_type: { select: { id: true, name: true, category: true } },
  address: true,
} as const;

/** Equipment types (shared catalogue) and the equipment each customer owns. */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
  ) {}

  listTypes(category?: MaintenanceCategory) {
    return this.prisma.equipmentType.findMany({ where: { category }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async create(customerId: string, dto: CreateEquipmentDto) {
    const type = await this.prisma.equipmentType.findUnique({ where: { id: dto.equipment_type_id } });
    if (!type) throw new AppException('UNKNOWN_EQUIPMENT_TYPE', 'That equipment type does not exist', 400);
    if (dto.address_id) await this.addresses.findOwned(customerId, dto.address_id);

    return this.prisma.equipment.create({
      data: { ...dto, user_id: customerId },
      include: EQUIPMENT_INCLUDE,
    });
  }

  async list(customerId: string, query: ListEquipmentQuery) {
    const where = { user_id: customerId };
    const [rows, total] = await Promise.all([
      this.prisma.equipment.findMany({
        where,
        include: EQUIPMENT_INCLUDE,
        orderBy: { created_at: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return paginated(rows, query.page, query.pageSize, total);
  }

  async get(customerId: string, id: string) {
    return this.findOwned(customerId, id, undefined, true);
  }

  async update(customerId: string, id: string, dto: UpdateEquipmentDto) {
    await this.findOwned(customerId, id);
    if (dto.address_id) await this.addresses.findOwned(customerId, dto.address_id);
    return this.prisma.equipment.update({ where: { id }, data: dto, include: EQUIPMENT_INCLUDE });
  }

  /** The equipment must belong to the caller; anyone else gets 404 so existence is not revealed. */
  async findOwned(customerId: string, id: string, tx?: Db, withRelations = false) {
    const db = tx ?? this.prisma;
    const equipment = await db.equipment.findFirst({
      where: { id, user_id: customerId },
      ...(withRelations ? { include: EQUIPMENT_INCLUDE } : {}),
    });
    if (!equipment) throw new NotFoundException('Equipment not found');
    return equipment;
  }
}
