import { NotFoundException } from '@nestjs/common';
import { NotificationPriority, NotificationType, Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function setup() {
  const notification = {
    create: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn(),
  };
  const users = { listActiveUserIdsByRole: jest.fn() };
  const service = new NotificationsService({ notification } as never, users as never);
  return { service, notification, users };
}

describe('NotificationsService', () => {
  it('notify stores one notification with the default priority and returns its id', async () => {
    const { service, notification } = setup();
    notification.create.mockResolvedValue({ id: 'n1' });
    await expect(
      service.notify('u1', NotificationType.SYSTEM, { title: 'T', body: 'B', requestId: 'r1' }),
    ).resolves.toBe('n1');
    expect(notification.create.mock.calls[0][0].data).toMatchObject({
      user_id: 'u1',
      notification_type: NotificationType.SYSTEM,
      priority: NotificationPriority.NORMAL,
      request_id: 'r1',
    });
  });

  it('notify never throws into business code: a database failure returns null', async () => {
    const { service, notification } = setup();
    notification.create.mockRejectedValue(new Error('db down'));
    await expect(service.notify('u1', NotificationType.SYSTEM, { title: 'T', body: 'B' })).resolves.toBeNull();
  });

  it('notifyRole creates one row per active user with the role', async () => {
    const { service, notification, users } = setup();
    users.listActiveUserIdsByRole.mockResolvedValue(['d1', 'd2']);
    notification.createMany.mockResolvedValue({ count: 2 });
    await expect(
      service.notifyRole(Role.DISPATCHER, NotificationType.SAFETY_ESCALATED, {
        title: 'T',
        body: 'B',
        priority: NotificationPriority.URGENT,
      }),
    ).resolves.toBe(2);
    expect(users.listActiveUserIdsByRole).toHaveBeenCalledWith(Role.DISPATCHER);
    const rows = notification.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { user_id: string }) => r.user_id)).toEqual(['d1', 'd2']);
    expect(rows[0].priority).toBe(NotificationPriority.URGENT);
  });

  it('notifyRole returns 0 when nobody holds the role, and 0 (not an error) when storing fails', async () => {
    const { service, notification, users } = setup();
    users.listActiveUserIdsByRole.mockResolvedValue([]);
    await expect(service.notifyRole(Role.MANAGER, NotificationType.SYSTEM, { title: 'T', body: 'B' })).resolves.toBe(0);
    users.listActiveUserIdsByRole.mockResolvedValue(['m1']);
    notification.createMany.mockRejectedValue(new Error('db down'));
    await expect(service.notifyRole(Role.MANAGER, NotificationType.SYSTEM, { title: 'T', body: 'B' })).resolves.toBe(0);
  });

  it('list and unreadCount only look at the caller\'s own rows', async () => {
    const { service, notification } = setup();
    await service.list('u1', { page: 2, pageSize: 10, unread: true });
    expect(notification.findMany.mock.calls[0][0]).toMatchObject({
      where: { user_id: 'u1', is_read: false },
      skip: 10,
      take: 10,
    });
    await service.unreadCount('u1');
    expect(notification.count).toHaveBeenLastCalledWith({ where: { user_id: 'u1', is_read: false } });
  });

  it('markRead only touches the caller\'s own notification and answers 404 for anyone else\'s', async () => {
    const { service, notification } = setup();
    notification.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.markRead('u1', 'n1')).resolves.toEqual({ id: 'n1', is_read: true });
    expect(notification.updateMany.mock.calls[0][0].where).toEqual({ id: 'n1', user_id: 'u1' });

    notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.markRead('u2', 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markAllRead only updates the caller\'s unread rows', async () => {
    const { service, notification } = setup();
    notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 3 });
    expect(notification.updateMany.mock.calls[0][0].where).toEqual({ user_id: 'u1', is_read: false });
  });
});
