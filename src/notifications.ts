import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

if (Platform.OS !== 'web') Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
export async function schedule(id: string, text: string, dueAt: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', { name: 'DuanOS 提醒', importance: Notifications.AndroidImportance.HIGH });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;
  await Notifications.scheduleNotificationAsync({ identifier: id, content: { title: 'DuanOS · 提醒', body: text, sound: 'default' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(dueAt), channelId: 'reminders' } });
  return true;
}
export async function cancel(id: string) { if (Platform.OS !== 'web') await Notifications.cancelScheduledNotificationAsync(id); }
