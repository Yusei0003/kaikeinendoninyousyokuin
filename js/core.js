'use strict';

/* ============================================================
 * 会計年度任用職員 一元管理システム — 計算・判定ロジック
 * 画面（app.js）から独立させ、Node.js でもテストできるようにしている。
 *
 * 根拠法令の区分
 *   【国】地方公務員法 第22条の2（会計年度任用職員の採用の方法等）
 *   【市】陸前高田市会計年度任用職員の給与等に関する条例・規則
 *   【市】総務課マニュアル「会計年度任用職員の概要」（R3.3.29作成・R5.3.31改定）
 *         以下「市マニュアル」。章番号はこのマニュアルのもの。
 *   【市】総務課職員係「申送事項」（年間スケジュール・手続き）
 * 法令の条文原文は取得できていないため、判定の閾値はすべて設定値として
 * 外出しし、「根拠法令」タブで条文を貼り付けて確認する。
 * ============================================================ */

(function (root) {
  const APPOINT_TYPE_LABEL = {
    part: 'パートタイム（第22条の2第1項第1号）',
    full: 'フルタイム（第22条の2第1項第2号）',
  };
  const APPOINT_TYPE_SHORT = { part: 'パート', full: 'フル' };
  const RECRUIT_LABEL = { public: '公募', reappoint: '再度の任用（公募によらない）' };
  const PAY_TYPE_LABEL = { monthly: '月額', daily: '日額', hourly: '時間額' };
  const EXAM_METHOD_LABEL = { competitive: '競争試験', selection: '選考' };
  const RESULT_LABEL = { pending: '未判定', pass: '合格', fail: '不合格', decline: '辞退' };
  const RECOMMEND_LABEL = { yes: '再度の任用可', hold: '要検討', no: '再度の任用不可', '': '未入力' };
  const WISH_LABEL = { yes: '希望する', no: '希望しない', '': '未確認' };

  const DEFAULT_SETTINGS = {
    // 常勤職員の1週間当たりの通常の勤務時間（市マニュアル第Ⅰ章2：週38.75時間）
    fullTimeWeeklyHours: 38.75,
    // 公募によらない再度の任用の上限回数（市マニュアル第Ⅷ章2：原則連続2回・最長3会計年度）
    reappointLimit: 2,
    // この時間以上・フル未満のパートは勤務時間設定の説明が必要（市マニュアル第Ⅱ章2：週35時間以上）
    explainHoursFrom: 35,
    // 報酬の算定式の除数（市マニュアル第Ⅲ章2）
    dailyDivisor: 21,
    hourlyDivisor: 162.75,
    // 期末手当の支給要件（市マニュアル第Ⅳ章10：任用期間6か月以上かつ週15時間30分以上）
    bonusMinMonths: 6,
    bonusMinWeeklyHours: 15.5,
    // 社会保険（市マニュアル第Ⅶ章1：週29時間以上は共済組合（短期）及び厚生年金）
    socialInsHours: 29,
    // 雇用保険（市マニュアル第Ⅶ章2：週20時間以上かつ31日以上の雇用見込み）
    empInsHours: 20,
    // フルタイムの切替時期（市マニュアル第Ⅶ章1・2：退職手当は6月超、共済組合は12月超）
    taishuMonths: 6,
    kyosaiMonths: 12,
    // 健康診断・ストレスチェック（市マニュアル第Ⅶ章4：任用1年かつ週29時間以上）
    healthCheckHours: 29,
    // 年休：週4日以内でも週この時間以上なら「5日以上」の区分（年次休暇の規定のただし書）
    leaveFullColumnHours: 29,
    // 任期満了の何日前から一覧に警告表示するか
    expiryAlertDays: 60,
    // 評価段階（上位から）
    gradeScale: ['S', 'A', 'B', 'C', 'D'],
    // 次年度の再度の任用案で「推薦」とする総合評価
    reappointGrades: ['S', 'A', 'B'],
    // 評価項目（能力評価・業績評価に加えて任意に追加できる）
    evalItems: ['能力評価', '業績評価'],
    // 条件付採用期間（月）。原文確認のうえ設定する。
    probationMonths: 1,
    // 前回バックアップから何日経過したら警告するか
    backupReminderDays: 7,
    orgName: '陸前高田市',
  };

  /* ------------------------------------------------------------
   * 日付
   * ------------------------------------------------------------ */
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function parseISO(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function diffDays(a, b) {
    const MS = 24 * 60 * 60 * 1000;
    return Math.round((parseISO(b) - parseISO(a)) / MS);
  }
  function addDaysISO(s, n) {
    const d = parseISO(s);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  /** 月を加算。月末を超える場合はその月の末日に丸める。 */
  function addMonthsISO(s, n) {
    const d = parseISO(s);
    const day = d.getDate();
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(day, last));
    return toISO(r);
  }
  /** 会計年度（4月始まり） */
  function fiscalYearOf(s) {
    const d = parseISO(s);
    return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  }
  function fiscalYearStart(fy) { return `${fy}-04-01`; }
  function fiscalYearEnd(fy) { return `${fy + 1}-03-31`; }

  /** 和暦表記（令和のみ対応。それ以前は西暦表記） */
  function warekiYear(y) {
    if (y >= 2019) return y === 2019 ? '令和元' : `令和${y - 2018}`;
    return `${y}`;
  }
  function fyLabel(fy) { return `${warekiYear(fy)}年度`; }
  function formatDateJa(s) {
    const d = parseISO(s);
    if (!d) return '';
    const y = d.getFullYear();
    // 令和元年5月1日より前は平成表記
    if (y < 2019 || (y === 2019 && d.getMonth() < 4)) return `${y}年${d.getMonth() + 1}月${d.getDate()}日`;
    return `${warekiYear(y)}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ------------------------------------------------------------
   * データ
   * ------------------------------------------------------------ */
  function emptyData() {
    return {
      version: 1,
      staff: [],
      appointments: [],
      evaluations: [],
      exams: [],
      applicants: [],
      legalTexts: {},
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      lastBackupAt: null,
    };
  }
  /** 読み込んだデータ（古い版・一部欠損を含む）を現在の形に揃える */
  function normalizeData(raw) {
    const base = emptyData();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw };
    for (const k of ['staff', 'appointments', 'evaluations', 'exams', 'applicants']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    out.settings = { ...base.settings, ...(raw.settings || {}) };
    out.legalTexts = { ...(raw.legalTexts || {}) };
    return out;
  }

  /* ------------------------------------------------------------
   * 任用の判定
   * ------------------------------------------------------------ */
  function appointmentsOfStaff(data, staffId) {
    return data.appointments
      .filter((a) => a.staffId === staffId)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  /** 条件付採用期間の終了日（原文確認前の設定値ベース） */
  function probationEnd(appt, settings) {
    const months = Number(settings.probationMonths);
    if (!appt.start || !months) return '';
    return addDaysISO(addMonthsISO(appt.start, months), -1);
  }

  /**
   * 任用の時点で「公募によらない再度の任用」が何回連続しているかを数える。
   * 同じ職員の任用を年度順に並べ、直近の「公募」以降の再度の任用を数える。
   * 任用一覧の「会計年度（何年目）」が入っている任用はその値を正とする（年目−1回）。
   * 同一年度内の任期の更新は再度の任用に数えない。
   */
  function consecutiveReappointCount(data, staffId, uptoAppt) {
    const list = appointmentsOfStaff(data, staffId).filter((a) => a.status !== 'canceled' && (!uptoAppt || a.id !== uptoAppt.id));
    if (uptoAppt) list.push(uptoAppt);
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let count = 0;
    let lastFy = null;
    for (const a of list) {
      const fy = a.fiscalYear != null && a.fiscalYear !== '' ? Number(a.fiscalYear) : fiscalYearOf(a.start);
      if (Number(a.yearInService) > 0) count = Number(a.yearInService) - 1;
      else if (a.recruitMethod === 'public') count = 0;
      else if (a.recruitMethod === 'reappoint' && fy !== lastFy) count += 1;
      lastFy = fy;
      if (uptoAppt && a.id === uptoAppt.id) break;
    }
    return count;
  }
  /**
   * 公募が必要になる会計年度。
   * 採用月にかかわらず採用した年度を1年目と数え、毎年4月の再度の任用（更新）は連続2回まで。
   * 例：R5.11採用・R5.4採用とも R5①・R6②・R7③ → R8.4に公募が必要。
   */
  function publicRecruitFy(data, appt, settings) {
    const limit = settings.reappointLimit;
    if (limit == null || limit === '' || !parseISO(appt.start)) return null;
    return fiscalYearOf(appt.start) + Number(limit) + 2 - yearInServiceOf(data, appt);
  }
  /** 公募から数えて何年目（会計年度）の任用か */
  function yearInServiceOf(data, appt) {
    if (Number(appt.yearInService) > 0) return Number(appt.yearInService);
    if (!appt.staffId) return 1;
    return consecutiveReappointCount(data, appt.staffId, appt) + 1;
  }

  /* ------------------------------------------------------------
   * 任用一覧の区分・給与・保険の判定（市マニュアル）
   * ------------------------------------------------------------ */
  const KUBUN_LABEL = { full: 'フル', part_monthly: 'パート(月額)', part_daily: 'パート(日額)', part_hourly: 'パート(時間額)' };
  function kubunOf(a) { return a.type === 'full' ? 'full' : `part_${a.payType || 'monthly'}`; }
  function applyKubun(rec, kubun) {
    if (kubun === 'full') { rec.type = 'full'; rec.payType = 'monthly'; }
    else { rec.type = 'part'; rec.payType = String(kubun).replace('part_', '') || 'monthly'; }
    return rec;
  }
  function hoursOf(a) { const h = Number(a.weeklyHours); return a.weeklyHours !== '' && a.weeklyHours != null && h > 0 ? h : null; }

  /** 任用期間の月数（端数切捨て）。例：4/1〜3/31＝12、4/1〜9/30＝6 */
  function termMonths(a) {
    if (!parseISO(a.start) || !parseISO(a.end)) return null;
    const s = parseISO(a.start);
    const e = parseISO(addDaysISO(a.end, 1));
    let m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (e.getDate() < s.getDate()) m -= 1;
    return m;
  }

  /** 給料・報酬額の算定（市マニュアル第Ⅲ章。1円未満切捨て） */
  function calcPay(a, settings) {
    const base = Number(a.baseAmount);
    if (!(base > 0)) return null;
    const fl = (x) => Math.floor(x + 1e-9);
    if (a.type === 'full') return fl(base);
    if (a.payType === 'monthly') { const h = hoursOf(a); return h ? fl((base * h) / Number(settings.fullTimeWeeklyHours)) : null; }
    if (a.payType === 'daily') return fl(base / Number(settings.dailyDivisor));
    if (a.payType === 'hourly') return fl(base / Number(settings.hourlyDivisor));
    return null;
  }
  /** 給料・報酬の支給日（市マニュアル第Ⅲ章3） */
  function expectedPayDay(a) {
    return a.type === 'full' || a.payType === 'monthly' ? '毎月21日' : '翌月21日';
  }
  /** 期末手当の支給の有無（市マニュアル第Ⅳ章10）。判定できなければ null */
  function bonusEligibility(a, settings) {
    const h = hoursOf(a);
    const m = termMonths(a);
    if (m == null) return null;
    if (m < Number(settings.bonusMinMonths)) return '無';
    if (h == null) return null;
    return h >= Number(settings.bonusMinWeeklyHours) ? '有' : '無';
  }

  /**
   * 勤続（継続勤務）の開始日。公募で採用し直しても、任用が切れ目なく続いていれば通算する。
   * （公募の判断に使う3年周期の年目 yearInServiceOf とは別に数える）
   *  - 同じ職員の任用を、前の任期の翌日に始まるものを切れ目なしとしてさかのぼる。
   *  - さかのぼった中に「勤続開始日」の入力（overrideKey）があればそれを使う。
   *  - 履歴がない場合、最も古い任用が4月1日開始なら、その3年周期の年目の分だけ4月1日にさかのぼって推定する。
   * fullOnly：フルタイムの任用だけをたどる（退手・共済の切替用）
   */
  function serviceStartOf(data, appt, fullOnly) {
    if (!parseISO(appt.start)) return null;
    const key = fullOnly ? 'fullTimeStart' : 'serviceStart';
    const list = appointmentsOfStaff(data, appt.staffId)
      .filter((a) => a.status !== 'canceled' && a.id !== appt.id && (!fullOnly || a.type === 'full'));
    let cur = appt;
    for (;;) {
      if (parseISO(cur[key])) return { date: cur[key], estimated: false, manual: true };
      const prev = list.find((a) => a.end === addDaysISO(cur.start, -1));
      if (!prev) break;
      cur = prev;
    }
    const y = yearInServiceOf(data, cur);
    if (y > 1 && cur.start.slice(5) === '04-01') {
      return { date: fiscalYearStart(fiscalYearOf(cur.start) - (y - 1)), estimated: true, manual: false };
    }
    return { date: cur.start, estimated: false, manual: false };
  }
  /** フルタイムとして継続して勤務している開始日（退手・共済の切替の起算日） */
  function fullTimeServiceStart(data, appt) {
    if (appt.type !== 'full') return null;
    return serviceStartOf(data, appt, true);
  }
  /** フルタイムの雇用保険→退職手当、健保（共済短期）→共済組合の切替時期（市マニュアル第Ⅶ章1・2） */
  function fullTimeSwitchDates(data, appt, settings) {
    const ss = fullTimeServiceStart(data, appt, settings);
    if (!ss) return null;
    return {
      serviceStart: ss.date,
      estimated: ss.estimated,
      taishu: addMonthsISO(ss.date, Number(settings.taishuMonths)),
      kyosai: addMonthsISO(ss.date, Number(settings.kyosaiMonths)),
    };
  }
  /** 任用開始日時点の社会保険の目安（市マニュアル第Ⅶ章1）。sure=false は要件確認が必要 */
  function suggestSocialIns(data, appt, settings) {
    if (appt.type === 'full') {
      const sw = fullTimeSwitchDates(data, appt, settings);
      return { value: sw && sw.kyosai <= appt.start ? '共済' : '共済(短期)', sure: true };
    }
    const h = hoursOf(appt);
    if (h == null) return null;
    if (h >= Number(settings.socialInsHours)) return { value: '共済(短期)', sure: true };
    if (h >= 20) return { value: '共済(短期)', sure: false, note: '週20時間以上29時間未満：賃金月額8.8万円以上・雇用期間1年以上見込み・学生でない の要件を確認' };
    return { value: '無', sure: true };
  }
  /** 任用開始日時点の雇用保険／退職手当の目安（市マニュアル第Ⅶ章2） */
  function suggestEmpIns(data, appt, settings) {
    if (appt.type === 'full') {
      const sw = fullTimeSwitchDates(data, appt, settings);
      return { value: sw && sw.taishu <= appt.start ? '退手' : '雇用保険', sure: true };
    }
    const h = hoursOf(appt);
    if (h == null) return null;
    const days = parseISO(appt.start) && parseISO(appt.end) ? diffDays(appt.start, appt.end) + 1 : 0;
    return { value: h >= Number(settings.empInsHours) && days >= 31 ? '雇用保険' : '無', sure: true };
  }
  /**
   * 継続勤務年数（年休の表の行）：勤続開始日から任用の日までの年数。
   * 1年未満の端数は1年とみなす（年次休暇の規定）。勤続開始日当日の任用は「任用の日」（0）。
   * 例：R5.4.1から勤続 → R6.4.1は1年、R8.4.1は3年。R5.11.1から勤続 → R6.4.1は5か月の端数で1年。
   * 公募をまたいでも切れ目がなければ通算する。
   */
  function continuousServiceYears(data, appt) {
    const ss = serviceStartOf(data, appt, false);
    if (!ss) return null;
    const s0 = parseISO(ss.date);
    const s1 = parseISO(appt.start);
    if (s1 <= s0) return 0;
    let y = s1.getFullYear() - s0.getFullYear();
    if (s1.getMonth() < s0.getMonth() || (s1.getMonth() === s0.getMonth() && s1.getDate() < s0.getDate())) y -= 1;
    // 満y年の応当日より後なら端数あり → 1年とみなして切り上げ
    const anniversary = addMonthsISO(ss.date, y * 12);
    return anniversary < appt.start ? y + 1 : y;
  }
  // 年次休暇の日数表（市マニュアル第Ⅴ章1）。行：継続勤務年数0〜6以上、列：週5日以上・4日・3日・2日・1日
  const ANNUAL_LEAVE_TABLE = [
    [10, 7, 5, 3, 1],
    [11, 8, 6, 4, 2],
    [12, 9, 6, 4, 2],
    [14, 10, 8, 5, 2],
    [16, 12, 9, 6, 3],
    [18, 13, 10, 6, 3],
    [20, 15, 11, 7, 3],
  ];
  /** 年休の表の列（週の勤務日数、なければ任用期間の勤務日数から）。判定できなければ null、対象外は -1 */
  function annualLeaveColumn(appt, settings) {
    const wd = Number(appt.weeklyDays) || (appt.type === 'full' || appt.payType === 'monthly' ? 5 : 0);
    if (wd) {
      if (wd >= 5) return 0;
      // ただし書：週の勤務日が4日以内でも、週の勤務時間が29時間以上なら「5日以上」の区分
      const h = hoursOf(appt);
      if (h != null && h >= Number((settings || {}).leaveFullColumnHours || 29)) return 0;
      return 5 - Math.floor(wd);
    }
    const ad = Number(appt.annualWorkDays);
    if (!ad) return null;
    if (ad >= 217) return 0;
    if (ad >= 169) return 1;
    if (ad >= 121) return 2;
    if (ad >= 73) return 3;
    if (ad >= 48) return 4;
    return -1;
  }
  /**
   * 年次休暇の付与日数（市マニュアル第Ⅴ章1）。
   * 6月以上の任期が定められている職員が対象（対象外は 0）。前年度からの繰越分は含まない。
   * 週の勤務日数：フル・月額パートは5日、日額・時間額パートは入力値（または任用期間の勤務日数）。
   */
  function annualLeaveDays(data, appt, settings) {
    const m = termMonths(appt);
    if (m == null) return null;
    if (m < 6) return 0;
    const col = annualLeaveColumn(appt, settings);
    if (col == null) return null;
    if (col < 0) return 0;
    const years = Math.min(continuousServiceYears(data, appt) || 0, 6);
    return ANNUAL_LEAVE_TABLE[years][col];
  }
  /** 健康診断・ストレスチェックの対象（市マニュアル第Ⅶ章4） */
  function healthCheckRequired(appt, settings) {
    const h = hoursOf(appt);
    const m = termMonths(appt);
    return h != null && m != null && m >= 12 && h >= Number(settings.healthCheckHours);
  }
  function normInsText(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/\s/g, '');
  }

  /**
   * 任用1件を検査し、問題点の一覧を返す。
   * level: 'error'（登録不可）／'warn'（要確認）
   */
  function validateAppointment(appt, data, settings) {
    const issues = [];
    const err = (msg, basis) => issues.push({ level: 'error', msg, basis });
    const warn = (msg, basis) => issues.push({ level: 'warn', msg, basis });
    const LAW = '【国】地方公務員法第22条の2';
    const MAN = (ch) => `【市】市マニュアル${ch}`;

    if (!appt.staffId) err('職員が選択されていません。');
    const s = parseISO(appt.start);
    const e = parseISO(appt.end);
    if (!s) err('任期の開始日が正しくありません。');
    if (!e) err('任期の終了日が正しくありません。');
    if (s && e) {
      if (e < s) err('任期の終了日が開始日より前になっています。');
      const fy = fiscalYearOf(appt.start);
      if (appt.end > fiscalYearEnd(fy)) {
        err(`任期が会計年度（${fyLabel(fy)}：${fiscalYearEnd(fy)}まで）を超えています。任期は採用の日の属する会計年度の末日までの範囲で定めます。`, LAW);
      }
      if (appt.fiscalYear != null && appt.fiscalYear !== '' && Number(appt.fiscalYear) !== fy) {
        err(`年度欄（${fyLabel(Number(appt.fiscalYear))}）と任期の開始日の年度（${fyLabel(fy)}）が一致しません。`);
      }
    }

    const hours = hoursOf(appt);
    const fullHours = Number(settings.fullTimeWeeklyHours);
    const hoursRequired = appt.type === 'full' || appt.payType === 'monthly';
    if (hours == null) {
      if (hoursRequired) err('1週間当たりの勤務時間を入力してください（フル・月額パートは必須）。');
    } else if (fullHours > 0) {
      if (appt.type === 'full' && hours !== fullHours) {
        err(`フルタイムは1週間当たりの勤務時間が常勤職員と同一（週${fullHours}時間）である必要があります。`, `${LAW}／${MAN('第Ⅰ章2')}`);
      }
      if (appt.type === 'part' && hours >= fullHours) {
        err(`パートタイムは1週間当たりの勤務時間が常勤職員（週${fullHours}時間）より短い必要があります。`, `${LAW}／${MAN('第Ⅰ章2')}`);
      }
      if (appt.type === 'part' && hours >= Number(settings.explainHoursFrom) && hours < fullHours) {
        warn(`週${hours}時間のパートタイムです（週${settings.explainHoursFrom}時間以上${fullHours}時間未満）。勤務時間設定の考え方を説明できるようにしておいてください。`, MAN('第Ⅱ章2'));
      }
    }

    if (!(Number(appt.payAmount) > 0)) {
      warn('給料・報酬額が未入力です。', '【市】陸前高田市会計年度任用職員の給与等に関する条例・規則');
    } else {
      const calc = calcPay(appt, settings);
      if (calc != null && calc !== Number(appt.payAmount)) {
        warn(`給料・報酬額が算定式による額（${calc.toLocaleString('ja-JP')}円）と一致しません（入力：${Number(appt.payAmount).toLocaleString('ja-JP')}円）。`,
          `${MAN('第Ⅲ章1・2')}（月額＝基礎額×週時間/${fullHours}、日額＝基礎額/${settings.dailyDivisor}、時間額＝基礎額/${settings.hourlyDivisor}、1円未満切捨て）`);
      }
    }
    if (appt.payDay && normInsText(appt.payDay) !== expectedPayDay(appt)) {
      warn(`給料・報酬の支給日は「${expectedPayDay(appt)}」です（入力：${appt.payDay}）。`, MAN('第Ⅲ章3'));
    }
    if (appt.bonus) {
      const b = bonusEligibility(appt, settings);
      if (b && b !== normInsText(appt.bonus)) {
        warn(`期末手当は「${b}」と判定されます（入力：${appt.bonus}）。要件：任用期間${settings.bonusMinMonths}か月以上かつ週${settings.bonusMinWeeklyHours}時間以上。`, MAN('第Ⅳ章10'));
      }
    }
    if (appt.socialIns && appt.staffId) {
      const sug = suggestSocialIns(data, appt, settings);
      if (sug && sug.sure && sug.value !== normInsText(appt.socialIns)) {
        warn(`社会保険は「${sug.value}」と判定されます（入力：${appt.socialIns}）。`, MAN('第Ⅶ章1'));
      }
    }
    if (appt.empIns && appt.staffId) {
      const sug = suggestEmpIns(data, appt, settings);
      if (sug && sug.value !== normInsText(appt.empIns)) {
        warn(`雇用保険／退職手当は「${sug.value}」と判定されます（入力：${appt.empIns}）。`, MAN('第Ⅶ章2'));
      }
    }
    if (appt.annualLeave !== '' && appt.annualLeave != null && appt.staffId) {
      const days = annualLeaveDays(data, appt, settings);
      if (days != null && days !== Number(appt.annualLeave)) {
        warn(`年休は${days}日と判定されます（入力：${appt.annualLeave}日。前年度からの繰越分は含めません）。`, `${MAN('第Ⅴ章1')}／年次休暇の規定（週29時間以上のただし書、継続勤務年数の端数は1年）`);
      }
    }
    if (/保育士/.test(appt.title || '') && normInsText(appt.hoikushiCheck) !== '済') {
      warn('保育士の任用です。保育士特定登録取消者管理システムの確認が「済」になっていません。', '任用一覧の確認項目');
    }

    // 同一職員の任期の重複
    if (appt.staffId && s && e) {
      for (const other of data.appointments) {
        if (other.id === appt.id || other.staffId !== appt.staffId || other.status === 'canceled') continue;
        if (!(other.end < appt.start || other.start > appt.end)) {
          err(`同じ職員の別の任用（${other.start}〜${other.end}／${other.dept || ''} ${other.title || ''}）と任期が重なっています。`);
        }
      }
    }

    // 公募によらない再度の任用の回数
    const limit = settings.reappointLimit;
    if (appt.staffId && appt.recruitMethod === 'reappoint' && limit != null && limit !== '' && s) {
      const n = consecutiveReappointCount(data, appt.staffId, appt);
      if (n > Number(limit)) {
        warn(`${n + 1}年目の任用です。公募によらない再度の任用（毎年4月の更新）は連続${limit}回・最長${Number(limit) + 1}会計年度までのため、原則として公募が必要です。`, MAN('第Ⅷ章2'));
      }
    }
    return issues;
  }

  /** 任期の更新（同一会計年度内での任期の延長）の検査 */
  function validateRenewal(appt, newEnd) {
    const issues = [];
    if (!parseISO(newEnd)) {
      issues.push({ level: 'error', msg: '更新後の終了日が正しくありません。' });
      return issues;
    }
    if (newEnd <= appt.end) issues.push({ level: 'error', msg: '更新後の終了日は現在の終了日より後にしてください。' });
    const fy = fiscalYearOf(appt.start);
    if (newEnd > fiscalYearEnd(fy)) {
      issues.push({
        level: 'error',
        msg: `更新後も任期は${fyLabel(fy)}の末日（${fiscalYearEnd(fy)}）までです。次年度は「再度の任用」として新たに任用してください。`,
        basis: '【国】地方公務員法第22条の2',
      });
    }
    return issues;
  }

  /** 基準日時点の任用の状態 */
  function appointmentStatus(appt, todayISO) {
    if (appt.status === 'canceled') return 'canceled';
    if (todayISO < appt.start) return 'planned';
    if (todayISO > appt.end) return 'ended';
    return 'active';
  }
  const STATUS_LABEL = { planned: '任用予定', active: '在職中', ended: '任期満了', canceled: '取消' };

  /** 任期満了が近い在職中の任用 */
  function expiringAppointments(data, todayISO, days) {
    return data.appointments
      .filter((a) => appointmentStatus(a, todayISO) === 'active')
      .map((a) => ({ appt: a, daysLeft: diffDays(todayISO, a.end) }))
      .filter((x) => x.daysLeft <= days)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /* ------------------------------------------------------------
   * 人事評価
   * ------------------------------------------------------------ */
  function evaluationFor(data, staffId, fy) {
    return data.evaluations.find((e) => e.staffId === staffId && Number(e.fiscalYear) === Number(fy)) || null;
  }

  /** 評価項目の結果から総合評価の目安を出す（段階の平均を四捨五入） */
  function suggestOverall(itemGrades, gradeScale) {
    const idx = Object.values(itemGrades || {})
      .map((g) => gradeScale.indexOf(g))
      .filter((i) => i >= 0);
    if (!idx.length) return '';
    const avg = idx.reduce((a, b) => a + b, 0) / idx.length;
    return gradeScale[Math.round(avg)];
  }

  /** 年度内に在職した任用のうち、人事評価が未入力のもの */
  function missingEvaluations(data, fy) {
    const seen = new Set();
    const out = [];
    for (const a of data.appointments) {
      if (a.status === 'canceled') continue;
      if (fiscalYearOf(a.start) !== Number(fy)) continue;
      if (seen.has(a.staffId)) continue;
      seen.add(a.staffId);
      if (!evaluationFor(data, a.staffId, fy)) out.push(a);
    }
    return out;
  }

  /* ------------------------------------------------------------
   * 次年度の再度の任用案
   * ------------------------------------------------------------ */
  /**
   * fy 年度に任用のある職員について、翌年度の任用案を作る（保存はしない）。
   * 同一職員に複数の任用がある場合は最も遅く終わるものを基にする。
   */
  function buildNextYearPlan(data, fy, settings) {
    const nextFy = Number(fy) + 1;
    const latestByStaff = new Map();
    for (const a of data.appointments) {
      if (a.status === 'canceled' || fiscalYearOf(a.start) !== Number(fy)) continue;
      const cur = latestByStaff.get(a.staffId);
      if (!cur || a.end > cur.end) latestByStaff.set(a.staffId, a);
    }
    const plans = [];
    for (const [staffId, base] of latestByStaff) {
      const already = data.appointments.some(
        (a) => a.staffId === staffId && a.status !== 'canceled' && fiscalYearOf(a.start) === nextFy,
      );
      const ev = evaluationFor(data, staffId, fy);
      // 前年度の任用内容を引き継ぎ、年度ごとに確認する項目（伺い・切替時期など）は空にする
      const draft = {
        ...base,
        id: uid('ap'),
        fiscalYear: nextFy,
        start: fiscalYearStart(nextFy),
        end: fiscalYearEnd(nextFy),
        recruitMethod: 'reappoint',
        yearInService: yearInServiceOf(data, base) + 1,
        status: '',
        ukagai: false,
        kyosaiSwitch: '',
        taishuSwitch: '',
        socialIns: '',
        empIns: '',
        note: '',
        renewals: [],
        createdAt: undefined,
      };
      delete draft.createdAt;
      delete draft.examId;
      if (draft.annualLeave !== '' && draft.annualLeave != null) {
        const days = annualLeaveDays({ ...data, appointments: data.appointments.concat([draft]) }, draft, settings);
        if (days != null) draft.annualLeave = days;
      }
      const reasons = [];
      let recommend = true;
      if (already) { recommend = false; reasons.push(`${fyLabel(nextFy)}の任用が登録済み`); }
      if (!ev) { recommend = false; reasons.push(`${fyLabel(fy)}の人事評価が未入力`); }
      else {
        if (ev.recommend === 'no') { recommend = false; reasons.push('評価者の所見：再度の任用不可'); }
        if (ev.recommend === 'hold') { recommend = false; reasons.push('評価者の所見：要検討'); }
        if (ev.overall && !settings.reappointGrades.includes(ev.overall)) {
          recommend = false; reasons.push(`総合評価 ${ev.overall}（推薦基準：${settings.reappointGrades.join('・')}）`);
        }
        if (ev.wish === 'no') { recommend = false; reasons.push('本人が再度の任用を希望していない'); }
        if (!ev.wish) reasons.push('本人の希望が未確認');
      }
      const n = draft.yearInService - 1;
      const limit = settings.reappointLimit;
      const overLimit = limit != null && limit !== '' && n > Number(limit);
      if (overLimit) { recommend = false; reasons.push(`${fyLabel(nextFy)}は${draft.yearInService}年目となり、公募によらない再度の任用（毎年4月の更新）の上限（連続${limit}回・${Number(limit) + 1}会計年度）を超える → ${toWarekiShort(fiscalYearStart(nextFy))}に公募が必要`); }
      plans.push({ staffId, base, draft, evaluation: ev, recommend, reasons, already, reappointCount: n, overLimit });
    }
    return plans;
  }

  /* ------------------------------------------------------------
   * 採用試験
   * ------------------------------------------------------------ */
  function applicantTotal(applicant, exam) {
    const stages = exam.stages || [];
    let total = 0;
    let complete = stages.length > 0;
    for (const st of stages) {
      const v = applicant.scores ? applicant.scores[st] : undefined;
      if (v === undefined || v === null || v === '' || isNaN(Number(v))) { complete = false; continue; }
      total += Number(v);
    }
    return { total, complete };
  }
  /** 合計点の降順で順位を付ける（同点は同順位） */
  function rankApplicants(applicants, exam) {
    const rows = applicants
      .filter((a) => a.examId === exam.id && a.result !== 'decline')
      .map((a) => ({ a, ...applicantTotal(a, exam) }))
      .sort((x, y) => y.total - x.total);
    let prev = null;
    let rank = 0;
    rows.forEach((r, i) => {
      if (prev === null || r.total !== prev) rank = i + 1;
      r.rank = rank;
      prev = r.total;
    });
    return rows;
  }

  /* ------------------------------------------------------------
   * Excel取込（見出し名の揺れを吸収して列を対応付ける）
   * ------------------------------------------------------------ */
  const IMPORT_SCHEMAS = {
    staff: {
      label: '職員台帳',
      fields: {
        number: ['職員番号', '番号', '個人番号', '職員コード', 'no'],
        name: ['氏名', '名前', '職員氏名'],
        kana: ['ふりがな', 'フリガナ', 'カナ', '氏名カナ', 'よみ'],
        gender: ['性別'],
        birth: ['生年月日', '誕生日'],
        phone: ['電話番号', '連絡先', '電話'],
        address: ['住所'],
        note: ['備考'],
      },
      required: ['name'],
    },
    appointments: {
      label: '任用',
      fields: {
        number: ['職員番号', '番号', '個人番号', '職員コード'],
        name: ['氏名', '名前', '職員氏名'],
        dept: ['所属', '所属課', '所属名', '課名'],
        section: ['係', '係名'],
        title: ['職名', '職種', '業務'],
        type: ['区分', '勤務形態', 'フルパート', '任用区分'],
        start: ['任期開始', '任用開始日', '開始日', '任期（自）', '任期自', '採用日'],
        end: ['任期終了', '任用終了日', '終了日', '任期（至）', '任期至'],
        weeklyHours: ['週勤務時間', '週所定労働時間', '1週間の勤務時間', '勤務時間（週）', '週時間'],
        payType: ['報酬区分', '報酬形態', '給与区分'],
        payAmount: ['報酬額', '報酬', '給料', '給料月額', '報酬月額', '時給', '日額'],
        recruitMethod: ['採用方法', '任用方法', '公募区分'],
        note: ['備考'],
      },
      required: ['name', 'start', 'end'],
    },
    evaluations: {
      label: '人事評価',
      fields: {
        number: ['職員番号', '番号', '個人番号', '職員コード'],
        name: ['氏名', '名前', '職員氏名'],
        fiscalYear: ['年度', '評価年度'],
        evaluator: ['評価者', '一次評価者'],
        ability: ['能力評価', '能力'],
        performance: ['業績評価', '業績'],
        overall: ['総合評価', '総合', '評語'],
        recommend: ['再度の任用', '次年度任用', '所見（任用）'],
        comment: ['所見', 'コメント', '評価コメント'],
      },
      required: ['name', 'fiscalYear'],
    },
    applicants: {
      label: '応募者',
      fields: {
        name: ['氏名', '名前', '応募者氏名'],
        kana: ['ふりがな', 'フリガナ', 'カナ'],
        gender: ['性別'],
        birth: ['生年月日'],
        phone: ['電話番号', '連絡先', '電話'],
        address: ['住所'],
        note: ['備考'],
      },
      required: ['name'],
    },
  };

  function normalizeHeader(h) {
    return String(h == null ? '' : h)
      .normalize('NFKC')
      .replace(/[\s　]/g, '')
      .replace(/[（）()]/g, (c) => ({ '（': '(', '）': ')' }[c] || c))
      .toLowerCase();
  }
  /** 見出し行を探して、フィールド→列番号の対応表を返す（先頭10行を走査） */
  function detectColumns(rows, schemaKey) {
    const schema = IMPORT_SCHEMAS[schemaKey];
    let best = { headerRow: -1, map: {}, score: 0 };
    const limit = Math.min(rows.length, 10);
    for (let r = 0; r < limit; r++) {
      const cells = (rows[r] || []).map(normalizeHeader);
      const map = {};
      let score = 0;
      for (const [field, aliases] of Object.entries(schema.fields)) {
        const normAliases = aliases.map(normalizeHeader);
        // 完全一致を優先し、なければ前方一致
        let idx = cells.findIndex((c) => c && normAliases.includes(c));
        if (idx < 0) idx = cells.findIndex((c) => c && normAliases.some((a) => c.startsWith(a)));
        if (idx >= 0 && !Object.values(map).includes(idx)) { map[field] = idx; score += 1; }
      }
      if (score > best.score) best = { headerRow: r, map, score };
    }
    return best;
  }

  function excelValueToISO(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return toISO(v);
    if (typeof v === 'number') {
      // Excelのシリアル値（1900年日付系）
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) return toISO(new Date(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(R|令和)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) {
      const y = 2018 + (m[2] === '元' ? 1 : Number(m[2]));
      return toISO(new Date(y, +m[3] - 1, +m[4]));
    }
    m = s.match(/^(H|平成)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) {
      const y = 1988 + (m[2] === '元' ? 1 : Number(m[2]));
      return toISO(new Date(y, +m[3] - 1, +m[4]));
    }
    m = s.match(/^(S|昭和)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) {
      const y = 1925 + (m[2] === '元' ? 1 : Number(m[2]));
      return toISO(new Date(y, +m[3] - 1, +m[4]));
    }
    return '';
  }
  /** 「令和8年度」「R8」「2026」などを西暦の年度に */
  function parseFiscalYear(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v > 1900 ? v : 2018 + v;
    const s = String(v).trim();
    let m = s.match(/(\d{4})/);
    if (m) return Number(m[1]);
    m = s.match(/(?:R|令和)\s*(\d{1,2}|元)/);
    if (m) return 2018 + (m[1] === '元' ? 1 : Number(m[1]));
    return null;
  }
  function parseGender(v) {
    const s = String(v == null ? '' : v).trim();
    if (['男', '男性', 'M', 'm', '1'].includes(s)) return 'M';
    if (['女', '女性', 'F', 'f', '2', '0'].includes(s)) return 'F';
    return '';
  }
  function parseAppointType(v, hours, settings) {
    const s = String(v == null ? '' : v);
    if (/フル|2号|第2号/.test(s)) return 'full';
    if (/パート|1号|第1号/.test(s)) return 'part';
    if (Number(hours) > 0 && Number(hours) === Number(settings.fullTimeWeeklyHours)) return 'full';
    return 'part';
  }
  function parsePayType(v) {
    const s = String(v == null ? '' : v);
    if (/日/.test(s)) return 'daily';
    if (/時/.test(s)) return 'hourly';
    return 'monthly';
  }
  function parseRecruit(v) {
    const s = String(v == null ? '' : v);
    if (/再度|再任|更新|継続/.test(s)) return 'reappoint';
    return 'public';
  }
  function parseRecommend(v) {
    const s = String(v == null ? '' : v);
    if (!s) return '';
    if (/不可|否|×/.test(s)) return 'no';
    if (/検討|保留|△/.test(s)) return 'hold';
    if (/可|適|○|〇/.test(s)) return 'yes';
    return '';
  }
  function toNumber(v) {
    if (v == null || v === '') return '';
    const n = Number(String(v).replace(/[,，円\s]/g, ''));
    return isNaN(n) ? '' : n;
  }
  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return toISO(v);
    return String(v).trim();
  }

  /**
   * シートの行データ（2次元配列）を取込用レコードに変換する。
   * 戻り値：{ records, skipped, map, headerRow }
   */
  function rowsToRecords(rows, schemaKey, settings) {
    const schema = IMPORT_SCHEMAS[schemaKey];
    const det = detectColumns(rows, schemaKey);
    const missing = schema.required.filter((f) => det.map[f] === undefined);
    if (det.headerRow < 0 || missing.length) {
      return {
        records: [],
        skipped: [],
        map: det.map,
        headerRow: det.headerRow,
        error: `見出し行に必要な列が見つかりません：${missing.map((f) => schema.fields[f][0]).join('、')}`,
      };
    }
    const records = [];
    const skipped = [];
    for (let r = det.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = (f) => (det.map[f] === undefined ? '' : row[det.map[f]]);
      if (!cellText(get('name'))) { if (row.some((c) => c != null && c !== '')) skipped.push({ row: r + 1, reason: '氏名が空欄' }); continue; }
      const rec = {};
      for (const f of Object.keys(schema.fields)) rec[f] = get(f);
      // 型の整形
      rec.name = cellText(rec.name).replace(/\s+/g, ' ');
      if ('number' in rec) rec.number = cellText(rec.number);
      if ('kana' in rec) rec.kana = cellText(rec.kana);
      if ('gender' in rec) rec.gender = parseGender(rec.gender);
      if ('birth' in rec) rec.birth = excelValueToISO(rec.birth);
      for (const f of ['phone', 'address', 'note', 'dept', 'section', 'title', 'evaluator', 'comment']) {
        if (f in rec) rec[f] = cellText(rec[f]);
      }
      if (schemaKey === 'appointments') {
        rec.start = excelValueToISO(rec.start);
        rec.end = excelValueToISO(rec.end);
        rec.weeklyHours = toNumber(rec.weeklyHours);
        rec.type = parseAppointType(rec.type, rec.weeklyHours, settings);
        rec.payType = parsePayType(rec.payType);
        rec.payAmount = toNumber(rec.payAmount);
        rec.recruitMethod = parseRecruit(rec.recruitMethod);
        if (!rec.start || !rec.end) { skipped.push({ row: r + 1, reason: '任期の日付が読み取れません' }); continue; }
      }
      if (schemaKey === 'evaluations') {
        rec.fiscalYear = parseFiscalYear(rec.fiscalYear);
        rec.recommend = parseRecommend(rec.recommend);
        for (const f of ['ability', 'performance', 'overall']) rec[f] = cellText(rec[f]).toUpperCase();
        if (!rec.fiscalYear) { skipped.push({ row: r + 1, reason: '年度が読み取れません' }); continue; }
      }
      rec._row = r + 1;
      records.push(rec);
    }
    return { records, skipped, map: det.map, headerRow: det.headerRow };
  }

  /* ------------------------------------------------------------
   * 総務課「任用一覧」Excel（1行＝1任用）の読込・書出し
   * ------------------------------------------------------------ */
  /** 'R8.4.1' → '2026-04-01'（R/H/令和/平成、区切りは . / 年月日） */
  function parseWarekiShort(v) {
    return excelValueToISO(typeof v === 'string' ? v.normalize('NFKC').replace(/\s/g, '') : v);
  }
  function toWarekiShort(iso) {
    const d = parseISO(iso);
    if (!d) return '';
    const y = d.getFullYear();
    return y >= 2019 ? `R${y - 2018}.${d.getMonth() + 1}.${d.getDate()}` : `${y}.${d.getMonth() + 1}.${d.getDate()}`;
  }
  /** 'R8.4.1～R9.3.31' → ['2026-04-01','2027-03-31'] */
  function parsePeriod(v) {
    if (v == null || v === '') return null;
    const s = String(v).normalize('NFKC').replace(/\s/g, '');
    const parts = s.split(/[~〜～―]|から|-(?=[RHS令平昭])/).filter(Boolean);
    if (parts.length < 2) return null;
    const a = parseWarekiShort(parts[0].replace(/まで$/, ''));
    const b = parseWarekiShort(parts[parts.length - 1].replace(/まで$/, ''));
    return a && b ? [a, b] : null;
  }
  /** 切替時期のセル：Excelで「4/1」と入力されると年付きの日付になるため、月/日の文字にする */
  function switchCellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return `${v.getMonth() + 1}/${v.getDate()}`;
    const s = String(v).trim();
    return s === '-' || s === '－' ? '' : s;
  }
  function dashToEmpty(v) {
    const s = cellText(v);
    return s === '-' || s === '－' || s === 'ー' ? '' : s;
  }

  const ICHIRAN_COLUMNS = [
    // [フィールド, 見出しの判定（NFKC・空白除去後）]
    ['ukagai', (h) => h.startsWith('任用伺')],
    ['yearInService', (h) => h === '会計年度'],
    ['number', (h) => h === '職員番号'],
    ['kubun', (h) => h === '区分'],
    ['name', (h) => h === '氏名'],
    ['kana', (h) => h === 'フリガナ' || h === 'ふりがな'],
    ['deptCode', (h) => h === '所属CD' || h === '所属コード'],
    ['dept', (h) => h === '所属名' || h === '所属'],
    ['account', (h) => h === '会計'],
    ['budgetCode', (h) => h === '予算科目'],
    ['period', (h) => h === '任用期間'],
    ['workplace', (h) => h === '就業場所'],
    ['title', (h) => h === '業務内容'],
    ['weeklyHours', (h) => h.startsWith('勤務時間')],
    ['annualLeave', (h) => h.startsWith('年休')],
    ['baseAmount', (h) => h === '基礎額'],
    ['payTypeText', (h) => h === '給料・報酬'],
    ['payDay', (h) => h === '給料・報酬支給日'],
    ['bonus', (h) => h.startsWith('期末手当')],
    ['commuteDay', (h) => h === '通勤手当支給日'],
    ['socialIns', (h) => h.endsWith('社会保険')],
    ['kyosaiSwitch', (h) => h.includes('共済切替')],
    ['empIns', (h) => h.endsWith('雇保/退手')],
    ['taishuSwitch', (h) => h.includes('退手切替')],
    ['hoikushiCheck', (h) => h.includes('保育士特定登録')],
    ['note', (h) => h === '備考'],
  ];
  const ICHIRAN_HEADERS = ['任用\n伺い', '会計\n年度', '職員\n番号', '区分', '氏名', 'ﾌﾘｶﾞﾅ', '所属\nCD', '所属名', '会計', '予算科目', '任用期間',
    '就業\n場所', '業務内容', '勤務\n時間/週', '年休\n（日数）', '基礎額', '給料・報酬', '', '給料・報酬\n支給日', '期末手当\n支給の有無',
    '通勤手当\n支給日', '{FY}\n社会保険', '健保→共済\n切替時期', '{FY}\n雇保/退手', '雇保→退手\n切替時期', '保育士特定登録取消者管理システム', '備考'];

  function ichiranHeaderKey(h) { return String(h == null ? '' : h).normalize('NFKC').replace(/\s/g, ''); }

  /** 見出し行を探して列の対応を返す。「給料・報酬」の右隣の見出しなし列を金額とする。 */
  function detectIchiranColumns(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hs = (rows[r] || []).map(ichiranHeaderKey);
      if (!hs.includes('氏名') || !(hs.includes('任用期間') || hs.includes('区分'))) continue;
      const map = {};
      hs.forEach((h, i) => {
        if (!h) return;
        const hit = ICHIRAN_COLUMNS.find(([f, test]) => map[f] === undefined && test(h));
        if (hit) map[hit[0]] = i;
      });
      if (map.payTypeText !== undefined && !hs[map.payTypeText + 1]) map.payAmount = map.payTypeText + 1;
      const fyHeader = hs.find((h) => /社会保険$/.test(h));
      const fy = fyHeader ? fiscalYearOf(parseWarekiShort(fyHeader.replace(/社会保険$/, '')) || '') : null;
      return { headerRow: r, map, fy: Number.isFinite(fy) ? fy : null };
    }
    return { headerRow: -1, map: {}, fy: null };
  }

  function parseKubun(kubunText, payTypeText) {
    const s = String(kubunText || '').normalize('NFKC');
    if (/フル/.test(s)) return 'full';
    const t = `${s}${String(payTypeText || '')}`;
    if (/時間/.test(t)) return 'part_hourly';
    if (/日額/.test(t)) return 'part_daily';
    if (/月額/.test(t) || /パート/.test(s)) return 'part_monthly';
    return '';
  }

  /**
   * 任用一覧の行データ（2次元配列）を取込用レコードに変換する。
   * defaultFy：任用期間が空欄の行に使う年度（見出しの「R8.4.1 社会保険」から読めればそちらを優先）
   */
  function parseNinyoIchiran(rows, defaultFy) {
    const det = detectIchiranColumns(rows);
    if (det.headerRow < 0) {
      return { records: [], skipped: [], error: '「氏名」「任用期間」（または「区分」）の見出しがある行が見つかりません。任用一覧の様式か確認してください。' };
    }
    const fy = det.fy || defaultFy;
    const records = [];
    const skipped = [];
    const get = (row, f) => (det.map[f] === undefined ? '' : row[det.map[f]]);
    for (let r = det.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = cellText(get(row, 'name'));
      if (!name) { if (row.some((c) => c != null && c !== '')) skipped.push({ row: r + 1, reason: '氏名が空欄' }); continue; }
      const notes = [];
      const kubun = parseKubun(get(row, 'kubun'), get(row, 'payTypeText'));
      if (!kubun) notes.push('区分を読み取れないため「パート(月額)」として登録');
      let period = parsePeriod(get(row, 'period'));
      if (!period) {
        if (!fy) { skipped.push({ row: r + 1, reason: '任用期間が空欄で、年度も判定できません' }); continue; }
        period = [fiscalYearStart(fy), fiscalYearEnd(fy)];
        notes.push(`任用期間が空欄のため${fyLabel(fy)}の1年間として登録（要確認）`);
      }
      const hoursRaw = get(row, 'weeklyHours');
      const hoursNum = toNumber(hoursRaw);
      const yis = toNumber(get(row, 'yearInService'));
      const rec = applyKubun({
        number: cellText(get(row, 'number')),
        name,
        kana: cellText(get(row, 'kana')),
        ukagai: /[○〇◯済]/.test(cellText(get(row, 'ukagai'))),
        yearInService: yis === '' ? '' : yis,
        deptCode: cellText(get(row, 'deptCode')),
        dept: cellText(get(row, 'dept')),
        account: cellText(get(row, 'account')),
        budgetCode: cellText(get(row, 'budgetCode')),
        start: period[0],
        end: period[1],
        workplace: cellText(get(row, 'workplace')),
        title: cellText(get(row, 'title')),
        weeklyHours: hoursNum,
        hoursText: hoursNum === '' ? dashToEmpty(hoursRaw) : '',
        annualLeave: toNumber(dashToEmpty(get(row, 'annualLeave'))),
        baseAmount: toNumber(get(row, 'baseAmount')),
        payAmount: toNumber(get(row, 'payAmount')),
        payDay: dashToEmpty(get(row, 'payDay')),
        bonus: dashToEmpty(get(row, 'bonus')),
        commuteDay: dashToEmpty(get(row, 'commuteDay')),
        socialIns: normInsText(dashToEmpty(get(row, 'socialIns'))),
        kyosaiSwitch: switchCellText(get(row, 'kyosaiSwitch')),
        empIns: normInsText(dashToEmpty(get(row, 'empIns'))),
        taishuSwitch: switchCellText(get(row, 'taishuSwitch')),
        hoikushiCheck: cellText(get(row, 'hoikushiCheck')),
        note: cellText(get(row, 'note')),
        recruitMethod: Number(yis) >= 2 ? 'reappoint' : 'public',
      }, kubun || 'part_monthly');
      rec._row = r + 1;
      rec._notes = notes;
      records.push(rec);
    }
    return { records, skipped, map: det.map, headerRow: det.headerRow, fy };
  }

  /** 任用一覧の様式（同じ列構成）で書き出す行データ */
  function ninyoIchiranRows(data, fy, settings) {
    const header = ICHIRAN_HEADERS.map((h) => h.replace('{FY}', toWarekiShort(fiscalYearStart(Number(fy)))));
    const list = data.appointments
      .filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === Number(fy))
      .sort((a, b) => String(a.deptCode || '').localeCompare(String(b.deptCode || '')) || String(a.dept || '').localeCompare(String(b.dept || ''), 'ja'));
    const rows = [header];
    for (const a of list) {
      const s = data.staff.find((x) => x.id === a.staffId) || {};
      const sw = fullTimeSwitchDates(data, a, settings);
      const md = (iso) => { const d = parseISO(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };
      rows.push([
        a.ukagai ? '○' : '',
        yearInServiceOf(data, a),
        s.number || '',
        KUBUN_LABEL[kubunOf(a)],
        s.name || '',
        s.kana || '',
        a.deptCode || '',
        a.dept || '',
        a.account || '',
        a.budgetCode || '',
        `${toWarekiShort(a.start)}～${toWarekiShort(a.end)}`,
        a.workplace || '',
        a.title || '',
        hoursOf(a) != null ? hoursOf(a) : a.hoursText || '',
        a.annualLeave === '' || a.annualLeave == null ? (annualLeaveDays(data, a, settings) || '-') : a.annualLeave,
        a.baseAmount === '' || a.baseAmount == null ? '' : a.baseAmount,
        PAY_TYPE_LABEL[a.payType] || '',
        a.payAmount === '' || a.payAmount == null ? '' : a.payAmount,
        a.payDay || expectedPayDay(a),
        a.bonus || bonusEligibility(a, settings) || '',
        a.commuteDay || expectedPayDay(a),
        a.socialIns || '',
        a.kyosaiSwitch || (sw ? md(sw.kyosai) : '-'),
        a.empIns || '',
        a.taishuSwitch || (sw ? md(sw.taishu) : '-'),
        a.hoikushiCheck || '-',
        a.note || '',
      ]);
    }
    return rows;
  }

  /** 職員番号優先、なければ氏名（空白除去）で職員を探す */
  function findStaff(data, number, name) {
    if (number) {
      const byNo = data.staff.find((s) => s.number && String(s.number) === String(number));
      if (byNo) return byNo;
    }
    const key = String(name || '').replace(/[\s　]/g, '');
    if (!key) return null;
    const hits = data.staff.filter((s) => String(s.name).replace(/[\s　]/g, '') === key);
    return hits.length === 1 ? hits[0] : null;
  }

  const api = {
    APPOINT_TYPE_LABEL, APPOINT_TYPE_SHORT, RECRUIT_LABEL, PAY_TYPE_LABEL, EXAM_METHOD_LABEL,
    RESULT_LABEL, RECOMMEND_LABEL, WISH_LABEL, STATUS_LABEL, DEFAULT_SETTINGS, IMPORT_SCHEMAS, KUBUN_LABEL,
    toISO, parseISO, diffDays, addDaysISO, addMonthsISO, fiscalYearOf, fiscalYearStart, fiscalYearEnd,
    warekiYear, fyLabel, formatDateJa, uid,
    emptyData, normalizeData,
    appointmentsOfStaff, probationEnd, consecutiveReappointCount, yearInServiceOf, publicRecruitFy, validateAppointment, validateRenewal,
    kubunOf, applyKubun, hoursOf, termMonths, calcPay, expectedPayDay, bonusEligibility, fullTimeServiceStart,
    fullTimeSwitchDates, suggestSocialIns, suggestEmpIns, healthCheckRequired, serviceStartOf, continuousServiceYears, annualLeaveDays,
    parsePeriod, toWarekiShort, parseNinyoIchiran, ninyoIchiranRows,
    appointmentStatus, expiringAppointments,
    evaluationFor, suggestOverall, missingEvaluations, buildNextYearPlan,
    applicantTotal, rankApplicants,
    normalizeHeader, detectColumns, excelValueToISO, parseFiscalYear, parseGender, rowsToRecords, findStaff,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
