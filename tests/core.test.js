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
  assert.ok(C.validateAppointment(next, d, d.settings).some((i) => i.level === 'warn' && /4年目の任用/.test(i.msg)));
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
  d.evaluations.push({ id: 'e1', staffId: 's1', fiscalYear: 2026, overall: 'A', recommend: 'yes', wish: 'yes' });
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

test('公募が必要な年度：R5.11採用もR5.4採用もR8.4に公募（毎年4月の更新は連続2回まで）', () => {
  for (const start of ['2023-11-01', '2023-04-01']) {
    const d = baseData();
    const first = appt({ id: 'r5', fiscalYear: 2023, start, end: '2024-03-31', recruitMethod: 'public' });
    d.appointments.push(first);
    assert.strictEqual(C.publicRecruitFy(d, first, d.settings), 2026, start);
    let base = first;
    for (const fy of [2024, 2025]) {
      d.evaluations.push({ id: `e${fy}`, staffId: 's1', fiscalYear: fy - 1, overall: 'A', recommend: 'yes', wish: 'yes' });
      const p = C.buildNextYearPlan(d, fy - 1, d.settings)[0];
      assert.strictEqual(p.recommend, true, `${start} ${fy}`);
      d.appointments.push(p.draft);
      base = p.draft;
    }
    assert.strictEqual(C.yearInServiceOf(d, base), 3);
    assert.strictEqual(C.publicRecruitFy(d, base, d.settings), 2026);
    d.evaluations.push({ id: 'e2025', staffId: 's1', fiscalYear: 2025, overall: 'A', recommend: 'yes', wish: 'yes' });
    const r8 = C.buildNextYearPlan(d, 2025, d.settings)[0];
    assert.strictEqual(r8.overLimit, true);
    assert.ok(r8.reasons.some((x) => /R8\.4\.1に公募が必要/.test(x)));
  }
});

test('年休の付与日数（市マニュアル第Ⅴ章1）と3年周期の1年目の扱い', () => {
  const d = baseData();
  const s = d.settings;
  const full = (over) => appt({ type: 'full', payType: 'monthly', weeklyHours: 38.75, ...over });
  // 3年周期の1年目（10082の例）：年休10日、共済(短期)・雇用保険
  const y1 = full({ id: 'y1', yearInService: 1, annualLeave: 20, socialIns: '共済', empIns: '退手' });
  assert.strictEqual(C.annualLeaveDays(d, y1, s), 10);
  const msgs = C.validateAppointment(y1, d, s).map((i) => i.msg).join('\n');
  assert.match(msgs, /年休は10日と判定/);
  assert.match(msgs, /社会保険は「共済\(短期\)」/);
  assert.match(msgs, /雇用保険／退職手当は「雇用保険」/);
  assert.strictEqual(C.annualLeaveDays(d, full({ id: 'y2', yearInService: 2 }), s), 11);
  assert.strictEqual(C.annualLeaveDays(d, full({ id: 'y3', yearInService: 3 }), s), 12);
  // 時間額パート：既定は付与しない。手入力の日数は警告しない。「付与する」にすれば表で判定
  const hourly = appt({ id: 'h', type: 'part', payType: 'hourly', weeklyHours: '', yearInService: 1 });
  assert.strictEqual(C.annualLeaveInfo(d, hourly, s).granted, false);
  assert.strictEqual(C.annualLeaveDays(d, { ...hourly, weeklyDays: 3 }, s), 0);
  assert.ok(!C.validateAppointment({ ...hourly, annualLeave: 5 }, d, s).some((i) => /年休/.test(i.msg)));
  const hGrant = { ...hourly, leaveGrant: 'grant' };
  assert.strictEqual(C.annualLeaveDays(d, hGrant, s), null);
  assert.strictEqual(C.annualLeaveDays(d, { ...hGrant, weeklyDays: 3 }, s), 5);
  assert.strictEqual(C.annualLeaveDays(d, { ...hGrant, annualWorkDays: 130 }, s), 5);
  // 日額パート（週3日）：任期が短くても既定は付与、「付与しない」を選べば0日
  const daily = appt({ id: 'dy', type: 'part', payType: 'daily', weeklyDays: 3, weeklyHours: 20, yearInService: 1, end: '2026-08-31' });
  assert.strictEqual(C.annualLeaveDays(d, daily, s), 5);
  assert.strictEqual(C.annualLeaveDays(d, { ...daily, leaveGrant: 'none' }, s), 0);
  assert.ok(C.validateAppointment({ ...daily, leaveGrant: 'none', annualLeave: 5 }, d, s).some((i) => /付与しない/.test(i.msg)));
});

test('勤続は公募をまたいでも通算し、3年周期の年目は公募で1年目に戻る', () => {
  const d = baseData();
  const full = (over) => appt({ type: 'full', payType: 'monthly', weeklyHours: 38.75, ...over });
  // R5〜R7：1周期目（R5公募・R6/R7更新）、R8：公募で再び採用（2周期目の1年目）
  d.appointments.push(
    full({ id: 'r5', fiscalYear: 2023, start: '2023-04-01', end: '2024-03-31', recruitMethod: 'public' }),
    full({ id: 'r6', fiscalYear: 2024, start: '2024-04-01', end: '2025-03-31', recruitMethod: 'reappoint' }),
    full({ id: 'r7', fiscalYear: 2025, start: '2025-04-01', end: '2026-03-31', recruitMethod: 'reappoint' }),
  );
  const r8 = full({ id: 'r8', recruitMethod: 'public' });
  d.appointments.push(r8);
  // 3年周期：公募で1年目に戻り、次の公募はR11.4
  assert.strictEqual(C.yearInServiceOf(d, r8), 1);
  assert.strictEqual(C.publicRecruitFy(d, r8, d.settings), 2029);
  // 勤続：R5.4.1から通算（3年）→ 年休14日、退手・共済に切替済み
  assert.strictEqual(C.serviceStartOf(d, r8, false).date, '2023-04-01');
  assert.strictEqual(C.continuousServiceYears(d, r8), 3);
  assert.strictEqual(C.annualLeaveDays(d, r8, d.settings), 14);
  assert.strictEqual(C.suggestSocialIns(d, r8, d.settings).value, '共済');
  assert.strictEqual(C.suggestEmpIns(d, r8, d.settings).value, '退手');
});

test('勤続が途切れた場合・履歴がない場合・勤続開始日の入力', () => {
  const d = baseData();
  const full = (over) => appt({ type: 'full', payType: 'monthly', weeklyHours: 38.75, ...over });
  // R6年度は任用なし（途切れ）→ R7公募の任用は勤続初年
  d.appointments.push(full({ id: 'old', fiscalYear: 2023, start: '2023-04-01', end: '2024-03-31', recruitMethod: 'public' }));
  const r7 = full({ id: 'r7', fiscalYear: 2025, start: '2025-04-01', end: '2026-03-31', recruitMethod: 'public' });
  d.appointments.push(r7);
  assert.strictEqual(C.continuousServiceYears(d, r7), 0);
  assert.strictEqual(C.annualLeaveDays(d, r7, d.settings), 10);
  // 履歴がない3年周期の1年目（10082の例）：初年扱い → 共済(短期)・雇用保険・年休10日
  const lone = full({ id: 'lone', staffId: 's9', yearInService: 1 });
  assert.strictEqual(C.suggestSocialIns(d, lone, d.settings).value, '共済(短期)');
  assert.strictEqual(C.suggestEmpIns(d, lone, d.settings).value, '雇用保険');
  assert.strictEqual(C.annualLeaveDays(d, lone, d.settings), 10);
  // 勤続開始日・フル継続開始日を入力すれば、履歴がなくても通算される
  const manual = { ...lone, serviceStart: '2020-04-01', fullTimeStart: '2025-04-01' };
  assert.strictEqual(C.continuousServiceYears(d, manual), 6);
  assert.strictEqual(C.annualLeaveDays(d, manual, d.settings), 20);
  assert.strictEqual(C.suggestSocialIns(d, manual, d.settings).value, '共済');
  // 3年周期の年目は入力どおり1年目のまま（公募の判断は別）
  assert.strictEqual(C.yearInServiceOf(d, manual), 1);
});

test('年休：継続勤務年数の1年未満の端数は1年とみなす', () => {
  const d = baseData();
  const full = (over) => appt({ type: 'full', payType: 'monthly', weeklyHours: 38.75, ...over });
  // R5.11.1採用（任期5か月でも既定は付与：任用の日で10日）→ R6.4.1は端数5か月で1年
  const r5 = full({ id: 'r5', fiscalYear: 2023, start: '2023-11-01', end: '2024-03-31', recruitMethod: 'public' });
  const r6 = full({ id: 'r6', fiscalYear: 2024, start: '2024-04-01', end: '2025-03-31', recruitMethod: 'reappoint' });
  const r7 = full({ id: 'r7', fiscalYear: 2025, start: '2025-04-01', end: '2026-03-31', recruitMethod: 'reappoint' });
  d.appointments.push(r5, r6, r7);
  assert.strictEqual(C.continuousServiceYears(d, r5), 0);
  assert.strictEqual(C.annualLeaveDays(d, r5, d.settings), 10);
  assert.strictEqual(C.annualLeaveDays(d, { ...r5, leaveGrant: 'none' }, d.settings), 0);
  assert.strictEqual(C.continuousServiceYears(d, r6), 1);
  assert.strictEqual(C.annualLeaveDays(d, r6, d.settings), 11);
  assert.strictEqual(C.continuousServiceYears(d, r7), 2);
  assert.strictEqual(C.annualLeaveDays(d, r7, d.settings), 12);
  // ちょうど満1年（R5.4.1→R6.4.1）は1年のまま
  const a = full({ id: 'a', staffId: 's2', fiscalYear: 2023, start: '2023-04-01', end: '2024-03-31', recruitMethod: 'public' });
  const b = full({ id: 'b', staffId: 's2', fiscalYear: 2024, start: '2024-04-01', end: '2025-03-31', recruitMethod: 'reappoint' });
  d.appointments.push(a, b);
  assert.strictEqual(C.continuousServiceYears(d, b), 1);
});

test('年休：週4日以内でも週29時間以上なら「5日以上」の区分', () => {
  const d = baseData();
  const p = (over) => appt({ type: 'part', payType: 'hourly', leaveGrant: 'grant', yearInService: 1, ...over });
  assert.strictEqual(C.annualLeaveDays(d, p({ weeklyDays: 4, weeklyHours: 31 }), d.settings), 10);
  assert.strictEqual(C.annualLeaveDays(d, p({ weeklyDays: 4, weeklyHours: 29 }), d.settings), 10);
  assert.strictEqual(C.annualLeaveDays(d, p({ weeklyDays: 4, weeklyHours: 28 }), d.settings), 7);
  assert.strictEqual(C.annualLeaveDays(d, p({ weeklyDays: 3, weeklyHours: 23.25 }), d.settings), 5);
  // 週以外の期間で定める場合は中欄（任用期間の勤務日数）
  assert.strictEqual(C.annualLeaveDays(d, p({ annualWorkDays: 130 }), d.settings), 5);
});

test('経歴：所属・職名・区分・報酬の変更、途切れ、公募を検出', () => {
  const d = baseData();
  d.appointments.push(
    appt({ id: 'c1', fiscalYear: 2023, start: '2023-04-01', end: '2024-03-31', dept: '市民課', title: '事務補助員', payAmount: 1000, recruitMethod: 'public' }),
    appt({ id: 'c2', fiscalYear: 2024, start: '2024-04-01', end: '2025-03-31', dept: '税務課', title: '事務補助員', payAmount: 1000, recruitMethod: 'reappoint' }),
    appt({ id: 'c3', fiscalYear: 2026, start: '2026-04-01', end: '2027-03-31', dept: '税務課', title: '事務専門員', payAmount: 1100, recruitMethod: 'public',
      renewals: [{ date: '2026-09-01', oldEnd: '2026-09-30', newEnd: '2027-03-31' }] }),
  );
  const c = C.careerOf(d, 's1', d.settings, '2026-06-01');
  assert.strictEqual(c.rows.length, 3);
  assert.deepStrictEqual(c.rows[0].changes.map((x) => x.kind), ['first']);
  assert.deepStrictEqual(c.rows[1].changes.map((x) => x.kind), ['dept']);
  const k3 = c.rows[2].changes.map((x) => x.kind);
  for (const k of ['gap', 'title', 'pay', 'public', 'renew']) assert.ok(k3.includes(k), k);
  assert.strictEqual(c.summary.firstStart, '2023-04-01');
  assert.strictEqual(c.summary.serviceStart, '2026-04-01'); // R7年度に途切れたため数え直し
  assert.strictEqual(c.summary.fiscalYears, 3);
  assert.strictEqual(c.summary.current.id, 'c3');
  assert.strictEqual(c.summary.deptChanges, 1);
  assert.strictEqual(c.summary.titleChanges, 1);
});

test('年度別サマリー', () => {
  const d = baseData();
  d.staff.push({ id: 's2', name: 'b' });
  d.appointments.push(
    appt({ id: 'y1', recruitMethod: 'public' }),
    appt({ id: 'y2', staffId: 's2', type: 'full', payType: 'monthly', weeklyHours: 38.75, recruitMethod: 'reappoint' }),
    appt({ id: 'y3', fiscalYear: 2027, start: '2027-04-01', end: '2028-03-31', recruitMethod: 'reappoint' }),
  );
  d.evaluations.push({ id: 'e', staffId: 's1', fiscalYear: 2026, overall: 'A' });
  const sm = C.fiscalYearSummary(d, 2026);
  assert.strictEqual(sm.staff, 2);
  assert.strictEqual(sm.byKubun.full, 1);
  assert.strictEqual(sm.byKubun.part_hourly, 1);
  assert.strictEqual(sm.publicCount, 1);
  assert.strictEqual(sm.continuing, 1);
  assert.strictEqual(sm.evaluated, 1);
  assert.deepStrictEqual(C.fiscalYearsInData(d), [2026, 2027]);
});

test('再度の任用案：可否と本人の希望が両方そろって推薦', () => {
  const d = baseData();
  d.appointments.push(appt({ id: 'p' }));
  d.evaluations.push({ id: 'e', staffId: 's1', fiscalYear: 2026, recommend: 'yes' });
  let p = C.buildNextYearPlan(d, 2026, d.settings)[0];
  assert.strictEqual(p.recommend, false);
  assert.ok(p.reasons.includes('本人の希望が未確認'));
  d.evaluations[0].wish = 'yes';
  p = C.buildNextYearPlan(d, 2026, d.settings)[0];
  assert.strictEqual(p.recommend, true); // 評語が未入力でも可否・希望があれば推薦（注意書きのみ）
  assert.ok(p.reasons.some((r) => /評語）が未入力/.test(r)));
  // 可否・希望だけの記録は「評価未入力」扱い
  assert.strictEqual(C.missingEvaluations(d, 2026).length, 1);
});

test('残る人・残らない人の判定と公募が必要な職', () => {
  const d = baseData();
  ['s2', 's3', 's4', 's5', 's6'].forEach((id) => d.staff.push({ id, name: id }));
  const a1 = appt({ id: 'a1' }); // 可・希望 → 残る見込み
  const a2 = appt({ id: 'a2', staffId: 's2' }); // 希望しない → 残らない見込み
  const a3 = appt({ id: 'a3', staffId: 's3', yearInService: 3, recruitMethod: 'reappoint' }); // 3年目 → 公募
  const a4 = appt({ id: 'a4', staffId: 's4', retireType: 'resign', retireDate: '2026-10-31', end: '2026-10-31' }); // 退職登録
  const a5 = appt({ id: 'a5', staffId: 's5' }); // 翌年度登録済み
  const a5n = appt({ id: 'a5n', staffId: 's5', fiscalYear: 2027, start: '2027-04-01', end: '2028-03-31', recruitMethod: 'reappoint' });
  const a6 = appt({ id: 'a6', staffId: 's6' }); // 未入力 → 未定
  d.appointments.push(a1, a2, a3, a4, a5, a5n, a6);
  d.evaluations.push({ id: 'e1', staffId: 's1', fiscalYear: 2026, recommend: 'yes', wish: 'yes' });
  d.evaluations.push({ id: 'e2', staffId: 's2', fiscalYear: 2026, recommend: 'yes', wish: 'no' });
  const code = (a) => C.continuationStatus(d, a, d.settings).code;
  assert.strictEqual(code(a1), 'stay_expected');
  assert.strictEqual(code(a2), 'leave_expected');
  assert.strictEqual(code(a3), 'public');
  assert.strictEqual(code(a4), 'leave');
  assert.strictEqual(code(a5), 'stay');
  assert.strictEqual(code(a6), 'undecided');
  const needs = C.recruitNeeds(d, 2026, d.settings).map((x) => x.appt.id).sort();
  assert.deepStrictEqual(needs, ['a2', 'a3', 'a4']);
  // 退職登録済みの職員は再度の任用案で推薦しない
  const p4 = C.buildNextYearPlan(d, 2026, d.settings).find((p) => p.staffId === 's4');
  assert.ok(p4.reasons.some((r) => /退職登録済み/.test(r)));
});

/* ---------- 人事システムの職員名簿（架空データ） ---------- */
const MEIBO_HEADER = ['番号', '区分cd', '区分名', '区分補足', '身分', '職種', '氏名', 'ﾌﾘｶﾞﾅ', '性別', '生年月日', '採用日', '退職日', '所属CD', '所属ST', '所属名', 'ランク', '職名', '兼職', '係CD', '係名', '年度年齢', '在職', '内線等', 'PASS', '財務', '労務', '級', '号', '経歴', '社保', '雇保', 'Mail', '郵便番号', '住所', '住所方書', '電話', '携帯', '緊急時氏名', '緊急時続柄', '緊急時電話', '新規'];
const meiboRow = (o) => MEIBO_HEADER.map((h) => (h in o ? o[h] : ''));
const MEIBO_ROWS = [
  MEIBO_HEADER,
  meiboRow({ 番号: 90101, 区分名: '会計年度任用職員', 職種: '事務', 氏名: '架空　一子', ﾌﾘｶﾞﾅ: 'ｶｸｳ ｲﾁｺ', 性別: 0, 生年月日: new Date(1985, 4, 10), 採用日: new Date(2026, 3, 1), 所属CD: 1300, 所属名: '市民課', 職名: '事務補助員', 係名: '窓口係', 在職: 1, PASS: 1234, 内線等: 999, Mail: 'x@example.jp', 郵便番号: '000-0000', 住所: '架空町1番地', 住所方書: '101号', 電話: '0000-00-0000' }),
  meiboRow({ 番号: 90102, 区分名: '会計年度任用職員', 氏名: '架空　二郎', ﾌﾘｶﾞﾅ: 'ｶｸｳ ｼﾞﾛｳ', 性別: 1, 生年月日: '1990/01/20', 採用日: 'R8.10.1', 所属名: '建設課', 職名: '技術員', 在職: 1 }),
  meiboRow({ 番号: 90001, 区分名: '正職員', 氏名: '架空　正子', 性別: 2, 生年月日: new Date(1980, 0, 1), 採用日: new Date(2005, 3, 1), 在職: 1 }),
];

test('職員名簿：会計年度任用職員だけを読み、必要な情報を持ってくる（PASS等は読まない）', () => {
  const res = C.parseMeibo(MEIBO_ROWS);
  assert.ifError(res.error);
  assert.strictEqual(res.records.length, 2);
  assert.strictEqual(res.excludedCount, 1);
  assert.ok(!res.records.some((r) => r.name === '架空　正子'));
  assert.ok(res.records.every((r) => r.category === '会計年度任用職員'));
  const [a, b] = res.records;
  assert.strictEqual(a.number, '90101');
  assert.strictEqual(a.gender, 'F');
  assert.strictEqual(a.birth, '1985-05-10');
  assert.strictEqual(a.hireDate, '2026-04-01');
  assert.strictEqual(a.dept, '市民課');
  assert.strictEqual(a.title, '事務補助員');
  assert.strictEqual(a.section, '窓口係');
  assert.strictEqual(a.address, '架空町1番地　101号');
  assert.strictEqual(a.email, 'x@example.jp');
  assert.strictEqual(a.inService, '在職');
  assert.ok(!('PASS' in a) && !('pass' in a) && !Object.values(a).includes('1234'));
  assert.strictEqual(b.gender, 'M');
  assert.strictEqual(b.birth, '1990-01-20');
  assert.strictEqual(b.hireDate, '2026-10-01');
  // 「会計年度」を含むだけの別の区分・空欄は対象外
  const others = [MEIBO_HEADER, meiboRow({ 番号: 1, 区分名: '会計年度任用職員（旧臨時）', 氏名: 'x', 採用日: '2026/4/1' }), meiboRow({ 番号: 2, 区分名: '', 氏名: 'y', 採用日: '2026/4/1' })];
  assert.strictEqual(C.parseMeibo(others).records.length, 0);
  assert.strictEqual(C.parseMeibo(others).excludedCount, 2);
  // 区分名の見出しがなくてもC列で判定
  const noHeader = MEIBO_ROWS.map((r, i) => (i === 0 ? r.map((h) => (h === '区分名' ? '' : h)) : r));
  assert.strictEqual(C.parseMeibo(noHeader).records.length, 2);
});

test('職員名簿：既存の職員との照合（番号→氏名と生年月日）と任用登録の確認', () => {
  const d = C.emptyData();
  d.staff.push({ id: 'a', number: '90101', name: '架空　一子' });
  d.staff.push({ id: 'b', number: '', name: '架空 二郎' }); // 任用一覧から先に取り込んだ職員（番号なし）
  const [r1, r2] = C.parseMeibo(MEIBO_ROWS).records;
  assert.strictEqual(C.findStaffForMeibo(d, r1).id, 'a');
  assert.strictEqual(C.findStaffForMeibo(d, r2).id, 'b');
  d.appointments.push({ id: 'x', staffId: 'a', start: '2026-04-01', end: '2027-03-31' });
  assert.strictEqual(C.hasAppointmentOn(d, 'a', '2026-04-01'), true);
  assert.strictEqual(C.hasAppointmentOn(d, 'b', '2026-10-01'), false);
});

test('和暦表記（令和・平成・昭和）と読み戻し', () => {
  assert.strictEqual(C.formatDateJa('2019-05-01'), '令和元年5月1日');
  assert.strictEqual(C.formatDateJa('2019-04-30'), '平成31年4月30日');
  assert.strictEqual(C.formatDateJa('1990-06-01'), '平成2年6月1日');
  assert.strictEqual(C.formatDateJa('1989-01-07'), '昭和64年1月7日');
  assert.strictEqual(C.toWarekiShort('2026-04-01'), 'R8.4.1');
  assert.strictEqual(C.toWarekiShort('2019-04-01'), 'H31.4.1');
  assert.strictEqual(C.toWarekiShort('1985-05-10'), 'S60.5.10');
  for (const iso of ['2026-04-01', '2019-04-01', '1990-06-01', '1985-05-10']) {
    assert.strictEqual(C.excelValueToISO(C.toWarekiShort(iso)), iso);
  }
});

test('会計年度任用職員以外の職員は保存データからも除く', () => {
  const d = C.normalizeData({
    staff: [{ id: 'k', name: 'a', category: '会計年度任用職員' }, { id: 'n', name: 'b' }, { id: 'o', name: 'c', category: '正職員' }],
    appointments: [{ id: 'x', staffId: 'o' }, { id: 'y', staffId: 'k' }],
    evaluations: [{ id: 'e', staffId: 'o' }],
  });
  assert.deepStrictEqual(d.staff.map((s) => s.id), ['k', 'n']);
  assert.deepStrictEqual(d.appointments.map((a) => a.id), ['y']);
  assert.strictEqual(d.evaluations.length, 0);
});

test('名簿の採用日（最初に採用された日）から勤続を通算する', () => {
  const d = baseData();
  d.staff[0].hireDate = '2020-04-01';
  const r8 = appt({ id: 'r8', yearInService: 1, type: 'full', payType: 'monthly', weeklyHours: 38.75 });
  d.appointments.push(r8);
  // 履歴がなくても採用日から：R2.4.1〜R8.4.1 で6年 → 年休20日
  const ss = C.serviceStartOf(d, r8, false);
  assert.strictEqual(ss.date, '2020-04-01');
  assert.strictEqual(ss.source, 'roster');
  assert.strictEqual(C.continuousServiceYears(d, r8), 6);
  assert.strictEqual(C.annualLeaveDays(d, r8, d.settings), 20);
  // 退手・共済（フルの継続）には採用日を使わない
  assert.strictEqual(C.fullTimeServiceStart(d, r8).date, '2026-04-01');
  // 3年周期（公募の判断）は別：1年目のまま
  assert.strictEqual(C.yearInServiceOf(d, r8), 1);
  // 働き始めは採用日
  assert.strictEqual(C.careerOf(d, 's1', d.settings, '2026-06-01').summary.firstStart, '2020-04-01');
});

test('採用日より後の履歴に途切れがあれば、採用日ではなく途切れた後から数える', () => {
  const d = baseData();
  d.staff[0].hireDate = '2020-04-01';
  d.appointments.push(appt({ id: 'old', fiscalYear: 2020, start: '2020-04-01', end: '2021-03-31', recruitMethod: 'public' }));
  const r8 = appt({ id: 'r8', recruitMethod: 'public' }); // R3〜R7は任用なし
  d.appointments.push(r8);
  assert.strictEqual(C.serviceStartOf(d, r8, false).date, '2026-04-01');
  assert.strictEqual(C.continuousServiceYears(d, r8), 0);
  // 勤続開始日を入力すればそれが優先
  assert.strictEqual(C.serviceStartOf(d, { ...r8, serviceStart: '2024-04-01' }, false).date, '2024-04-01');
  // 採用日が任用より後（データの食い違い）は使わない
  const d2 = baseData();
  d2.staff[0].hireDate = '2026-10-01';
  const a = appt({ id: 'a' });
  d2.appointments.push(a);
  assert.strictEqual(C.serviceStartOf(d2, a, false).date, '2026-04-01');
});
