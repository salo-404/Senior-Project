import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { StorageService } from './storage.service';

/** Upload routes are mounted by the owning modules (for example POST /requests/:id/photos). */
@Controller('attachments')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get(':id/url')
  getUrl(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.storage.getSignedUrl(id, user);
  }
}
