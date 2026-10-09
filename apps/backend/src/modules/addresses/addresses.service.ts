import { Injectable, NotFoundException } from '@nestjs/common';
import { AppException } from '../../common/app.exception';
import { Db } from '../../common/db';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/addresses.dto';

/** A customer's saved addresses. Exactly one is the default once any exist. */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(customerId: string) {
    return this.prisma.address.findMany({
      where: { user_id: customerId },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });
  }

  async create(customerId: string, dto: CreateAddressDto) {
    return this.prisma.runInTransaction(async (tx) => {
      const existing = await tx.address.count({ where: { user_id: customerId } });
      const makeDefault = existing === 0 || dto.is_default === true;
      if (makeDefault) await tx.address.updateMany({ where: { user_id: customerId, is_default: true }, data: { is_default: false } });
      const { is_default: _ignored, ...fields } = dto;
      return tx.address.create({ data: { ...fields, user_id: customerId, is_default: makeDefault } });
    });
  }

  async update(customerId: string, id: string, dto: UpdateAddressDto) {
    if (dto.is_default === false) {
      throw new AppException('DEFAULT_REQUIRED', 'Choose another address as the default instead', 400);
    }
    return this.prisma.runInTransaction(async (tx) => {
      await this.findOwned(customerId, id, tx);
      if (dto.is_default === true) {
        await tx.address.updateMany({ where: { user_id: customerId, is_default: true }, data: { is_default: false } });
      }
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  /** The address must belong to the caller; anyone else gets 404 so existence is not revealed. */
  async findOwned(customerId: string, id: string, tx?: Db) {
    const db = tx ?? this.prisma;
    const address = await db.address.findFirst({ where: { id, user_id: customerId } });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  async findDefault(customerId: string, tx?: Db) {
    const db = tx ?? this.prisma;
    return db.address.findFirst({ where: { user_id: customerId, is_default: true } });
  }
}
