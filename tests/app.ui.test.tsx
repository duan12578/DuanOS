import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { cancel, schedule } from '../src/notifications';

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, authenticated: false }) })) as jest.Mock; });
async function openInput(text: string) {
  await waitFor(() => expect(screen.getByLabelText('统一输入入口')).not.toBeDisabled());
  fireEvent.press(screen.getByLabelText('统一输入入口'));
  fireEvent.changeText(screen.getByLabelText('输入内容'), text);
  fireEvent.press(screen.getByText('识别内容'));
  await screen.findByText('核对这条记录');
}
test('ledger saves only after confirmation, updates totals and survives remount', async () => {
  const app = render(<App />);
  await openInput('微信支付午饭25元');
  expect(screen.getByLabelText('金额（元）').props.value).toBe('25');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('记账已保存到本机');
  fireEvent.press(screen.getByRole('tab', { name: '数据' }));
  expect(screen.getByText('¥25.00')).toBeTruthy();
  app.unmount(); render(<App />);
  await waitFor(() => expect(screen.getByLabelText('统一输入入口')).not.toBeDisabled());
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  expect(screen.getByText('微信支付午饭25元')).toBeTruthy();
});
test('transfer review shows both accounts and history uses a neutral amount', async () => {
  render(<App />);
  await openInput('工资卡转入微信钱包10元');
  expect(screen.getByLabelText('金额（元）').props.value).toBe('10');
  expect(screen.getByLabelText('转出账户').props.value).toBe('工资卡');
  expect(screen.getByLabelText('转入账户').props.value).toBe('微信零钱');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('记账已保存到本机');
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  expect(screen.getByText(/记账 · .* · 工资卡 → 微信零钱/)).toBeTruthy();
  expect(screen.getByText('↔ ¥10.00')).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: '数据' }));
  expect(screen.getAllByText('¥0.00')).toHaveLength(2);
});
test('todo completion works without requesting notification permissions', async () => {
  render(<App />); await openInput('待办：背单词，不需要提醒');
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('待办已保存到本机');
  expect(schedule).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  fireEvent.press(screen.getByText('标记完成'));
  await screen.findByText('恢复待办');
  const raw = await AsyncStorage.getItem('duanos:entries:v1');
  expect(JSON.parse(raw!)[0].done).toBe(true);
});
test('reminder denial is explicit and does not lose the record', async () => {
  render(<App />); await openInput('2099-09-13 20:00提醒我读书');
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText(/通知未开启或当前平台不支持/);
  expect(schedule).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  expect(screen.getByText(/通知未安排/)).toBeTruthy();
  expect(screen.getByText('重试通知')).toBeTruthy();
});
test('review saves and AI page truthfully shows disconnected providers', async () => {
  render(<App />); await openInput('每日复盘：今天读完一章书');
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('每日复盘已保存到本机');
  fireEvent.press(screen.getByRole('tab', { name: 'AI' }));
  expect(screen.getByText(/当前使用本地模式/)).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  fireEvent.press(screen.getByText('每日复盘', { exact: true }));
  expect(screen.getByText('每日复盘：今天读完一章书')).toBeTruthy();
});
test('owner login changes cloud status without exposing a bridge secret', async () => {
  const originalOS = Platform.OS; Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  let healthCalls = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/health') { healthCalls++; return { ok: true, json: async () => ({ ok: true, authenticated: healthCalls > 1 }) }; }
    return { ok: true, json: async () => ({ ok: true, authenticated: true }) };
  }) as jest.Mock;
  try {
    render(<App />); fireEvent.press(screen.getByRole('tab', { name: 'AI' }));
    await screen.findByLabelText('Owner 登录口令'); fireEvent.changeText(screen.getByLabelText('Owner 登录口令'), 'private-passphrase'); fireEvent.press(screen.getByText('登录并启用云同步'));
    await screen.findByText('Owner Session 已登录。记账可经私有 Apps Script 桥接同步到 Google Sheets 并发送 Gmail 回执。');
    expect(screen.queryByText(/APPS_SCRIPT_SHARED_SECRET/)).toBeNull();
  } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }); }
});
test('invalid money blocks persistence and keeps the draft', async () => {
  render(<App />); await openInput('微信支付12.345元');
  fireEvent.press(screen.getByText('确认保存'));
  expect(screen.getByText(/请输入大于 0/)).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(screen.getByLabelText('金额（元）').props.value).toBe('12.345');
});
test('failed storage keeps input and offers retry', async () => {
  render(<App />); await openInput('待办：阅读');
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('保存失败，内容仍保留在这里，请重试。');
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('待办已保存到本机');
});
test('scheduled reminder uses one identifier and completion cancels it', async () => {
  jest.mocked(schedule).mockResolvedValueOnce(true);
  render(<App />); await openInput('2099-09-13 20:00提醒我读书');
  fireEvent.press(screen.getByText('确认保存'));
  await screen.findByText('定时提醒已保存到本机，通知已安排');
  const entry = JSON.parse((await AsyncStorage.getItem('duanos:entries:v1'))!)[0];
  expect(entry.notificationId).toBe(entry.id);
  expect(entry.notificationState).toBe('scheduled');
  fireEvent.press(screen.getByRole('tab', { name: '工作台' }));
  fireEvent.press(screen.getByText('标记完成'));
  await screen.findByText('恢复待办');
  expect(cancel).toHaveBeenCalledWith(entry.id);
});
test('corrupt stored data keeps the input entry disabled', async () => {
  await AsyncStorage.setItem('duanos:entries:v1', '{broken');
  jest.clearAllMocks(); render(<App />);
  await screen.findByText(/无法读取本地记录/);
  expect(screen.getByLabelText('统一输入入口')).toBeDisabled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
