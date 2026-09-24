'use strict';

/* ============================================================
 * 会計年度任用職員 一元管理システム — 計算・判定ロジック
 * 画面（app.js）から独立させ、Node.js でもテストできるようにしている。
 *
 * 根拠法令の区分
 *   【国】地方公務員法 第22条の2（会計年度任用職員の採用の方法等）
 *   【市】陸前高田市会計年度任用職員の給与等に関する条例・規則
 * 条文の原文はこの画面から取得・確認できていないため、判定の閾値
 * （フルタイムの週勤務時間、再度の任用の上限回数など）はすべて
 * 設定値として外出しし、「根拠法令」タブで条文を貼り付けて確認する。
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

  const DEFAULT_SETTINGS = {
    // 常勤職員の1週間当たりの通常の勤務時間（フル／パートの判定に使用）。
    // 市の勤務時間条例で定める時間を設定すること。
    fullTimeWeeklyHours: 38.75,
    // 公募によらない再度の任用の上限回数。空欄（null）なら判定しない。
    reappointLimit: null,
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
   * 任用の直前までに「公募によらない再度の任用」が何回連続しているかを数える。
   * 同じ職員の任用を年度順に並べ、直近の「公募」以降の再度の任用を数える。
   * 同一年度内の任期の更新は再度の任用に数えない。
   */
  function consecutiveReappointCount(data, staffId, uptoAppt) {
    const list = appointmentsOfStaff(data, staffId).filter((a) => !uptoAppt || a.id !== uptoAppt.id);
    if (uptoAppt) list.push(uptoAppt);
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let count = 0;
    let lastFy = null;
    for (const a of list) {
      const fy = a.fiscalYear != null ? Number(a.fiscalYear) : fiscalYearOf(a.start);
      if (a.recruitMethod === 'public') count = 0;
      else if (a.recruitMethod === 'reappoint' && fy !== lastFy) count += 1;
      lastFy = fy;
      if (uptoAppt && a.id === uptoAppt.id) break;
    }
    return count;
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

    const hours = Number(appt.weeklyHours);
    const fullHours = Number(settings.fullTimeWeeklyHours);
    if (!(hours > 0)) {
      err('1週間当たりの勤務時間を入力してください。');
    } else if (fullHours > 0) {
      if (appt.type === 'full' && hours !== fullHours) {
        err(`フルタイムは1週間当たりの勤務時間が常勤職員と同一（設定値：${fullHours}時間）である必要があります。`, LAW);
      }
      if (appt.type === 'part' && hours >= fullHours) {
        err(`パートタイムは1週間当たりの勤務時間が常勤職員（設定値：${fullHours}時間）より短い必要があります。`, LAW);
      }
    }

    if (!(Number(appt.payAmount) > 0)) {
      warn('報酬（給料）額が未入力です。', '【市】陸前高田市会計年度任用職員の給与等に関する条例・規則');
    }
    // 同一職員の任期の重複
    if (appt.staffId && s && e) {
      for (const other of data.appointments) {
        if (other.id === appt.id || other.staffId !== appt.staffId) continue;
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
        warn(`公募によらない再度の任用が連続${n}回目です（設定上限：${limit}回）。公募の実施を検討してください。`, '【市】運用方針（設定値）');
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
      const draft = {
        id: uid('ap'),
        staffId,
        fiscalYear: nextFy,
        type: base.type,
        dept: base.dept,
        section: base.section,
        title: base.title,
        start: fiscalYearStart(nextFy),
        end: fiscalYearEnd(nextFy),
        weeklyHours: base.weeklyHours,
        payType: base.payType,
        payAmount: base.payAmount,
        recruitMethod: 'reappoint',
        status: 'planned',
        note: '',
        renewals: [],
      };
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
      }
      const tmp = { ...data, appointments: data.appointments.concat([draft]) };
      const n = consecutiveReappointCount(tmp, staffId, draft);
      const limit = settings.reappointLimit;
      const overLimit = limit != null && limit !== '' && n > Number(limit);
      if (overLimit) { recommend = false; reasons.push(`公募によらない再度の任用が連続${n}回目（上限${limit}回）→ 公募が必要`); }
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
    RESULT_LABEL, RECOMMEND_LABEL, STATUS_LABEL, DEFAULT_SETTINGS, IMPORT_SCHEMAS,
    toISO, parseISO, diffDays, addDaysISO, addMonthsISO, fiscalYearOf, fiscalYearStart, fiscalYearEnd,
    warekiYear, fyLabel, formatDateJa, uid,
    emptyData, normalizeData,
    appointmentsOfStaff, probationEnd, consecutiveReappointCount, validateAppointment, validateRenewal,
    appointmentStatus, expiringAppointments,
    evaluationFor, suggestOverall, missingEvaluations, buildNextYearPlan,
    applicantTotal, rankApplicants,
    normalizeHeader, detectColumns, excelValueToISO, parseFiscalYear, parseGender, rowsToRecords, findStaff,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
