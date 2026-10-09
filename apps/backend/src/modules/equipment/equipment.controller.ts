import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { CreateEquipmentDto, ListEquipmentQuery, ListEquipmentTypesQuery, UpdateEquipmentDto } from './dto/equipment.dto';
import { EquipmentService } from './equipment.service';

@Controller()
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  /** The catalogue the equipment form picks from. Any signed-in user can read it. */
  @Get('equipment-types')
  listTypes(@Query() query: ListEquipmentTypesQuery) {
    return this.equipment.listTypes(query.category);
  }

  @Roles(Role.CUSTOMER)
  @Post('equipment')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEquipmentDto) {
    return this.equipment.create(user.id, dto);
  }

  @Roles(Role.CUSTOMER)
  @Get('equipment')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEquipmentQuery) {
    return this.equipment.list(user.id, query);
  }

  @Roles(Role.CUSTOMER)
  @Get('equipment/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.get(user.id, id);
  }

  @Roles(Role.CUSTOMER)
  @Patch('equipment/:id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEquipmentDto) {
    return this.equipment.update(user.id, id, dto);
  }
}
