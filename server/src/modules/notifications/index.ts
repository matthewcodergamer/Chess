import { handleNotificationRequest } from '../../notifications';
import { handleWebPushRequest } from '../../webPush';
import { CanonicalNotificationRegistry as NotificationRegistry } from '../../data/notificationProjection';
import type { DataModelEnv } from '../../data/registry';
import { moduleDescriptor } from '../contracts';

type InAppEnv = Parameters<typeof handleNotificationRequest>[1];
type WebPushEnv = Parameters<typeof handleWebPushRequest>[1];

export { NotificationRegistry };
export type NotificationsModuleEnv = InAppEnv & WebPushEnv & DataModelEnv;

export const notificationsModule = moduleDescriptor('notifications', [
  'persistent in-app inbox',
  'read/unread and notification preferences',
  'web-push subscriptions and delivery',
  'security and payout notification delivery',
], ['auth']);

export async function handleNotificationsRequest(request: Request, env: NotificationsModuleEnv): Promise<Response | null> {
  const push = await handleWebPushRequest(request, env);
  if (push) return push;
  return handleNotificationRequest(request, env);
}
