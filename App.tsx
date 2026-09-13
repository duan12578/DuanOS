import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { beijingDate, decodeEntries, kinds, labels, makeEntry, recognize, totals, validate } from './src/domain';
import type { Draft, Entry, Kind } from './src/domain';
import { cancel, schedule } from './src/notifications';
import { fetchCloudStatus, syncLedgerEntry, type CloudStatus } from './src/cloud';
import { pendingSyncCount, updateSync } from './src/sync';

const KEY = 'duanos:entries:v1';
const C = { bg: '#F5F6FA', ink: '#19243C', muted: '#6F788B', accent: '#5555D9', pale: '#EEEEFF', line: '#E7EAF1', green: '#247B68' };
type Icon = React.ComponentProps<typeof Ionicons>['name'];
const icons: Record<Kind, Icon> = { ledger: 'wallet-outline', todo: 'checkbox-outline', reminder: 'notifications-outline', review: 'book-outline' };
const examples: Record<Kind, string> = { ledger: '微信支付午饭 25 元', todo: '待办：明天拿快递，不需要提醒', reminder: '明天晚上8点提醒我背英语单词', review: '每日复盘：今天完成了什么，有哪些收获？' };
const cash = (cents: number) => (cents / 100).toFixed(2);
const timeLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function Button({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, secondary && s.secondary, disabled && { opacity: .45 }]}><Text style={[s.buttonText, secondary && { color: C.accent }]}>{title}</Text></Pressable>;
}
function Field({ label, value, onChange, placeholder, numeric = false, multiline = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean }) {
  return <View style={{ gap: 7 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} style={[s.input, multiline && { minHeight: 112, textAlignVertical: 'top' }]} /></View>;
}
export default function App() { return <SafeAreaProvider><DuanOS /></SafeAreaProvider>; }
function DuanOS() {
  const [tab, setTab] = useState('首页');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Kind | null>(null);
  const [cloud, setCloud] = useState<CloudStatus>({ ok: false, authenticated: false, email: null });
  useEffect(() => { AsyncStorage.getItem(KEY).then(decodeEntries).then(setEntries).then(() => setLoaded(true)).catch(() => setLoadError('无法读取本地记录。为保护数据，已暂停写入，请重启应用重试。')); }, []);
  useEffect(() => { if (Platform.OS === 'web') fetchCloudStatus().then(setCloud).catch(() => setCloud({ ok: false, authenticated: false, email: null })); }, []);
  const persist = async (next: Entry[]) => { await AsyncStorage.setItem(KEY, JSON.stringify(next)); setEntries(next); };
  const syncOne = async (entry: Entry, current = entries) => {
    if (entry.kind !== 'ledger' || entry.syncState === 'synced') return;
    const syncing = updateSync(current, entry.id, 'syncing');
    try { await persist(syncing); }
    catch { setMessage('无法保存同步状态，本地记录保持待同步，请稍后重试'); return; }
    try {
      const result = await syncLedgerEntry({ ...entry, syncState: 'syncing' });
      const state = result.receiptSent ? 'synced' as const : 'error' as const;
      await persist(updateSync(syncing, entry.id, state, result.receiptSent ? undefined : '表格已同步，回执邮件待重试'));
      setMessage(result.receiptSent ? '记账已同步，Gmail 回执已发送' : '表格已同步，Gmail 回执发送失败，可安全重试');
    } catch {
      await persist(updateSync(syncing, entry.id, 'error', '同步失败，本地记录已保留'));
      setMessage('云同步失败，本地记录已保留，可在工作台重试');
    }
  };
  const start = (kind?: Kind) => { setRaw(kind ? examples[kind] : ''); setDraft(null); setError(''); setOpen(true); };
  const close = () => { if (!lock.current) setOpen(false); };
  const save = async () => {
    if (!draft || lock.current || !loaded) return;
    const issue = validate(draft); if (issue) { setError(issue); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const entry = makeEntry(draft, Crypto.randomUUID());
      // Persist first: a killed process can leave an unscheduled record, never an invisible reminder.
      if (entry.kind === 'reminder') { entry.notificationId = entry.id; entry.notificationState = 'unavailable'; }
      const next = [entry, ...entries];
      await persist(next);
      let notice = `${labels[entry.kind]}已保存到本机`;
      let cloudAttempted = false;
      if (entry.kind === 'reminder') {
        try {
          const ok = await schedule(entry.id, entry.text, entry.dueAt!);
          if (ok) {
            try { await persist(next.map(e => e.id === entry.id ? { ...e, notificationState: 'scheduled' as const } : e)); notice += '，通知已安排'; }
            catch { await cancel(entry.id); notice += '，通知状态保存失败，请重试通知'; }
          } else notice += '；通知未开启或当前平台不支持，请在工作台重试通知';
        } catch { notice += '；通知安排失败，请在工作台重试通知'; }
      }
      if (entry.kind === 'ledger' && cloud.ok && cloud.authenticated) {
        cloudAttempted = true;
        await syncOne(entry, next);
      }
      if (!cloudAttempted) setMessage(notice);
      setOpen(false); setDraft(null); setRaw('');
    } catch { setError('保存失败，内容仍保留在这里，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const mutate = async (entry: Entry, action: 'delete' | 'complete' | 'retry') => {
    if (lock.current || !loaded) return;
    lock.current = true; setBusy(true);
    try {
      if (action === 'retry') {
        if (!entry.dueAt || new Date(entry.dueAt).getTime() <= Date.now()) { setMessage('提醒已到期，请重新创建未来时间的提醒。'); return; }
        const ok = await schedule(entry.id, entry.text, entry.dueAt);
        if (!ok) { setMessage('通知未开启。请到手机设置允许 DuanOS 通知；网页版仅保存记录。'); return; }
        try { await persist(entries.map(e => e.id === entry.id ? { ...e, notificationState: 'scheduled' as const } : e)); }
        catch (failure) { await cancel(entry.id); throw failure; }
        setMessage('通知已安排'); return;
      }
      if (entry.kind === 'reminder') await cancel(entry.notificationId || entry.id);
      await persist(action === 'delete' ? entries.filter(e => e.id !== entry.id) : entries.map(e => e.id === entry.id ? { ...e, done: !e.done, ...(e.kind === 'reminder' ? { notificationState: 'cancelled' as const } : {}) } : e));
      setMessage(action === 'delete' ? '记录已删除' : '状态已更新');
    } catch { setMessage('操作未完成，请重试。若通知已取消，请使用“重试通知”重新安排。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const remove = (e: Entry) => {
    if (Platform.OS === 'web') { if (window.confirm('确定删除这条记录？')) void mutate(e, 'delete'); }
    else Alert.alert('删除记录', '删除后无法撤销。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void mutate(e, 'delete') }]);
  };
  const today = beijingDate(); const summary = totals(entries, today); const all = totals(entries);
  const pending = entries.filter(e => (e.kind === 'todo' || e.kind === 'reminder') && !e.done);
  const unsynced = pendingSyncCount(entries);
  const cloudLabel = unsynced ? `${unsynced} 条待同步` : cloud.ok && cloud.authenticated ? '云端已连接' : '本地模式';
  const patch = (value: Partial<Draft>) => setDraft(d => d ? { ...d, ...value } : d);
  const renderEntry = (e: Entry) => <View key={e.id} style={s.entry}>
    <View style={[s.iconBox, { backgroundColor: e.kind === 'review' ? '#FFF3E6' : C.pale }]}><Ionicons name={icons[e.kind]} size={22} color={C.accent} /></View>
    <View style={{ flex: 1, gap: 6 }}><Text style={[s.body, e.done && { textDecorationLine: 'line-through', color: C.muted }]}>{e.text}</Text><Text style={s.caption}>{labels[e.kind]} · {e.date}{e.account ? ` · ${e.account}` : ''}</Text>
      {e.kind === 'reminder' && <Text style={s.caption}>{timeLabel(e.dueAt!)} 北京时间 · {e.done ? '已完成' : e.notificationState === 'scheduled' ? '已安排通知' : '通知未安排'}</Text>}
      {e.kind === 'ledger' && <Text style={s.caption}>{e.syncState === 'synced' ? '已同步到 Google Sheets' : e.syncState === 'syncing' ? '正在同步' : e.syncState === 'error' ? `同步失败${e.syncError ? ` · ${e.syncError}` : ''}` : '待同步'}</Text>}
      <View style={s.row}>{(e.kind === 'todo' || e.kind === 'reminder') && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void mutate(e, 'complete')} style={s.smallAction}><Text style={s.link}>{e.done ? '恢复待办' : '标记完成'}</Text></Pressable>}
      {e.kind === 'reminder' && !e.done && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void mutate(e, 'retry')} style={s.smallAction}><Text style={s.link}>重试通知</Text></Pressable>}
      {e.kind === 'ledger' && e.syncState !== 'synced' && cloud.authenticated && <Pressable accessibilityRole="button" disabled={busy || e.syncState === 'syncing'} onPress={() => void syncOne(e)} style={s.smallAction}><Text style={s.link}>重试同步</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={`删除记录：${e.text}`} disabled={busy} onPress={() => remove(e)} style={s.smallAction}><Text style={s.caption}>删除</Text></Pressable></View>
    </View>{e.kind === 'ledger' && <Text style={[s.money, e.direction === 'income' && { color: C.green }]}>{e.direction === 'income' ? '+' : '−'}{cash(e.amountCents!)}</Text>}
  </View>;
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <View style={s.top}><View style={s.row}><View style={s.logo}><Text style={s.logoText}>D</Text></View><Text style={s.brand}>DuanOS</Text></View><View style={s.badge}><View style={s.dot} /><Text style={s.caption}>{cloudLabel}</Text></View></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>PERSONAL WORKSPACE / V0.2.0</Text>
      <Text style={s.title}>{tab === '首页' ? '让生活，有条理。' : tab === '工作台' ? '把想法，变成行动。' : tab === 'AI' ? '一句话，开始整理。' : '每一步，都有记录。'}</Text>
      <Text style={s.subtitle}>{tab === '首页' ? `${today} · 只专注当下重要的事` : tab === '工作台' ? '记账、待办、提醒与复盘，集中管理' : tab === 'AI' ? '本地意图识别已就绪，无需 API Key' : '来自你的真实记录，不预填示例数据'}</Text>
      {(message || loadError) ? <Pressable accessibilityRole="button" onPress={() => setMessage('')} style={s.notice}><Text accessibilityLiveRegion="polite" style={s.body}>{loadError || message}</Text></Pressable> : null}
      {!loaded && !loadError && <ActivityIndicator color={C.accent} />}
      {tab === '首页' && <>
        <View style={s.hero}><View style={s.rowBetween}><Text style={s.heroLabel}>今日概览</Text><Ionicons name="sunny-outline" color="#CBCBFF" size={25} /></View><Text style={s.heroNumber}>{pending.length}<Text style={{ fontSize: 17 }}> 件待完成</Text></Text><Text style={s.heroHint}>从一件小事开始，让今天向前一步。</Text><View style={s.heroDivider} /><View style={s.rowBetween}><View><Text style={s.heroLabel}>今日支出</Text><Text style={s.heroAmount}>¥ {cash(summary.expense)}</Text></View><View><Text style={s.heroLabel}>今日复盘</Text><Text style={s.heroAmount}>{entries.some(e => e.kind === 'review' && e.date === today) ? '已记录' : '待记录'}</Text></View></View></View>
        <View style={s.rowBetween}><Text style={s.sectionTitle}>快捷开始</Text><Text style={s.caption}>随手记，不遗漏</Text></View>
        <View style={s.grid}>{kinds.map(k => <Pressable key={k} accessibilityRole="button" disabled={!loaded} onPress={() => start(k)} style={s.quick}><Ionicons name={icons[k]} color={C.accent} size={24} /><Text style={s.body}>{labels[k]}</Text><Ionicons name="arrow-forward" color={C.muted} size={17} /></Pressable>)}</View>
        <View style={s.rowBetween}><Text style={s.sectionTitle}>接下来</Text><Pressable accessibilityRole="button" onPress={() => setTab('工作台')}><Text style={s.link}>查看全部 →</Text></Pressable></View>
        <View style={s.card}>{pending.length ? pending.slice(0, 3).map(renderEntry) : <View style={s.empty}><Ionicons name="leaf-outline" size={30} color={C.green} /><Text style={s.body}>留一点空间，给重要的事</Text><Text style={s.caption}>点击下方 +，记录第一个待办</Text></View>}</View>
      </>}
      {tab === '工作台' && <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>{[null, ...kinds].map(k => <Pressable accessibilityRole="button" accessibilityState={{ selected: filter === k }} key={k ?? 'all'} onPress={() => setFilter(k)} style={[s.chip, filter === k && s.chipActive]}><Text style={{ color: filter === k ? '#FFF' : C.muted }}>{k ? labels[k] : '全部'}</Text></Pressable>)}</ScrollView>
        <View style={s.card}>{entries.filter(e => !filter || e.kind === filter).length ? entries.filter(e => !filter || e.kind === filter).map(renderEntry) : <View style={s.empty}><Text style={s.body}>这里还没有记录</Text><Text style={s.caption}>你的下一步，从 + 开始</Text><Button title="添加记录" onPress={() => start(filter ?? undefined)} disabled={!loaded} /></View>}</View>
      </>}
      {tab === 'AI' && <>
        <View style={[s.card, s.aiCard]}><View style={[s.iconBox, { width: 62, height: 62 }]}><Ionicons name="sparkles-outline" size={30} color={C.accent} /></View><Text style={s.sectionTitle}>你的统一输入助手</Text><Text style={[s.subtitle, { textAlign: 'center' }]}>输入一句话，识别后核对保存。\n可使用 iPhone 键盘自带的语音听写。</Text><Button title="输入一条记录" onPress={() => start()} disabled={!loaded} /></View>
        <Text style={s.sectionTitle}>试着这样说</Text>{kinds.map(k => <Pressable accessibilityRole="button" disabled={!loaded} key={k} onPress={() => start(k)} style={s.example}><Ionicons name={icons[k]} size={21} color={C.accent} /><View style={{ flex: 1, gap: 5 }}><Text style={s.label}>{labels[k]}</Text><Text style={s.body}>{examples[k]}</Text></View><Ionicons name="arrow-up-outline" size={19} color={C.muted} /></Pressable>)}
        <View style={s.notice}><Text style={s.label}>Google 连接</Text><Text style={s.subtitle}>{cloud.authenticated ? `已授权 ${cloud.email ?? '当前账户'}，记账可同步到 Google Sheets 并发送 Gmail 回执。` : '当前使用本地规则识别。未连接时仍可正常本地使用；连接后只同步记账，其他记录保持本地。'}</Text>{Platform.OS === 'web' && !cloud.authenticated && <Button title="连接 Google" onPress={() => { window.location.href = '/api/auth/login'; }} />}</View>
      </>}
      {tab === '数据' && <>
        <View style={s.stats}><View style={[s.card, s.stat]}><Text style={s.caption}>累计支出</Text><Text style={s.statNumber}>¥{cash(all.expense)}</Text></View><View style={[s.card, s.stat]}><Text style={s.caption}>累计收入</Text><Text style={[s.statNumber, { color: C.green }]}>¥{cash(all.income)}</Text></View></View>
        <View style={[s.card, { padding: 22, gap: 20 }]}><Text style={s.sectionTitle}>记录分布</Text>{kinds.map(k => { const count = entries.filter(e => e.kind === k).length; return <View key={k} style={{ gap: 9 }}><View style={s.rowBetween}><Text style={s.body}>{labels[k]}</Text><Text style={s.caption}>{count} 条</Text></View><View style={s.track}><View style={[s.fill, { width: `${entries.length ? count / entries.length * 100 : 0}%` }]} /></View></View>; })}</View>
        <View style={[s.card, { padding: 22, gap: 14 }]}><Text style={s.sectionTitle}>数据与隐私</Text><Text style={s.subtitle}>所有记录先保存在当前设备。连接 Google 后，只有记账会同步到指定表格；网络失败不会删除本地记录。</Text><Text style={s.caption}>金额汇总基于本地流水，不代表银行账户余额。</Text><Text style={s.caption}>DuanOS v0.2.0 · Asia/Shanghai</Text></View>
      </>}
      <Text style={s.footer}>少一点切换，多一点专注。</Text>
    </ScrollView>
    <View style={s.nav}>{(['首页', '工作台', '+', 'AI', '数据'] as const).map((name, i) => name === '+' ? <Pressable key={name} accessibilityRole="button" accessibilityLabel="统一输入入口" disabled={!loaded || busy} onPress={() => start()} style={[s.plus, !loaded && { opacity: .4 }]}><Ionicons name="add" size={31} color="white" /></Pressable> : <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={s.navItem}><Ionicons name={(['home-outline', 'grid-outline', 'add', 'sparkles-outline', 'bar-chart-outline'] as Icon[])[i]} size={22} color={tab === name ? C.accent : C.muted} /><Text style={[s.navText, tab === name && { color: C.accent }]}>{name}</Text></Pressable>)}</View>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={s.safe}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.top}><Text style={s.sectionTitle}>{draft ? '核对这条记录' : '随手记一笔'}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭输入" disabled={busy} onPress={close} style={s.smallAction}><Ionicons name="close" size={25} color={C.ink} /></Pressable></View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!draft ? <><Text style={s.subtitle}>一次记录一件事。支持记账、待办、定时提醒和每日复盘。</Text><Field label="输入内容" value={raw} onChange={setRaw} multiline placeholder="例如：微信支付午饭25元" /><Button title="识别内容" disabled={!raw.trim()} onPress={() => { setDraft(recognize(raw)); setError(''); }} /></> : <>
          <Text style={s.subtitle}>{draft.kind ? '已识别类型，可调整后保存。' : '暂未确定类型，请手动选择。'}</Text><View style={s.grid}>{kinds.map(k => <Pressable accessibilityRole="button" accessibilityState={{ selected: draft.kind === k }} key={k} onPress={() => patch({ kind: k })} style={[s.chip, draft.kind === k && s.chipActive]}><Text style={{ color: draft.kind === k ? '#FFF' : C.muted }}>{labels[k]}</Text></Pressable>)}</View>
          <Field label="记录内容" value={draft.text} onChange={text => patch({ text })} multiline /><Field label="记录日期（北京时间）" value={draft.date} onChange={date => patch({ date })} placeholder="YYYY-MM-DD" />
          {draft.kind === 'ledger' && <><View style={s.row}>{(['expense', 'income'] as const).map(direction => <Pressable accessibilityRole="button" key={direction} onPress={() => patch({ direction })} style={[s.chip, draft.direction === direction && s.chipActive]}><Text style={{ color: draft.direction === direction ? '#FFF' : C.muted }}>{direction === 'expense' ? '支出' : '收入'}</Text></Pressable>)}</View><Field label="金额（元）" value={draft.amount} onChange={amount => patch({ amount })} numeric /><Field label="账户" value={draft.account} onChange={account => patch({ account })} placeholder="例如：工资卡、微信零钱" /></>}
          {draft.kind === 'reminder' && <><Field label="提醒时间（北京时间）" value={draft.time} onChange={time => patch({ time })} placeholder="YYYY-MM-DD HH:mm" /><Text style={s.caption}>单次本机通知，首次保存时申请系统通知权限。</Text></>}
          {draft.kind === 'todo' && <Text style={s.caption}>只保存待办，不申请通知权限。</Text>}
          {error ? <Text accessibilityLiveRegion="assertive" style={{ color: '#AB3647' }}>{error}</Text> : null}
          <Button title={busy ? '正在保存…' : '确认保存'} onPress={() => void save()} disabled={busy || !draft.kind} /><Button title="返回修改输入" secondary disabled={busy} onPress={() => { setDraft(null); setError(''); }} />
        </>}
      </ScrollView></KeyboardAvoidingView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, top: { paddingHorizontal: 24, paddingVertical: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, logo: { backgroundColor: C.ink, width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, logoText: { color: '#FFF', fontSize: 20, fontWeight: '800' }, brand: { fontSize: 19, fontWeight: '800', letterSpacing: -.5, color: C.ink }, badge: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: C.green }, content: { padding: 24, paddingTop: 14, gap: 20, maxWidth: 760, width: '100%', alignSelf: 'center' }, eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '600', color: C.muted }, title: { color: C.ink, fontSize: 29, fontWeight: '800', letterSpacing: -1, marginBottom: -9 }, subtitle: { fontSize: 14, lineHeight: 23, color: C.muted }, hero: { backgroundColor: '#252746', padding: 25, borderRadius: 25, gap: 15 }, heroLabel: { color: '#C8C9E0', fontSize: 13 }, heroNumber: { color: '#FFF', fontSize: 45, fontWeight: '700', letterSpacing: -1 }, heroHint: { color: '#BABCD6', fontSize: 12 }, heroDivider: { height: 1, backgroundColor: '#41435F', marginVertical: 3 }, heroAmount: { color: '#FFF', fontSize: 21, fontWeight: '600', marginTop: 9 }, sectionTitle: { fontSize: 18, fontWeight: '700', color: C.ink }, caption: { fontSize: 12, lineHeight: 18, color: C.muted }, label: { color: C.ink, fontSize: 13, fontWeight: '600' }, body: { color: C.ink, fontSize: 14, lineHeight: 22 }, link: { color: C.accent, fontSize: 12, fontWeight: '600' }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, quick: { width: '48%', flexGrow: 1, backgroundColor: '#FFF', padding: 17, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }, card: { backgroundColor: '#FFF', borderRadius: 22, overflow: 'hidden' }, empty: { padding: 28, alignItems: 'center', gap: 14 }, entry: { flexDirection: 'row', padding: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, gap: 12, alignItems: 'flex-start' }, iconBox: { backgroundColor: C.pale, width: 42, height: 42, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, money: { color: C.ink, fontSize: 15, fontWeight: '600', marginTop: 3 }, smallAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, chip: { paddingHorizontal: 17, paddingVertical: 13, borderRadius: 14, backgroundColor: '#EDEFF5' }, chipActive: { backgroundColor: C.accent }, button: { backgroundColor: C.accent, minHeight: 49, paddingHorizontal: 23, borderRadius: 15, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: C.pale }, buttonText: { color: '#FFF', fontSize: 15, fontWeight: '600' }, input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, fontSize: 16, color: C.ink }, notice: { backgroundColor: C.pale, borderRadius: 17, padding: 17, gap: 9 }, aiCard: { padding: 27, alignItems: 'center', gap: 18 }, example: { backgroundColor: '#FFF', borderRadius: 18, padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' }, stats: { flexDirection: 'row', gap: 12 }, stat: { flex: 1, padding: 18, gap: 12 }, statNumber: { fontSize: 23, fontWeight: '700', color: C.ink }, track: { height: 7, borderRadius: 5, backgroundColor: '#F0F1F7', overflow: 'hidden' }, fill: { height: 7, backgroundColor: '#8886E9', borderRadius: 5 }, footer: { color: '#9299A8', textAlign: 'center', fontSize: 11, paddingVertical: 9 }, nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 10, paddingBottom: 7, backgroundColor: '#FFF', borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line }, navItem: { alignItems: 'center', gap: 5, flex: 1, paddingVertical: 5 }, navText: { color: C.muted, fontSize: 10 }, plus: { backgroundColor: C.accent, width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginHorizontal: 12 }
});
