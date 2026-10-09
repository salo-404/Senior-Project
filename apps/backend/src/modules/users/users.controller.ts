import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { ChangeRoleDto, CreateStaffDto, ListUsersQuery, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Roles(Role.MANAGER)
  @Post()
  createStaff(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateStaffDto) {
    return this.users.createStaff(dto, actor);
  }

  @Roles(Role.MANAGER)
  @Get()
  listUsers(@Query() query: ListUsersQuery) {
    return this.users.listUsers(query);
  }

  @Roles(Role.MANAGER)
  @Patch(':id/deactivate')
  deactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.deactivateUser(id, actor);
  }

  @Roles(Role.MANAGER)
  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.users.changeRole(id, dto.role, actor);
  }
}
