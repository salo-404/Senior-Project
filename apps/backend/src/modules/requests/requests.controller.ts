import { Body, Controller, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { MAX_IMAGE_BYTES, UploadedImage } from '../../infra/storage/storage.service';
import { CreateEmergencyDto, CreateRequestDto } from './dto/requests.dto';
import { RequestsService } from './requests.service';

@Roles(Role.CUSTOMER)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /** The detailed form (NORMAL or URGENT). */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequestDto) {
    return this.requests.createManual(user, dto);
  }

  /** The simplified emergency form. */
  @Post('emergency')
  createEmergency(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmergencyDto) {
    return this.requests.createEmergency(user, dto);
  }

  /** multipart/form-data with one image in the "file" field. */
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.requests.addPhoto(user, id, file);
  }
}
