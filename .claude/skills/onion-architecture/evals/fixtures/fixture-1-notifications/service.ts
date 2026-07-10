import { Container } from '../../platform/container';

export class NotificationsService {
  constructor(private container: Container) {}

  async listForUser(workspaceId: string, userId: string, unreadOnly?: boolean) {
    const items = await this.container.notificationsRepo.listByWorkspace(workspaceId);
    const user = await this.container.usersRepo.findById(userId);
    const visible = user.role === 'admin'
      ? items
      : items.filter((item) => item.visibility !== 'internal');
    return unreadOnly ? visible.filter((item) => !item.readAt) : visible;
  }

  async markRead(workspaceId: string, notificationId: string) {
    await this.container.notificationsRepo.markRead(workspaceId, notificationId);
  }
}
