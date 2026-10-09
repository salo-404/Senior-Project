import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationPriority, NotificationType, Prisma, Role } from '@prisma/client';
import { Paginated, paginated, skipTake } from '../../common/pagination';
import { UsersService } from '../../modules/users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsQuery } from './dto/notifications.dto';

export interface NotifyOptions {
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  requestId?: string;
  priority?: NotificationPriority;
}

/**
 * Call notify() AFTER the business transaction commits, so a failed notification can never roll back
 * business data. Sending therefore never throws: a failure is logged and reported through the return value.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Creates one notification. Returns its id, or null when it could not be stored. */
  async notify(userId: string, type: NotificationType, options: NotifyOptions): Promise<string | null> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          user_id: userId,
          notification_type: type,
          priority: options.priority ?? NotificationPriority.NORMAL,
          title: options.title,
          body: options.body,
          data: options.data,
          request_id: options.requestId,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.logger.error(`Could not create notification for user ${userId}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Notifies every active user with the role (for example all dispatchers). Returns how many were stored. */
  async notifyRole(role: Role, type: NotificationType, options: NotifyOptions): Promise<number> {
    try {
      const userIds = await this.users.listActiveUserIdsByRole(role);
      if (userIds.length === 0) return 0;
      const result = await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          user_id: userId,
          notification_type: type,
          priority: options.priority ?? NotificationPriority.NORMAL,
          title: options.title,
          body: options.body,
          data: options.data,
          request_id: options.requestId,
        })),
      });
      return result.count;
    } catch (err) {
      this.logger.error(`Could not notify role ${role}: ${(err as Error).message}`);
      return 0;
    }
  }

  async list(userId: string, query: ListNotificationsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.NotificationWhereInput = {
      user_id: userId,
      ...(query.unread ? { is_read: false } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(rows, query.page, query.pageSize, total);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { user_id: userId, is_read: false } });
    return { count };
  }

  /** A notification that belongs to someone else is reported as 404, never 403. */
  async markRead(userId: string, notificationId: string): Promise<{ id: string; is_read: true }> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, user_id: userId },
      data: { is_read: true, read_at: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Notification not found');
    return { id: notificationId, is_read: true };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });
    return { updated: result.count };
  }
}
