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
