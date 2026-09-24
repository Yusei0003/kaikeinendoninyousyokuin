'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/core.js');

function baseData() {
  const d = C.emptyData();
  d.staff.push({ id: 's1', number: '1001', name: '山田 花子' });
  return d;
}
function appt(over) {
  return {
    id: C.uid('ap'), staffId: 's1', fiscalYear: 2026, type: 'part', dept: '市民課', title: '事務補助',
    start: '2026-04-01', end: '2027-03-31', weeklyHours: 29, payType: 'hourly', payAmount: 1000,
    recruitMethod: 'public', status: '', renewals: [], ...over,
  };
}
const errors = (issues) => issues.filter((i) => i.level === 'error');

test('会計年度の判定', () => {
  assert.strictEqual(C.fiscalYearOf('2026-04-01'), 2026);
  assert.strictEqual(C.fiscalYearOf('2027-03-31'), 2026);
  assert.strictEqual(C.fyLabel(2026), '令和8年度');
  assert.strictEqual(C.fyLabel(2019), '令和元年度');
});

test('任期が会計年度を超えるとエラー', () => {
  const d = baseData();
  const a = appt({ end: '2027-04-30' });
  assert.ok(errors(C.validateAppointment(a, d, d.settings)).some((i) => /会計年度/.test(i.msg)));
  assert.strictEqual(errors(C.validateAppointment(appt(), d, d.settings)).length, 0);
});

test('フル／パートの勤務時間判定', () => {
  const d = baseData();
  assert.ok(errors(C.validateAppointment(appt({ type: 'full', weeklyHours: 30 }), d, d.settings)).length > 0);
  assert.strictEqual(errors(C.validateAppointment(appt({ type: 'full', weeklyHours: 38.75 }), d, d.settings)).length, 0);
  assert.ok(errors(C.validateAppointment(appt({ type: 'part', weeklyHours: 38.75 }), d, d.settings)).length > 0);
});

test('同一職員の任期重複を検出', () => {
  const d = baseData();
  d.appointments.push(appt({ id: 'a1', start: '2026-04-01', end: '2026-09-30' }));
  const dup = appt({ id: 'a2', start: '2026-09-01', end: '2027-03-31' });
  assert.ok(errors(C.validateAppointment(dup, d, d.settings)).some((i) => /重なって/.test(i.msg)));
});

test('再度の任用の連続回数と上限警告', () => {
  const d = baseData();
  d.settings.reappointLimit = 2;
  d.appointments.push(appt({ id: 'y1', fiscalYear: 2023, start: '2023-04-01', end: '2024-03-31', recruitMethod: 'public' }));
  d.appointments.push(appt({ id: 'y2', fiscalYear: 2024, start: '2024-04-01', end: '2025-03-31', recruitMethod: 'reappoint' }));
  d.appointments.push(appt({ id: 'y3', fiscalYear: 2025, start: '2025-04-01', end: '2026-03-31', recruitMethod: 'reappoint' }));
  const next = appt({ id: 'y4', recruitMethod: 'reappoint' });
  assert.strictEqual(C.consecutiveReappointCount(d, 's1', next), 3);
  assert.ok(C.validateAppointment(next, d, d.settings).some((i) => i.level === 'warn' && /連続3回目/.test(i.msg)));
  // 公募を挟むとリセット
  assert.strictEqual(C.consecutiveReappointCount(d, 's1', appt({ id: 'y4', recruitMethod: 'public' })), 0);
});

test('任期の更新は同一年度内のみ', () => {
  const a = appt({ end: '2026-09-30' });
  assert.strictEqual(errors(C.validateRenewal(a, '2027-03-31')).length, 0);
  assert.ok(errors(C.validateRenewal(a, '2027-04-01')).length > 0);
  assert.ok(errors(C.validateRenewal(a, '2026-09-01')).length > 0);
});

test('次年度の任用案：評価と上限で推薦可否', () => {
  const d = baseData();
  d.staff.push({ id: 's2', name: '佐藤 一郎' });
  d.appointments.push(appt({ id: 'p1' }));
  d.appointments.push(appt({ id: 'p2', staffId: 's2' }));
  d.evaluations.push({ id: 'e1', staffId: 's1', fiscalYear: 2026, overall: 'A', recommend: 'yes' });
  d.evaluations.push({ id: 'e2', staffId: 's2', fiscalYear: 2026, overall: 'D', recommend: 'yes' });
  const plans = C.buildNextYearPlan(d, 2026, d.settings);
  const p1 = plans.find((p) => p.staffId === 's1');
  const p2 = plans.find((p) => p.staffId === 's2');
  assert.strictEqual(p1.recommend, true);
  assert.strictEqual(p1.draft.start, '2027-04-01');
  assert.strictEqual(p1.draft.end, '2028-03-31');
  assert.strictEqual(p2.recommend, false);
});

test('採用試験の合計点と順位（同点同順位）', () => {
  const exam = { id: 'x1', stages: ['書類', '面接'] };
  const apps = [
    { id: 'a', examId: 'x1', scores: { 書類: 30, 面接: 50 } },
    { id: 'b', examId: 'x1', scores: { 書類: 40, 面接: 40 } },
    { id: 'c', examId: 'x1', scores: { 書類: 10, 面接: 20 } },
    { id: 'd', examId: 'x1', scores: { 書類: 90 }, result: 'decline' },
  ];
  const r = C.rankApplicants(apps, exam);
  assert.deepStrictEqual(r.map((x) => [x.a.id, x.rank]), [['a', 1], ['b', 1], ['c', 3]]);
});

test('Excel取込：見出しの揺れと和暦日付', () => {
  const rows = [
    ['令和8年度 会計年度任用職員一覧'],
    ['職員番号', '氏名', '所属課', '職名', '勤務形態', '任期（自）', '任期（至）', '週勤務時間', '報酬形態', '報酬額', '採用方法'],
    ['1001', '山田 花子', '市民課', '事務補助', 'パートタイム', 'R8.4.1', '2027/3/31', 29, '時間額', '1,050', '再度の任用'],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['1002', '鈴木 次郎', '建設課', '技術員', 'フルタイム', 46113, 46477, 38.75, '月額', 200000, '公募'],
  ];
  const res = C.rowsToRecords(rows, 'appointments', C.emptyData().settings);
  assert.strictEqual(res.headerRow, 1);
  assert.strictEqual(res.records.length, 2);
  const [a, b] = res.records;
  assert.strictEqual(a.start, '2026-04-01');
  assert.strictEqual(a.end, '2027-03-31');
  assert.strictEqual(a.payAmount, 1050);
  assert.strictEqual(a.payType, 'hourly');
  assert.strictEqual(a.recruitMethod, 'reappoint');
  assert.strictEqual(b.type, 'full');
  assert.strictEqual(b.start, '2026-04-01');
  assert.strictEqual(b.end, '2027-03-31');
});

test('Excel取込：必須列がなければエラー', () => {
  const res = C.rowsToRecords([['番号', '所属']], 'staff', C.emptyData().settings);
  assert.ok(res.error);
});

test('条件付採用期間の終了日', () => {
  const s = { probationMonths: 1 };
  assert.strictEqual(C.probationEnd({ start: '2026-04-01' }, s), '2026-04-30');
});

test('古いデータの正規化', () => {
  const d = C.normalizeData({ staff: [{ id: 'x' }], settings: { expiryAlertDays: 30 } });
  assert.strictEqual(d.staff.length, 1);
  assert.deepStrictEqual(d.exams, []);
  assert.strictEqual(d.settings.expiryAlertDays, 30);
  assert.strictEqual(d.settings.fullTimeWeeklyHours, 38.75);
});

/* ---------- 任用一覧（総務課様式）・市マニュアルの判定 ---------- */
const ICHIRAN_HEADER = ['任用\n伺い', '会計\n年度', '職員\n番号', '区分', '氏名', 'ﾌﾘｶﾞﾅ', '所属\nCD', '所属名', '会計', '予算科目', '任用期間',
  '就業\n場所', '業務内容', '勤務\n時間/週', '年休\n（日数）', '基礎額', '給料・報酬', '', '給料・報酬\n支給日', '期末手当\n支給の有無',
  '通勤手当\n支給日', 'R8.4.1\n社会保険', '健保→共済\n切替時期', 'R7.4.1\n雇保/退手', '雇保→退手\n切替時期', '保育士特定登録取消者管理システム', '備考'];
const ICHIRAN_ROWS = [
  ICHIRAN_HEADER,
  ['○', 1, 90001, 'パート(月額)', '試験　月子', 'ｼｹﾝ　ﾂｷｺ', 3820, 'A保育所', 1, '30204000200', 'R8.4.1～R9.3.31', 'A保育所', '保育士', 35, 20, 239300, '月額', 216141, '毎月21日', '有', '毎月21日', '共済(短期)', '-', '雇用保険', '-', '済', ''],
  ['○', 1, 90002, 'フル', '試験　全子', 'ｼｹﾝ　ｾﾞﾝｺ', 3830, 'B保育所', 1, '30204000200', 'R8.4.1～R9.3.31', 'B保育所', '保育士', 38.75, 20, 239300, '月額', 239300, '毎月21日', '有', '毎月21日', '共済', new Date(2020, 3, 1), '退手', new Date(2020, 9, 1), '済', ''],
  ['○', 3, 90003, 'パート(時間額)', '試験　時子', 'ｼｹﾝ　ﾄｷｺ', 2400, '福祉部子ども未来課', '', '', '', '', '調理員', '随時', '-', 236300, '時間額', 1451, '翌月21日', '無', '翌月21日', '無', '-', '無', '-', '-', ''],
];

test('任用一覧：様式どおりに読み込める', () => {
  const res = C.parseNinyoIchiran(ICHIRAN_ROWS, null);
  assert.ifError(res.error);
  assert.strictEqual(res.fy, 2026);
  assert.strictEqual(res.records.length, 3);
  const [m, f, h] = res.records;
  assert.strictEqual(m.type, 'part'); assert.strictEqual(m.payType, 'monthly');
  assert.strictEqual(m.kana, 'ｼｹﾝ　ﾂｷｺ');
  assert.strictEqual(m.name, '試験　月子');
  assert.strictEqual(m.payAmount, 216141);
  assert.strictEqual(m.start, '2026-04-01'); assert.strictEqual(m.end, '2027-03-31');
  assert.strictEqual(m.ukagai, true);
  assert.strictEqual(m.socialIns, '共済(短期)');
  assert.strictEqual(f.type, 'full');
  assert.strictEqual(f.kyosaiSwitch, '4/1');
  assert.strictEqual(f.taishuSwitch, '10/1');
  assert.strictEqual(h.payType, 'hourly');
  assert.strictEqual(h.weeklyHours, '');
  assert.strictEqual(h.hoursText, '随時');
  assert.strictEqual(h.yearInService, 3);
  assert.strictEqual(h.recruitMethod, 'reappoint');
  assert.ok(h._notes.some((n) => /任用期間が空欄/.test(n)));
});

test('報酬の算定式（市マニュアル第Ⅲ章）', () => {
  const s = C.emptyData().settings;
  assert.strictEqual(C.calcPay({ type: 'part', payType: 'monthly', baseAmount: 239300, weeklyHours: 35 }, s), 216141);
  assert.strictEqual(C.calcPay({ type: 'part', payType: 'hourly', baseAmount: 236300 }, s), 1451);
  assert.strictEqual(C.calcPay({ type: 'part', payType: 'daily', baseAmount: 151400 }, s), 7209);
  assert.strictEqual(C.calcPay({ type: 'full', payType: 'monthly', baseAmount: 239300 }, s), 239300);
});

test('期末手当・支給日・健診の判定（市マニュアル）', () => {
  const s = C.emptyData().settings;
  const year = { start: '2026-04-01', end: '2027-03-31' };
  assert.strictEqual(C.bonusEligibility({ ...year, weeklyHours: 16 }, s), '有');
  assert.strictEqual(C.bonusEligibility({ ...year, weeklyHours: 15 }, s), '無');
  assert.strictEqual(C.bonusEligibility({ start: '2026-04-01', end: '2026-09-29', weeklyHours: 30 }, s), '無');
  assert.strictEqual(C.bonusEligibility({ start: '2026-04-01', end: '2026-09-30', weeklyHours: 30 }, s), '有');
  assert.strictEqual(C.bonusEligibility({ ...year, weeklyHours: '' }, s), null);
  assert.strictEqual(C.expectedPayDay({ type: 'part', payType: 'hourly' }), '翌月21日');
  assert.strictEqual(C.expectedPayDay({ type: 'part', payType: 'monthly' }), '毎月21日');
  assert.strictEqual(C.healthCheckRequired({ ...year, weeklyHours: 29 }, s), true);
  assert.strictEqual(C.healthCheckRequired({ ...year, weeklyHours: 28 }, s), false);
});

test('フルタイムの退手・共済の切替時期（市マニュアル第Ⅶ章）', () => {
  const d = baseData();
  const s = d.settings;
  // 7/1採用 → 退手 1/1、共済 翌7/1
  const a1 = appt({ id: 'f1', type: 'full', weeklyHours: 38.75, start: '2022-07-01', end: '2023-03-31', fiscalYear: 2022 });
  d.appointments.push(a1);
  let sw = C.fullTimeSwitchDates(d, a1, s);
  assert.strictEqual(sw.taishu, '2023-01-01');
  assert.strictEqual(sw.kyosai, '2023-07-01');
  // 翌年度も切れ目なくフル → 継続開始日は 2022-07-01 のまま、4/1時点は退手・共済(短期)
  const a2 = appt({ id: 'f2', type: 'full', weeklyHours: 38.75, start: '2023-04-01', end: '2024-03-31', fiscalYear: 2023, recruitMethod: 'reappoint' });
  d.appointments.push(a2);
  sw = C.fullTimeSwitchDates(d, a2, s);
  assert.strictEqual(sw.serviceStart, '2022-07-01');
  assert.strictEqual(C.suggestEmpIns(d, a2, s).value, '退手');
  assert.strictEqual(C.suggestSocialIns(d, a2, s).value, '共済(短期)');
  // 年目から推定（履歴がなくても3年目なら2年前の4/1から継続）
  const lone = { ...appt({ id: 'f3', staffId: 's9', type: 'full', weeklyHours: 38.75 }), yearInService: 3 };
  sw = C.fullTimeSwitchDates(d, lone, s);
  assert.strictEqual(sw.serviceStart, '2024-04-01');
  assert.strictEqual(sw.estimated, true);
  assert.strictEqual(C.suggestSocialIns(d, lone, s).value, '共済');
});

test('任用一覧の記載と判定の食い違いを警告', () => {
  const d = baseData();
  const rec = appt({ type: 'full', weeklyHours: 38.75, baseAmount: 239300, payAmount: 239300, payDay: '毎月21日', bonus: '有', socialIns: '共済', empIns: '退手', title: '保育士', hoikushiCheck: '-', yearInService: 1 });
  const msgs = C.validateAppointment(rec, d, d.settings).map((i) => i.msg).join('\n');
  assert.match(msgs, /社会保険は「共済\(短期\)」/);
  assert.match(msgs, /雇用保険／退職手当は「雇用保険」/);
  assert.match(msgs, /保育士特定登録取消者/);
  const bad = appt({ type: 'part', payType: 'monthly', weeklyHours: 36, baseAmount: 239300, payAmount: 200000, payDay: '翌月21日' });
  const m2 = C.validateAppointment(bad, d, d.settings).map((i) => i.msg).join('\n');
  assert.match(m2, /算定式による額（222,317円）/);
  assert.match(m2, /支給日は「毎月21日」/);
  assert.match(m2, /勤務時間設定の考え方/);
  // 時間額パートは週勤務時間が空欄でもエラーにしない
  const hourly = appt({ type: 'part', payType: 'hourly', weeklyHours: '', hoursText: '随時' });
  assert.strictEqual(errors(C.validateAppointment(hourly, d, d.settings)).length, 0);
});

test('年目と再度の任用の上限（原則連続2回・最長3会計年度）', () => {
  const d = baseData();
  const third = appt({ id: 't3', recruitMethod: 'reappoint', yearInService: 3 });
  d.appointments.push(third);
  d.evaluations.push({ id: 'e', staffId: 's1', fiscalYear: 2026, overall: 'A', recommend: 'yes', wish: 'yes' });
  assert.strictEqual(C.yearInServiceOf(d, third), 3);
  assert.ok(!C.validateAppointment(third, d, d.settings).some((i) => /上限/.test(i.msg)));
  const plan = C.buildNextYearPlan(d, 2026, d.settings)[0];
  assert.strictEqual(plan.draft.yearInService, 4);
  assert.strictEqual(plan.overLimit, true);
  assert.strictEqual(plan.recommend, false);
});

test('任用一覧の書出し→読込で内容が変わらない', () => {
  const d = baseData();
  const parsed = C.parseNinyoIchiran(ICHIRAN_ROWS, null).records;
  parsed.forEach((r, i) => {
    const sid = `x${i}`;
    d.staff.push({ id: sid, number: r.number, name: r.name, kana: r.kana });
    const { number, name, kana, _row, _notes, ...rest } = r;
    d.appointments.push({ id: `a${i}`, staffId: sid, ...rest });
  });
  const rows = C.ninyoIchiranRows(d, 2026, d.settings);
  assert.strictEqual(rows[0][21], 'R8.4.1\n社会保険');
  const again = C.parseNinyoIchiran(rows, 2026).records;
  assert.strictEqual(again.length, 3);
  for (const k of ['number', 'name', 'type', 'payType', 'start', 'end', 'weeklyHours', 'hoursText', 'baseAmount', 'payAmount', 'socialIns', 'empIns', 'kyosaiSwitch', 'yearInService', 'dept', 'budgetCode']) {
    const byNo = (arr) => arr.map((r) => String(r[k])).sort();
    assert.deepStrictEqual(byNo(again), byNo(parsed), k);
  }
});
