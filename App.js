import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Image, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

// ============ デザイントークン（Web版と統一） ============
const colors = {
  ink: '#16232E', inkSoft: '#2C3D4C', paper: '#EDEAE2', paperCard: '#F7F4EC',
  hanko: '#B23A2E', moss: '#5F7052', text: '#302B24', textDim: '#6B6558', line: '#D8D2C2',
};
const CATEGORIES = ['家電', '家具', 'スマホ・PC', '時計・アクセサリー', 'その他'];
const WARRANTY_TYPES = ['メーカー保証', '延長保証', '両方'];
const STORAGE_KEY = 'warranty_items_v1';

// ============ ユーティリティ ============
function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function warrantyEndDate(purchaseDateStr, months) {
  const d = new Date(purchaseDateStr);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
function yen(n) { return n ? Number(n).toLocaleString('ja-JP') + '円' : ''; }
function normalize(it) {
  return {
    id: it.id, name: it.name || '', category: it.category || 'その他',
    maker: it.maker || '', model: it.model || '', warrantyType: it.warrantyType || 'メーカー保証',
    purchaseDate: it.purchaseDate || '', warrantyMonths: it.warrantyMonths || '',
    warrantyEnd: it.warrantyEnd || '', price: it.price || '', store: it.store || '',
    memo: it.memo || '', photoWarranty: it.photoWarranty || null, photoReceipt: it.photoReceipt || null,
    repairHistory: it.repairHistory || [],
  };
}

// ============ 共通パーツ ============
function ChipSelector({ options, value, onChange, includeAll, allLabel = 'すべて' }) {
  const items = includeAll ? [null, ...options] : options;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      {items.map((opt, i) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={i}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt === null ? allLabel : opt}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function ItemCard({ item, onPress }) {
  const d = daysUntil(item.warrantyEnd);
  let stampStyle = styles.stampOk, stampNum = d, stampUnit = '残り日数';
  if (d === null) { stampNum = '-'; stampUnit = ''; }
  else if (d < 0) { stampStyle = styles.stampExpired; stampNum = '期限切れ'; stampUnit = ''; }
  else if (d <= 30) { stampStyle = styles.stampWarn; }
  const makerModel = [item.maker, item.model].filter(Boolean).join(' / ');

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {item.photoWarranty ? (
        <Image source={{ uri: item.photoWarranty }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}><Text style={{ fontSize: 18 }}>📄</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.meta}>{makerModel ? makerModel + ' ・ ' : ''}期限 {fmtDate(item.warrantyEnd)}</Text>
        <View style={styles.tags}>
          <View style={styles.tag}><Text style={styles.tagText}>{item.category}</Text></View>
          {item.warrantyType !== 'メーカー保証' && (
            <View style={[styles.tag, { borderColor: colors.hanko }]}><Text style={[styles.tagText, { color: colors.hanko }]}>{item.warrantyType}</Text></View>
          )}
          {item.repairHistory?.length > 0 && (
            <View style={styles.tag}><Text style={styles.tagText}>修理歴 {item.repairHistory.length}件</Text></View>
          )}
        </View>
      </View>
      <View style={[styles.stamp, stampStyle]}>
        <Text style={[styles.stampNum, stampStyle === styles.stampExpired && { fontSize: 11 }]}>{stampNum}</Text>
        {!!stampUnit && <Text style={styles.stampUnit}>{stampUnit}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ============ 一覧画面 ============
function ListScreen({ items, onOpenItem, onOpenAdd }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => {
        const matchesQuery = !q || [it.name, it.maker, it.model].join(' ').toLowerCase().includes(q);
        const matchesCat = !category || it.category === category;
        return matchesQuery && matchesCat;
      })
      .sort((a, b) => new Date(a.warrantyEnd) - new Date(b.warrantyEnd));
  }, [items, query, category]);

  const soon = useMemo(() => items
    .filter((it) => { const d = daysUntil(it.warrantyEnd); return d !== null && d >= 0 && d <= 30; })
    .sort((a, b) => daysUntil(a.warrantyEnd) - daysUntil(b.warrantyEnd)), [items]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>WARRANTY VAULT</Text>
        <Text style={styles.title}>保証帳</Text>
        <Text style={styles.subtitle}>保証書・取扱説明書を、必要になったその日まで。</Text>
      </View>

      {soon.length > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            <Text style={{ fontWeight: '700' }}>{soon[0].name}</Text> の保証があと{daysUntil(soon[0].warrantyEnd)}日で切れます
            {soon.length > 1 ? `　他${soon.length - 1}件` : ''}
          </Text>
        </View>
      )}

      <View style={styles.controls}>
        <TextInput style={styles.search} placeholder="商品名・メーカー・型番で検索" placeholderTextColor={colors.textDim} value={query} onChangeText={setQuery} />
      </View>
      <View style={styles.chipsWrap}>
        <ChipSelector options={CATEGORIES} value={category} onChange={setCategory} includeAll />
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>まだ何も登録されていません</Text>
          <Text style={styles.emptyBody}>右下の「＋」から、最初の保証書を登録しましょう。</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyBody}>条件に一致する商品はありません</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ItemCard item={item} onPress={() => onOpenItem(item.id)} />}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={onOpenAdd} activeOpacity={0.85}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ============ 登録・編集画面 ============
const emptyForm = {
  name: '', category: '家電', warrantyType: 'メーカー保証', maker: '', model: '',
  purchaseDate: '', warrantyMonths: '', price: '', store: '', memo: '',
  photoWarranty: null, photoReceipt: null, repairHistory: [],
};

function FormScreen({ existingItem, onSave, onDelete, onCancel }) {
  const [form, setForm] = useState(existingItem ? { ...emptyForm, ...existingItem } : emptyForm);
  const [rDate, setRDate] = useState('');
  const [rDesc, setRDesc] = useState('');
  const [rCost, setRCost] = useState('');

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  async function pickPhoto(slot, source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('権限が必要です', 'カメラまたは写真ライブラリへのアクセスを許可してください。'); return; }
    const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ quality: 0.5, base64: true, allowsEditing: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    setForm((f) => ({ ...f, [slot]: `data:image/jpeg;base64,${asset.base64}` }));
  }

  function addRepair() {
    if (!rDate || !rDesc) { Alert.alert('入力してください', '修理日と内容を入力してください。'); return; }
    setForm((f) => ({ ...f, repairHistory: [...f.repairHistory, { date: rDate, desc: rDesc, cost: rCost }] }));
    setRDate(''); setRDesc(''); setRCost('');
  }
  function removeRepair(idx) {
    setForm((f) => ({ ...f, repairHistory: f.repairHistory.filter((_, i) => i !== idx) }));
  }

  function handleSave() {
    if (!form.name.trim()) return Alert.alert('商品名を入力してください');
    if (!form.purchaseDate) return Alert.alert('購入日を入力してください', 'YYYY-MM-DD の形式で入力してください（例: 2026-07-20）');
    if (!form.warrantyMonths || Number(form.warrantyMonths) <= 0) return Alert.alert('保証期間（ヶ月）を入力してください');
    if (isNaN(new Date(form.purchaseDate))) return Alert.alert('購入日の形式が正しくありません', 'YYYY-MM-DD の形式で入力してください');
    const warrantyEnd = warrantyEndDate(form.purchaseDate, form.warrantyMonths);
    onSave({ ...form, warrantyEnd, id: existingItem?.id || makeId() });
  }
  function handleDelete() {
    Alert.alert('削除しますか？', 'この保証書を削除します。この操作は取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete(existingItem.id) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe2}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.formTitle}>{existingItem ? '保証書を編集' : '保証書を登録'}</Text>

        <Text style={styles.sectionLabel}>基本情報</Text>
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.label}>商品名</Text>
          <TextInput style={styles.input} placeholder="例: 冷蔵庫" value={form.name} onChangeText={set('name')} />
        </View>
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.label}>カテゴリ</Text>
          <ChipSelector options={CATEGORIES} value={form.category} onChange={set('category')} />
        </View>
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.label}>保証区分</Text>
          <ChipSelector options={WARRANTY_TYPES} value={form.warrantyType} onChange={set('warrantyType')} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>メーカー</Text>
            <TextInput style={styles.input} placeholder="例: パナソニック" value={form.maker} onChangeText={set('maker')} />
          </View>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>型番</Text>
            <TextInput style={styles.input} placeholder="例: NR-B17" value={form.model} onChangeText={set('model')} />
          </View>
        </View>

        <Text style={styles.sectionLabel}>購入情報</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>購入日 (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2026-07-20" value={form.purchaseDate} onChangeText={set('purchaseDate')} />
          </View>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>保証期間（ヶ月）</Text>
            <TextInput style={styles.input} placeholder="12" keyboardType="number-pad" value={String(form.warrantyMonths)} onChangeText={set('warrantyMonths')} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>購入金額（円）</Text>
            <TextInput style={styles.input} placeholder="98000" keyboardType="number-pad" value={String(form.price)} onChangeText={set('price')} />
          </View>
          <View style={{ flex: 1, marginBottom: 14 }}>
            <Text style={styles.label}>購入店舗</Text>
            <TextInput style={styles.input} placeholder="ヨドバシ横浜店" value={form.store} onChangeText={set('store')} />
          </View>
        </View>
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.label}>メモ</Text>
          <TextInput style={[styles.input, styles.textarea]} placeholder="修理窓口の電話番号など、任意" value={form.memo} onChangeText={set('memo')} multiline />
        </View>

        <Text style={styles.sectionLabel}>写真</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {['warranty', 'receipt'].map((slot) => {
            const key = slot === 'warranty' ? 'photoWarranty' : 'photoReceipt';
            return (
              <View style={{ flex: 1 }} key={slot}>
                <Text style={styles.label}>{slot === 'warranty' ? '保証書' : 'レシート'}</Text>
                {form[key] && <Image source={{ uri: form[key] }} style={styles.photoPreview} />}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(key, 'camera')}><Text style={styles.photoBtnText}>撮影</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(key, 'library')}><Text style={styles.photoBtnText}>選択</Text></TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {existingItem && (
          <>
            <Text style={styles.sectionLabel}>修理履歴</Text>
            {form.repairHistory.length === 0 ? (
              <Text style={styles.repairEmpty}>修理履歴はまだありません</Text>
            ) : (
              form.repairHistory.map((r, i) => (
                <View key={i} style={styles.repairItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: colors.text }}>{r.desc}</Text>
                    <Text style={styles.repairMeta}>{fmtDate(r.date)}{r.cost ? ' ・ ' + yen(r.cost) : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={() => removeRepair(i)}><Text style={{ color: colors.textDim, fontSize: 16, paddingHorizontal: 6 }}>×</Text></TouchableOpacity>
                </View>
              ))
            )}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="YYYY-MM-DD" value={rDate} onChangeText={setRDate} />
              <TextInput style={[styles.input, { flex: 1.4 }]} placeholder="内容" value={rDesc} onChangeText={setRDesc} />
              <TextInput style={[styles.input, { flex: 0.8 }]} placeholder="費用" keyboardType="number-pad" value={rCost} onChangeText={setRCost} />
              <TouchableOpacity style={styles.repairAddBtn} onPress={addRepair}><Text style={{ color: colors.paper, fontSize: 13 }}>追加</Text></TouchableOpacity>
            </View>
          </>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onCancel}><Text style={{ color: colors.textDim, fontWeight: '700' }}>キャンセル</Text></TouchableOpacity>
          {existingItem && (
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleDelete}><Text style={{ color: colors.hanko, fontWeight: '700' }}>削除</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleSave}><Text style={{ color: '#fff', fontWeight: '700' }}>保存する</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============ アプリ本体 ============
export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('list');
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        setItems(raw ? JSON.parse(raw).map(normalize) : []);
      } catch (e) { setItems([]); }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setItems(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  }, []);

  function openAdd() { setEditingId(null); setScreen('form'); }
  function openItem(id) { setEditingId(id); setScreen('form'); }
  function cancelForm() { setScreen('list'); }
  async function handleSave(data) {
    const next = editingId ? items.map((it) => (it.id === editingId ? data : it)) : [...items, data];
    await persist(next);
    setScreen('list');
  }
  async function handleDelete(id) {
    await persist(items.filter((it) => it.id !== id));
    setScreen('list');
  }

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }}><ActivityIndicator color={colors.paper} /></View>;
  }

  return (
    <>
      {screen === 'list' ? (
        <ListScreen items={items} onOpenItem={openItem} onOpenAdd={openAdd} />
      ) : (
        <FormScreen existingItem={editingId ? items.find((it) => it.id === editingId) : null} onSave={handleSave} onDelete={handleDelete} onCancel={cancelForm} />
      )}
    </>
  );
}

// ============ スタイル ============
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  safe2: { flex: 1, backgroundColor: colors.paperCard },
  header: { padding: 20, paddingBottom: 22 },
  eyebrow: { color: 'rgba(237,234,226,0.55)', fontSize: 11, letterSpacing: 2 },
  title: { color: colors.paper, fontSize: 28, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  subtitle: { color: 'rgba(237,234,226,0.6)', fontSize: 13 },
  banner: { marginHorizontal: 16, marginTop: -8, marginBottom: 4, backgroundColor: colors.hanko, borderRadius: 10, padding: 12 },
  bannerText: { color: '#fff', fontSize: 13 },
  controls: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  search: { backgroundColor: colors.paperCard, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14, color: colors.text },
  chipsWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: colors.paper, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptyBody: { color: 'rgba(237,234,226,0.6)', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  fab: { position: 'absolute', right: 20, bottom: 26, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.hanko, alignItems: 'center', justifyContent: 'center' },
  fabText: { color: '#fff', fontSize: 26, marginTop: -2 },
  chip: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 20, backgroundColor: colors.paperCard, borderWidth: 1, borderColor: colors.line, marginRight: 6 },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12, color: colors.textDim },
  chipTextActive: { color: colors.paper },
  card: { backgroundColor: colors.paperCard, borderRadius: 4, borderLeftWidth: 3, borderLeftColor: colors.line, borderStyle: 'dashed', padding: 16, flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 12 },
  thumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: colors.line },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  name: { fontWeight: '700', fontSize: 16, color: colors.text, marginBottom: 3 },
  meta: { fontSize: 12, color: colors.textDim },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  tag: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 10, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  tagText: { fontSize: 10, color: colors.textDim },
  stamp: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  stampOk: { borderColor: colors.moss },
  stampWarn: { borderColor: colors.hanko },
  stampExpired: { borderColor: colors.textDim },
  stampNum: { fontSize: 16, fontWeight: '700', color: colors.text },
  stampUnit: { fontSize: 8, color: colors.textDim, marginTop: 1 },
  scroll: { padding: 20, paddingBottom: 60 },
  formTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 6 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: colors.textDim, textTransform: 'uppercase', marginTop: 20, marginBottom: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  label: { fontSize: 12, color: colors.textDim, marginBottom: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: colors.text },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  photoPreview: { width: '100%', height: 90, borderRadius: 8, backgroundColor: colors.paper },
  photoBtn: { flex: 1, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  photoBtnText: { fontSize: 12, color: colors.text },
  repairEmpty: { fontSize: 12, color: colors.textDim, marginBottom: 10 },
  repairItem: { flexDirection: 'row', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 8, alignItems: 'center' },
  repairMeta: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  repairAddBtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.hanko },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.hanko },
});
