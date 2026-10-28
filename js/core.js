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
  const RETIRE_LABEL = { expiry: '任期満了', resign: '自己都合退職', other: 'その他の退職' };

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
  /** 元号（令和：2019/5/1〜、平成：1989/1/8〜、昭和：1926/12/25〜） */
  function eraOf(d) {
    const iso = toISO(d);
    const y = d.getFullYear();
    if (iso >= '2019-05-01') return { name: '令和', code: 'R', year: y - 2018 };
    if (iso >= '1989-01-08') return { name: '平成', code: 'H', year: y - 1988 };
    if (iso >= '1926-12-25') return { name: '昭和', code: 'S', year: y - 1925 };
    return null;
  }
  function formatDateJa(s) {
    const d = parseISO(s);
    if (!d) return '';
    const e = eraOf(d);
    const md = `${d.getMonth() + 1}月${d.getDate()}日`;
    if (!e) return `${d.getFullYear()}年${md}`;
    return `${e.name}${e.year === 1 ? '元' : e.year}年${md}`;
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
      recruitPositions: [],
      kamoku: [],
      recruitDecisions: {},
      legalTexts: {},
      yearEnd: {},
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      lastBackupAt: null,
    };
  }
  /** 読み込んだデータ（古い版・一部欠損を含む）を現在の形に揃える */
  function normalizeData(raw) {
    const base = emptyData();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw };
    if (!raw.recruitDecisions || typeof raw.recruitDecisions !== 'object') out.recruitDecisions = {};
    for (const k of ['staff', 'appointments', 'evaluations', 'exams', 'applicants', 'recruitPositions', 'kamoku']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    // 会計年度任用職員以外（区分名が入っていて別の区分）の職員は扱わない
    const others = new Set(out.staff.filter((s) => s.category && !isMeiboTarget(s.category)).map((s) => s.id));
    if (others.size) {
      out.staff = out.staff.filter((s) => !others.has(s.id));
      out.appointments = out.appointments.filter((a) => !others.has(a.staffId));
      out.evaluations = out.evaluations.filter((e) => !others.has(e.staffId));
    }
    out.settings = { ...base.settings, ...(raw.settings || {}) };
    out.legalTexts = { ...(raw.legalTexts || {}) };
    if (!raw.yearEnd || typeof raw.yearEnd !== 'object') out.yearEnd = {};
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
  function staffOf(data, id) { return (data.staff || []).find((s) => s.id === id) || null; }
  /** 年数確認データで取り込んだ「会計年度任用年数」（職員ごと・年度ごと） */
  function cycleYearFromStaff(data, a) {
    const st = staffOf(data, a.staffId);
    if (!st || !st.cycleYears || !parseISO(a.start)) return 0;
    return Number(st.cycleYears[fiscalYearOf(a.start)]) || 0;
  }
  /** 任用に明示された3年周期の年目（任用の入力 → 年数確認データの順） */
  function explicitCycleYear(data, a) {
    return Number(a.yearInService) > 0 ? Number(a.yearInService) : cycleYearFromStaff(data, a);
  }
  function consecutiveReappointCount(data, staffId, uptoAppt) {
    const list = appointmentsOfStaff(data, staffId).filter((a) => a.status !== 'canceled' && (!uptoAppt || a.id !== uptoAppt.id));
    if (uptoAppt) list.push(uptoAppt);
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let count = 0;
    let lastFy = null;
    for (const a of list) {
      const fy = a.fiscalYear != null && a.fiscalYear !== '' ? Number(a.fiscalYear) : fiscalYearOf(a.start);
      const ey = explicitCycleYear(data, a);
      if (ey > 0) count = ey - 1;
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
    const ey = explicitCycleYear(data, appt);
    if (ey > 0) return ey;
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
   *  - さかのぼった先がその職員の最初の任用（それより前の履歴がない）で、職員名簿の採用日（最初に採用された日）が
   *    それより前なら、採用日から通算する（source: 'roster'）。途中で途切れていれば「勤続開始日」を入力する。
   *  - 採用日もない場合、最も古い任用が4月1日開始なら、その3年周期の年目の分だけ4月1日にさかのぼって推定する。
   * fullOnly：フルタイムの任用だけをたどる（退手・共済の切替用。名簿の採用日はフルかどうか分からないため使わない）
   * 戻り値：{ date, estimated, manual, source: 'manual'|'history'|'roster'|'estimate' }
   */
  function serviceStartOf(data, appt, fullOnly) {
    if (!parseISO(appt.start)) return null;
    const key = fullOnly ? 'fullTimeStart' : 'serviceStart';
    const list = appointmentsOfStaff(data, appt.staffId)
      .filter((a) => a.status !== 'canceled' && a.id !== appt.id && (!fullOnly || a.type === 'full'));
    let cur = appt;
    for (;;) {
      if (parseISO(cur[key])) return { date: cur[key], estimated: false, manual: true, source: 'manual' };
      const prev = list.find((a) => a.end === addDaysISO(cur.start, -1));
      if (!prev) break;
      cur = prev;
    }
    // 人事システムの任用（在職期間）があれば、それで切れ目なく続く期間の開始日を使う
    const emp = employmentChainStart(staffOf(data, appt.staffId), appt.start, fullOnly);
    if (emp) return { date: emp, estimated: false, manual: false, source: 'jinji' };
    if (!fullOnly) {
      const staff = (data.staff || []).find((x) => x.id === appt.staffId);
      const earlier = appointmentsOfStaff(data, appt.staffId).some((a) => a.status !== 'canceled' && a.id !== cur.id && a.start < cur.start);
      if (staff && parseISO(staff.hireDate) && staff.hireDate < cur.start && !earlier) {
        return { date: staff.hireDate, estimated: false, manual: false, source: 'roster' };
      }
    }
    const y = yearInServiceOf(data, cur);
    if (y > 1 && cur.start.slice(5) === '04-01') {
      return { date: fiscalYearStart(fiscalYearOf(cur.start) - (y - 1)), estimated: true, manual: false, source: 'estimate' };
    }
    return { date: cur.start, estimated: false, manual: false, source: 'history' };
  }
  /* ------------------------------------------------------------
   * 人事システムの任用（在職期間）：人事sys→ﾆ 任用 の検索結果
   * 1行＝1つの在職期間（区分が変わると別の行）。終了日が空欄なら継続中。
   * ------------------------------------------------------------ */
  function kubunFromText(v) {
    const t = String(v == null ? '' : v).normalize('NFKC');
    if (/フル/.test(t)) return 'full';
    if (/時間/.test(t)) return 'part_hourly';
    if (/日額/.test(t)) return 'part_daily';
    if (/月額|パート/.test(t)) return 'part_monthly';
    return '';
  }
  function sortedPeriods(staff, fullOnly) {
    return ((staff && staff.employment) || [])
      .filter((p) => parseISO(p.start) && (!fullOnly || p.kubun === 'full'))
      .slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }
  /** iso を含む在職期間から、前の期間の終了日の翌日に始まる期間を切れ目なくさかのぼった開始日 */
  function employmentChainStart(staff, iso, fullOnly) {
    const ps = sortedPeriods(staff, fullOnly);
    let cur = ps.find((p) => p.start <= iso && (!p.end || iso <= p.end));
    if (!cur) return null;
    for (;;) {
      const prev = ps.find((p) => p.end && addDaysISO(p.end, 1) === cur.start);
      if (!prev) break;
      cur = prev;
    }
    return cur.start;
  }
  /** 在職期間の一覧に、前の期間とのつながり（連続／空き日数）を付ける */
  function employmentTimeline(staff) {
    const ps = sortedPeriods(staff, false);
    return ps.map((p, i) => {
      const prev = ps[i - 1];
      const gap = prev && prev.end ? diffDays(prev.end, p.start) - 1 : null;
      return { ...p, gapDays: prev ? gap : null, continuous: prev ? gap === 0 : null };
    });
  }
  /** 人事システムの任用の行を取込用レコードに変換する */
  function parseJinjiNinyo(rows) {
    let headerRow = -1;
    const map = {};
    const tests = [
      ['number', (h) => h === '職員番号' || h === '番号'],
      ['name', (h) => h === '氏名'],
      ['kubun', (h) => h === '区分'],
      ['start', (h) => h === '開始日'],
      ['end', (h) => h === '終了日'],
      ['reason', (h) => h === '退職事由'],
      ['note', (h) => h === '備考'],
    ];
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hs = (rows[r] || []).map((h) => String(h == null ? '' : h).normalize('NFKC').replace(/\s/g, ''));
      if (!hs.includes('開始日') || !hs.includes('氏名')) continue;
      headerRow = r;
      hs.forEach((h, i) => { const hit = tests.find(([f, t]) => map[f] === undefined && t(h)); if (hit) map[hit[0]] = i; });
      break;
    }
    if (headerRow < 0) return { records: [], skipped: [], error: '「職員番号」「氏名」「区分」「開始日」「終了日」の見出しがある行が見つかりません。人事システムの任用の検索結果か確認してください。' };
    const get = (row, f) => (map[f] === undefined ? '' : row[map[f]]);
    const records = [];
    const skipped = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((c) => c != null && c !== '')) continue;
      const name = cellText(get(row, 'name'));
      const start = excelValueToISO(get(row, 'start'));
      if (!name) { skipped.push({ row: r + 1, reason: '氏名が空欄' }); continue; }
      if (!start) { skipped.push({ row: r + 1, reason: '開始日が読み取れません' }); continue; }
      const reason = cellText(get(row, 'reason'));
      records.push({
        _row: r + 1,
        number: cellText(get(row, 'number')),
        name,
        kubunText: cellText(get(row, 'kubun')),
        kubun: kubunFromText(get(row, 'kubun')),
        start,
        end: excelValueToISO(get(row, 'end')),
        reason: reason === '未入力' ? '' : reason,
        note: cellText(get(row, 'note')),
      });
    }
    return { records, skipped, headerRow, map };
  }

  /* ------------------------------------------------------------
   * 年数確認データ（3年周期の何年目か）：番号・会計年度任用年数・身分・氏名・所属名・職名
   * ------------------------------------------------------------ */
  function parseNensu(rows) {
    let headerRow = -1;
    const map = {};
    const tests = [
      ['number', (h) => h === '番号' || h === '職員番号'],
      ['years', (h) => h.startsWith('会計年度任用年数') || h === '任用年数' || h === '年数'],
      ['kubun', (h) => h === '身分' || h === '区分'],
      ['name', (h) => h === '氏名'],
      ['dept', (h) => h === '所属名' || h === '所属'],
      ['title', (h) => h === '職名'],
    ];
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hs = (rows[r] || []).map((h) => String(h == null ? '' : h).normalize('NFKC').replace(/\s/g, ''));
      if (!hs.includes('氏名') || !hs.some((h) => h.includes('任用年数') || h === '年数')) continue;
      headerRow = r;
      hs.forEach((h, i) => { const hit = tests.find(([f, t]) => map[f] === undefined && t(h)); if (hit) map[hit[0]] = i; });
      break;
    }
    if (headerRow < 0) return { records: [], skipped: [], error: '「番号」「会計年度任用年数」「氏名」の見出しがある行が見つかりません。年数確認データか確認してください。' };
    const get = (row, f) => (map[f] === undefined ? '' : row[map[f]]);
    const records = [];
    const skipped = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((c) => c != null && c !== '')) continue;
      const name = cellText(get(row, 'name'));
      const years = Number(String(get(row, 'years')).normalize('NFKC').replace(/[^0-9]/g, ''));
      if (!name) { skipped.push({ row: r + 1, reason: '氏名が空欄' }); continue; }
      if (!(years > 0)) { skipped.push({ row: r + 1, reason: '会計年度任用年数が読み取れません' }); continue; }
      records.push({
        _row: r + 1, number: cellText(get(row, 'number')), name, years,
        kubunText: cellText(get(row, 'kubun')), dept: cellText(get(row, 'dept')), title: cellText(get(row, 'title')),
      });
    }
    return { records, skipped, headerRow, map };
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
  const LEAVE_GRANT_LABEL = {
    '': '自動（時間額パートは付与しない、それ以外は付与する）',
    grant: '付与する',
    none: '付与しない（任期が短い等）',
  };
  /**
   * 年次休暇の付与の判定。前年度からの繰越分は含まない。
   *  - 任用ごとの「年休の付与」（leaveGrant）：自動／付与する／付与しない。
   *    自動では、時間額パートは付与しない（必要な人は「付与する」にするか日数を手入力）、
   *    それ以外は任期の長短にかかわらず付与する（任期が短く付与しない場合は「付与しない」を選ぶ）。
   *  - 日数は表（市マニュアル第Ⅴ章1）の、週の勤務日数（フル・月額パートは5日）または任用期間の勤務日数の欄
   *    ×継続勤務年数の行。
   * 戻り値：{ granted, days, reason }。days は付与しないとき 0、判定できないとき null。
   */
  function annualLeaveInfo(data, appt, settings) {
    const mode = appt.leaveGrant || '';
    if (mode === 'none') return { granted: false, days: 0, reason: '「付与しない」に設定' };
    if (mode === '' && appt.type === 'part' && appt.payType === 'hourly') {
      return { granted: false, days: 0, reason: '時間額パートのため付与しない（必要な場合は手入力）', defaultNone: true };
    }
    if (!parseISO(appt.start)) return { granted: true, days: null, reason: '任用期間が未入力' };
    const col = annualLeaveColumn(appt, settings);
    if (col == null) return { granted: true, days: null, reason: '週の勤務日数（または任用期間の勤務日数）が未入力' };
    if (col < 0) return { granted: true, days: 0, reason: '任用期間の勤務日数が48日未満' };
    const years = Math.min(continuousServiceYears(data, appt) || 0, 6);
    return { granted: true, days: ANNUAL_LEAVE_TABLE[years][col], reason: '' };
  }
  function annualLeaveDays(data, appt, settings) {
    return annualLeaveInfo(data, appt, settings).days;
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
      const info = annualLeaveInfo(data, appt, settings);
      const days = info.days;
      if (!info.granted && !info.defaultNone && Number(appt.annualLeave) > 0) {
        warn(`年休の付与が「付与しない」に設定されていますが、年休が${appt.annualLeave}日入力されています。`, MAN('第Ⅴ章1'));
      } else if (info.granted && days != null && days !== Number(appt.annualLeave)) {
        warn(`年休は${days}日と判定されます（入力：${appt.annualLeave}日。前年度からの繰越分は含めません）。`, `${MAN('第Ⅴ章1')}／年次休暇の規定（週29時間以上のただし書、継続勤務年数の端数は1年）`);
      }
    }
    const empStaff = staffOf(data, appt.staffId);
    if (s && empStaff && (empStaff.employment || []).length) {
      const inside = empStaff.employment.some((p) => p.start <= appt.start && (!p.end || appt.start <= p.end));
      if (!inside) warn('任期の開始日が、人事システムの任用（在職期間）のどの期間にも含まれていません。人事システムの任用の登録・退職の入力を確認してください。', '人事システムの任用');
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
   * 経歴（職員ごとの任用の変遷）
   * ------------------------------------------------------------ */
  /**
   * 職員の経歴を古い順に返す。前の任用からの変更点（所属・職名・区分・勤務時間・報酬・途切れ・公募）を付ける。
   * 戻り値：{ rows:[{ appt, fy, cycleYear, serviceYears, changes:[{kind,text}] }], summary }
   */
  function careerOf(data, staffId, settings, todayISO) {
    const list = appointmentsOfStaff(data, staffId).filter((a) => a.status !== 'canceled' && parseISO(a.start));
    const rows = [];
    let prev = null;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    for (const a of list) {
      const changes = [];
      if (!prev) {
        changes.push({ kind: 'first', text: '初めての任用' });
      } else {
        const gapDays = diffDays(prev.end, a.start) - 1;
        if (gapDays > 0) changes.push({ kind: 'gap', text: `前の任期（${toWarekiShort(prev.end)}まで）から${gapDays}日空いている → 勤続は数え直し` });
        if ((prev.dept || '') !== (a.dept || '')) changes.push({ kind: 'dept', text: `所属：${prev.dept || '—'} → ${a.dept || '—'}` });
        if ((prev.title || '') !== (a.title || '')) changes.push({ kind: 'title', text: `職名：${prev.title || '—'} → ${a.title || '—'}` });
        if (kubunOf(prev) !== kubunOf(a)) changes.push({ kind: 'kubun', text: `区分：${KUBUN_LABEL[kubunOf(prev)]} → ${KUBUN_LABEL[kubunOf(a)]}` });
        if (hoursOf(prev) !== hoursOf(a)) changes.push({ kind: 'hours', text: `勤務時間/週：${hoursOf(prev) ?? (prev.hoursText || '—')} → ${hoursOf(a) ?? (a.hoursText || '—')}` });
        if (num(prev.payAmount) !== num(a.payAmount)) {
          changes.push({ kind: 'pay', text: `給料・報酬：${num(prev.payAmount) == null ? '—' : num(prev.payAmount).toLocaleString('ja-JP')} → ${num(a.payAmount) == null ? '—' : num(a.payAmount).toLocaleString('ja-JP')}円` });
        }
      }
      if (a.recruitMethod === 'public' && prev) changes.push({ kind: 'public', text: '公募により採用（3年周期の1年目に戻る）' });
      for (const r of a.renewals || []) changes.push({ kind: 'renew', text: `${toWarekiShort(r.date)} 任期更新：終了日 ${toWarekiShort(r.oldEnd)} → ${toWarekiShort(r.newEnd)}` });
      rows.push({
        appt: a,
        fy: fiscalYearOf(a.start),
        cycleYear: yearInServiceOf(data, a),
        serviceYears: continuousServiceYears(data, a),
        publicFy: publicRecruitFy(data, a, settings),
        changes,
      });
      prev = a;
    }
    const last = list[list.length - 1] || null;
    const current = todayISO ? list.find((a) => a.start <= todayISO && todayISO <= a.end) || null : null;
    const ss = last ? serviceStartOf(data, last, false) : null;
    const staff = (data.staff || []).find((x) => x.id === staffId);
    const empFirst = sortedPeriods(staff, false)[0];
    const firstAppt = [list.length ? list[0].start : null, empFirst ? empFirst.start : null].filter(Boolean).sort()[0] || null;
    const hire = staff && parseISO(staff.hireDate) ? staff.hireDate : null;
    // 任用一覧に任用がなくても、人事システムの在職期間・年数確認データから勤続と年目を出す
    let ssAlt = null;
    let syAlt = null;
    if (!last && todayISO && staff) {
      const pseudo = { id: '_', staffId, start: todayISO, end: todayISO };
      const e = employmentChainStart(staff, todayISO, false);
      if (e) { ssAlt = { date: e, estimated: false, source: 'jinji' }; syAlt = continuousServiceYears(data, pseudo); }
    }
    const cycleFys = Object.keys((staff && staff.cycleYears) || {}).map(Number).sort((a, b) => b - a);
    const cycleAlt = !last && cycleFys.length ? { year: Number(staff.cycleYears[cycleFys[0]]), fy: cycleFys[0] } : null;
    return {
      rows,
      summary: {
        firstStart: hire && (!firstAppt || hire < firstAppt) ? hire : firstAppt,
        firstStartSource: hire && (!firstAppt || hire <= firstAppt) ? 'roster' : empFirst && empFirst.start === firstAppt ? 'jinji' : 'history',
        serviceSource: ss ? ss.source : ssAlt ? ssAlt.source : null,
        serviceStart: ss ? ss.date : ssAlt ? ssAlt.date : null,
        serviceEstimated: ss ? ss.estimated : false,
        serviceYears: last ? continuousServiceYears(data, last) : syAlt,
        fiscalYears: [...new Set(list.map((a) => fiscalYearOf(a.start)))].length,
        current,
        last,
        cycleYear: last ? yearInServiceOf(data, last) : cycleAlt ? cycleAlt.year : null,
        publicFy: last ? publicRecruitFy(data, last, settings)
          : cycleAlt && settings.reappointLimit != null && settings.reappointLimit !== '' ? cycleAlt.fy + Number(settings.reappointLimit) + 2 - cycleAlt.year : null,
        deptChanges: rows.filter((r) => r.changes.some((c) => c.kind === 'dept')).length,
        titleChanges: rows.filter((r) => r.changes.some((c) => c.kind === 'title')).length,
      },
    };
  }

  /** 年度ごとの集計（年度別サマリー用） */
  function fiscalYearSummary(data, fy) {
    const list = data.appointments.filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === Number(fy));
    const staffIds = [...new Set(list.map((a) => a.staffId))];
    const byKubun = {};
    for (const a of list) byKubun[kubunOf(a)] = (byKubun[kubunOf(a)] || 0) + 1;
    const nextIds = new Set(data.appointments.filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === Number(fy) + 1).map((a) => a.staffId));
    const evaluated = staffIds.filter((id) => data.evaluations.some((e) => e.staffId === id && Number(e.fiscalYear) === Number(fy))).length;
    return {
      fy: Number(fy),
      appointments: list.length,
      staff: staffIds.length,
      byKubun,
      publicCount: list.filter((a) => a.recruitMethod === 'public').length,
      reappointCount: list.filter((a) => a.recruitMethod === 'reappoint').length,
      continuing: staffIds.filter((id) => nextIds.has(id)).length,
      evaluated,
    };
  }
  function fiscalYearsInData(data) {
    return [...new Set(data.appointments.filter((a) => a.start).map((a) => fiscalYearOf(a.start)))].sort((a, b) => a - b);
  }

  /* ------------------------------------------------------------
   * 人事評価
   * ------------------------------------------------------------ */
  function evaluationFor(data, staffId, fy) {
    return data.evaluations.find((e) => e.staffId === staffId && Number(e.fiscalYear) === Number(fy)) || null;
  }

  /** 評語（評価項目・総合評価）が入力されているか。可否・希望だけの記録は評価未入力とみなす */
  function hasGrades(ev) {
    return !!(ev && (ev.overall || Object.values(ev.items || {}).some(Boolean)));
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
      if (!hasGrades(evaluationFor(data, a.staffId, fy))) out.push(a);
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
      // 任期が短いための「付与しない」は翌年度（通年）には引き継がない
      if (draft.leaveGrant === 'none') draft.leaveGrant = '';
      if (draft.annualLeave !== '' && draft.annualLeave != null && annualLeaveInfo(data, draft, settings).granted) {
        const days = annualLeaveDays({ ...data, appointments: data.appointments.concat([draft]) }, draft, settings);
        if (days != null) draft.annualLeave = days;
      }
      const reasons = [];
      let recommend = true;
      if (already) { recommend = false; reasons.push(`${fyLabel(nextFy)}の任用が登録済み`); }
      if (base.retireType) { recommend = false; reasons.push(`退職登録済み（${RETIRE_LABEL[base.retireType] || base.retireType}）`); }
      // 再度の任用は、人事評価の結果に基づく可否と本人の希望による（市マニュアル第Ⅷ章2・申送事項）
      if (!ev || !ev.recommend) { recommend = false; reasons.push('再度の任用の可否が未入力'); }
      else if (ev.recommend === 'no') { recommend = false; reasons.push('再度の任用：不可'); }
      else if (ev.recommend === 'hold') { recommend = false; reasons.push('再度の任用：要検討'); }
      if (!ev || !ev.wish) { recommend = false; reasons.push('本人の希望が未確認'); }
      else if (ev.wish === 'no') { recommend = false; reasons.push('本人が再度の任用を希望していない'); }
      if (!hasGrades(ev)) reasons.push(`${fyLabel(fy)}の人事評価（評語）が未入力`);
      else if (ev.overall && !settings.reappointGrades.includes(ev.overall)) {
        recommend = false; reasons.push(`総合評価 ${ev.overall}（推薦基準：${settings.reappointGrades.join('・')}）`);
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
   * 残る人・残らない人（退職・残留の管理）
   * ------------------------------------------------------------ */
  /** 年度内の職員ごとの最後の任用 */
  function latestAppointmentsOfFy(data, fy) {
    const map = new Map();
    for (const a of data.appointments) {
      if (a.status === 'canceled' || !a.start || fiscalYearOf(a.start) !== Number(fy)) continue;
      const cur = map.get(a.staffId);
      if (!cur || a.end > cur.end) map.set(a.staffId, a);
    }
    return [...map.values()];
  }
  const CONTINUATION_LABEL = {
    stay: '残る（翌年度の任用登録済み）',
    stay_expected: '残る見込み（再度の任用）',
    public: '公募の対象（本人の応募は可）',
    leave_expected: '残らない見込み',
    leave: '残らない（退職登録済み）',
    undecided: '未定（可否・希望の入力待ち）',
  };
  /**
   * fy 年度の職員が翌年度に残るかどうか。
   * 優先順：翌年度の任用登録 → 退職登録 → 不可・希望しない → 3年目（公募） → 可かつ希望する → 未定
   */
  function continuationStatus(data, appt, settings) {
    const fy = fiscalYearOf(appt.start);
    const nextFy = fy + 1;
    const next = data.appointments.filter((a) => a.staffId === appt.staffId && a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === nextFy);
    const mk = (code, detail) => ({ code, label: CONTINUATION_LABEL[code], detail: detail || '' });
    if (next.length) return mk('stay', next.some((a) => a.recruitMethod === 'public') ? '公募で採用' : '再度の任用');
    if (appt.retireType) return mk('leave', `${RETIRE_LABEL[appt.retireType] || ''}${appt.retireDate ? `（${toWarekiShort(appt.retireDate)}）` : ''}`);
    const ev = evaluationFor(data, appt.staffId, fy);
    if (ev && ev.wish === 'no') return mk('leave_expected', '本人が希望しない');
    if (ev && ev.recommend === 'no') return mk('leave_expected', '再度の任用：不可');
    if (publicRecruitFy(data, appt, settings) === nextFy) return mk('public', `${yearInServiceOf(data, appt)}年目のため${toWarekiShort(fiscalYearStart(nextFy))}は公募`);
    if (ev && ev.recommend === 'yes' && ev.wish === 'yes') return mk('stay_expected');
    const missing = [!ev || !ev.recommend ? '可否' : '', !ev || !ev.wish ? '希望' : '', ev && ev.recommend === 'hold' ? '可否が要検討' : ''].filter(Boolean);
    return mk('undecided', missing.join('・'));
  }
  /**
   * 翌年度に公募が必要となる見込みの職（現職者が残らない・残らない見込み・3年目）。
   * 新規・増員の職（recruitPositions）は含まない。
   */
  function recruitNeeds(data, fy, settings) {
    return latestAppointmentsOfFy(data, fy)
      .map((a) => ({ appt: a, status: continuationStatus(data, a, settings) }))
      .filter((x) => ['leave', 'leave_expected', 'public'].includes(x.status.code));
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
    const e = eraOf(d);
    const md = `${d.getMonth() + 1}.${d.getDate()}`;
    return e ? `${e.code}${e.year}.${md}` : `${d.getFullYear()}.${md}`;
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

  /* ------------------------------------------------------------
   * 人事システムの職員名簿（番号・区分名・氏名・ﾌﾘｶﾞﾅ・性別・生年月日・採用日…）
   * 採用があったとき・初めて使うときに取り込み、職員台帳の基本情報を埋める。
   * PASS・内線等・財務・労務などの業務に不要な列は読み込まない。
   * ------------------------------------------------------------ */
  const MEIBO_COLUMNS = [
    ['number', (h) => h === '番号' || h === '職員番号'],
    ['category', (h) => h === '区分名'],
    ['status', (h) => h === '身分'],
    ['jobType', (h) => h === '職種'],
    ['name', (h) => h === '氏名'],
    ['kana', (h) => h === 'フリガナ' || h === 'ふりがな'],
    ['gender', (h) => h === '性別'],
    ['birth', (h) => h === '生年月日'],
    ['hireDate', (h) => h === '採用日' || h === '採用年月日'],
    ['retireDate', (h) => h === '退職日'],
    ['deptCode', (h) => h === '所属CD'],
    ['dept', (h) => h === '所属名'],
    ['title', (h) => h === '職名'],
    ['section', (h) => h === '係名'],
    ['sideJob', (h) => h === '兼職'],
    ['grade', (h) => h === '級'],
    ['step', (h) => h === '号'],
    ['inService', (h) => h === '在職'],
    ['postal', (h) => h === '郵便番号'],
    ['address1', (h) => h === '住所'],
    ['address2', (h) => h === '住所方書'],
    ['phone', (h) => h === '電話'],
    ['mobile', (h) => h === '携帯'],
    ['email', (h) => h === 'MAIL' || h === 'メール'],
    ['emergencyName', (h) => h === '緊急時氏名'],
    ['emergencyRelation', (h) => h === '緊急時続柄'],
    ['emergencyPhone', (h) => h === '緊急時電話'],
  ];
  function meiboHeaderKey(h) { return String(h == null ? '' : h).normalize('NFKC').replace(/\s/g, '').toUpperCase(); }
  /** 名簿の性別：1＝男性、0または2＝女性（人事システムの出力） */
  function parseMeiboGender(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (s === '1' || /男/.test(s)) return 'M';
    if (s === '0' || s === '2' || /女/.test(s)) return 'F';
    return '';
  }
  /**
   * 名簿の行データを取込用レコードに変換する。
   * このアプリは会計年度任用職員の管理用のため、C列（区分名）が「会計年度任用職員」の行だけを読む。
   * それ以外の行（正職員など）は、氏名を含め一切の値を読まずに件数だけ数える。
   */
  const MEIBO_TARGET_CATEGORY = '会計年度任用職員';
  function isMeiboTarget(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/\s/g, '') === MEIBO_TARGET_CATEGORY;
  }
  function parseMeibo(rows) {
    let headerRow = -1;
    const map = {};
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hs = (rows[r] || []).map(meiboHeaderKey);
      if (!hs.includes('氏名') || !(hs.includes('採用日') || hs.includes('生年月日'))) continue;
      headerRow = r;
      hs.forEach((h, i) => {
        const hit = MEIBO_COLUMNS.find(([f, test]) => map[f] === undefined && test(h));
        if (hit) map[hit[0]] = i;
      });
      break;
    }
    if (headerRow < 0) return { records: [], skipped: [], excludedCount: 0, error: '「氏名」と「採用日」（または「生年月日」）の見出しがある行が見つかりません。職員名簿の形式か確認してください。' };
    // 区分名の列（見出しがなければC列）
    if (map.category === undefined) map.category = 2;
    const get = (row, f) => (map[f] === undefined ? '' : row[map[f]]);
    const records = [];
    const skipped = [];
    let excludedCount = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((c) => c != null && c !== '')) continue;
      const category = cellText(get(row, 'category'));
      if (!isMeiboTarget(category)) { excludedCount += 1; continue; }
      const name = cellText(get(row, 'name'));
      if (!name) { skipped.push({ row: r + 1, reason: '氏名が空欄' }); continue; }
      const addr = [cellText(get(row, 'address1')), cellText(get(row, 'address2'))].filter(Boolean).join('　');
      const inService = cellText(get(row, 'inService'));
      records.push({
        _row: r + 1,
        number: cellText(get(row, 'number')),
        name,
        kana: cellText(get(row, 'kana')),
        gender: parseMeiboGender(get(row, 'gender')),
        birth: excelValueToISO(get(row, 'birth')),
        hireDate: excelValueToISO(get(row, 'hireDate')),
        retireDate: excelValueToISO(get(row, 'retireDate')),
        category: MEIBO_TARGET_CATEGORY,
        jobType: cellText(get(row, 'jobType')),
        deptCode: cellText(get(row, 'deptCode')),
        dept: cellText(get(row, 'dept')),
        title: cellText(get(row, 'title')),
        section: cellText(get(row, 'section')),
        grade: cellText(get(row, 'grade')),
        step: cellText(get(row, 'step')),
        inService: inService === '' ? '' : inService === '1' ? '在職' : '非在職',
        postal: cellText(get(row, 'postal')),
        address: addr,
        phone: cellText(get(row, 'phone')),
        mobile: cellText(get(row, 'mobile')),
        email: cellText(get(row, 'email')),
        emergencyName: cellText(get(row, 'emergencyName')),
        emergencyRelation: cellText(get(row, 'emergencyRelation')),
        emergencyPhone: cellText(get(row, 'emergencyPhone')),
      });
    }
    return { records, skipped, excludedCount, headerRow, map };
  }
  /** 名簿で職員を探す：職員番号 → 氏名と生年月日 → 氏名（1人に決まる場合） */
  function findStaffForMeibo(data, rec) {
    if (rec.number) {
      const byNo = data.staff.find((s) => s.number && String(s.number) === String(rec.number));
      if (byNo) return byNo;
    }
    const key = String(rec.name || '').replace(/[\s　]/g, '');
    const same = data.staff.filter((s) => String(s.name).replace(/[\s　]/g, '') === key);
    if (rec.birth) {
      const hit = same.find((s) => s.birth === rec.birth);
      if (hit) return hit;
      const noBirth = same.filter((s) => !s.birth && (!s.number || !rec.number));
      return noBirth.length === 1 ? noBirth[0] : null;
    }
    return same.length === 1 ? same[0] : null;
  }
  /** 名簿の採用日を含む任用が登録されているか（新規採用者の任用登録漏れの確認） */
  function hasAppointmentOn(data, staffId, iso) {
    return data.appointments.some((a) => a.staffId === staffId && a.status !== 'canceled' && a.start <= iso && iso <= (a.originalEnd || a.end));
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

  /* ------------------------------------------------------------
   * 年度替わり事務のチェックリスト
   * 総務課長通知（陸高総号外。R7.11.5・R7.11.28・R8.1.8×2・R8.1.26・R8.2.26）の
   * 令和8年度任用の日程をひな形とし、他の年度は同じ月日を土日・祝日・年末年始を避けてずらす。
   * ------------------------------------------------------------ */
  /** 春分の日（1980〜2099年の近似式） */
  function shunbunDay(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  /** 閉庁日（土日・11〜4月の祝日と振替休日・年末年始12/29〜1/3） */
  function isClosedDay(iso) {
    const d = parseISO(iso);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return true;
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if ((m === 12 && day >= 29) || (m === 1 && day <= 3)) return true;
    const y = d.getFullYear();
    const holidays = (yy) => {
      const firstMon = ((8 - new Date(yy, 0, 1).getDay()) % 7) + 1; // 1月の第1月曜
      return [`${yy}-11-03`, `${yy}-11-23`, `${yy}-01-01`, toISO(new Date(yy, 0, firstMon + 7)), `${yy}-02-11`, `${yy}-02-23`,
        toISO(new Date(yy, 2, shunbunDay(yy))), `${yy}-04-29`];
    };
    const hs = holidays(y);
    if (hs.includes(iso)) return true;
    // 振替休日：日曜の祝日の翌日（以降の平日）
    for (const h of hs) {
      if (parseISO(h).getDay() !== 0) continue;
      let n = addDaysISO(h, 1);
      while (hs.includes(n)) n = addDaysISO(n, 1);
      if (n === iso) return true;
    }
    return false;
  }
  /** 閉庁日なら前（before）または後（after）の開庁日にずらす */
  function toBusinessDay(iso, dir) {
    let d = iso;
    const step = dir === 'after' ? 1 : -1;
    for (let i = 0; i < 10 && isClosedDay(d); i++) d = addDaysISO(d, step);
    return d;
  }
  /** 対象年度（4/1任用の年度）の m月d日。11・12月は前年 */
  function yearEndDate(targetFy, md, dir = 'before') {
    if (!md) return '';
    const [m, d] = md;
    const y = m >= 5 ? targetFy - 1 : targetFy;
    return toBusinessDay(toISO(new Date(y, m - 1, d)), dir);
  }
  const YEAR_END_SRC = {
    kibo: '任用に係る会計年度任用職員の任用希望調査について（R7.11.5 総務課長通知）',
    kakunin: '会計年度任用職員の再度の任用に係る確認について（R7.11.28 総務課長通知）',
    boshu: '会計年度任用職員の募集方法について（R8.1.8 総務課長通知）',
    saido: '任用に係る会計年度任用職員の再度の任用について（R8.1.8 総務課長通知）',
    senko: '会計年度任用職員の選考方法について（R8.1.26 総務課長通知）',
    okuri: '申送事項（総務課職員係）年間スケジュール 4月',
    kirikae: '年度切替に伴う会計年度任用職員の任用及び退職に係る事務手続きについて（R8.2.26 総務課長通知）',
  };
  /**
   * 総務課（職員係）が通知ごとに行うこと。
   * notice=通知日、due=回答・提出期限、due2=2つ目の期限（[月,日]。令和8年度任用の通知の日程）。
   * steps[].at：['notice'|'due'|'due2', ずらす日数] または ['md', [月,日], 'before'|'after']
   * tracker：回答の受付状況を記録する相手（課・職員）の種類
   */
  /** 通知 → 取りまとめ → データ確定 の3工程 */
  const YE_STEPS = (notice, matome, kakutei, tabs = {}, matomeAt = ['due', 0], kakuteiAt = ['due', 7]) => [
    { key: 'tsuchi', label: `通知（${notice}）`, at: ['notice', 0] },
    { key: 'matome', label: `取りまとめ（${matome}）`, at: matomeAt, tab: tabs.matome },
    { key: 'kakutei', label: `データ確定（${kakutei}）`, at: kakuteiAt, tab: tabs.kakutei },
  ];
  /** 予算議決の確認を pos 番目に入れる（任用の起案日・特定財源の職員への通知は議決後） */
  const withGiketsu = (steps, pos) => [...steps.slice(0, pos), { key: 'giketsu', label: '予算議決の確認（議決日を画面上部に入力）', at: ['budget', 0] }, ...steps.slice(pos)];
  const YEAR_END_NOTICES = [
    { key: 'kibo', title: '任用希望調査', src: 'kibo', notice: [11, 5], due: [11, 21], dueLabel: '回答期限',
      points: ['翌年度に新たに任用を希望する職（職務内容等）と、今年度で廃止する事業の職員を「任用希望調査シート」で報告してもらう', '引き続き任用する職員（4会計年度目以降の公募を含む）は報告不要', 'グループウェアのメッセージで職員係へ送信'],
      tracker: { type: 'all', label: '回答', step: 'matome' },
      steps: YE_STEPS('任用希望調査シートを添付', '回答の受付・未回答の課へ督促', '新規・増員の職を「公募職種」に入力、廃止事業の職員を確認', { kakutei: 'recruit' }) },
    { key: 'kakunin', title: '再度の任用に係る確認', src: 'kakunin', notice: [11, 28], due: [12, 8], dueLabel: '提出期限',
      points: ['人事評価面談の結果で、再度の任用の希望の有無が確認できなかった職員について、各課に本人へ確認してもらう', '任用開始から3会計年度目の職員は人事評価の結果による再度の任用の対象外（翌年度も任用するなら公募。再度の応募は可）'],
      tracker: { type: 'wishMissing', label: '提出', step: 'matome' },
      steps: YE_STEPS('別紙：希望の有無が未確認の職員一覧', '提出の受付・未提出の課へ督促', '本人の希望を「年目・任用意向」に入力し、再度の任用の対象者を確定', { kakutei: 'intent' }) },
    { key: 'boshu', title: '募集方法（募集職種一覧）', src: 'boshu', notice: [1, 8], due: [1, 16], dueLabel: '修正の提出期限',
      points: ['選考スケジュール：募集 1/22〜1/30、選考 2/2〜2/20、合否通知・結果報告 2/27', '募集はハローワークインターネットサービスへの求人申込み', '募集職種一覧に加筆修正があれば朱書き訂正して提出してもらう', '募集人数に達した場合は受付期間内でも締め切ってよい'],
      steps: [
        { key: 'tsuchi', label: '通知（募集職種一覧・募集案内を添付）', at: ['notice', 0] },
        { key: 'kyujin', label: '求人確認（ハローワークインターネットサービスへの求人申込み・内容の確認。募集開始の前日まで）', at: ['md', [1, 21], 'before'], tab: 'recruit' },
      ] },
    { key: 'saido', title: '再度の任用（本人への通知）', src: 'saido', notice: [1, 8], due: [3, 19], dueLabel: '本人通知の期限',
      points: ['各課から現職員へ、様式1（行う）・様式2（行わない）・様式3（対象外：3会計年度目）で通知してもらう', '予算の議決までは再度の任用となる見込みとして扱う', '特定財源で人件費を措置している職員は、予算の議決後に通知', '総務課合議は不要。対象者一覧に修正があれば連絡してもらう'],
      tracker: { type: 'reappoint', label: '本人通知', step: 'matome' },
      steps: withGiketsu(YE_STEPS('対象者一覧・様式1〜3を添付', '対象者一覧の修正連絡の受付・各課の本人通知の完了確認', '「再度の任用」で翌年度の任用を登録', { kakutei: 'reappoint' }), 2) },
    { key: 'senko', title: '選考方法・選考結果報告', src: 'senko', notice: [1, 26], due: [2, 27], dueLabel: '結果報告の期限',
      points: ['書類審査（書類審査採点表）又は面接審査（面接評定表）。どちらにするかは各課が判断', '面接の日程は各課が申込者と調整。併願者は担当課間で調整（紹介状は併願数分）', '結果報告に添付：応募者一覧表、採点表又は評定表、応募者全員の応募申込書・職務等経歴書（必要に応じて資格証の写し）'],
      tracker: { type: 'recruit', label: '結果報告', step: 'matome' },
      steps: YE_STEPS('様式の保存先を明記', '選考結果報告の受付・添付書類の確認', '合格者を「採用試験」に記録し、翌年度の任用を登録', { kakutei: 'exam' }) },
    { key: 'kirikae', title: '年度切替の任用・退職の事務手続き', src: 'kirikae', notice: [2, 26], due: [3, 23], dueLabel: '起案の合議期限', due2: [3, 31], due2Label: '退職者の書類の期限',
      points: ['4/1付け任用（再度の任用を含む）は、記載例・任用予定者一覧を参考に起案して総務課へ合議', '起案日は当初予算の議決後の日付。添付は辞令書・勤務条件通知書のみ（履歴書等は不要）', '3/31付け退職者は、資格確認証（マイナ保険証未取得の場合）・タイムカード・名札ケースを提出'],
      tracker: { type: 'kian', label: '合議', step: 'matome' },
      tracker2: { type: 'retire', label: '退職者の書類', step: 'matome', items: ['資格確認証', 'タイムカード', '名札ケース'] },
      steps: withGiketsu(YE_STEPS('記載例・任用予定者一覧を添付', '任用起案の合議・3/31退職者の書類の受付', '翌年度の任用一覧を確定、退職者の退職を登録', { kakutei: 'appoint' }, ['due2', 0], ['due2', 1]), 1) },
    { key: 'shikaku', title: '4月の資格取得・喪失手続き', src: 'okuri', kind: 'task', notice: [4, 1], noticeDir: 'none', noticeLabel: '任用開始', due: [4, 5], dueLabel: '期限',
      points: ['新規採用者の資格取得手続き（共済短期・厚生年金・雇用保険）', '退職者の社会保険等の喪失手続き（共済組合・厚生年金・雇用保険・総合事務組合）', '対象外の欄は、任用の「社会保険」「雇保／退手」の入力（未入力なら週時間からの目安）で決めています'],
      tracker: { type: 'newHire', label: '新規採用者の資格取得', step: 'shutoku', store: 'hire', ins: true, items: ['共済(短期)', '厚生年金', '雇用保険'] },
      tracker2: { type: 'retire', label: '退職者の資格喪失', step: 'soshitsu', store: 'soshitsu', ins: true, items: ['共済組合', '厚生年金', '雇用保険', '総合事務組合'] },
      steps: [
        { key: 'shutoku', label: '新規採用者の資格取得手続き（共済短期・厚生年金・雇用保険）', at: ['due', 0], tab: 'appoint' },
        { key: 'soshitsu', label: '退職者の資格喪失手続き（共済組合・厚生年金・雇用保険・総合事務組合）', at: ['due', 0], tab: 'retire' },
      ] },
  ];
  function yearEndNoticeDates(targetFy, n) {
    return {
      notice: n.noticeDir === 'none' ? toISO(new Date(targetFy, n.notice[0] - 1, n.notice[1])) : yearEndDate(targetFy, n.notice, 'before'),
      due: yearEndDate(targetFy, n.due, 'before'),
      due2: n.due2 ? yearEndDate(targetFy, n.due2, 'before') : '',
    };
  }
  /** 手順の目安日（通知日・期限からの日数。閉庁日は避ける） */
  function yearEndStepDate(targetFy, step, dates) {
    const [base, v, dir] = step.at;
    if (base === 'md') return yearEndDate(targetFy, v, dir || 'before');
    const from = dates[base];
    if (!from) return '';
    return toBusinessDay(addDaysISO(from, v), v > 0 ? 'after' : 'before');
  }
  /** 対象年度（4/1任用の年度）のチェックリストがなければ作る。作ったら true */
  function ensureYearEnd(data, targetFy) {
    if (!data.yearEnd || typeof data.yearEnd !== 'object') data.yearEnd = {};
    let list = data.yearEnd[targetFy];
    let changed = false;
    if (!list || list.version !== 3) {
      list = data.yearEnd[targetFy] = { version: 3, createdAt: toISO(new Date()), budgetDate: '', notices: {} };
      changed = true;
    }
    // 4月の手続きの期限を4/10（仮）から4/5に変えたため、仮の日付のままなら直す
    const sk = list.notices.shikaku;
    if (sk && sk.dates && sk.dates.due === yearEndDate(targetFy, [4, 10], 'before')) {
      sk.dates.due = yearEndDate(targetFy, [4, 5], 'before');
      changed = true;
    }
    for (const n of YEAR_END_NOTICES) {
      if (list.notices[n.key]) continue;
      list.notices[n.key] = { dates: yearEndNoticeDates(targetFy, n), steps: {}, responses: {}, retire: {}, memo: '' };
      changed = true;
    }
    return changed;
  }
  /** 任用の社会保険・雇保／退手（未入力なら目安） */
  function insuranceOf(data, a, settings) {
    const soc = a.socialIns || ((suggestSocialIns(data, a, settings) || {}).value) || '';
    const emp = a.empIns || ((suggestEmpIns(data, a, settings) || {}).value) || '';
    return { soc, emp };
  }
  /**
   * 資格取得・喪失の欄が対象外か。社会保険「無」→共済・厚生年金は対象外、
   * 雇用保険でない→雇用保険は対象外、退手でない→総合事務組合は対象外。未入力は対象として残す。
   */
  function insuranceNa(item, ins) {
    if (!ins) return false;
    if (/共済|厚生年金/.test(item)) return ins.soc === '無';
    if (item === '雇用保険') return ins.emp === '無' || ins.emp === '退手';
    if (item === '総合事務組合') return ins.emp !== '' && ins.emp !== '退手';
    return false;
  }
  /** 回答を受け付ける相手（課・職員）。保存済みの相手も残す */
  function yearEndTargets(data, fy, type, settings, saved) {
    const latest = latestAppointmentsOfFy(data, fy);
    const depts = (list) => [...new Set(list.map((a) => a.dept).filter(Boolean))];
    let keys = [];
    if (type === 'all') keys = depts(latest);
    else if (type === 'wishMissing') keys = depts(latest.filter((a) => { const ev = evaluationFor(data, a.staffId, fy); return !ev || !ev.wish; }));
    else if (type === 'recruit') {
      const dec = data.recruitDecisions || {};
      keys = depts([
        ...recruitNeeds(data, fy, settings).filter((x) => ((dec[`${fy + 1}:${x.appt.id}`] || {}).decision || 'public') === 'public').map((x) => x.appt),
        ...data.recruitPositions.filter((r) => Number(r.fy) === fy + 1 && (r.decision || 'public') === 'public'),
      ]);
    } else if (type === 'reappoint') {
      keys = depts([
        ...data.appointments.filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === fy + 1 && a.recruitMethod === 'reappoint'),
        ...latest.filter((a) => continuationStatus(data, a, settings).code === 'stay_expected'),
      ]);
    } else if (type === 'kian') {
      keys = depts(data.appointments.filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === fy + 1));
    } else if (type === 'retire' || type === 'newHire') {
      const list = type === 'retire'
        ? latest.filter((a) => a.end === fiscalYearEnd(fy) && ['leave', 'leave_expected', 'public'].includes(continuationStatus(data, a, settings).code))
        : data.appointments.filter((a) => a.status !== 'canceled' && a.start === fiscalYearStart(fy + 1)
          && !data.appointments.some((b) => b.staffId === a.staffId && b.status !== 'canceled' && b.end === fiscalYearEnd(fy)));
      const out = list.map((a) => {
        const s = data.staff.find((x) => x.id === a.staffId) || {};
        return { key: a.staffId, label: s.name || '', sub: a.dept || '', ins: insuranceOf(data, a, settings) };
      });
      for (const k of Object.keys(saved || {})) {
        if (!out.some((x) => x.key === k)) out.push({ key: k, label: (saved[k] && saved[k].label) || '', sub: (saved[k] && saved[k].sub) || '' });
      }
      return out;
    }
    for (const k of Object.keys(saved || {})) if (!keys.includes(k)) keys.push(k);
    return keys.map((k) => ({ key: k, label: k }));
  }
  /** 状態：done / overdue / soon（7日以内）/ later */
  function yearEndState(date, done, today) {
    if (done) return 'done';
    if (!date) return 'later';
    if (date < today) return 'overdue';
    if (diffDays(today, date) <= 7) return 'soon';
    return 'later';
  }
  /** 表示用にまとめる（手順の目安日・進み具合・次にやること・回答の状況） */
  function yearEndView(data, targetFy, today, settings) {
    const list = (data.yearEnd || {})[targetFy];
    if (!list) return [];
    const fy = targetFy - 1;
    return YEAR_END_NOTICES.map((n) => {
      const rec = list.notices[n.key] || { dates: {}, steps: {}, responses: {}, retire: {} };
      const dates = { ...rec.dates, budget: list.budgetDate || '' };
      const steps = n.steps.map((s) => {
        const date = yearEndStepDate(targetFy, s, dates);
        const doneAt = rec.steps[s.key] || '';
        return { ...s, date, doneAt, state: yearEndState(date, !!doneAt, today) };
      });
      const tracker = (tr) => {
        if (!tr) return null;
        const store = tr.store || (tr.items ? 'retire' : 'responses');
        const saved = rec[store] || {};
        const targets = yearEndTargets(data, fy, tr.type, settings, saved);
        const rows = targets.map((t) => {
          const r = saved[t.key] || {};
          const na = tr.items ? tr.items.map((it) => (tr.ins ? insuranceNa(it, t.ins) : false)) : [];
          const done = tr.items ? tr.items.every((_, i) => na[i] || r[i]) : r.s === 'done' || r.s === 'na';
          return { ...t, rec: r, na, done };
        });
        return { ...tr, store, rows, done: rows.filter((x) => x.done).length, total: rows.length };
      };
      const done = steps.filter((s) => s.doneAt).length;
      const next = steps.find((s) => !s.doneAt) || null;
      return {
        key: n.key, title: n.title, source: YEAR_END_SRC[n.src], points: n.points, dueLabel: n.dueLabel, due2Label: n.due2Label || '',
        dates, memo: rec.memo || '', steps, done, total: steps.length, next,
        state: next ? next.state : 'done',
        noticeLabel: n.noticeLabel || '通知日',
        tracker: tracker(n.tracker),
        tracker2: tracker(n.tracker2),
      };
    });
  }

  /* ------------------------------------------------------------
   * 科目（会計・款項目）
   * 年度始めに「会計・款項目 アップロード」の一覧を取り込み、年度途中の追加は手入力する。
   * 任用の「会計」「予算科目」と款項目表示（またはコード）で突き合わせる。
   * ------------------------------------------------------------ */
  /** 科目の項目（キー, 見出し） */
  const KAMOKU_FIELDS = [
    ['srcId', 'ID'], ['deptCode', '所属'], ['dept', '所属名'], ['zaimuCode', '財務'], ['zaimuName', '財務名'],
    ['accountCode', '会計'], ['account', '会計名'], ['code', '款項目コード'], ['display', '款項目表示'], ['name', '款項目名'],
    ['subDept', 'サブ所属'], ['subAccount', 'サブ会計'], ['subKamoku', 'サブ科目'],
    ['jicchoCode', '実調部門cd'], ['jicchoName', '実調部門名'], ['teiinCode', '定員部門cd'], ['teiinName', '定員部門名'], ['flag', '備考'],
  ];
  /** 款項目表示・予算科目の表記ゆれをそろえる（全角・空白・ハイフンの種類） */
  function normBudget(s) {
    return String(s == null ? '' : s).normalize('NFKC').replace(/[\s　]/g, '').replace(/[‐‑‒–—―−ー－]/g, '-');
  }
  /**
   * 「会計・款項目 アップロード」の一覧を読む。
   * 見出し行は「款項目コード」か「款項目表示」がある行。「財務」の右隣の見出しのない列は財務の名称、
   * 最後の見出しのない列（変・複など）は備考として読む。
   */
  function parseKamoku(rows) {
    const H = (v) => normalizeHeader(v);
    let headerRow = -1;
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const hs = (rows[r] || []).map(H);
      if (hs.includes('款項目コード') || hs.includes('款項目表示')) { headerRow = r; break; }
    }
    if (headerRow < 0) return { records: [], skipped: [], headerRow, error: '「款項目コード」または「款項目表示」の見出しがある行が見つかりません。会計・款項目の一覧か確認してください。' };
    const hs = (rows[headerRow] || []).map(H);
    const map = {};
    const names = {
      srcId: ['id'], deptCode: ['所属', '所属cd', '所属コード'], dept: ['所属名'], zaimuCode: ['財務'], accountCode: ['会計', '会計cd', '会計コード'], account: ['会計名'],
      code: ['款項目コード'], display: ['款項目表示'], name: ['款項目名'], subDept: ['サブ所属'], subAccount: ['サブ会計'], subKamoku: ['サブ科目'],
      jicchoCode: ['実調部門cd'], jicchoName: ['実調部門名'], teiinCode: ['定員部門cd'], teiinName: ['定員部門名'], flag: ['備考'],
    };
    for (const [key, list] of Object.entries(names)) {
      const i = hs.findIndex((h) => list.includes(h));
      if (i >= 0) map[key] = i;
    }
    if (map.zaimuCode !== undefined && !hs[map.zaimuCode + 1]) map.zaimuName = map.zaimuCode + 1;
    if (map.flag === undefined) {
      // 見出しのない最後の列にデータがあれば備考として読む
      const width = Math.max(...rows.slice(headerRow + 1).map((r) => (r || []).length), hs.length);
      for (let c = width - 1; c > (map.teiinName !== undefined ? map.teiinName : -1); c--) {
        if (!hs[c] && c !== map.zaimuName && rows.slice(headerRow + 1).some((r) => r && r[c] != null && r[c] !== '')) { map.flag = c; break; }
      }
    }
    const records = [];
    const skipped = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((c) => c != null && c !== '')) continue;
      const rec = {};
      for (const [key] of KAMOKU_FIELDS) rec[key] = map[key] === undefined ? '' : cellText(row[map[key]]);
      if (!rec.display && !rec.code) { skipped.push({ row: r + 1, reason: '款項目コード・款項目表示が空欄' }); continue; }
      rec._row = r + 1;
      records.push(rec);
    }
    return { records, skipped, headerRow, map };
  }
  function kamokuOfFy(data, fy) {
    return (data.kamoku || []).filter((k) => Number(k.fy) === Number(fy));
  }
  /** 同じ科目か（IDが同じ、またはIDがなく所属・会計・款項目表示が同じ） */
  function sameKamoku(a, b) {
    if (a.srcId && b.srcId) return String(a.srcId) === String(b.srcId);
    return String(a.deptCode) === String(b.deptCode) && String(a.accountCode || a.account) === String(b.accountCode || b.account)
      && normBudget(a.display || a.code) === normBudget(b.display || b.code);
  }
  /** 取り込む（同じ科目は上書き、ないものは追加）。apply=false なら件数だけ数える */
  function importKamoku(data, fy, records, apply = true) {
    if (!Array.isArray(data.kamoku)) data.kamoku = [];
    let add = 0;
    let update = 0;
    const now = toISO(new Date());
    for (const r of records) {
      const { _row, ...vals } = r;
      const hit = kamokuOfFy(data, fy).find((k) => sameKamoku(k, vals));
      if (hit) { update++; if (apply) Object.assign(hit, vals, { updatedAt: now }); } else {
        add++;
        if (apply) data.kamoku.push({ id: uid('km'), fy: Number(fy), ...vals, source: 'import', createdAt: now });
      }
    }
    return { add, update };
  }
  /** 前年度などの科目を別の年度へ写す（同じ科目は写さない） */
  function copyKamoku(data, fromFy, toFy) {
    const list = kamokuOfFy(data, fromFy).map(({ id, fy, createdAt, updatedAt, source, ...rest }) => rest);
    return importKamoku(data, toFy, list, true).add;
  }
  /**
   * 任用の科目（任用の年度の科目一覧から、予算科目＝款項目表示またはコードで探す）。
   * 同じ款項目が複数の所属・会計にあるときは、所属CD・会計が合うものを選ぶ。
   */
  function kamokuOfAppointment(data, appt) {
    const key = normBudget(appt.budgetCode);
    if (!key || !appt.start) return null;
    const digits = key.replace(/\D/g, '');
    const list = kamokuOfFy(data, fiscalYearOf(appt.start)).filter((k) => normBudget(k.display) === key || (digits && (String(k.code).replace(/\D/g, '') === digits || String(k.display).replace(/\D/g, '') === digits)));
    if (!list.length) return null;
    const score = (k) => (String(k.deptCode) === String(appt.deptCode || '') ? 2 : 0) + (appt.account && (k.account === appt.account || String(k.accountCode) === String(appt.account)) ? 1 : 0);
    return list.slice().sort((a, b) => score(b) - score(a))[0];
  }
  /** 科目を登録する任用か（フルタイム・月額パートのみ。日額・時間額パートは対象外） */
  function kamokuApplies(appt) {
    return ['full', 'part_monthly'].includes(kubunOf(appt));
  }
  /** 科目を使っている任用（その年度） */
  function appointmentsOfKamoku(data, k) {
    return data.appointments.filter((a) => a.status !== 'canceled' && a.start && fiscalYearOf(a.start) === Number(k.fy) && kamokuApplies(a) && kamokuOfAppointment(data, a) === k);
  }

  const api = {
    APPOINT_TYPE_LABEL, APPOINT_TYPE_SHORT, RECRUIT_LABEL, PAY_TYPE_LABEL, EXAM_METHOD_LABEL,
    RESULT_LABEL, RECOMMEND_LABEL, WISH_LABEL, STATUS_LABEL, DEFAULT_SETTINGS, IMPORT_SCHEMAS, KUBUN_LABEL,
    toISO, parseISO, diffDays, addDaysISO, addMonthsISO, fiscalYearOf, fiscalYearStart, fiscalYearEnd,
    warekiYear, fyLabel, formatDateJa, uid,
    emptyData, normalizeData,
    appointmentsOfStaff, probationEnd, consecutiveReappointCount, yearInServiceOf, publicRecruitFy, validateAppointment, validateRenewal,
    kubunOf, applyKubun, hoursOf, termMonths, calcPay, expectedPayDay, bonusEligibility, fullTimeServiceStart,
    fullTimeSwitchDates, suggestSocialIns, suggestEmpIns, healthCheckRequired, serviceStartOf, continuousServiceYears, annualLeaveDays, annualLeaveInfo, LEAVE_GRANT_LABEL,
    parsePeriod, toWarekiShort, parseNinyoIchiran, ninyoIchiranRows,
    parseMeibo, parseMeiboGender, isMeiboTarget, findStaffForMeibo, hasAppointmentOn,
    parseJinjiNinyo, parseNensu, employmentChainStart, employmentTimeline, kubunFromText, cycleYearFromStaff,
    appointmentStatus, expiringAppointments,
    evaluationFor, hasGrades, suggestOverall, missingEvaluations, buildNextYearPlan,
    RETIRE_LABEL, CONTINUATION_LABEL, latestAppointmentsOfFy, continuationStatus, recruitNeeds, careerOf, fiscalYearSummary, fiscalYearsInData,
    applicantTotal, rankApplicants,
    KAMOKU_FIELDS, normBudget, parseKamoku, kamokuOfFy, importKamoku, copyKamoku, kamokuOfAppointment, appointmentsOfKamoku, kamokuApplies,
    YEAR_END_NOTICES, YEAR_END_SRC, insuranceNa, isClosedDay, toBusinessDay, yearEndNoticeDates, yearEndStepDate, ensureYearEnd, yearEndTargets, yearEndView, yearEndState,
    normalizeHeader, detectColumns, excelValueToISO, parseFiscalYear, parseGender, rowsToRecords, findStaff,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
