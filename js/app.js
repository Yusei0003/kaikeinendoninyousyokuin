'use strict';

/* ============================================================
 * 会計年度任用職員 一元管理システム — 画面処理
 * 判定ロジックは core.js（window.Core）にある。
 * ============================================================ */

const C = window.Core;
const STORAGE_KEY = 'kaikei_ninyo_data_v1';
const UI_KEY = 'kaikei_ninyo_ui_v1';

let DATA = C.emptyData();
let selectedExamId = null;

/* ------------------------------------------------------------
 * 保存・共通
 * ------------------------------------------------------------ */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    DATA = C.normalizeData(raw ? JSON.parse(raw) : null);
  } catch (e) {
    DATA = C.emptyData();
    showToast('保存データを読み込めませんでした。バックアップから復元してください。');
  }
}
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
  } catch (e) {
    alert('ブラウザへの保存に失敗しました。容量不足の可能性があります。すぐにバックアップを保存してください。');
  }
  renderAll();
}
function loadUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
}
function saveUi(patch) {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUi(), ...patch })); } catch (e) { /* 表示設定のみなので無視 */ }
}

function todayISO() { return C.toISO(new Date()); }
function currentFy() { return Number(document.getElementById('global-fy').value) || C.fiscalYearOf(todayISO()); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function writeWorkbook(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
function yen(n) {
  if (n === '' || n == null || isNaN(Number(n))) return '';
  return `${Number(n).toLocaleString('ja-JP')}円`;
}
function staffById(id) { return DATA.staff.find((s) => s.id === id) || null; }
function staffName(id) { const s = staffById(id); return s ? s.name : '（削除済み）'; }
function issueBadges(issues) {
  if (!issues.length) return '<span class="badge ok">OK</span>';
  const e = issues.filter((i) => i.level === 'error').length;
  const w = issues.length - e;
  return (e ? `<span class="badge err">エラー${e}</span>` : '') + (w ? `<span class="badge warn">要確認${w}</span>` : '');
}
function issuesHtml(issues) {
  if (!issues.length) return '';
  const sorted = issues.filter((i) => i.level === 'error').concat(issues.filter((i) => i.level !== 'error'));
  return `<ul class="issue-list">${sorted.map((i) =>
    `<li class="${i.level}">${escapeHtml(i.msg)}${i.basis ? `<span class="basis">根拠：${escapeHtml(i.basis)}</span>` : ''}</li>`).join('')}</ul>`;
}
function tableHtml(headers, rowsHtml, emptyText) {
  if (!rowsHtml.length) return `<p class="empty">${escapeHtml(emptyText || 'データがありません。')}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>`;
}

/* ------------------------------------------------------------
 * モーダル・汎用フォーム
 * ------------------------------------------------------------ */
function openModal(title, bodyHtml, { wide } = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.querySelector('#modal .modal-box').classList.toggle('wide', !!wide);
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}

/**
 * fields: [{ key, label, type, options:[[value,label]], required, hint, step, full }]
 * onSubmit(values) → 返り値が文字列ならエラー表示、false なら閉じない、それ以外は閉じる
 */
function openForm(title, fields, values, onSubmit, { wide, before = '', after = '', submitLabel = '保存する' } = {}) {
  const inputs = fields.map((f) => {
    if (f.type === 'heading') return `<h4 class="form-heading">${escapeHtml(f.label)}</h4>`;
    const v = values[f.key] == null ? '' : values[f.key];
    const id = `f-${f.key}`;
    const req = f.required ? ' required' : '';
    let control;
    if (f.type === 'select') {
      control = `<select id="${id}"${req}>${f.options.map(([ov, ol]) =>
        `<option value="${escapeHtml(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${escapeHtml(ol)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${id}" rows="${f.rows || 3}">${escapeHtml(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<label class="checkbox-label${f.full ? ' full' : ''}"><input type="checkbox" id="${id}"${v ? ' checked' : ''}> ${escapeHtml(f.label)}</label>`;
    } else {
      control = `<input type="${f.type || 'text'}" id="${id}" value="${escapeHtml(v)}"${f.step ? ` step="${f.step}"` : ''}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}${req}>`;
    }
    return `<label class="${f.full ? 'full' : ''}">${escapeHtml(f.label)}${f.required ? ' <span class="req">必須</span>' : ''}${control}${f.hint ? `<small>${escapeHtml(f.hint)}</small>` : ''}</label>`;
  }).join('');
  openModal(title, `${before}<form id="modal-form" class="grid-form">${inputs}</form>${after}
    <div id="modal-errors"></div>
    <div class="row-actions end"><button type="button" class="btn-secondary" id="modal-cancel">キャンセル</button>
    <button type="button" class="btn-primary" id="modal-submit">${escapeHtml(submitLabel)}</button></div>`, { wide });
  const collect = () => {
    const out = {};
    for (const f of fields) {
      if (f.type === 'heading') continue;
      const el = document.getElementById(`f-${f.key}`);
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'number') out[f.key] = el.value === '' ? '' : Number(el.value);
      else out[f.key] = el.value.trim();
    }
    return out;
  };
  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-submit').onclick = () => {
    const vals = collect();
    const missing = fields.filter((f) => f.required && (vals[f.key] === '' || vals[f.key] == null));
    if (missing.length) {
      document.getElementById('modal-errors').innerHTML = `<p class="error-text">${missing.map((f) => escapeHtml(f.label)).join('、')}を入力してください。</p>`;
      return;
    }
    const res = onSubmit(vals);
    if (typeof res === 'string') document.getElementById('modal-errors').innerHTML = res;
    else if (res !== false) closeModal();
  };
  return { collect };
}

/* ------------------------------------------------------------
 * タブ・年度
 * ------------------------------------------------------------ */
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const activate = (tab) => {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
    saveUi({ tab });
  };
  buttons.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
  // 起動時は常に任用一覧を開く
  activate('appoint');
  window.activateTab = activate;
}
function initFiscalYearPicker() {
  const sel = document.getElementById('global-fy');
  const nowFy = C.fiscalYearOf(todayISO());
  const years = new Set([nowFy - 2, nowFy - 1, nowFy, nowFy + 1]);
  DATA.appointments.forEach((a) => a.start && years.add(C.fiscalYearOf(a.start)));
  const sorted = [...years].sort((a, b) => b - a);
  const prev = sel.value || loadUi().fy || nowFy;
  sel.innerHTML = sorted.map((y) => `<option value="${y}">${C.fyLabel(y)}（${y}）</option>`).join('');
  sel.value = sorted.includes(Number(prev)) ? String(prev) : String(nowFy);
  renderFyChips();
}
/** 年度の切替（年度ごとの任用人数つき） */
function renderFyChips() {
  const sel = document.getElementById('global-fy');
  const years = [...sel.options].map((o) => Number(o.value)).sort((a, b) => a - b);
  const cur = Number(sel.value);
  const nowFy = C.fiscalYearOf(todayISO());
  const chips = years.map((y) => {
    const n = C.fiscalYearSummary(DATA, y).staff;
    return `<button class="fy-chip${y === cur ? ' active' : ''}" data-fy="${y}">${C.toWarekiShort(C.fiscalYearStart(y)).replace(/\.4\.1$/, '')}年度${y === nowFy ? '<small>今年度</small>' : ''}<span class="fy-count">${n}人</span></button>`;
  }).join('');
  const box = document.getElementById('fy-chips');
  box.innerHTML = `<button class="fy-nav" data-step="-1" aria-label="前の年度">◀</button>${chips}<button class="fy-nav" data-step="1" aria-label="次の年度">▶</button>`;
  const go = (y) => {
    if (!years.includes(y)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${y}">${C.fyLabel(y)}（${y}）</option>`);
    }
    sel.value = String(y);
    sel.dispatchEvent(new Event('change'));
  };
  box.querySelectorAll('[data-fy]').forEach((b) => (b.onclick = () => go(Number(b.dataset.fy))));
  box.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => go(cur + Number(b.dataset.step))));
}

/* ------------------------------------------------------------
 * ホーム
 * ------------------------------------------------------------ */
/** 申送事項（総務課職員係）の年間スケジュール。month は該当月（1〜12） */
const YEARLY_SCHEDULE = [
  { month: 4, text: '退職者の社会保険等の喪失手続き（共済組合・厚生年金・雇用保険・総合事務組合）／新規採用者の資格取得手続き（共済短期・厚生年金・雇用保険）' },
  { month: 6, text: '雇用保険料・労働保険料の申告・支払（電子申請）' },
  { month: 7, text: '被保険者報酬月額算定基礎届・賞与支払届の提出' },
  { month: 9, text: '算定基礎届に基づく標準報酬月額の変更（人事システムの保険情報へ反映）' },
  { month: 10, text: '雇用保険から退職手当制度への切替（4/1採用のフルタイム1年目：6月経過）' },
  { month: 11, text: '任用希望調査（各課の新規需要の把握）／公募職種及び勤務条件の決定' },
  { month: 12, text: '求人申込書等の提出依頼・公募関係書類作成' },
  { month: 1, text: '再度の任用に関する通知（人事評価の結果・本人の希望による）／募集期間・公募（HP・区長文書・ハローワーク）' },
  { month: 2, text: '選考（書類審査・面接）、合否結果通知、採用手続書類の提出依頼' },
  { month: 3, text: '給料（報酬）額決定、翌年度の任用に関する通知（任用一覧の作成）、各課の任用起案の合議' },
];
/** 今後の手続き（切替時期・伺い・保育士確認） */
function upcomingProcedures(t, days) {
  const out = [];
  const limit = C.addDaysISO(t, days);
  for (const a of DATA.appointments) {
    if (a.status === 'canceled' || !a.start || a.end < t) continue;
    const name = staffName(a.staffId);
    const sw = C.fullTimeSwitchDates(DATA, a, DATA.settings);
    if (sw) {
      if (sw.taishu > t && sw.taishu <= limit && sw.taishu <= a.end) out.push({ date: sw.taishu, name, staffId: a.staffId, what: '雇用保険→退職手当の切替（フルタイム6月経過）', basis: '市マニュアル第Ⅶ章2' });
      if (sw.kyosai > t && sw.kyosai <= limit && sw.kyosai <= C.addDaysISO(a.end, 1)) out.push({ date: sw.kyosai, name, staffId: a.staffId, what: '共済組合（短期）→共済組合への切替（フルタイム12月経過）', basis: '市マニュアル第Ⅶ章1' });
    }
    if (a.start >= t && a.start <= limit && !a.ukagai) out.push({ date: a.start, name, staffId: a.staffId, what: `任用伺いが未受理（${a.dept} ${a.title}）`, basis: '申送事項（3月下旬 任用起案）' });
    if (/保育士/.test(a.title || '') && String(a.hoikushiCheck || '') !== '済') out.push({ date: a.start, name, staffId: a.staffId, what: '保育士特定登録取消者管理システムの確認が未済', basis: '任用一覧の確認項目' });
  }
  for (const s of hiresWithoutAppointment()) {
    if (s.hireDate < C.addDaysISO(t, -days) || s.hireDate > limit) continue;
    out.push({ date: s.hireDate, name: s.name, staffId: s.id, what: `任用が未登録（名簿の採用日。${s.rosterDept || ''} ${s.rosterTitle || ''}）`, basis: '職員名簿の取込' });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}
function renderHome() {
  const t = todayISO();
  const fy = currentFy();
  const statuses = DATA.appointments.map((a) => C.appointmentStatus(a, t));
  const active = statuses.filter((s) => s === 'active').length;
  const planned = statuses.filter((s) => s === 'planned').length;
  const issueCount = DATA.appointments.filter((a) => a.status !== 'canceled' && a.start && C.fiscalYearOf(a.start) === fy && C.validateAppointment(a, DATA, DATA.settings).length).length;
  const missing = C.missingEvaluations(DATA, fy);
  const openExams = DATA.exams.filter((e) => e.status !== 'closed');
  const procs = upcomingProcedures(t, 90);
  const stat = (label, value, tab, tone) =>
    `<button class="stat ${tone || ''}" data-goto="${tab}"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></button>`;
  document.getElementById('home-stats').innerHTML = [
    stat('本日在職中', `${active}人`, 'appoint'),
    stat('任用予定', `${planned}件`, 'appoint'),
    stat(`${C.fyLabel(fy)} 要確認の任用`, `${issueCount}件`, 'appoint', issueCount ? 'warn' : ''),
    stat(`${C.fyLabel(fy)} 評価未入力`, `${missing.length}人`, 'eval', missing.length ? 'warn' : ''),
    stat('90日以内の手続き', `${procs.length}件`, 'home', procs.length ? 'warn' : ''),
    stat('実施中の試験', `${openExams.length}件`, 'exam'),
  ].join('');
  document.querySelectorAll('#home-stats [data-goto]').forEach((b) => (b.onclick = () => window.activateTab(b.dataset.goto)));

  const nextFy = C.fiscalYearOf(t) + 1;
  const needPublic = DATA.appointments.filter((a) => a.status !== 'canceled' && a.start && C.fiscalYearOf(a.start) === nextFy - 1
    && C.publicRecruitFy(DATA, a, DATA.settings) === nextFy);
  document.getElementById('home-public').innerHTML = `<p class="hint">${C.fyLabel(nextFy - 1)}が${Number(DATA.settings.reappointLimit) + 1}年目の職員です。採用月にかかわらず採用した年度を1年目と数え、毎年4月の再度の任用（更新）は連続${DATA.settings.reappointLimit}回までのため、${C.toWarekiShort(C.fiscalYearStart(nextFy))}の任用は公募となります（市マニュアル第Ⅷ章2）。11月の公募職種の決定に使ってください。</p>`
    + tableHtml(['氏名', '所属', '業務内容', '区分', '採用年度からの年目'], needPublic.map((a) =>
      `<tr><td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${C.KUBUN_LABEL[C.kubunOf(a)]}</td><td>${C.yearInServiceOf(DATA, a)}年目</td></tr>`),
    `${C.toWarekiShort(C.fiscalYearStart(nextFy))}に公募が必要な職員はいません。`);
  const fyList = C.fiscalYearsInData(DATA);
  document.getElementById('home-years').innerHTML = tableHtml(
    ['年度', '任用人数', 'フル', 'パート(月額)', 'パート(日額)', 'パート(時間額)', '公募', '再度の任用', '翌年度も任用', '評価入力', ''],
    fyList.slice().reverse().map((y) => {
      const sm = C.fiscalYearSummary(DATA, y);
      const k = (key) => sm.byKubun[key] || 0;
      return `<tr class="${y === fy ? 'row-selected' : ''}"><td><strong>${C.fyLabel(y)}</strong></td><td>${sm.staff}人</td><td>${k('full')}</td><td>${k('part_monthly')}</td><td>${k('part_daily')}</td><td>${k('part_hourly')}</td>
        <td>${sm.publicCount}</td><td>${sm.reappointCount}</td><td>${sm.continuing}人</td><td>${sm.evaluated}/${sm.staff}</td>
        <td><button class="btn-small" data-open-fy="${y}">この年度を開く</button></td></tr>`;
    }),
    '任用が登録されていません。「Excel取込」から過去の任用一覧を取り込んでください。',
  );
  document.querySelectorAll('[data-open-fy]').forEach((b) => (b.onclick = () => {
    const sel = document.getElementById('global-fy');
    sel.value = b.dataset.openFy;
    sel.dispatchEvent(new Event('change'));
    window.activateTab('appoint');
  }));
  document.getElementById('home-procedures').innerHTML = tableHtml(
    ['期日', '氏名', '手続き・確認', '根拠'],
    procs.map((p) => `<tr><td>${C.formatDateJa(p.date)}</td><td>${nameLink(p.staffId)}</td><td>${escapeHtml(p.what)}</td><td><small class="muted">${escapeHtml(p.basis)}</small></td></tr>`),
    '90日以内に予定されている手続きはありません。',
  );
  const month = Number(t.slice(5, 7));
  const order = [...YEARLY_SCHEDULE].sort((a, b) => ((a.month - month + 12) % 12) - ((b.month - month + 12) % 12));
  document.getElementById('home-schedule').innerHTML = `<ul class="schedule">${order.map((s) =>
    `<li class="${s.month === month ? 'now' : ''}"><span class="month">${s.month}月</span>${escapeHtml(s.text)}</li>`).join('')}</ul>`;

  const exp = C.expiringAppointments(DATA, t, Number(DATA.settings.expiryAlertDays) || 60);
  document.getElementById('home-expiring').innerHTML = tableHtml(
    ['氏名', '所属', '業務内容', '任期', '残り日数', '次年度'],
    exp.map(({ appt, daysLeft }) => {
      const nextFy = C.fiscalYearOf(appt.start) + 1;
      const hasNext = DATA.appointments.some((a) => a.staffId === appt.staffId && a.status !== 'canceled' && C.fiscalYearOf(a.start) === nextFy);
      return `<tr><td>${nameLink(appt.staffId)}</td><td>${escapeHtml(appt.dept)}</td><td>${escapeHtml(appt.title)}</td>
        <td>${appt.start}〜${appt.end}</td><td>${daysLeft}日</td><td>${hasNext ? '登録済み' : '<span class="badge warn">未登録（任期満了退職の確認）</span>'}</td></tr>`;
    }),
    '任期満了が近い職員はいません。',
  );
  document.getElementById('home-missing-eval').innerHTML = tableHtml(
    ['氏名', '所属', '業務内容', '任期'],
    missing.map((a) => `<tr><td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${a.start}〜${a.end}</td></tr>`),
    '未入力の職員はいません。',
  );
  document.getElementById('home-exams').innerHTML = tableHtml(
    ['試験名', '方法', '職', '試験日', '応募者', '合格'],
    openExams.map((e) => {
      const apps = DATA.applicants.filter((a) => a.examId === e.id);
      return `<tr><td>${escapeHtml(e.name)}</td><td>${C.EXAM_METHOD_LABEL[e.method] || ''}</td><td>${escapeHtml(e.dept)} ${escapeHtml(e.title)}</td>
        <td>${e.examDate || ''}</td><td>${apps.length}人</td><td>${apps.filter((a) => a.result === 'pass').length}人</td></tr>`;
    }),
    '実施中の試験はありません。',
  );
}
/* ------------------------------------------------------------
 * バックアップ警告
 * ------------------------------------------------------------ */
function renderBackupBanner() {
  const el = document.getElementById('backup-banner');
  const status = document.getElementById('backup-status');
  const hasData = DATA.staff.length || DATA.appointments.length || DATA.exams.length;
  const last = DATA.lastBackupAt;
  const lastText = last ? new Date(last).toLocaleString('ja-JP') : 'まだ保存していません';
  status.textContent = `前回のバックアップ：${lastText}`;
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  const limit = Number(DATA.settings.backupReminderDays) || 7;
  if (hasData && days > limit) {
    el.innerHTML = `⚠ ${last ? `前回のバックアップから${Math.floor(days)}日経過しています。` : 'まだバックアップを保存していません。'}データはこの端末のブラウザ内にしかありません。
      <button class="btn-small" id="banner-backup">今すぐバックアップ</button>`;
    el.classList.remove('hidden');
    document.getElementById('banner-backup').onclick = doBackup;
  } else {
    el.classList.add('hidden');
  }
}

/* ------------------------------------------------------------
 * 職員台帳
 * ------------------------------------------------------------ */
const GENDER_OPTIONS = [['', '未設定'], ['M', '男性'], ['F', '女性']];
const GENDER_LABEL = { M: '男性', F: '女性', '': '' };

function staffFields() {
  return [
    { key: 'number', label: '職員番号' },
    { key: 'name', label: '氏名', required: true, placeholder: '例：高田 花子' },
    { key: 'kana', label: 'ふりがな' },
    { key: 'gender', label: '性別', type: 'select', options: GENDER_OPTIONS },
    { key: 'birth', label: '生年月日', type: 'date' },
    { key: 'hireDate', label: '採用日（人事システム）', type: 'date' },
    { key: 'retireDate', label: '退職日（人事システム）', type: 'date' },
    { key: 'jobType', label: '職種' },
    { key: 'postal', label: '郵便番号' },
    { key: 'address', label: '住所', full: true },
    { key: 'phone', label: '電話' },
    { key: 'mobile', label: '携帯' },
    { key: 'email', label: 'メール' },
    { key: 'emergencyName', label: '緊急時連絡先（氏名）' },
    { key: 'emergencyRelation', label: '緊急時連絡先（続柄）' },
    { key: 'emergencyPhone', label: '緊急時連絡先（電話）' },
    { key: 'note', label: '備考', type: 'textarea', full: true },
  ];
}
function openStaffForm(staff, afterSave) {
  const isNew = !staff;
  openForm(isNew ? '職員を追加' : '職員情報を編集', staffFields(), staff || {}, (v) => {
    if (v.number && DATA.staff.some((s) => s.number === v.number && (!staff || s.id !== staff.id))) {
      return '<p class="error-text">同じ職員番号の職員が既に登録されています。</p>';
    }
    let saved;
    if (isNew) {
      saved = { id: C.uid('st'), ...v, category: '会計年度任用職員', createdAt: new Date().toISOString() };
      DATA.staff.push(saved);
    } else {
      Object.assign(staff, v);
      saved = staff;
    }
    saveData();
    showToast(isNew ? '職員を追加しました。' : '職員情報を更新しました。');
    if (afterSave) afterSave(saved);
    return undefined;
  });
}
function renderStaff() {
  const q = document.getElementById('staff-search').value.trim().replace(/[\s　]/g, '');
  const t = todayISO();
  const fy = currentFy();
  const fyOnly = document.getElementById('staff-fy-only').checked;
  const inFy = (sid) => DATA.appointments.find((a) => a.staffId === sid && a.status !== 'canceled' && a.start && C.fiscalYearOf(a.start) === fy);
  const list = DATA.staff
    .filter((s) => !fyOnly || inFy(s.id))
    .filter((s) => !q || [s.number, s.name, s.kana].some((x) => String(x || '').replace(/[\s　]/g, '').includes(q)))
    .sort((a, b) => String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'));
  document.getElementById('staff-table').innerHTML = tableHtml(
    ['番号', '氏名', 'ふりがな', '性別', '生年月日', '採用日', `${C.fyLabel(fy)}の所属・職名`, '働き始め', '勤続', '任用年度数', '直近の評価', ''],
    list.map((s) => {
      const appts = C.appointmentsOfStaff(DATA, s.id).filter((a) => a.status !== 'canceled');
      const cur = appts.find((a) => C.appointmentStatus(a, t) === 'active');
      const evs = DATA.evaluations.filter((e) => e.staffId === s.id).sort((a, b) => b.fiscalYear - a.fiscalYear);
      const fys = new Set(appts.map((a) => C.fiscalYearOf(a.start)));
      const fa = inFy(s.id) || (fyOnly ? null : cur);
      const last = appts[appts.length - 1];
      const sy = last ? C.continuousServiceYears(DATA, last) : null;
      const dash = '<span class="muted">—</span>';
      return `<tr><td>${escapeHtml(s.number)}</td><td>${nameLink(s.id)}</td><td>${escapeHtml(s.kana)}</td>
        <td>${GENDER_LABEL[s.gender || ''] || dash}</td><td>${s.birth ? C.toWarekiShort(s.birth) : dash}</td><td>${s.hireDate ? C.toWarekiShort(s.hireDate) : dash}</td>
        <td>${fa ? `${escapeHtml(fa.dept)} ${escapeHtml(fa.title)}` : '<span class="muted">—</span>'}</td>
        <td>${appts.length ? C.toWarekiShort(appts[0].start) : '<span class="muted">—</span>'}</td>
        <td>${sy == null ? '<span class="muted">—</span>' : sy === 0 ? '初年' : `${sy}年`}</td>
        <td>${fys.size}年度</td>
        <td>${evs[0] ? `${C.fyLabel(Number(evs[0].fiscalYear))}：${escapeHtml(evs[0].overall || '—')}` : '<span class="muted">—</span>'}</td>
        <td class="actions"><button class="btn-small" data-detail="${s.id}">経歴</button><button class="btn-small" data-edit="${s.id}">編集</button><button class="btn-danger" data-del="${s.id}">削除</button></td></tr>`;
    }),
    DATA.staff.length ? '該当する職員がいません。' : '職員が登録されていません。「職員を追加」または「Excel取込」から登録してください。',
  );
  const tbl = document.getElementById('staff-table');
  tbl.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openStaffForm(staffById(b.dataset.edit))));
  tbl.querySelectorAll('[data-detail]').forEach((b) => (b.onclick = () => openStaffDetail(b.dataset.detail)));
  tbl.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const s = staffById(b.dataset.del);
    const n = DATA.appointments.filter((a) => a.staffId === s.id).length + DATA.evaluations.filter((e) => e.staffId === s.id).length;
    if (!confirm(`${s.name} を削除しますか？${n ? `\n任用・評価の記録${n}件もあわせて削除されます。` : ''}`)) return;
    DATA.staff = DATA.staff.filter((x) => x.id !== s.id);
    DATA.appointments = DATA.appointments.filter((a) => a.staffId !== s.id);
    DATA.evaluations = DATA.evaluations.filter((e) => e.staffId !== s.id);
    DATA.applicants.forEach((a) => { if (a.staffId === s.id) a.staffId = null; });
    saveData();
    showToast('削除しました。');
  }));
}
/** 氏名のリンク（押すと経歴を開く） */
function nameLink(staffId, label) {
  const s = staffById(staffId);
  const text = label != null ? label : s ? s.name : '（削除済み）';
  return s ? `<a href="#" class="name-link" data-staff="${s.id}">${escapeHtml(text)}</a>` : escapeHtml(text);
}
const CHANGE_LABEL = { first: '初任用', gap: '途切れ', dept: '所属変更', title: '職名変更', kubun: '区分変更', hours: '時間変更', pay: '報酬変更', public: '公募', renew: '任期更新' };
function wareki(iso) { return iso ? C.formatDateJa(iso) : '—'; }
function ageOn(birth, iso) {
  const b = C.parseISO(birth);
  const d = C.parseISO(iso);
  let y = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) y -= 1;
  return y;
}
function openStaffDetail(staffId) {
  const s = staffById(staffId);
  if (!s) return;
  const t = todayISO();
  const career = C.careerOf(DATA, s.id, DATA.settings, t);
  const sm = career.summary;
  const evs = DATA.evaluations.filter((e) => e.staffId === s.id).sort((a, b) => b.fiscalYear - a.fiscalYear);
  const apps = DATA.applicants.filter((a) => a.staffId === s.id);
  const cur = sm.current || sm.last;
  const card = (label, value, sub) => `<div class="sum-card"><span class="sum-label">${label}</span><span class="sum-value">${value}</span>${sub ? `<span class="sum-sub">${sub}</span>` : ''}</div>`;
  const timeline = career.rows.slice().reverse().map((r) => {
    const a = r.appt;
    const isCur = sm.current && sm.current.id === a.id;
    return `<li class="tl-item${isCur ? ' current' : ''}">
      <div class="tl-year"><span class="tl-fy">${C.fyLabel(r.fy)}</span><span class="badge">${r.cycleYear}年目</span>${isCur ? '<span class="badge ok">現在</span>' : ''}</div>
      <div class="tl-body">
        <div class="tl-period">${wareki(a.start)} 〜 ${wareki(a.end)}　<small class="muted">${C.RECRUIT_LABEL[a.recruitMethod] || ''}</small></div>
        <div class="tl-main"><strong>${escapeHtml(a.dept || '—')}</strong>${a.workplace && a.workplace !== a.dept ? `（${escapeHtml(a.workplace)}）` : ''}　${escapeHtml(a.title || '—')}</div>
        <div class="tl-sub">${C.KUBUN_LABEL[C.kubunOf(a)]}・${C.hoursOf(a) != null ? `週${C.hoursOf(a)}時間` : escapeHtml(a.hoursText || '勤務時間未設定')}・${C.PAY_TYPE_LABEL[a.payType] || ''} ${yen(a.payAmount)}・勤続${r.serviceYears === 0 ? '初年' : `${r.serviceYears}年`}</div>
        ${r.changes.length ? `<div class="tl-changes">${r.changes.map((c) => `<span class="chg chg-${c.kind}" title="${escapeHtml(c.text)}"><b>${CHANGE_LABEL[c.kind]}</b> ${escapeHtml(c.kind === 'first' ? '' : c.text.replace(/^[^：]*：/, ''))}</span>`).join('')}</div>` : ''}
        <div class="tl-actions"><button class="btn-small" data-career-edit="${a.id}">この任用を開く</button></div>
      </div></li>`;
  }).join('');
  const body = `
    <div class="sum-grid">
      ${card('働き始め（初回任用）', wareki(sm.firstStart), [sm.fiscalYears ? `任用のある年度：${sm.fiscalYears}年度分` : '', s.hireDate ? `名簿の採用日：${C.toWarekiShort(s.hireDate)}` : ''].filter(Boolean).join('<br>'))}
      ${card('勤続（切れ目なく継続）', sm.serviceStart ? `${wareki(sm.serviceStart)}から` : '—', sm.serviceYears == null ? '' : `継続勤務年数 ${sm.serviceYears === 0 ? '初年' : `${sm.serviceYears}年`}${sm.serviceEstimated ? '（年目から推定）' : ''}`)}
      ${card(sm.current ? '現在の所属・職名' : '直近の所属・職名', cur ? `${escapeHtml(cur.dept || '—')}` : '—', cur ? `${escapeHtml(cur.title || '')}・${C.KUBUN_LABEL[C.kubunOf(cur)]}` : '')}
      ${card('3年周期', sm.cycleYear ? `${sm.cycleYear}年目` : '—', sm.publicFy ? `${C.toWarekiShort(C.fiscalYearStart(sm.publicFy)).replace(/\.1$/, '')} に公募` : '')}
      ${card('変更の回数', `所属 ${sm.deptChanges}回・職名 ${sm.titleChanges}回`, '')}
    </div>
    <dl class="kv compact">
      <dt>職員番号</dt><dd>${escapeHtml(s.number) || '—'}</dd>
      <dt>ふりがな</dt><dd>${escapeHtml(s.kana) || '—'}</dd>
      <dt>性別</dt><dd>${GENDER_LABEL[s.gender || ''] || '—'}</dd>
      <dt>生年月日</dt><dd>${s.birth ? `${C.formatDateJa(s.birth)}（${ageOn(s.birth, t)}歳）` : '—'}</dd>
      <dt>採用日（人事システム）</dt><dd>${s.hireDate ? C.formatDateJa(s.hireDate) : '—'}</dd>
      <dt>退職日（人事システム）</dt><dd>${s.retireDate ? C.formatDateJa(s.retireDate) : '—'}</dd>
      <dt>区分・職種</dt><dd>${escapeHtml([s.category, s.jobType].filter(Boolean).join('・')) || '—'}</dd>
      <dt>名簿の所属・職名</dt><dd>${escapeHtml([s.rosterDept, s.rosterSection, s.rosterTitle].filter(Boolean).join(' ')) || '—'}</dd>
      <dt>住所</dt><dd>${escapeHtml([s.postal ? `〒${s.postal}` : '', s.address].filter(Boolean).join(' ')) || '—'}</dd>
      <dt>電話・携帯</dt><dd>${escapeHtml([s.phone, s.mobile].filter(Boolean).join('／')) || '—'}</dd>
      <dt>メール</dt><dd>${escapeHtml(s.email) || '—'}</dd>
      <dt>緊急時連絡先</dt><dd>${escapeHtml([s.emergencyName, s.emergencyRelation ? `（${s.emergencyRelation}）` : '', s.emergencyPhone].filter(Boolean).join(' ')) || '—'}</dd>
    </dl>
    ${s.rosterImportedAt ? `<p class="muted">人事システムの名簿から取込：${new Date(s.rosterImportedAt).toLocaleDateString('ja-JP')}</p>` : ''}
    <h4>経歴（新しい順）</h4>
    ${career.rows.length ? `<ol class="timeline">${timeline}</ol>` : '<p class="empty">任用の記録はありません。</p>'}
    <h4>人事評価</h4>
    ${tableHtml(['年度', ...DATA.settings.evalItems, '総合', '所見（任用）', '本人の希望', '評価者'], evs.map((e) =>
      `<tr><td>${C.fyLabel(Number(e.fiscalYear))}</td>${DATA.settings.evalItems.map((it) => `<td>${escapeHtml((e.items || {})[it] || '')}</td>`).join('')}
       <td>${escapeHtml(e.overall)}</td><td>${C.RECOMMEND_LABEL[e.recommend || '']}</td><td>${C.WISH_LABEL[e.wish || '']}</td><td>${escapeHtml(e.evaluator)}</td></tr>`), '評価の記録はありません。')}
    <h4>採用試験の応募歴</h4>
    ${tableHtml(['試験', '結果'], apps.map((a) => {
      const ex = DATA.exams.find((x) => x.id === a.examId);
      return `<tr><td>${escapeHtml(ex ? ex.name : '（削除済み）')}</td><td>${C.RESULT_LABEL[a.result || 'pending']}</td></tr>`;
    }), '応募歴はありません。')}
    ${s.note ? `<h4>備考</h4><p>${escapeHtml(s.note)}</p>` : ''}
    <div class="row-actions end">
      <button class="btn-secondary" id="detail-edit-staff">基本情報を編集</button>
      <button class="btn-secondary" id="detail-export">経歴をExcelに書き出す</button>
      <button class="btn-primary" id="detail-add-appt">この職員の任用を登録</button>
    </div>`;
  openModal(`${s.name} さんの経歴`, body, { wide: true });
  document.getElementById('detail-add-appt').onclick = () => { closeModal(); openAppointForm(null, { staffId: s.id }); };
  document.getElementById('detail-edit-staff').onclick = () => { closeModal(); openStaffForm(s); };
  document.querySelectorAll('[data-career-edit]').forEach((b) => (b.onclick = () => {
    const a = DATA.appointments.find((x) => x.id === b.dataset.careerEdit);
    closeModal();
    openAppointForm(a);
  }));
  document.getElementById('detail-export').onclick = () => {
    const rows = [['年度', '3年周期', '勤続', '任期（自）', '任期（至）', '採用方法', '所属', '就業場所', '職名', '区分', '勤務時間/週', '給料・報酬', '変更点']];
    for (const r of career.rows) {
      const a = r.appt;
      rows.push([C.fyLabel(r.fy), `${r.cycleYear}年目`, r.serviceYears === 0 ? '初年' : `${r.serviceYears}年`, a.start, a.end, C.RECRUIT_LABEL[a.recruitMethod] || '',
        a.dept || '', a.workplace || '', a.title || '', C.KUBUN_LABEL[C.kubunOf(a)], C.hoursOf(a) ?? (a.hoursText || ''), a.payAmount === '' ? '' : a.payAmount,
        r.changes.map((c) => `${CHANGE_LABEL[c.kind]}${c.kind === 'first' ? '' : `（${c.text}）`}`).join('／')]);
    }
    writeWorkbook(`経歴_${s.name}_${stamp()}.xlsx`, [{ name: '経歴', rows }]);
  };
}

/* ------------------------------------------------------------
 * 任用管理
 * ------------------------------------------------------------ */
function staffOptions(includeBlank = true) {
  const list = DATA.staff.slice().sort((a, b) => String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'));
  return (includeBlank ? [['', '選択してください']] : []).concat(list.map((s) => [s.id, `${s.name}${s.number ? `（${s.number}）` : ''}`]));
}
const KUBUN_OPTIONS = Object.entries(C.KUBUN_LABEL);
const INS_SOCIAL_OPTIONS = [['', '未記入'], ['共済', '共済'], ['共済(短期)', '共済(短期)'], ['無', '無']];
const INS_EMP_OPTIONS = [['', '未記入'], ['雇用保険', '雇用保険'], ['退手', '退手'], ['無', '無']];
const UMU_OPTIONS = [['', '未記入'], ['有', '有'], ['無', '無']];
const CHECK_OPTIONS = [['', '未記入'], ['済', '済'], ['未', '未'], ['-', '-（対象外）']];

function appointFields() {
  return [
    { type: 'heading', label: '職員・任用' },
    { key: 'staffId', label: '職員', type: 'select', options: staffOptions(), required: true },
    { key: 'recruitMethod', label: '採用方法', type: 'select', options: Object.entries(C.RECRUIT_LABEL) },
    { key: 'yearInService', label: '会計年度（3年周期の何年目）', type: 'number', hint: '公募の判断用。採用月にかかわらず採用した年度を1年目と数え、公募で1年目に戻る（例：R5.11採用→R5が1年目、R8.4に公募）。空欄なら任用履歴から自動計算' },
    { key: 'serviceStart', label: '勤続開始日（履歴がない場合）', type: 'date', hint: '公募をまたいで切れ目なく勤務している場合の最初の任用日。空欄なら任用履歴から自動計算（年休に使用）' },
    { key: 'fullTimeStart', label: 'フルタイム継続開始日（履歴がない場合）', type: 'date', hint: 'フルタイムで切れ目なく勤務している最初の任用日。空欄なら任用履歴から自動計算（退手・共済の切替に使用）' },
    { key: 'ukagai', label: '任用伺い 受理済み（○）', type: 'checkbox' },
    { type: 'heading', label: '所属・業務' },
    { key: 'deptCode', label: '所属CD' },
    { key: 'dept', label: '所属名', required: true },
    { key: 'workplace', label: '就業場所' },
    { key: 'title', label: '業務内容', required: true, placeholder: '例：保育士、事務補助員' },
    { key: 'account', label: '会計' },
    { key: 'budgetCode', label: '予算科目' },
    { type: 'heading', label: '任用期間・勤務時間' },
    { key: 'kubun', label: '区分', type: 'select', options: KUBUN_OPTIONS },
    { key: 'start', label: '任用期間（開始）', type: 'date', required: true },
    { key: 'end', label: '任用期間（終了）', type: 'date', required: true, hint: '開始日の属する会計年度の3月31日まで' },
    { key: 'weeklyHours', label: '勤務時間/週（時間）', type: 'number', step: '0.25', hint: `フルは${DATA.settings.fullTimeWeeklyHours}時間。日額・時間額で定まらない場合は空欄` },
    { key: 'hoursText', label: '勤務時間の記載（週時間が空欄のとき）', placeholder: '例：随時' },
    { key: 'weeklyDays', label: '1週間の勤務日数', type: 'number', hint: 'フル・月額パートは5日として判定。日額・時間額パートは入力（年休の判定に使用）' },
    { key: 'annualWorkDays', label: '任用期間の勤務日数（週で定めない場合）', type: 'number' },
    { key: 'leaveGrant', label: '年休の付与', type: 'select', options: Object.entries(C.LEAVE_GRANT_LABEL) },
    { key: 'annualLeave', label: '年休（日数）', type: 'number', hint: '付与日数（前年度からの繰越分は含めない）。時間額パートで付与する場合はここに手入力' },
    { type: 'heading', label: '給料・報酬・手当' },
    { key: 'baseAmount', label: '基礎額（円）', type: 'number' },
    { key: 'payAmount', label: '給料・報酬額（円）', type: 'number', hint: '月額・日額・時間額（区分による）' },
    { key: 'payDay', label: '給料・報酬支給日', placeholder: '毎月21日／翌月21日' },
    { key: 'bonus', label: '期末手当 支給の有無', type: 'select', options: UMU_OPTIONS },
    { key: 'commuteDay', label: '通勤手当支給日', placeholder: '毎月21日／翌月21日' },
    { type: 'heading', label: '社会保険・雇用保険・確認事項' },
    { key: 'socialIns', label: '社会保険（4/1時点）', type: 'select', options: INS_SOCIAL_OPTIONS },
    { key: 'kyosaiSwitch', label: '健保→共済 切替時期', placeholder: '例：4/1' },
    { key: 'empIns', label: '雇保／退手（4/1時点）', type: 'select', options: INS_EMP_OPTIONS },
    { key: 'taishuSwitch', label: '雇保→退手 切替時期', placeholder: '例：10/1' },
    { key: 'hoikushiCheck', label: '保育士特定登録取消者管理システム', type: 'select', options: CHECK_OPTIONS },
    { key: 'note', label: '備考', type: 'textarea', full: true },
    { key: 'canceled', label: 'この任用を取り消す（記録は残す）', type: 'checkbox', full: true },
  ];
}
/** フォームの値から任用レコードを組み立てる */
function appointFromForm(v, base) {
  const rec = { ...(base || { id: C.uid('ap'), renewals: [], createdAt: new Date().toISOString() }), ...v };
  C.applyKubun(rec, v.kubun);
  delete rec.kubun;
  rec.fiscalYear = v.start ? C.fiscalYearOf(v.start) : '';
  rec.status = v.canceled ? 'canceled' : '';
  delete rec.canceled;
  return rec;
}
/** 市マニュアルに基づく判定結果（フォーム下部に表示） */
function judgeAppointment(rec) {
  const s = DATA.settings;
  const tmp = { ...DATA, appointments: DATA.appointments.filter((a) => a.id !== rec.id).concat([rec]) };
  const calc = C.calcPay(rec, s);
  const bonus = C.bonusEligibility(rec, s);
  const soc = rec.staffId ? C.suggestSocialIns(tmp, rec, s) : null;
  const emp = rec.staffId ? C.suggestEmpIns(tmp, rec, s) : null;
  const sw = rec.staffId ? C.fullTimeSwitchDates(tmp, rec, s) : null;
  const md = (iso) => { const d = C.parseISO(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };
  return {
    payAmount: calc,
    payDay: C.expectedPayDay(rec),
    commuteDay: C.expectedPayDay(rec),
    bonus,
    socialIns: soc ? soc.value : null,
    socialNote: soc && !soc.sure ? soc.note : '',
    empIns: emp ? emp.value : null,
    kyosaiSwitch: sw ? md(sw.kyosai) : null,
    taishuSwitch: sw ? md(sw.taishu) : null,
    sw,
    health: C.healthCheckRequired(rec, s),
    leave: rec.staffId ? C.annualLeaveInfo(tmp, rec, s) : null,
    annualLeave: rec.staffId ? C.annualLeaveDays(tmp, rec, s) : null,
    serviceYears: rec.staffId ? C.continuousServiceYears(tmp, rec) : null,
    service: rec.staffId ? C.serviceStartOf(tmp, rec, false) : null,
    publicFy: rec.staffId ? C.publicRecruitFy(tmp, rec, s) : null,
    year: rec.staffId ? C.yearInServiceOf(tmp, rec) : null,
  };
}
function judgeHtml(j) {
  const v = (x, unit = '') => (x == null || x === '' ? '<span class="muted">判定不可（入力不足）</span>' : `<strong>${escapeHtml(typeof x === 'number' ? x.toLocaleString('ja-JP') : x)}${unit}</strong>`);
  return `<div class="judge-box"><h4>市マニュアルによる判定</h4><dl class="kv">
    <dt>給料・報酬額（算定式）</dt><dd>${v(j.payAmount, '円')} <small class="muted">第Ⅲ章</small></dd>
    <dt>給料・報酬／通勤手当の支給日</dt><dd>${v(j.payDay)} <small class="muted">第Ⅲ章3</small></dd>
    <dt>期末手当</dt><dd>${v(j.bonus)} <small class="muted">第Ⅳ章10（6か月以上かつ週15.5時間以上）</small></dd>
    <dt>年休（付与日数）</dt><dd>${j.leave && !j.leave.granted ? `<strong>付与しない</strong> <small class="muted">${escapeHtml(j.leave.reason)}</small>` : v(j.annualLeave, '日')}${j.leave && j.leave.granted && j.leave.reason ? ` <small class="warn-text">${escapeHtml(j.leave.reason)}</small>` : ''} <small class="muted">第Ⅴ章1（継続勤務年数${j.serviceYears == null ? '—' : j.serviceYears === 0 ? '：任用の日' : `：${j.serviceYears}年`}。繰越分は含まない）</small></dd>
    <dt>社会保険（任用開始時）</dt><dd>${v(j.socialIns)} ${j.socialNote ? `<small class="warn-text">${escapeHtml(j.socialNote)}</small>` : ''} <small class="muted">第Ⅶ章1</small></dd>
    <dt>雇保／退手（任用開始時）</dt><dd>${v(j.empIns)} <small class="muted">第Ⅶ章2</small></dd>
    ${j.sw ? `<dt>フルタイム継続開始日</dt><dd>${j.sw.serviceStart}${j.sw.estimated ? '（年目から推定）' : ''}</dd>
      <dt>雇保→退手 切替</dt><dd><strong>${j.sw.taishu}</strong> <small class="muted">6月経過</small></dd>
      <dt>健保→共済 切替</dt><dd><strong>${j.sw.kyosai}</strong> <small class="muted">12月経過</small></dd>` : ''}
    <dt>健康診断・ストレスチェック</dt><dd>${j.health ? '<strong>対象</strong>' : '対象外'} <small class="muted">第Ⅶ章4（任用1年かつ週29時間以上）</small></dd>
    <dt>勤続（継続勤務）</dt><dd>${j.service ? `${j.service.date}から${j.service.manual ? '（入力値）' : j.service.estimated ? '（年目から推定）' : ''}・継続勤務年数 ${j.serviceYears === 0 ? '任用の日' : `${j.serviceYears}年`}` : '—'} <small class="muted">公募をまたいでも切れ目がなければ通算（年休・退手・共済に使用）</small></dd>
    <dt>3年周期の年目（公募の判断）</dt><dd>${j.year ? `${j.year}年目` : '—'}${j.publicFy ? `・<strong>${C.toWarekiShort(C.fiscalYearStart(j.publicFy)).replace(/\.1$/, '')}に公募</strong>` : ''} <small class="muted">第Ⅷ章2（公募で1年目に戻る）</small></dd>
  </dl>
  <button type="button" class="btn-secondary" id="judge-apply">判定結果を入力欄に反映</button>
  <small class="muted">（給料・報酬額、支給日、期末手当、年休、社会保険、雇保/退手、切替時期を上書きします）</small></div>`;
}
function openAppointForm(appt, preset = {}) {
  if (!DATA.staff.length) { alert('先に職員台帳に職員を登録してください。'); return; }
  const isNew = !appt;
  const fy = currentFy();
  const { onSaved, ...presetValues } = preset;
  const values = appt ? { ...appt, kubun: C.kubunOf(appt), canceled: appt.status === 'canceled' } : {
    recruitMethod: 'public', kubun: 'part_monthly', start: C.fiscalYearStart(fy), end: C.fiscalYearEnd(fy), ...presetValues,
  };
  const trySave = (v, force) => {
    const rec = appointFromForm(v, appt);
    const issues = C.validateAppointment(rec, DATA, DATA.settings);
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length && !rec.status) return issuesHtml(issues);
    const warns = issues.filter((i) => i.level === 'warn');
    if (warns.length && !force) {
      return `${issuesHtml(warns)}<p class="hint">内容を確認のうえ、このまま保存する場合は下のボタンを押してください。</p>
        <button type="button" class="btn-secondary" id="modal-force">確認したのでこのまま保存</button>`;
    }
    if (isNew) DATA.appointments.push(rec);
    else Object.assign(appt, rec);
    if (onSaved) onSaved(rec);
    saveData();
    showToast(isNew ? '任用を登録しました。' : '任用を更新しました。');
    return undefined;
  };
  const form = openForm(isNew ? '任用を登録' : '任用を編集', appointFields(), values, (v) => {
    const res = trySave(v, false);
    if (typeof res === 'string') {
      setTimeout(() => {
        const f = document.getElementById('modal-force');
        if (f) f.onclick = () => { if (trySave(form.collect(), true) === undefined) closeModal(); };
      });
    }
    return res;
  }, { wide: true, after: '<div id="judge-area"></div>' });

  const refreshJudge = () => {
    const rec = appointFromForm(form.collect(), appt);
    const j = judgeAppointment(rec);
    document.getElementById('judge-area').innerHTML = judgeHtml(j);
    document.getElementById('judge-apply').onclick = () => {
      const set = (key, val) => { if (val != null && val !== '') document.getElementById(`f-${key}`).value = val; };
      set('payAmount', j.payAmount);
      set('payDay', j.payDay);
      set('commuteDay', j.commuteDay);
      set('bonus', j.bonus);
      if (j.leave && !j.leave.granted) {
        // 時間額パートの既定（付与しない）では手入力した日数を消さない
        if (!j.leave.defaultNone) document.getElementById('f-annualLeave').value = '';
      } else set('annualLeave', j.annualLeave);
      set('socialIns', j.socialIns);
      set('empIns', j.empIns);
      document.getElementById('f-kyosaiSwitch').value = j.kyosaiSwitch || '';
      document.getElementById('f-taishuSwitch').value = j.taishuSwitch || '';
      refreshJudge();
    };
  };
  document.getElementById('modal-form').addEventListener('change', refreshJudge);
  refreshJudge();
  // 勤務時間38.75ならフルに合わせる
  const hoursEl = document.getElementById('f-weeklyHours');
  hoursEl.addEventListener('change', () => {
    const h = Number(hoursEl.value);
    const k = document.getElementById('f-kubun');
    if (h > 0 && h === Number(DATA.settings.fullTimeWeeklyHours)) k.value = 'full';
    else if (h > 0 && k.value === 'full') k.value = 'part_monthly';
    refreshJudge();
  });
}
function openRenewForm(appt) {
  openForm(`任期の更新：${staffName(appt.staffId)}`, [
    { key: 'newEnd', label: '更新後の任期の終了日', type: 'date', required: true, hint: `現在：${appt.end}／${C.fyLabel(C.fiscalYearOf(appt.start))}の末日まで` },
    { key: 'date', label: '更新日', type: 'date', required: true },
    { key: 'reason', label: '更新理由（勤務実績の考慮など）', type: 'textarea', full: true },
  ], { newEnd: C.fiscalYearEnd(C.fiscalYearOf(appt.start)), date: todayISO() }, (v) => {
    const issues = C.validateRenewal(appt, v.newEnd);
    if (issues.some((i) => i.level === 'error')) return issuesHtml(issues);
    const next = { ...appt, end: v.newEnd };
    const other = C.validateAppointment(next, DATA, DATA.settings).filter((i) => i.level === 'error');
    if (other.length) return issuesHtml(other);
    appt.renewals = (appt.renewals || []).concat([{ date: v.date, oldEnd: appt.end, newEnd: v.newEnd, reason: v.reason }]);
    appt.end = v.newEnd;
    saveData();
    showToast('任期を更新しました。');
    return undefined;
  }, { before: '<p class="hint">任期の更新は、同一会計年度内で任期を延長する場合に使います（【国】地方公務員法第22条の2）。翌年度の任用は「再度の任用」として新たに登録してください。</p>' });
}
function filteredAppointments() {
  const fy = currentFy();
  const t = todayISO();
  const q = document.getElementById('appoint-search').value.trim();
  const st = document.getElementById('appoint-status-filter').value;
  const issueOnly = document.getElementById('appoint-issue-only').checked;
  return DATA.appointments
    .filter((a) => a.start && C.fiscalYearOf(a.start) === fy)
    .map((a) => ({ a, status: C.appointmentStatus(a, t), issues: a.status === 'canceled' ? [] : C.validateAppointment(a, DATA, DATA.settings) }))
    .filter((x) => !st || x.status === st)
    .filter((x) => !issueOnly || x.issues.length)
    .filter((x) => !q || [staffName(x.a.staffId), (staffById(x.a.staffId) || {}).number, x.a.dept, x.a.workplace, x.a.title].some((s) => String(s || '').includes(q)))
    .sort((x, y) => String(x.a.deptCode || '').localeCompare(String(y.a.deptCode || '')) || String(x.a.dept).localeCompare(String(y.a.dept), 'ja')
      || String(staffName(x.a.staffId)).localeCompare(staffName(y.a.staffId), 'ja'));
}
/** 公募が必要になる年度（翌年度なら強調） */
function publicRecruitCell(a) {
  const pfy = C.publicRecruitFy(DATA, a, DATA.settings);
  if (pfy == null) return '<span class="muted">-</span>';
  const label = C.toWarekiShort(C.fiscalYearStart(pfy)).replace(/\.1$/, '');
  return pfy <= C.fiscalYearOf(a.start) + 1 ? `<span class="badge warn">${label}</span>` : label;
}
/** 勤続（継続勤務年数）。公募をまたいでも通算 */
function serviceCell(a) {
  const ss = C.serviceStartOf(DATA, a, false);
  if (!ss) return '<span class="muted">-</span>';
  const y = C.continuousServiceYears(DATA, a);
  return `<span title="${ss.date}から${ss.estimated ? '（推定）' : ''}">${y === 0 ? '初年' : `${y}年`}${ss.estimated ? '<small class="muted">推</small>' : ''}</span>`;
}
function renderAppointments() {
  const rows = filteredAppointments();
  const dash = (v) => (v === '' || v == null ? '<span class="muted">-</span>' : escapeHtml(v));
  document.getElementById('appoint-table').innerHTML = tableHtml(
    ['伺い', '年目', '公募', '勤続', '職員番号', '区分', '氏名', '所属', '業務内容', '任用期間', '時間/週', '年休', '基礎額', '給料・報酬', '期末', '社会保険', '雇保/退手', '保育士確認', '状態', '点検', ''],
    rows.map(({ a, status, issues }) => {
      const s = staffById(a.staffId) || {};
      return `<tr class="${status === 'canceled' ? 'row-muted' : issues.some((i) => i.level === 'error') ? 'row-error' : issues.length ? 'row-warning' : ''}">
      <td>${a.ukagai ? '○' : '<span class="badge warn">未</span>'}</td>
      <td>${C.yearInServiceOf(DATA, a)}</td>
      <td>${publicRecruitCell(a)}</td>
      <td>${serviceCell(a)}</td>
      <td>${escapeHtml(s.number)}</td>
      <td>${C.KUBUN_LABEL[C.kubunOf(a)]}</td>
      <td>${nameLink(a.staffId)}${s.kana ? `<br><small class="muted">${escapeHtml(s.kana)}</small>` : ''}</td>
      <td>${escapeHtml(a.dept)}${a.workplace && a.workplace !== a.dept ? `<br><small>${escapeHtml(a.workplace)}</small>` : ''}</td>
      <td>${escapeHtml(a.title)}</td>
      <td>${C.toWarekiShort(a.start)}～${C.toWarekiShort(a.end)}${(a.renewals || []).length ? `<br><small>更新${a.renewals.length}回</small>` : ''}</td>
      <td>${C.hoursOf(a) != null ? C.hoursOf(a) : dash(a.hoursText)}</td>
      <td>${dash(a.annualLeave)}</td>
      <td class="num">${a.baseAmount ? Number(a.baseAmount).toLocaleString('ja-JP') : dash('')}</td>
      <td class="num">${C.PAY_TYPE_LABEL[a.payType] || ''} ${a.payAmount ? Number(a.payAmount).toLocaleString('ja-JP') : ''}</td>
      <td>${dash(a.bonus)}</td>
      <td>${dash(a.socialIns)}${a.kyosaiSwitch ? `<br><small>→共済 ${escapeHtml(a.kyosaiSwitch)}</small>` : ''}</td>
      <td>${dash(a.empIns)}${a.taishuSwitch ? `<br><small>→退手 ${escapeHtml(a.taishuSwitch)}</small>` : ''}</td>
      <td>${dash(a.hoikushiCheck)}</td>
      <td>${C.STATUS_LABEL[status]}</td>
      <td class="issues-cell">${issueBadges(issues)}${issues.length ? `<details class="issue-details"><summary>内容を見る</summary>${issuesHtml(issues)}</details>` : ''}</td>
      <td class="actions"><button class="btn-small" data-edit="${a.id}">編集</button>
        ${status !== 'canceled' ? `<button class="btn-small" data-renew="${a.id}">任期更新</button><button class="btn-small" data-print="${a.id}">明示書</button>` : ''}
        <button class="btn-danger" data-del="${a.id}">削除</button></td></tr>`;
    }),
    `${C.fyLabel(currentFy())}の任用はありません。`,
  );
  const tbl = document.getElementById('appoint-table');
  const find = (id) => DATA.appointments.find((a) => a.id === id);
  tbl.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openAppointForm(find(b.dataset.edit))));
  tbl.querySelectorAll('[data-renew]').forEach((b) => (b.onclick = () => openRenewForm(find(b.dataset.renew))));
  tbl.querySelectorAll('[data-print]').forEach((b) => (b.onclick = () => printConditions(find(b.dataset.print))));
  tbl.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const a = find(b.dataset.del);
    if (!confirm(`${staffName(a.staffId)} の任用（${a.start}〜${a.end}）を削除しますか？\n記録を残す場合は「編集」から取消にしてください。`)) return;
    DATA.appointments = DATA.appointments.filter((x) => x.id !== a.id);
    saveData();
  }));
}
function printConditions(appt) {
  const s = staffById(appt.staffId) || {};
  const set = DATA.settings;
  const pe = C.probationEnd(appt, set);
  document.getElementById('print-area').innerHTML = `
    <div class="print-doc">
      <p class="right">${C.formatDateJa(todayISO())}</p>
      <p>${escapeHtml(s.name)} 様</p>
      <p class="right">${escapeHtml(set.orgName)}長</p>
      <h2>会計年度任用職員の任期等について（明示）</h2>
      <p>あなたを会計年度任用職員として次のとおり任用します。</p>
      <table>
        <tr><th>所属</th><td>${escapeHtml(appt.dept)} ${escapeHtml(appt.section || '')}</td></tr>
        <tr><th>職名・業務</th><td>${escapeHtml(appt.title)}</td></tr>
        <tr><th>任用の区分</th><td>${C.APPOINT_TYPE_LABEL[appt.type]}</td></tr>
        <tr><th>任期</th><td>${C.formatDateJa(appt.start)} から ${C.formatDateJa(appt.end)} まで</td></tr>
        <tr><th>1週間当たりの勤務時間</th><td>${appt.weeklyHours}時間</td></tr>
        <tr><th>報酬（給料）</th><td>${C.PAY_TYPE_LABEL[appt.payType]} ${yen(appt.payAmount)}</td></tr>
        ${pe ? `<tr><th>条件付採用期間</th><td>${C.formatDateJa(appt.start)} から ${C.formatDateJa(pe)} まで</td></tr>` : ''}
        ${(appt.renewals || []).map((r) => `<tr><th>任期の更新</th><td>${C.formatDateJa(r.date)} 更新：終了日を ${C.formatDateJa(r.newEnd)} に変更</td></tr>`).join('')}
      </table>
      <p class="small">根拠：【国】地方公務員法第22条の2／【市】陸前高田市会計年度任用職員の給与等に関する条例・規則<br>
      ※本様式は参考様式です。正式な様式・記載事項は市の定めを確認してください。</p>
    </div>`;
  window.print();
}

/* ------------------------------------------------------------
 * 人事評価
 * ------------------------------------------------------------ */
function renderEvaluations() {
  const fy = currentFy();
  const missingOnly = document.getElementById('eval-missing-only').checked;
  const seen = new Map();
  for (const a of DATA.appointments) {
    if (a.status === 'canceled' || !a.start || C.fiscalYearOf(a.start) !== fy) continue;
    const cur = seen.get(a.staffId);
    if (!cur || a.end > cur.end) seen.set(a.staffId, a);
  }
  const items = DATA.settings.evalItems;
  const rows = [...seen.values()]
    .map((a) => ({ a, ev: C.evaluationFor(DATA, a.staffId, fy) }))
    .filter((x) => !missingOnly || !x.ev)
    .sort((x, y) => String(x.a.dept).localeCompare(String(y.a.dept), 'ja'));
  document.getElementById('eval-table').innerHTML = tableHtml(
    ['氏名', '所属・業務内容', '年目', ...items.map(escapeHtml), '総合', '所見（任用）', '本人の希望', '評価者', '評価日', ''],
    rows.map(({ a, ev }) => `<tr class="${ev ? '' : 'row-warning'}"><td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)} ${escapeHtml(a.title)}</td><td>${C.yearInServiceOf(DATA, a)}年目</td>
      ${items.map((it) => `<td>${ev ? escapeHtml((ev.items || {})[it] || '') : ''}</td>`).join('')}
      <td><strong>${ev ? escapeHtml(ev.overall) : ''}</strong></td><td>${ev ? C.RECOMMEND_LABEL[ev.recommend || ''] : '<span class="badge warn">未入力</span>'}</td>
      <td>${ev ? C.WISH_LABEL[ev.wish || ''] : ''}</td>
      <td>${ev ? escapeHtml(ev.evaluator) : ''}</td><td>${ev ? ev.evaluatedAt || '' : ''}</td>
      <td class="actions"><button class="btn-small" data-eval="${a.staffId}">${ev ? '編集' : '入力'}</button>${ev ? `<button class="btn-danger" data-del="${ev.id}">削除</button>` : ''}</td></tr>`),
    `${C.fyLabel(fy)}に任用のある職員がいません。`,
  );
  const tbl = document.getElementById('eval-table');
  tbl.querySelectorAll('[data-eval]').forEach((b) => (b.onclick = () => openEvalForm(b.dataset.eval, fy)));
  tbl.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('この評価を削除しますか？')) return;
    DATA.evaluations = DATA.evaluations.filter((e) => e.id !== b.dataset.del);
    saveData();
  }));
}
function openEvalForm(staffId, fy) {
  const ev = C.evaluationFor(DATA, staffId, fy);
  const set = DATA.settings;
  const grades = [['', '—']].concat(set.gradeScale.map((g) => [g, g]));
  const itemFields = set.evalItems.map((it, i) => ({ key: `item_${i}`, label: it, type: 'select', options: grades }));
  const values = {
    evaluator: ev ? ev.evaluator : '',
    evaluatedAt: ev ? ev.evaluatedAt : todayISO(),
    overall: ev ? ev.overall : '',
    recommend: ev ? ev.recommend : '',
    wish: ev ? ev.wish || '' : '',
    comment: ev ? ev.comment : '',
  };
  set.evalItems.forEach((it, i) => { values[`item_${i}`] = ev ? (ev.items || {})[it] || '' : ''; });
  openForm(`${C.fyLabel(fy)} 人事評価：${staffName(staffId)}`, [
    ...itemFields,
    { key: 'overall', label: '総合評価', type: 'select', options: grades, hint: '各項目を選ぶと目安が自動で入ります（変更可）' },
    { key: 'recommend', label: '所見（次年度の再度の任用）', type: 'select', options: Object.entries(C.RECOMMEND_LABEL) },
    { key: 'wish', label: '本人の希望（再度の任用）', type: 'select', options: Object.entries(C.WISH_LABEL) },
    { key: 'evaluator', label: '評価者' },
    { key: 'evaluatedAt', label: '評価日', type: 'date' },
    { key: 'comment', label: '所見・コメント', type: 'textarea', full: true, rows: 4 },
  ], values, (v) => {
    const items = {};
    set.evalItems.forEach((it, i) => { items[it] = v[`item_${i}`]; });
    const rec = { staffId, fiscalYear: fy, items, overall: v.overall, recommend: v.recommend, wish: v.wish, evaluator: v.evaluator, evaluatedAt: v.evaluatedAt, comment: v.comment };
    if (ev) Object.assign(ev, rec);
    else DATA.evaluations.push({ id: C.uid('ev'), ...rec });
    saveData();
    showToast('評価を保存しました。');
    return undefined;
  }, { wide: true, before: '<p class="hint">任期の長短・フル／パートにかかわらず人事評価の対象です。結果は再度の任用の判断要素のひとつですが、任用の優先権を与えるものではありません（市マニュアル第Ⅶ章5）。</p>' });
  const overallEl = document.getElementById('f-overall');
  let touched = !!values.overall;
  overallEl.addEventListener('change', () => { touched = true; });
  set.evalItems.forEach((it, i) => document.getElementById(`f-item_${i}`).addEventListener('change', () => {
    if (touched) return;
    const g = {};
    set.evalItems.forEach((x, j) => { g[x] = document.getElementById(`f-item_${j}`).value; });
    overallEl.value = C.suggestOverall(g, set.gradeScale);
  }));
}

/* ------------------------------------------------------------
 * 採用試験
 * ------------------------------------------------------------ */
function examFields() {
  return [
    { key: 'name', label: '試験・選考の名称', required: true, full: true, placeholder: '例：令和9年度 事務補助員 採用選考' },
    { key: 'method', label: '方法', type: 'select', options: Object.entries(C.EXAM_METHOD_LABEL) },
    { key: 'dept', label: '配属予定の所属' },
    { key: 'title', label: '職名・業務', required: true },
    { key: 'type', label: '区分', type: 'select', options: Object.entries(C.APPOINT_TYPE_LABEL) },
    { key: 'positions', label: '採用予定人数', type: 'number' },
    { key: 'applyFrom', label: '募集開始日', type: 'date' },
    { key: 'applyTo', label: '募集締切日', type: 'date' },
    { key: 'examDate', label: '試験・面接日', type: 'date' },
    { key: 'stagesText', label: '選考区分（読点「、」区切り）', required: true, hint: '例：書類、面接　区分ごとに得点を入力します', full: true },
    { key: 'status', label: '状態', type: 'select', options: [['open', '実施中'], ['closed', '終了']] },
    { key: 'note', label: '備考', type: 'textarea', full: true },
  ];
}
function openExamForm(exam) {
  const isNew = !exam;
  const values = exam ? { ...exam, stagesText: (exam.stages || []).join('、') } : { method: 'selection', type: 'part', stagesText: '書類、面接', status: 'open' };
  openForm(isNew ? '試験・選考を登録' : '試験・選考を編集', examFields(), values, (v) => {
    const stages = v.stagesText.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!stages.length) return '<p class="error-text">選考区分を1つ以上入力してください。</p>';
    const rec = { ...v, stages };
    delete rec.stagesText;
    if (isNew) { const e = { id: C.uid('ex'), ...rec }; DATA.exams.push(e); selectedExamId = e.id; }
    else Object.assign(exam, rec);
    saveData();
    return undefined;
  }, { wide: true });
}
function renderExams() {
  const list = DATA.exams.slice().sort((a, b) => String(b.examDate || '').localeCompare(String(a.examDate || '')));
  document.getElementById('exam-table').innerHTML = tableHtml(
    ['名称', '方法', '職', '募集期間', '試験日', '応募', '合格', '状態', ''],
    list.map((e) => {
      const apps = DATA.applicants.filter((a) => a.examId === e.id);
      return `<tr class="${e.id === selectedExamId ? 'row-selected' : ''}"><td>${escapeHtml(e.name)}</td><td>${C.EXAM_METHOD_LABEL[e.method] || ''}</td>
        <td>${escapeHtml(e.dept)} ${escapeHtml(e.title)}</td><td>${e.applyFrom || ''}〜${e.applyTo || ''}</td><td>${e.examDate || ''}</td>
        <td>${apps.length}人</td><td>${apps.filter((a) => a.result === 'pass').length}/${e.positions || '—'}人</td><td>${e.status === 'closed' ? '終了' : '実施中'}</td>
        <td class="actions"><button class="btn-small" data-open="${e.id}">応募者・採点</button><button class="btn-small" data-edit="${e.id}">編集</button><button class="btn-danger" data-del="${e.id}">削除</button></td></tr>`;
    }),
    '試験・選考が登録されていません。',
  );
  const tbl = document.getElementById('exam-table');
  const find = (id) => DATA.exams.find((e) => e.id === id);
  tbl.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { selectedExamId = b.dataset.open; renderExams(); }));
  tbl.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openExamForm(find(b.dataset.edit))));
  tbl.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const e = find(b.dataset.del);
    if (!confirm(`「${e.name}」と応募者の記録を削除しますか？`)) return;
    DATA.exams = DATA.exams.filter((x) => x.id !== e.id);
    DATA.applicants = DATA.applicants.filter((a) => a.examId !== e.id);
    if (selectedExamId === e.id) selectedExamId = null;
    saveData();
  }));
  renderExamDetail();
}
/** 合格者に提出を求める書類（市マニュアル第Ⅷ章1⑹） */
const HIRE_DOCS = ['採用承諾書', '住民票の写し', '健康診断書', '被保険者記録照会回答票'];
function renderExamDetail() {
  const el = document.getElementById('exam-detail');
  const exam = DATA.exams.find((e) => e.id === selectedExamId);
  if (!exam) { el.innerHTML = ''; return; }
  const ranked = C.rankApplicants(DATA.applicants, exam);
  const declined = DATA.applicants.filter((a) => a.examId === exam.id && a.result === 'decline');
  const rowHtml = (a, rank, total, complete) => `<tr class="${a.result === 'pass' ? 'row-pass' : a.result === 'decline' ? 'row-muted' : ''}">
    <td>${rank || '—'}</td><td>${escapeHtml(a.name)}${a.kana ? `<br><small>${escapeHtml(a.kana)}</small>` : ''}</td>
    ${exam.stages.map((st) => `<td><input type="number" class="score" data-app="${a.id}" data-stage="${escapeHtml(st)}" value="${escapeHtml((a.scores || {})[st] ?? '')}"></td>`).join('')}
    <td><strong>${total}</strong>${complete ? '' : '<br><small class="muted">未採点あり</small>'}</td>
    <td><select class="result-select" data-result="${a.id}">${Object.entries(C.RESULT_LABEL).map(([v, l]) => `<option value="${v}"${(a.result || 'pending') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
    <td>${a.result === 'pass' ? `<div class="doc-checks">${HIRE_DOCS.map((d) => `<label><input type="checkbox" data-doc="${a.id}" data-docname="${d}"${(a.docs || {})[d] ? ' checked' : ''}> ${d}</label>`).join('')}</div>` : ''}</td>
    <td class="actions">${a.result === 'pass' ? (a.appointmentId ? '<span class="badge ok">任用登録済み</span>' : `<button class="btn-small" data-hire="${a.id}">任用登録</button>`) : ''}
      <button class="btn-small" data-edit-app="${a.id}">編集</button><button class="btn-danger" data-del-app="${a.id}">削除</button></td></tr>`;
  el.innerHTML = `<div class="card">
    <div class="card-header-row"><h2>${escapeHtml(exam.name)}：応募者・採点</h2>
      <div class="row-actions">
        <button class="btn-primary" id="btn-app-add">応募者を追加</button>
        <label class="btn-secondary file-btn">応募者をExcelから取込<input type="file" id="app-import" accept=".xlsx,.xls,.csv" hidden></label>
        <button class="btn-secondary" id="btn-app-export">結果をExcelに書き出す</button>
      </div></div>
    <p class="hint">得点を入力すると自動で保存され、合計点の高い順に並びます（辞退者は順位から除外）。採用予定人数：${exam.positions || '—'}人<br>
      合格者には採用承諾書・住民票の写し・健康診断書（任用期間1年かつ週29時間以上の者のみ）・被保険者記録照会回答票の提出を依頼します。年金記録にない職歴は在職証明書で確認し、給料（報酬）額を決定します（市マニュアル第Ⅷ章1⑹⑺）。</p>
    ${tableHtml(['順位', '氏名', ...exam.stages.map(escapeHtml), '合計', '結果', '提出書類', ''],
      ranked.map((r) => rowHtml(r.a, r.rank, r.total, r.complete)).concat(declined.map((a) => rowHtml(a, null, C.applicantTotal(a, exam).total, true))),
      '応募者が登録されていません。')}
  </div>`;
  const find = (id) => DATA.applicants.find((a) => a.id === id);
  el.querySelectorAll('.score').forEach((inp) => (inp.onchange = () => {
    const a = find(inp.dataset.app);
    a.scores = { ...(a.scores || {}), [inp.dataset.stage]: inp.value === '' ? '' : Number(inp.value) };
    // 入力中の欄を作り直すとフォーカスが外れるため、描画を遅らせてフォーカスを戻す
    setTimeout(() => {
      const act = document.activeElement;
      const focusKey = act && act.classList.contains('score') ? [act.dataset.app, act.dataset.stage] : null;
      saveData();
      if (focusKey) {
        const again = [...document.querySelectorAll('#exam-detail .score')].find((x) => x.dataset.app === focusKey[0] && x.dataset.stage === focusKey[1]);
        if (again) again.focus();
      }
    });
  }));
  el.querySelectorAll('[data-result]').forEach((s) => (s.onchange = () => { find(s.dataset.result).result = s.value; saveData(); }));
  el.querySelectorAll('[data-doc]').forEach((c) => (c.onchange = () => {
    const a = find(c.dataset.doc);
    a.docs = { ...(a.docs || {}), [c.dataset.docname]: c.checked };
    saveData();
  }));
  el.querySelectorAll('[data-edit-app]').forEach((b) => (b.onclick = () => openApplicantForm(exam, find(b.dataset.editApp))));
  el.querySelectorAll('[data-del-app]').forEach((b) => (b.onclick = () => {
    if (!confirm('この応募者を削除しますか？')) return;
    DATA.applicants = DATA.applicants.filter((a) => a.id !== b.dataset.delApp);
    saveData();
  }));
  el.querySelectorAll('[data-hire]').forEach((b) => (b.onclick = () => hireApplicant(exam, find(b.dataset.hire))));
  document.getElementById('btn-app-add').onclick = () => openApplicantForm(exam, null);
  document.getElementById('app-import').onchange = (ev) => importApplicants(exam, ev.target.files[0], ev.target);
  document.getElementById('btn-app-export').onclick = () => {
    const rows = [['順位', '氏名', 'ふりがな', '性別', '生年月日', '連絡先', ...exam.stages, '合計', '結果']];
    for (const r of ranked) rows.push([r.rank, r.a.name, r.a.kana || '', GENDER_LABEL[r.a.gender || ''], r.a.birth || '', r.a.phone || '', ...exam.stages.map((st) => (r.a.scores || {})[st] ?? ''), r.total, C.RESULT_LABEL[r.a.result || 'pending']]);
    for (const a of declined) rows.push(['', a.name, a.kana || '', GENDER_LABEL[a.gender || ''], a.birth || '', a.phone || '', ...exam.stages.map(() => ''), '', '辞退']);
    writeWorkbook(`採用試験結果_${exam.name}_${stamp()}.xlsx`, [{ name: '結果', rows }]);
  };
}
function openApplicantForm(exam, app) {
  openForm(app ? '応募者を編集' : '応募者を追加', [
    { key: 'name', label: '氏名', required: true },
    { key: 'kana', label: 'ふりがな' },
    { key: 'gender', label: '性別', type: 'select', options: GENDER_OPTIONS },
    { key: 'birth', label: '生年月日', type: 'date' },
    { key: 'phone', label: '連絡先' },
    { key: 'address', label: '住所', full: true },
    { key: 'note', label: '備考', type: 'textarea', full: true },
  ], app || {}, (v) => {
    if (app) Object.assign(app, v);
    else DATA.applicants.push({ id: C.uid('apl'), examId: exam.id, result: 'pending', scores: {}, ...v });
    saveData();
    return undefined;
  });
}
function hireApplicant(exam, app) {
  // 同一人物が台帳にいれば紐づけ、いなければ新規登録
  let staff = app.staffId ? staffById(app.staffId) : null;
  if (!staff) {
    const key = String(app.name).replace(/[\s　]/g, '');
    staff = DATA.staff.find((s) => String(s.name).replace(/[\s　]/g, '') === key && (!app.birth || !s.birth || s.birth === app.birth)) || null;
  }
  const proceed = () => {
    const fy = currentFy();
    const nextFy = exam.examDate ? C.fiscalYearOf(exam.examDate) + 1 : fy;
    openAppointForm(null, {
      staffId: staff.id, recruitMethod: 'public', yearInService: 1, dept: exam.dept, title: exam.title, kubun: exam.type === 'full' ? 'full' : 'part_monthly',
      start: C.fiscalYearStart(nextFy), end: C.fiscalYearEnd(nextFy), note: `${exam.name} 合格`,
      onSaved: (rec) => { app.staffId = staff.id; app.appointmentId = rec.id; rec.examId = exam.id; },
    });
  };
  if (staff) {
    if (!confirm(`職員台帳の「${staff.name}」さんと同一人物として任用を登録します。よろしいですか？`)) return;
    proceed();
  } else {
    staff = { id: C.uid('st'), name: app.name, kana: app.kana || '', gender: app.gender || '', birth: app.birth || '', phone: app.phone || '', address: app.address || '', note: '', createdAt: new Date().toISOString() };
    DATA.staff.push(staff);
    app.staffId = staff.id;
    saveData();
    showToast('職員台帳に登録しました。続けて任用内容を入力してください。');
    proceed();
  }
}

/* ------------------------------------------------------------
 * Excel取込
 * ------------------------------------------------------------ */
let importState = null;

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
function sheetRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}
async function onImportFile() {
  const file = document.getElementById('import-file').files[0];
  if (!file) return;
  try {
    const wb = await readWorkbook(file);
    importState = { wb, fileName: file.name };
    const sel = document.getElementById('import-sheet');
    sel.innerHTML = wb.SheetNames.map((n) => `<option>${escapeHtml(n)}</option>`).join('');
    // 見出しから名簿・任用一覧を自動判別（データのあるシートを選ぶ）
    const withData = wb.SheetNames.find((n) => wb.Sheets[n]['!ref']);
    if (withData) sel.value = withData;
    const head = (sheetRows(wb.Sheets[sel.value]).slice(0, 10) || []).map((r) => (r || []).map((c) => String(c == null ? '' : c).normalize('NFKC').replace(/\s/g, '')));
    const has = (h) => head.some((r) => r.includes(h));
    if (has('氏名') && has('区分名') && has('採用日')) document.getElementById('import-kind').value = 'meibo';
    else if (has('氏名') && has('任用期間')) document.getElementById('import-kind').value = 'ninyoIchiran';
    renderImportPreview();
  } catch (e) {
    document.getElementById('import-preview').innerHTML = `<p class="error-text">ファイルを読み込めませんでした：${escapeHtml(e.message)}</p>`;
  }
}
function renderImportPreview() {
  const box = document.getElementById('import-preview');
  if (!importState) { box.innerHTML = ''; return; }
  const kind = document.getElementById('import-kind').value;
  const ws = importState.wb.Sheets[document.getElementById('import-sheet').value];
  if (kind === 'ninyoIchiran') { renderIchiranPreview(box, ws); return; }
  if (kind === 'meibo') { renderMeiboPreview(box, ws); return; }
  const res = C.rowsToRecords(sheetRows(ws), kind, DATA.settings);
  importState.result = res;
  importState.kind = kind;
  if (res.error) { box.innerHTML = `<p class="error-text">${escapeHtml(res.error)}</p>`; return; }
  const schema = C.IMPORT_SCHEMAS[kind];
  const used = Object.keys(res.map);
  const header = sheetRows(ws)[res.headerRow] || [];
  const mapping = used.map((f) => `<li>${escapeHtml(schema.fields[f][0])} ← 「${escapeHtml(header[res.map[f]])}」列</li>`).join('');
  const plan = planImport(kind, res.records, document.getElementById('import-create-staff').checked);
  const cols = used.filter((f) => f !== 'number' || kind === 'staff');
  box.innerHTML = `
    <h3>取込内容の確認</h3>
    <div class="import-summary">
      <div><strong>見出し行：</strong>${res.headerRow + 1}行目</div>
      <div><strong>対応付けた列</strong><ul>${mapping}</ul></div>
      <div><strong>結果（見込み）：</strong>新規 ${plan.add}件／更新 ${plan.update}件／スキップ ${plan.skip.length + res.skipped.length}件${plan.newStaff ? `／職員を自動追加 ${plan.newStaff}人` : ''}</div>
    </div>
    ${res.skipped.concat(plan.skip).length ? `<details><summary>スキップする行（${res.skipped.length + plan.skip.length}件）</summary><ul>${res.skipped.concat(plan.skip).map((s) => `<li>${s.row}行目：${escapeHtml(s.reason)}</li>`).join('')}</ul></details>` : ''}
    ${tableHtml(['行', ...cols.map((f) => escapeHtml(schema.fields[f][0]))], res.records.slice(0, 50).map((r) =>
      `<tr><td>${r._row}</td>${cols.map((f) => `<td>${escapeHtml(r[f])}</td>`).join('')}</tr>`))}
    ${res.records.length > 50 ? `<p class="muted">先頭50件を表示しています（全${res.records.length}件）。</p>` : ''}
    <div class="row-actions"><button class="btn-primary" id="btn-import-run">この内容で取り込む</button></div>`;
  document.getElementById('btn-import-run').onclick = runImport;
}
/** 人事システムの職員名簿の取込確認 */
function renderMeiboPreview(box, ws) {
  const res = C.parseMeibo(sheetRows(ws));
  importState.result = res;
  importState.kind = 'meibo';
  if (res.error) { box.innerHTML = `<p class="error-text">${escapeHtml(res.error)}</p>`; return; }
  const plan = planImport('meibo', res.records, true);
  const g = (v) => GENDER_LABEL[v || ''] || '';
  box.innerHTML = `
    <h3>取込内容の確認（人事システムの職員名簿）</h3>
    <div class="import-summary">
      <div><strong>見出し行：</strong>${res.headerRow + 1}行目／<strong>取込対象：</strong>${res.records.length}人（職員台帳に新規 ${plan.add}人・更新 ${plan.update}人）</div>
      <div><strong>読み込む項目：</strong>番号・氏名・ﾌﾘｶﾞﾅ・性別（1＝男性、0/2＝女性）・生年月日・採用日・退職日・区分名・職種・所属・職名・係・級・号・在職・郵便番号・住所・電話・携帯・Mail・緊急時連絡先</div>
      <div class="muted">C列（区分名）が「会計年度任用職員」の行だけを対象にします。PASS・内線等・財務・労務・経歴などの列は読み込みません。既存の職員とは職員番号 → 氏名と生年月日の順で照合し、名簿の値で上書きします。</div>
    </div>
    ${res.excludedCount ? `<p class="muted">C列（区分名）が「会計年度任用職員」ではない行が${res.excludedCount}件あります。これらの行は内容を読まずに除外しました。</p>` : ''}
    ${res.skipped.length ? `<details><summary>取り込まない行（${res.skipped.length}件）</summary><ul>${res.skipped.map((x) => `<li>${x.row}行目：${escapeHtml(x.reason)}</li>`).join('')}</ul></details>` : ''}
    ${tableHtml(['行', '番号', '氏名', 'ﾌﾘｶﾞﾅ', '性別', '生年月日', '採用日', '退職日', '所属', '職名', '在職', '職員台帳'],
      res.records.slice(0, 100).map((r) => {
        const hit = C.findStaffForMeibo(DATA, r);
        return `<tr><td>${r._row}</td><td>${escapeHtml(r.number)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.kana)}</td><td>${g(r.gender)}</td>
          <td>${C.toWarekiShort(r.birth)}</td><td>${C.toWarekiShort(r.hireDate)}</td><td>${C.toWarekiShort(r.retireDate)}</td>
          <td>${escapeHtml(r.dept)}${r.section ? `<br><small>${escapeHtml(r.section)}</small>` : ''}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.inService)}</td>
          <td>${hit ? `<span class="badge">更新</span> ${escapeHtml(hit.name)}` : '<span class="badge ok">新規</span>'}</td></tr>`;
      }),
      '取り込む職員がいません（C列の区分名が「会計年度任用職員」の行がありません）。')}
    ${res.records.length > 100 ? `<p class="muted">先頭100件を表示しています（全${res.records.length}件）。</p>` : ''}
    <div class="row-actions"><button class="btn-primary" id="btn-import-run"${res.records.length ? '' : ' disabled'}>この内容で取り込む</button></div>`;
  document.getElementById('btn-import-run').onclick = runImport;
}
/** 名簿の採用日を含む任用が未登録の職員（新規採用者の任用登録漏れ） */
function hiresWithoutAppointment(staffIds) {
  return DATA.staff.filter((s) => (!staffIds || staffIds.includes(s.id)) && s.hireDate && !s.retireDate && !C.hasAppointmentOn(DATA, s.id, s.hireDate));
}
function hireAppointmentPreset(s) {
  return {
    staffId: s.id, recruitMethod: 'public', yearInService: 1, deptCode: s.rosterDeptCode || '', dept: s.rosterDept || '', workplace: s.rosterDept || '',
    title: s.rosterTitle || '', start: s.hireDate, end: C.fiscalYearEnd(C.fiscalYearOf(s.hireDate)),
  };
}
function hiresTableHtml(list) {
  return tableHtml(['氏名', '採用日', '名簿の所属', '名簿の職名', ''],
    list.map((s) => `<tr><td>${nameLink(s.id)}</td><td>${C.formatDateJa(s.hireDate)}</td><td>${escapeHtml(s.rosterDept || '')}</td><td>${escapeHtml(s.rosterTitle || '')}</td>
      <td><button class="btn-small" data-hire-appt="${s.id}">任用を登録</button></td></tr>`), '');
}
function bindHireButtons(root) {
  root.querySelectorAll('[data-hire-appt]').forEach((b) => (b.onclick = () => openAppointForm(null, hireAppointmentPreset(staffById(b.dataset.hireAppt)))));
}
/** 任用一覧（総務課の様式）の取込確認 */
function renderIchiranPreview(box, ws) {
  const res = C.parseNinyoIchiran(sheetRows(ws), currentFy());
  importState.result = res;
  importState.kind = 'ninyoIchiran';
  if (res.error) { box.innerHTML = `<p class="error-text">${escapeHtml(res.error)}</p>`; return; }
  const plan = planImport('ninyoIchiran', res.records, true);
  const noted = res.records.filter((r) => r._notes.length);
  box.innerHTML = `
    <h3>取込内容の確認（任用一覧）</h3>
    <div class="import-summary">
      <div><strong>見出し行：</strong>${res.headerRow + 1}行目／<strong>年度：</strong>${res.fy ? `${C.fyLabel(res.fy)}（見出し「社会保険」列から判定）` : `見出しから判定できないため${C.fyLabel(currentFy())}を使用`}</div>
      <div><strong>読み取った列：</strong>${Object.keys(res.map).length}列</div>
      <div><strong>結果（見込み）：</strong>任用 新規 ${plan.add}件／更新 ${plan.update}件／スキップ ${res.skipped.length}件${plan.newStaff ? `／職員を台帳に追加 ${plan.newStaff}人` : ''}</div>
      <p class="muted">同じ職員・同じ開始日の任用がすでにあれば、Excelの内容で上書きします（同じファイルを何度取り込んでも二重登録されません）。</p>
    </div>
    ${res.skipped.length ? `<details open><summary>取り込まない行（${res.skipped.length}件）</summary><ul>${res.skipped.map((s) => `<li>${s.row}行目：${escapeHtml(s.reason)}</li>`).join('')}</ul></details>` : ''}
    ${noted.length ? `<details open><summary>確認が必要な行（${noted.length}件）</summary><ul>${noted.map((r) => `<li>${r._row}行目 ${escapeHtml(r.name)}：${r._notes.map(escapeHtml).join('／')}</li>`).join('')}</ul></details>` : ''}
    ${tableHtml(['行', '伺い', '年目', '職員番号', '氏名', '区分', '所属名', '業務内容', '任用期間', '時間/週', '基礎額', '給料・報酬', '期末', '社会保険', '雇保/退手'],
      res.records.slice(0, 100).map((r) => `<tr class="${r._notes.length ? 'row-warning' : ''}"><td>${r._row}</td><td>${r.ukagai ? '○' : ''}</td><td>${escapeHtml(r.yearInService)}</td>
        <td>${escapeHtml(r.number)}</td><td>${escapeHtml(r.name)}</td><td>${C.KUBUN_LABEL[C.kubunOf(r)]}</td><td>${escapeHtml(r.dept)}</td><td>${escapeHtml(r.title)}</td>
        <td>${C.toWarekiShort(r.start)}～${C.toWarekiShort(r.end)}</td><td>${r.weeklyHours !== '' ? r.weeklyHours : escapeHtml(r.hoursText)}</td>
        <td class="num">${escapeHtml(r.baseAmount)}</td><td class="num">${escapeHtml(r.payAmount)}</td><td>${escapeHtml(r.bonus)}</td><td>${escapeHtml(r.socialIns)}</td><td>${escapeHtml(r.empIns)}</td></tr>`))}
    ${res.records.length > 100 ? `<p class="muted">先頭100件を表示しています（全${res.records.length}件）。</p>` : ''}
    <div class="row-actions"><button class="btn-primary" id="btn-import-run">この内容で取り込む</button></div>`;
  document.getElementById('btn-import-run').onclick = runImport;
}
/**
 * 取込の見込み（dryRun）と実行を同じ処理で行う。
 * 職員：職員番号→氏名の順で照合し、あれば空欄以外を上書き。
 * 任用：同じ職員・同じ任期の任用があればスキップ。
 * 評価：同じ職員・同じ年度の評価があれば上書き。
 */
function planImport(kind, records, createStaff, apply = false) {
  const target = apply ? DATA : JSON.parse(JSON.stringify(DATA));
  const out = { add: 0, update: 0, skip: [], newStaff: 0 };
  const ensureStaff = (r) => {
    let s = C.findStaff(target, r.number, r.name);
    if (!s && createStaff) {
      s = { id: C.uid('st'), number: r.number || '', name: r.name, kana: '', gender: '', birth: '', createdAt: new Date().toISOString() };
      target.staff.push(s);
      out.newStaff += 1;
    }
    return s;
  };
  for (const r of records) {
    if (kind === 'meibo') {
      let s = C.findStaffForMeibo(target, r);
      const fields = {
        number: r.number, name: r.name, kana: r.kana, gender: r.gender, birth: r.birth, hireDate: r.hireDate, retireDate: r.retireDate,
        category: r.category, jobType: r.jobType, rosterDeptCode: r.deptCode, rosterDept: r.dept, rosterTitle: r.title, rosterSection: r.section,
        grade: r.grade, step: r.step, inService: r.inService, postal: r.postal, address: r.address, phone: r.phone, mobile: r.mobile, email: r.email,
        emergencyName: r.emergencyName, emergencyRelation: r.emergencyRelation, emergencyPhone: r.emergencyPhone,
      };
      const vals = {};
      for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) vals[k] = v;
      vals.rosterImportedAt = new Date().toISOString();
      if (s) { Object.assign(s, vals); out.update += 1; }
      else { s = { id: C.uid('st'), createdAt: new Date().toISOString(), ...vals }; target.staff.push(s); out.add += 1; }
      (out.touched = out.touched || []).push(s.id);
      continue;
    }
    if (kind === 'ninyoIchiran') {
      let s = C.findStaff(target, r.number, r.name);
      if (!s) {
        s = { id: C.uid('st'), number: r.number || '', name: r.name, kana: r.kana || '', gender: '', birth: '', createdAt: new Date().toISOString() };
        target.staff.push(s);
        out.newStaff += 1;
      } else {
        if (r.number && !s.number) s.number = r.number;
        if (r.kana && !s.kana) s.kana = r.kana;
      }
      const { number, name, kana, _row, _notes, ...fields } = r;
      const rec = { ...fields, staffId: s.id, fiscalYear: C.fiscalYearOf(r.start), status: '' };
      const existing = target.appointments.find((a) => a.staffId === s.id && a.start === r.start && a.status !== 'canceled');
      if (existing) { Object.assign(existing, rec); out.update += 1; }
      else { target.appointments.push({ id: C.uid('ap'), renewals: [], createdAt: new Date().toISOString(), ...rec }); out.add += 1; }
      continue;
    }
    if (kind === 'staff') {
      const s = C.findStaff(target, r.number, r.name);
      const vals = {};
      for (const k of ['number', 'name', 'kana', 'gender', 'birth', 'phone', 'address', 'note']) if (r[k]) vals[k] = r[k];
      if (s) { Object.assign(s, vals); out.update += 1; }
      else { target.staff.push({ id: C.uid('st'), createdAt: new Date().toISOString(), ...vals }); out.add += 1; }
    } else if (kind === 'appointments') {
      const s = ensureStaff(r);
      if (!s) { out.skip.push({ row: r._row, reason: `職員「${r.name}」が台帳にありません` }); continue; }
      if (target.appointments.some((a) => a.staffId === s.id && a.start === r.start && a.end === r.end)) {
        out.skip.push({ row: r._row, reason: '同じ任期の任用が登録済み' }); continue;
      }
      target.appointments.push({
        id: C.uid('ap'), staffId: s.id, fiscalYear: C.fiscalYearOf(r.start), type: r.type, dept: r.dept || '', section: r.section || '',
        title: r.title || '', start: r.start, end: r.end, weeklyHours: r.weeklyHours, payType: r.payType, payAmount: r.payAmount,
        recruitMethod: r.recruitMethod, status: '', note: r.note || '', renewals: [], createdAt: new Date().toISOString(),
      });
      out.add += 1;
    } else if (kind === 'evaluations') {
      const s = ensureStaff(r);
      if (!s) { out.skip.push({ row: r._row, reason: `職員「${r.name}」が台帳にありません` }); continue; }
      const items = {};
      const [i1, i2] = target.settings.evalItems;
      if (i1 && r.ability) items[i1] = r.ability;
      if (i2 && r.performance) items[i2] = r.performance;
      const overall = r.overall || C.suggestOverall(items, target.settings.gradeScale);
      const rec = { staffId: s.id, fiscalYear: r.fiscalYear, items, overall, recommend: r.recommend, evaluator: r.evaluator || '', comment: r.comment || '', evaluatedAt: '' };
      const ev = target.evaluations.find((e) => e.staffId === s.id && Number(e.fiscalYear) === Number(r.fiscalYear));
      if (ev) { Object.assign(ev, rec); out.update += 1; } else { target.evaluations.push({ id: C.uid('ev'), ...rec }); out.add += 1; }
    }
  }
  return out;
}
function runImport() {
  if (!importState || !importState.result) return;
  const { kind, result } = importState;
  const res = planImport(kind, result.records, kind === 'ninyoIchiran' || document.getElementById('import-create-staff').checked, true);
  saveData();
  initFiscalYearPicker();
  const box = document.getElementById('import-preview');
  box.innerHTML = `<p class="success-text">取込が完了しました：新規 ${res.add}件／更新 ${res.update}件／スキップ ${res.skip.length + result.skipped.length}件${res.newStaff ? `／職員を自動追加 ${res.newStaff}人` : ''}</p>`;
  if (kind === 'meibo') {
    // 初めて使うときは過去の採用者も含まれるため、対象年度以降の採用日に限る（過去の任用は任用一覧の取込で登録）
    const hires = hiresWithoutAppointment(res.touched || []).filter((x) => x.hireDate >= C.fiscalYearStart(currentFy()));
    if (hires.length) {
      box.innerHTML += `<h3>任用が未登録の職員（名簿の採用日を含む任用がありません）</h3>
        <p class="hint">新規採用者は「任用を登録」から任用を登録してください。所属・職名・任用期間（採用日〜年度末）は名簿から入力済みで開きます。</p>${hiresTableHtml(hires)}`;
      bindHireButtons(box);
    }
  }
  document.getElementById('import-file').value = '';
  importState = null;
  renderAll();
}
async function importApplicants(exam, file, input) {
  if (!file) return;
  try {
    const wb = await readWorkbook(file);
    const res = C.rowsToRecords(sheetRows(wb.Sheets[wb.SheetNames[0]]), 'applicants', DATA.settings);
    if (res.error) { alert(res.error); return; }
    let n = 0;
    for (const r of res.records) {
      const dup = DATA.applicants.some((a) => a.examId === exam.id && a.name.replace(/[\s　]/g, '') === r.name.replace(/[\s　]/g, '') && (a.birth || '') === (r.birth || ''));
      if (dup) continue;
      DATA.applicants.push({ id: C.uid('apl'), examId: exam.id, result: 'pending', scores: {}, name: r.name, kana: r.kana, gender: r.gender, birth: r.birth, phone: r.phone, address: r.address, note: r.note });
      n += 1;
    }
    saveData();
    showToast(`応募者を${n}人取り込みました。`);
  } catch (e) {
    alert(`読み込めませんでした：${e.message}`);
  } finally {
    input.value = '';
  }
}
function downloadImportTemplate() {
  const kind = document.getElementById('import-kind').value;
  if (kind === 'meibo') {
    writeWorkbook('取込ひな形_職員名簿.xlsx', [{ name: 'Sheet1', rows: [
      ['番号', '区分名', '職種', '氏名', 'ﾌﾘｶﾞﾅ', '性別', '生年月日', '採用日', '退職日', '所属CD', '所属名', '職名', '係名', '在職', '郵便番号', '住所', '住所方書', '電話', '携帯', 'Mail', '緊急時氏名', '緊急時続柄', '緊急時電話'],
      ['10001', '会計年度任用職員', '事務', '高田　花子', 'ﾀｶﾀ ﾊﾅｺ', 0, '1985/05/10', `${C.fiscalYearStart(currentFy()).replace(/-/g, '/')}`, '', '1000', '総務課', '事務補助員', '職員係', 1, '', '', '', '', '', '', '', '', ''],
    ] }]);
    return;
  }
  if (kind === 'ninyoIchiran') {
    const rows = C.ninyoIchiranRows({ ...DATA, appointments: [] }, currentFy(), DATA.settings);
    rows.push(['○', 1, '10001', 'パート(月額)', '高田　花子', 'ﾀｶﾀ　ﾊﾅｺ', '1000', '総務課', '1', '', `${C.toWarekiShort(C.fiscalYearStart(currentFy()))}～${C.toWarekiShort(C.fiscalYearEnd(currentFy()))}`,
      '総務課', '事務補助員', 30, 10, 151400, '月額', 117212, '毎月21日', '有', '毎月21日', '共済(短期)', '-', '雇用保険', '-', '-', '']);
    writeWorkbook('取込ひな形_任用一覧.xlsx', [{ name: 'Sheet1', rows }]);
    return;
  }
  const samples = {
    staff: [['職員番号', '氏名', 'ふりがな', '性別', '生年月日', '連絡先', '住所', '備考'], ['1001', '高田 花子', 'たかた はなこ', '女', '1985/05/10', '', '', '']],
    appointments: [['職員番号', '氏名', '所属課', '係', '職名', '区分', '任期（自）', '任期（至）', '週勤務時間', '報酬区分', '報酬額', '採用方法', '備考'],
      ['1001', '高田 花子', '市民課', '窓口係', '事務補助員', 'パートタイム', '2026/04/01', '2027/03/31', 29, '時間額', 1050, '公募', '']],
    evaluations: [['職員番号', '氏名', '年度', '能力評価', '業績評価', '総合評価', '再度の任用', '評価者', '所見'],
      ['1001', '高田 花子', '令和8年度', 'A', 'B', 'A', '可', '市民課長', '']],
  };
  writeWorkbook(`取込ひな形_${C.IMPORT_SCHEMAS[kind].label}.xlsx`, [{ name: C.IMPORT_SCHEMAS[kind].label, rows: samples[kind] }]);
}

/* ------------------------------------------------------------
 * 根拠法令
 * ------------------------------------------------------------ */
const LAWS = [
  {
    key: 'chikouhou_22_2',
    level: '国',
    title: '地方公務員法 第22条の2（会計年度任用職員の採用の方法等）',
    url: 'https://laws.e-gov.go.jp/law/325AC0000000261',
    uses: [
      '会計年度任用職員の採用は競争試験又は選考による → 「採用試験」タブ',
      '区分：第1項第1号（パートタイム：週勤務時間が常勤より短い）／第1項第2号（フルタイム：常勤と同一） → 任用の区分・勤務時間の点検',
      '任期は採用の日から同日の属する会計年度の末日までの範囲内で任命権者が定め、任期を明示する → 任期の点検・明示書',
      '勤務実績を考慮した上で、その範囲内で任期を更新できる → 「任期更新」',
      '条件付採用期間（期間は原文で確認し「設定」に入力） → 明示書の条件付採用期間',
    ],
    status: '原文未確認：Web検索結果の要約で内容を確認したのみ。項番号・文言は原文で確認してください。',
  },
  {
    key: 'rikuzentakata_kyuyo_jourei',
    level: '市',
    title: '陸前高田市会計年度任用職員の給与等に関する条例',
    url: '',
    uses: ['報酬・給料の額、報酬の区分（月額・日額・時間額） → 任用の報酬欄', 'フルタイム／パートタイムの処遇の違い'],
    status: '原文未確認：条例番号・条文は市の例規集で確認してください。',
  },
  {
    key: 'rikuzentakata_kyuyo_kisoku',
    level: '市',
    title: '陸前高田市会計年度任用職員の給与等に関する規則',
    url: '',
    uses: ['報酬の具体的な額・算定方法 → 任用の報酬欄'],
    status: '原文未確認：規則番号・条文は市の例規集で確認してください。',
  },
  {
    key: 'nenkyu_kitei',
    level: '市',
    title: '年次休暇の日数の規定（会計年度任用職員）※条例・規則名と条番号は未確認',
    url: '',
    docStatus: '担当者から規定の内容の提示あり（原文の名称・条番号は未確認）',
    uses: [
      '1週間の勤務日の日数が定められている職員は表の上欄（週の勤務日数）、週以外の期間で定められている職員は中欄（任用期間における勤務日の日数）、下欄の継続勤務年数ごとの日数 → 年休の判定',
      'ただし書：1週間の勤務日が4日以内で1週間の勤務時間が29時間以上の職員は「5日以上」の区分 → 年休の判定',
      '任用の日における継続勤務年数に1年未満の端数がある場合は1年とみなす → 継続勤務年数の算定',
    ],
    status: '',
  },
  {
    key: 'manual_gaiyou',
    level: '市',
    title: '総務課マニュアル「会計年度任用職員の概要」（令和3年3月29日作成・令和5年3月31日改定）',
    url: '',
    docStatus: '資料で確認済み（令和5年3月31日改定版）',
    uses: [
      '第Ⅰ章2・第Ⅱ章：フルタイム＝週38.75時間、パートタイム＝週38.75時間未満。週35時間以上のパートは勤務時間設定の考え方を説明できるように → 勤務時間の点検',
      '第Ⅲ章1・2：給料＝基礎額、月額報酬＝基礎額×週時間/38.75、日額＝基礎額/21、時間額＝基礎額/162.75（1円未満切捨て） → 給料・報酬額の点検・自動計算',
      '第Ⅲ章3：支給日（フル・月額パート＝当月21日、日額・時間額パート＝翌月21日） → 支給日の点検',
      '第Ⅳ章10：期末手当＝任用期間6か月以上かつ週15時間30分以上 → 期末手当の判定',
      '第Ⅴ章1：年次休暇（6月以上の任期の職員、週の勤務日数と継続勤務年数による表） → 年休の判定',
      '第Ⅶ章1・2：社会保険（週29時間以上＝共済短期＋厚生年金、フルは12月経過で共済組合）、雇用保険（週20時間以上かつ31日以上、フルは6月経過で退職手当） → 保険の判定・切替時期',
      '第Ⅶ章4：健康診断・ストレスチェック（任用1年かつ週29時間以上） → 判定表示',
      '第Ⅶ章5：人事評価（任期・フル/パートにかかわらず対象。任用の優先権は与えない） → 人事評価タブ',
      '第Ⅷ章1：選考・任用のスケジュール、合格者の提出書類 → 採用試験タブ・ホームの年間スケジュール',
      '第Ⅷ章2：再度の任用は人事評価の結果に基づき判断。公募によらない再度の任用は原則連続2回（最長3会計年度）まで → 次年度の任用案・上限の点検',
    ],
    status: '',
  },
  {
    key: 'moushiokuri',
    level: '市',
    title: '総務課職員係「申送事項」（会計年度任用職員関係事務）',
    url: '',
    docStatus: '資料で確認済み',
    uses: [
      '年間スケジュール（4月 資格得喪、10月 雇保→退手切替、1月 再度の任用の通知、3月 任用一覧の作成・任用起案 など） → ホームの年間スケジュール',
      '再度の任用は人事評価の結果（係長から）と本人の希望による → 人事評価の「本人の希望」',
      '任期満了退職者は合議がないため任用一覧で確認 → ホームの任期満了一覧',
      '年度内の任期の更新のみ辞令に現職が載る（翌年度は新たな任用） → 任期更新・再度の任用',
    ],
    status: '',
  },
];
function renderLaws() {
  document.getElementById('law-list').innerHTML = LAWS.map((l) => {
    const saved = DATA.legalTexts[l.key] || {};
    const verified = !!(saved.text && saved.checkedAt);
    return `<div class="law-item">
      <div class="law-head"><span class="level level-${l.level === '国' ? 'national' : 'city'}">${l.level}</span><h3>${escapeHtml(l.title)}</h3>
        ${l.docStatus ? `<span class="badge ok">${escapeHtml(l.docStatus)}</span>` : verified ? `<span class="badge ok">原文確認済み（${escapeHtml(saved.checkedAt)}）</span>` : '<span class="badge warn">原文未確認</span>'}</div>
      ${verified || l.docStatus ? '' : `<p class="muted">${escapeHtml(l.status)}</p>`}
      ${l.docStatus ? '<p class="muted">金額（基礎額・上限など）はマニュアル作成時点（R5.4.1）の値のため、システムには組み込まず任用ごとに入力します。</p>' : ''}
      <p class="muted">このシステムでの使いどころ：</p><ul>${l.uses.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
      ${l.url ? `<p class="muted">出典：<a href="${l.url}" target="_blank" rel="noopener">${l.url}</a>（インターネット接続端末で閲覧）</p>` : ''}
      <details><summary>${l.docStatus ? '関係する記述・改定メモを残す' : '条文の本文を貼り付ける・確認する'}</summary>
        <div class="grid-form">
          <label class="full">条文（原文をそのまま貼り付け）<textarea rows="8" data-law-text="${l.key}">${escapeHtml(saved.text || '')}</textarea></label>
          <label>出典（例規集のURL・版など）<input type="text" data-law-src="${l.key}" value="${escapeHtml(saved.source || '')}"></label>
          <label>原文を確認した日<input type="date" data-law-date="${l.key}" value="${escapeHtml(saved.checkedAt || '')}"></label>
        </div>
        <button class="btn-secondary" data-law-save="${l.key}">保存</button>
      </details>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-law-save]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.lawSave;
    DATA.legalTexts[k] = {
      text: document.querySelector(`[data-law-text="${k}"]`).value,
      source: document.querySelector(`[data-law-src="${k}"]`).value.trim(),
      checkedAt: document.querySelector(`[data-law-date="${k}"]`).value,
    };
    saveData();
    showToast('条文を保存しました。');
  }));
}

/* ------------------------------------------------------------
 * 設定・バックアップ
 * ------------------------------------------------------------ */
function renderSettings() {
  const s = DATA.settings;
  document.getElementById('settings-form').innerHTML = `
    <label>団体名（明示書に表示）<input type="text" id="set-orgName" value="${escapeHtml(s.orgName)}"></label>
    <label>常勤職員の1週間当たりの勤務時間（時間）<input type="number" step="0.25" id="set-fullTimeWeeklyHours" value="${escapeHtml(s.fullTimeWeeklyHours)}">
      <small>フルタイム／パートタイムの判定に使用（【国】地方公務員法第22条の2第1項各号）。市の勤務時間の定めに合わせてください。</small></label>
    <label>公募によらない再度の任用の上限回数<input type="number" min="0" id="set-reappointLimit" value="${s.reappointLimit == null ? '' : escapeHtml(s.reappointLimit)}" placeholder="空欄＝判定しない">
      <small>市マニュアル第Ⅷ章2：原則連続2回（最長3会計年度）。</small></label>
    <label>勤務時間の説明が必要となるパートの週時間（以上）<input type="number" step="0.25" id="set-explainHoursFrom" value="${escapeHtml(s.explainHoursFrom)}">
      <small>市マニュアル第Ⅱ章2：週35時間以上38.75時間未満。</small></label>
    <label>日額報酬の除数<input type="number" step="0.01" id="set-dailyDivisor" value="${escapeHtml(s.dailyDivisor)}"><small>市マニュアル第Ⅲ章2：基礎額/21</small></label>
    <label>時間額報酬の除数<input type="number" step="0.01" id="set-hourlyDivisor" value="${escapeHtml(s.hourlyDivisor)}"><small>市マニュアル第Ⅲ章2：基礎額/162.75</small></label>
    <label>期末手当：任用期間（月以上）<input type="number" id="set-bonusMinMonths" value="${escapeHtml(s.bonusMinMonths)}"><small>市マニュアル第Ⅳ章10</small></label>
    <label>期末手当：週勤務時間（時間以上）<input type="number" step="0.25" id="set-bonusMinWeeklyHours" value="${escapeHtml(s.bonusMinWeeklyHours)}"><small>市マニュアル第Ⅳ章10：15時間30分</small></label>
    <label>社会保険（共済短期）：週時間（以上）<input type="number" step="0.25" id="set-socialInsHours" value="${escapeHtml(s.socialInsHours)}"><small>市マニュアル第Ⅶ章1</small></label>
    <label>雇用保険：週時間（以上）<input type="number" step="0.25" id="set-empInsHours" value="${escapeHtml(s.empInsHours)}"><small>市マニュアル第Ⅶ章2</small></label>
    <label>フル：退職手当への切替（月経過）<input type="number" id="set-taishuMonths" value="${escapeHtml(s.taishuMonths)}"><small>市マニュアル第Ⅶ章2：6月</small></label>
    <label>フル：共済組合への切替（月経過）<input type="number" id="set-kyosaiMonths" value="${escapeHtml(s.kyosaiMonths)}"><small>市マニュアル第Ⅶ章1：12月</small></label>
    <label>健康診断・ストレスチェック：週時間（以上）<input type="number" step="0.25" id="set-healthCheckHours" value="${escapeHtml(s.healthCheckHours)}"><small>市マニュアル第Ⅶ章4</small></label>
    <label>条件付採用期間（月）<input type="number" min="0" id="set-probationMonths" value="${escapeHtml(s.probationMonths)}">
      <small>原文（【国】地方公務員法第22条の2）で確認のうえ設定。0で非表示。</small></label>
    <label>任期満了の警告（日前から）<input type="number" min="1" id="set-expiryAlertDays" value="${escapeHtml(s.expiryAlertDays)}"></label>
    <label>バックアップ警告（前回から何日で）<input type="number" min="1" id="set-backupReminderDays" value="${escapeHtml(s.backupReminderDays)}"></label>
    <label>評価段階（上位から、読点区切り）<input type="text" id="set-gradeScale" value="${escapeHtml(s.gradeScale.join('、'))}"></label>
    <label>再度の任用に推薦する総合評価（読点区切り）<input type="text" id="set-reappointGrades" value="${escapeHtml(s.reappointGrades.join('、'))}"></label>
    <label class="full">評価項目（読点区切り）<input type="text" id="set-evalItems" value="${escapeHtml(s.evalItems.join('、'))}">
      <small>Excel取込では1番目を「能力評価」列、2番目を「業績評価」列に対応付けます。</small></label>`;
}
function saveSettings() {
  const split = (id) => document.getElementById(id).value.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean);
  const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
  const gradeScale = split('set-gradeScale');
  const evalItems = split('set-evalItems');
  if (!gradeScale.length || !evalItems.length) { alert('評価段階と評価項目は1つ以上入力してください。'); return; }
  if (!(num('set-fullTimeWeeklyHours') > 0)) { alert('常勤職員の勤務時間を入力してください。'); return; }
  Object.assign(DATA.settings, {
    orgName: document.getElementById('set-orgName').value.trim(),
    fullTimeWeeklyHours: num('set-fullTimeWeeklyHours'),
    reappointLimit: num('set-reappointLimit'),
    explainHoursFrom: num('set-explainHoursFrom') ?? DATA.settings.explainHoursFrom,
    dailyDivisor: num('set-dailyDivisor') || DATA.settings.dailyDivisor,
    hourlyDivisor: num('set-hourlyDivisor') || DATA.settings.hourlyDivisor,
    bonusMinMonths: num('set-bonusMinMonths') ?? DATA.settings.bonusMinMonths,
    bonusMinWeeklyHours: num('set-bonusMinWeeklyHours') ?? DATA.settings.bonusMinWeeklyHours,
    socialInsHours: num('set-socialInsHours') ?? DATA.settings.socialInsHours,
    empInsHours: num('set-empInsHours') ?? DATA.settings.empInsHours,
    taishuMonths: num('set-taishuMonths') ?? DATA.settings.taishuMonths,
    kyosaiMonths: num('set-kyosaiMonths') ?? DATA.settings.kyosaiMonths,
    healthCheckHours: num('set-healthCheckHours') ?? DATA.settings.healthCheckHours,
    probationMonths: num('set-probationMonths') || 0,
    expiryAlertDays: num('set-expiryAlertDays') || 60,
    backupReminderDays: num('set-backupReminderDays') || 7,
    gradeScale,
    reappointGrades: split('set-reappointGrades'),
    evalItems,
  });
  saveData();
  showToast('設定を保存しました。');
}
function doBackup() {
  DATA.lastBackupAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  downloadBlob(`会計年度任用職員_バックアップ_${stamp()}.json`, blob);
  saveData();
  showToast('バックアップを保存しました。共有フォルダ等に保管してください。');
}
function doRestore(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj || !Array.isArray(obj.staff) || !Array.isArray(obj.appointments)) throw new Error('このシステムのバックアップファイルではありません。');
      const d = C.normalizeData(obj);
      const msg = `バックアップ（職員${d.staff.length}人・任用${d.appointments.length}件・評価${d.evaluations.length}件・試験${d.exams.length}件）で、この端末のデータを置き換えます。よろしいですか？`;
      if (!confirm(msg)) return;
      DATA = d;
      saveData();
      initFiscalYearPicker();
      renderAll();
      showToast('バックアップから復元しました。');
    } catch (err) {
      alert(`復元できませんでした：${err.message}`);
    }
  };
  reader.readAsText(file);
}
function exportAll() {
  const staffRows = [['職員番号', '氏名', 'ふりがな', '性別', '生年月日', '連絡先', '住所', '備考']];
  DATA.staff.forEach((s) => staffRows.push([s.number || '', s.name, s.kana || '', GENDER_LABEL[s.gender || ''], s.birth || '', s.phone || '', s.address || '', s.note || '']));
  const items = DATA.settings.evalItems;
  const evRows = [['職員番号', '氏名', '年度', ...items, '総合評価', '再度の任用', '評価者', '評価日', '所見']];
  DATA.evaluations.forEach((e) => {
    const s = staffById(e.staffId) || {};
    evRows.push([s.number || '', s.name || '', C.fyLabel(Number(e.fiscalYear)), ...items.map((it) => (e.items || {})[it] || ''), e.overall || '', C.RECOMMEND_LABEL[e.recommend || ''], e.evaluator || '', e.evaluatedAt || '', e.comment || '']);
  });
  const exRows = [['試験名', '方法', '所属', '職名', '試験日', '応募者', 'ふりがな', '合計点', '結果']];
  DATA.exams.forEach((ex) => DATA.applicants.filter((a) => a.examId === ex.id).forEach((a) =>
    exRows.push([ex.name, C.EXAM_METHOD_LABEL[ex.method] || '', ex.dept || '', ex.title || '', ex.examDate || '', a.name, a.kana || '', C.applicantTotal(a, ex).total, C.RESULT_LABEL[a.result || 'pending']])));
  writeWorkbook(`会計年度任用職員_全データ_${stamp()}.xlsx`, [
    { name: '職員台帳', rows: staffRows },
    ...[...new Set(DATA.appointments.filter((a) => a.start).map((a) => C.fiscalYearOf(a.start)))].sort().map((fy) => ({ name: `任用一覧_${C.fyLabel(fy)}`, rows: C.ninyoIchiranRows(DATA, fy, DATA.settings) })),
    { name: '人事評価', rows: evRows },
    { name: '採用試験', rows: exRows },
  ]);
}

/* ------------------------------------------------------------
 * 年目・任用意向／公募職種／再度の任用／退職・残留
 * ------------------------------------------------------------ */
const STATUS_TONE = { stay: 'ok', stay_expected: 'ok', public: 'info', leave_expected: 'warn', leave: 'err', undecided: 'muted' };
function statusBadge(st) {
  return `<span class="badge st-${STATUS_TONE[st.code]}">${escapeHtml(C.CONTINUATION_LABEL[st.code])}</span>${st.detail ? `<br><small class="muted">${escapeHtml(st.detail)}</small>` : ''}`;
}
function fyShort(fy) { return C.toWarekiShort(C.fiscalYearStart(fy)).replace(/\.4\.1$/, ''); }
function miniStats(items) {
  return items.map(([label, value, tone]) => `<div class="mini-stat ${tone || ''}"><span class="mini-value">${value}</span><span class="mini-label">${label}</span></div>`).join('');
}
function sortByDept(list) {
  return list.slice().sort((x, y) => String(x.deptCode || '').localeCompare(String(y.deptCode || '')) || String(x.dept || '').localeCompare(String(y.dept || ''), 'ja')
    || String(staffName(x.staffId)).localeCompare(staffName(y.staffId), 'ja'));
}
/** 可否・希望を評価レコードに保存（評語は変えない） */
function upsertIntent(staffId, fy, patch) {
  let ev = C.evaluationFor(DATA, staffId, fy);
  if (!ev) {
    ev = { id: C.uid('ev'), staffId, fiscalYear: fy, items: {}, overall: '', recommend: '', wish: '', evaluator: '', evaluatedAt: '', comment: '' };
    DATA.evaluations.push(ev);
  }
  Object.assign(ev, patch);
  saveData();
}

/* ---------- 年目・任用意向 ---------- */
function renderIntent() {
  const fy = currentFy();
  document.getElementById('intent-title').textContent = `${fyShort(fy)}年度の職員：年目・再度の任用の可否・本人の希望`;
  const filter = document.getElementById('intent-filter').value;
  const all = sortByDept(C.latestAppointmentsOfFy(DATA, fy)).map((a) => {
    const ev = C.evaluationFor(DATA, a.staffId, fy);
    return { a, ev, year: C.yearInServiceOf(DATA, a), pfy: C.publicRecruitFy(DATA, a, DATA.settings), st: C.continuationStatus(DATA, a, DATA.settings) };
  });
  const cnt = (f) => all.filter(f).length;
  document.getElementById('intent-summary').innerHTML = miniStats([
    ['対象の職員', `${all.length}人`],
    ['可', `${cnt((x) => x.ev && x.ev.recommend === 'yes')}人`, 'ok'],
    ['不可', `${cnt((x) => x.ev && x.ev.recommend === 'no')}人`],
    ['要検討', `${cnt((x) => x.ev && x.ev.recommend === 'hold')}人`],
    ['可否 未入力', `${cnt((x) => !x.ev || !x.ev.recommend)}人`, cnt((x) => !x.ev || !x.ev.recommend) ? 'warn' : ''],
    ['希望する', `${cnt((x) => x.ev && x.ev.wish === 'yes')}人`, 'ok'],
    ['希望しない', `${cnt((x) => x.ev && x.ev.wish === 'no')}人`],
    ['希望 未確認', `${cnt((x) => !x.ev || !x.ev.wish)}人`, cnt((x) => !x.ev || !x.ev.wish) ? 'warn' : ''],
    ['3年目（公募の対象）', `${cnt((x) => x.pfy === fy + 1)}人`, 'info'],
  ]);
  const rows = all.filter((x) => (filter === 'missing' ? !x.ev || !x.ev.recommend || !x.ev.wish : filter === 'third' ? x.pfy === fy + 1 : true));
  const sel = (sid, key, cur, labels) => `<select class="result-select intent-select${cur ? '' : ' empty'}" data-intent="${sid}" data-key="${key}">${Object.entries(labels).map(([v, l]) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${v === '' ? '未入力' : l}</option>`).join('')}</select>`;
  document.getElementById('intent-table').innerHTML = tableHtml(
    ['氏名', '所属', '業務内容', '区分', '3年周期', '公募年度', '勤続', '人事評価', '再度の任用の可否', '本人の希望', `${fyShort(fy + 1)}年度の見込み`],
    rows.map(({ a, ev, year, pfy, st }) => `<tr class="${pfy === fy + 1 ? 'row-info' : ''}">
      <td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${C.KUBUN_LABEL[C.kubunOf(a)]}</td>
      <td><strong>${year}年目</strong></td>
      <td>${pfy === fy + 1 ? `<span class="badge warn">${fyShort(pfy)}.4 公募</span>` : pfy ? `${fyShort(pfy)}.4` : '-'}</td>
      <td>${serviceCell(a)}</td>
      <td>${C.hasGrades(ev) ? `<strong>${escapeHtml(ev.overall || '—')}</strong> ` : '<span class="muted">未入力</span> '}<button class="btn-small" data-eval-open="${a.staffId}">${C.hasGrades(ev) ? '編集' : '入力'}</button></td>
      <td>${sel(a.staffId, 'recommend', ev && ev.recommend, { '': '', yes: '可', hold: '要検討', no: '不可' })}</td>
      <td>${sel(a.staffId, 'wish', ev && ev.wish, { '': '', yes: '希望する', no: '希望しない' })}</td>
      <td>${statusBadge(st)}</td></tr>`),
    all.length ? '該当する職員はいません。' : `${C.fyLabel(fy)}の任用がありません。`,
  );
  const box = document.getElementById('intent-table');
  box.querySelectorAll('.intent-select').forEach((s) => (s.onchange = () => upsertIntent(s.dataset.intent, fy, { [s.dataset.key]: s.value })));
  box.querySelectorAll('[data-eval-open]').forEach((b) => (b.onclick = () => openEvalForm(b.dataset.evalOpen, fy)));
}
function exportIntent() {
  const fy = currentFy();
  const rows = [['職員番号', '氏名', '所属', '業務内容', '区分', '3年周期', '公募年度', '勤続', '総合評価', '再度の任用の可否', '本人の希望', '翌年度の見込み']];
  for (const a of sortByDept(C.latestAppointmentsOfFy(DATA, fy))) {
    const s = staffById(a.staffId) || {};
    const ev = C.evaluationFor(DATA, a.staffId, fy);
    const pfy = C.publicRecruitFy(DATA, a, DATA.settings);
    const sy = C.continuousServiceYears(DATA, a);
    rows.push([s.number || '', s.name || '', a.dept, a.title, C.KUBUN_LABEL[C.kubunOf(a)], `${C.yearInServiceOf(DATA, a)}年目`, pfy ? `${fyShort(pfy)}.4` : '',
      sy === 0 ? '初年' : `${sy}年`, ev ? ev.overall || '' : '', { yes: '可', hold: '要検討', no: '不可' }[ev && ev.recommend] || '未入力', C.WISH_LABEL[(ev && ev.wish) || ''],
      C.continuationStatus(DATA, a, DATA.settings).label]);
  }
  writeWorkbook(`年目・任用意向_${C.fyLabel(fy)}_${stamp()}.xlsx`, [{ name: '年目・任用意向', rows }]);
}

/* ---------- 公募職種 ---------- */
const DECISION_LABEL = { public: '公募する', none: '公募しない（職の廃止・統合など）', '': '未定' };
function recruitItems(fy) {
  const nextFy = fy + 1;
  const auto = C.recruitNeeds(DATA, fy, DATA.settings).map(({ appt, status }) => {
    const key = `${nextFy}:${appt.id}`;
    const dec = DATA.recruitDecisions[key] || {};
    return {
      kind: 'auto', key, appt, status, dept: appt.dept, deptCode: appt.deptCode, title: appt.title, kubun: C.kubunOf(appt),
      hours: C.hoursOf(appt) != null ? C.hoursOf(appt) : appt.hoursText || '', baseAmount: appt.baseAmount, count: 1,
      decision: dec.decision != null ? dec.decision : 'public', note: dec.note || '',
    };
  });
  const manual = DATA.recruitPositions.filter((r) => Number(r.fy) === nextFy).map((r) => ({
    kind: 'manual', key: r.id, pos: r, dept: r.dept, deptCode: r.deptCode, title: r.title, kubun: r.kubun, hours: r.weeklyHours, baseAmount: r.baseAmount,
    count: Number(r.count) || 1, decision: r.decision != null ? r.decision : 'public', note: r.note || '',
  }));
  return { nextFy, auto, manual };
}
function recruitGroups(items) {
  const map = new Map();
  for (const it of items.filter((x) => x.decision === 'public')) {
    const k = `${it.dept}|${it.title}|${it.kubun}`;
    const g = map.get(k) || { dept: it.dept, deptCode: it.deptCode, title: it.title, kubun: it.kubun, count: 0, hours: new Set(), sources: [] };
    g.count += it.count;
    if (it.hours !== '' && it.hours != null) g.hours.add(it.hours);
    g.sources.push(it);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => String(a.deptCode || '').localeCompare(String(b.deptCode || '')) || String(a.dept).localeCompare(String(b.dept), 'ja'));
}
function renderRecruit() {
  const fy = currentFy();
  const { nextFy, auto, manual } = recruitItems(fy);
  document.getElementById('recruit-title').textContent = `${fyShort(nextFy)}年度に公募する職種の整理（${fyShort(fy)}年度の職員から）`;
  const decSel = (key, cur, kind) => `<select class="result-select" data-dec="${key}" data-kind="${kind}">${Object.entries(DECISION_LABEL).map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  document.getElementById('recruit-needs').innerHTML = tableHtml(
    ['所属', '業務内容', '区分', '時間/週', '基礎額', '現職者', '理由', '判断'],
    sortByDept(auto.map((x) => ({ ...x, staffId: x.appt.staffId }))).map((x) => `<tr class="${x.decision === '' ? 'row-warning' : x.decision === 'none' ? 'row-muted' : ''}">
      <td>${escapeHtml(x.dept)}</td><td>${escapeHtml(x.title)}</td><td>${C.KUBUN_LABEL[x.kubun]}</td><td>${escapeHtml(x.hours)}</td>
      <td class="num">${x.baseAmount ? Number(x.baseAmount).toLocaleString('ja-JP') : ''}</td>
      <td>${nameLink(x.appt.staffId)}</td><td>${statusBadge(x.status)}</td><td>${decSel(x.key, x.decision, 'auto')}</td></tr>`),
    '現職者が残らない・公募となる職はありません（「年目・任用意向」「退職・残留」の入力に応じて挙がります）。',
  );
  document.getElementById('recruit-manual').innerHTML = tableHtml(
    ['所属', '業務内容', '区分', '時間/週', '人数', '基礎額', '備考', '判断', ''],
    manual.map((x) => `<tr class="${x.decision === '' ? 'row-warning' : x.decision === 'none' ? 'row-muted' : ''}">
      <td>${escapeHtml(x.dept)}</td><td>${escapeHtml(x.title)}</td><td>${C.KUBUN_LABEL[x.kubun] || ''}</td><td>${escapeHtml(x.hours)}</td><td>${x.count}人</td>
      <td class="num">${x.baseAmount ? Number(x.baseAmount).toLocaleString('ja-JP') : ''}</td><td>${escapeHtml(x.note)}</td><td>${decSel(x.key, x.decision, 'manual')}</td>
      <td class="actions"><button class="btn-small" data-rp-edit="${x.key}">編集</button><button class="btn-danger" data-rp-del="${x.key}">削除</button></td></tr>`),
    '新規・増員の職はありません。「新規・増員の職を追加」から登録します。',
  );
  const groups = recruitGroups(auto.concat(manual));
  const undecided = auto.concat(manual).filter((x) => x.decision === '').length;
  document.getElementById('recruit-summary').innerHTML = (undecided ? `<p class="warn-text">判断が「未定」の職が${undecided}件あります。</p>` : '') + tableHtml(
    ['所属', '業務内容', '区分', '時間/週', '募集人数', '内訳', '採用試験'],
    groups.map((g, i) => {
      const examName = `${C.fyLabel(nextFy)} ${g.dept} ${g.title} 採用選考`;
      const exists = DATA.exams.find((e) => e.name === examName);
      return `<tr><td>${escapeHtml(g.dept)}</td><td>${escapeHtml(g.title)}</td><td>${C.KUBUN_LABEL[g.kubun] || ''}</td><td>${[...g.hours].map(escapeHtml).join('・')}</td>
        <td><strong>${g.count}人</strong></td>
        <td><small>${g.sources.map((s) => (s.kind === 'auto' ? `${escapeHtml(staffName(s.appt.staffId))}の後任` : `新規・増員${s.count}人`)).join('、')}</small></td>
        <td>${exists ? `<button class="btn-small" data-goto-exam="${exists.id}">作成済み（開く）</button>` : `<button class="btn-small" data-make-exam="${i}">採用試験を作成</button>`}</td></tr>`;
    }),
    '公募する職はありません。',
  );
  const panel = document.getElementById('panel-recruit');
  panel.querySelectorAll('[data-dec]').forEach((s) => (s.onchange = () => {
    if (s.dataset.kind === 'auto') DATA.recruitDecisions[s.dataset.dec] = { ...(DATA.recruitDecisions[s.dataset.dec] || {}), decision: s.value };
    else DATA.recruitPositions.find((r) => r.id === s.dataset.dec).decision = s.value;
    saveData();
  }));
  panel.querySelectorAll('[data-rp-edit]').forEach((b) => (b.onclick = () => openRecruitForm(DATA.recruitPositions.find((r) => r.id === b.dataset.rpEdit))));
  panel.querySelectorAll('[data-rp-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('この職を削除しますか？')) return;
    DATA.recruitPositions = DATA.recruitPositions.filter((r) => r.id !== b.dataset.rpDel);
    saveData();
  }));
  panel.querySelectorAll('[data-make-exam]').forEach((b) => (b.onclick = () => {
    const g = groups[Number(b.dataset.makeExam)];
    const exam = {
      id: C.uid('ex'), name: `${C.fyLabel(nextFy)} ${g.dept} ${g.title} 採用選考`, method: 'selection', dept: g.dept, title: g.title,
      type: g.kubun === 'full' ? 'full' : 'part', positions: g.count, stages: ['書類', '面接'], status: 'open', note: '公募職種の整理から作成',
    };
    DATA.exams.push(exam);
    selectedExamId = exam.id;
    saveData();
    window.activateTab('exam');
    showToast('採用試験を作成しました。募集期間・試験日を入力してください。');
  }));
  panel.querySelectorAll('[data-goto-exam]').forEach((b) => (b.onclick = () => { selectedExamId = b.dataset.gotoExam; renderExams(); window.activateTab('exam'); }));
}
function openRecruitForm(pos) {
  const nextFy = currentFy() + 1;
  openForm(pos ? '新規・増員の職を編集' : `${fyShort(nextFy)}年度の新規・増員の職を追加`, [
    { key: 'deptCode', label: '所属CD' },
    { key: 'dept', label: '所属名', required: true },
    { key: 'title', label: '業務内容', required: true },
    { key: 'kubun', label: '区分', type: 'select', options: Object.entries(C.KUBUN_LABEL) },
    { key: 'weeklyHours', label: '勤務時間/週', placeholder: '例：30、随時' },
    { key: 'count', label: '募集人数', type: 'number', required: true },
    { key: 'baseAmount', label: '基礎額（円）', type: 'number' },
    { key: 'decision', label: '判断', type: 'select', options: Object.entries(DECISION_LABEL) },
    { key: 'note', label: '備考（任用希望調査の回答など）', type: 'textarea', full: true },
  ], pos || { kubun: 'part_monthly', count: 1, decision: 'public' }, (v) => {
    if (pos) Object.assign(pos, v);
    else DATA.recruitPositions.push({ id: C.uid('rp'), fy: nextFy, ...v });
    saveData();
    return undefined;
  }, { wide: true });
}
function exportRecruit() {
  const fy = currentFy();
  const { nextFy, auto, manual } = recruitItems(fy);
  const rows = [['所属CD', '所属', '業務内容', '区分', '勤務時間/週', '募集人数', '内訳']];
  for (const g of recruitGroups(auto.concat(manual))) {
    rows.push([g.deptCode || '', g.dept, g.title, C.KUBUN_LABEL[g.kubun] || '', [...g.hours].join('・'), g.count,
      g.sources.map((s) => (s.kind === 'auto' ? `${staffName(s.appt.staffId)}の後任（${s.status.label}）` : `新規・増員${s.count}人${s.note ? `：${s.note}` : ''}`)).join('／')]);
  }
  const detail = [['区分', '所属', '業務内容', '現職者', '理由', '判断', '備考']];
  for (const x of auto) detail.push(['自動', x.dept, x.title, staffName(x.appt.staffId), `${x.status.label}${x.status.detail ? `（${x.status.detail}）` : ''}`, DECISION_LABEL[x.decision], x.note]);
  for (const x of manual) detail.push(['新規・増員', x.dept, x.title, '', `${x.count}人`, DECISION_LABEL[x.decision], x.note]);
  writeWorkbook(`${fyShort(nextFy)}年度_公募職種一覧_${stamp()}.xlsx`, [{ name: '公募職種一覧', rows }, { name: '内訳', rows: detail }]);
}

/* ---------- 再度の任用 ---------- */
let reappointPlans = [];
function renderReappoint() {
  const fy = currentFy();
  const nextFy = fy + 1;
  document.getElementById('reappoint-title').textContent = `${fyShort(nextFy)}年度の再度の任用の一覧（${fyShort(fy)}年度の職員から）`;
  reappointPlans = C.buildNextYearPlan(DATA, fy, DATA.settings);
  const registered = sortByDept(DATA.appointments.filter((a) => a.status !== 'canceled' && a.start && C.fiscalYearOf(a.start) === nextFy && a.recruitMethod === 'reappoint'));
  const todo = reappointPlans.filter((p) => p.recommend && !p.already);
  const excluded = reappointPlans.filter((p) => !p.recommend && !p.already);
  document.getElementById('reappoint-summary').innerHTML = miniStats([
    [`${fyShort(fy)}年度の職員`, `${reappointPlans.length}人`],
    ['再度の任用の対象（未登録）', `${todo.length}人`, todo.length ? 'ok' : ''],
    [`${fyShort(nextFy)}年度に登録済み`, `${registered.length}人`, 'ok'],
    ['対象外・要確認', `${excluded.length}人`, excluded.length ? 'warn' : ''],
  ]);
  const ev = (p) => p.evaluation;
  document.getElementById('reappoint-list').innerHTML = tableHtml(
    ['登録', '氏名', '所属', '業務内容', '区分', `${fyShort(nextFy)}年度`, '人事評価', '可否', '本人の希望', '状態', '注意'],
    todo.map((p) => `<tr>
      <td><input type="checkbox" data-plan-id="${p.draft.id}" checked></td>
      <td>${nameLink(p.staffId)}</td><td>${escapeHtml(p.base.dept)}</td><td>${escapeHtml(p.base.title)}</td><td>${C.KUBUN_LABEL[C.kubunOf(p.base)]}</td>
      <td>${p.draft.yearInService}年目</td><td>${escapeHtml((ev(p) && ev(p).overall) || '—')}</td><td>可</td><td>希望する</td>
      <td><span class="badge warn">未登録</span></td><td><small class="muted">${p.reasons.map(escapeHtml).join('<br>')}</small></td></tr>`)
      .concat(registered.map((a) => {
        const e = C.evaluationFor(DATA, a.staffId, fy);
        return `<tr><td></td><td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${C.KUBUN_LABEL[C.kubunOf(a)]}</td>
          <td>${C.yearInServiceOf(DATA, a)}年目</td><td>${escapeHtml((e && e.overall) || '—')}</td><td>${{ yes: '可', hold: '要検討', no: '不可' }[e && e.recommend] || '—'}</td>
          <td>${C.WISH_LABEL[(e && e.wish) || '']}</td><td><span class="badge ok">登録済み</span></td><td>${a.ukagai ? '' : '<small class="muted">任用伺い未受理</small>'}</td></tr>`;
      })),
    '再度の任用の対象はいません。「年目・任用意向」で可否と本人の希望を入力してください。',
  );
  document.getElementById('reappoint-excluded').innerHTML = tableHtml(
    ['氏名', '所属', '業務内容', `${fyShort(nextFy)}年度`, '理由'],
    excluded.map((p) => `<tr class="row-warning"><td>${nameLink(p.staffId)}</td><td>${escapeHtml(p.base.dept)}</td><td>${escapeHtml(p.base.title)}</td>
      <td>${p.draft.yearInService}年目${p.overLimit ? ' <span class="badge warn">公募</span>' : ''}</td><td><small>${p.reasons.map(escapeHtml).join('<br>')}</small></td></tr>`),
    '対象外・確認が必要な職員はいません。',
  );
}
function registerReappoint() {
  const ids = [...document.querySelectorAll('[data-plan-id]:checked')].map((c) => c.dataset.planId);
  const picked = reappointPlans.filter((p) => ids.includes(p.draft.id));
  if (!picked.length) { alert('登録する職員にチェックを入れてください。'); return; }
  const nextFy = currentFy() + 1;
  if (!confirm(`${picked.length}人を${C.fyLabel(nextFy)}の任用（再度の任用）として登録します。よろしいですか？`)) return;
  for (const p of picked) DATA.appointments.push(p.draft);
  saveData();
  initFiscalYearPicker();
  showToast(`${picked.length}人を${C.fyLabel(nextFy)}に登録しました。`);
}
function exportReappoint() {
  const fy = currentFy();
  const nextFy = fy + 1;
  const rows = [['職員番号', '氏名', '所属', '業務内容', '区分', `${C.fyLabel(nextFy)}の年目`, '総合評価', '可否', '本人の希望', '状態']];
  for (const p of C.buildNextYearPlan(DATA, fy, DATA.settings).filter((x) => x.recommend && !x.already)) {
    const s = staffById(p.staffId) || {};
    rows.push([s.number || '', s.name || '', p.base.dept, p.base.title, C.KUBUN_LABEL[C.kubunOf(p.base)], `${p.draft.yearInService}年目`, (p.evaluation && p.evaluation.overall) || '', '可', '希望する', '未登録']);
  }
  for (const a of DATA.appointments.filter((x) => x.status !== 'canceled' && x.start && C.fiscalYearOf(x.start) === nextFy && x.recruitMethod === 'reappoint')) {
    const s = staffById(a.staffId) || {};
    const e = C.evaluationFor(DATA, a.staffId, fy);
    rows.push([s.number || '', s.name || '', a.dept, a.title, C.KUBUN_LABEL[C.kubunOf(a)], `${C.yearInServiceOf(DATA, a)}年目`, (e && e.overall) || '',
      { yes: '可', hold: '要検討', no: '不可' }[e && e.recommend] || '', C.WISH_LABEL[(e && e.wish) || ''], '登録済み']);
  }
  writeWorkbook(`${fyShort(nextFy)}年度_再度の任用の一覧_${stamp()}.xlsx`, [{ name: '再度の任用', rows }]);
}

/* ---------- 退職・残留 ---------- */
/** 退職処理（申送事項）。resignOnly は自己都合等のみ（任期満了では省略） */
const RETIRE_PROCS = [
  { key: 'copy', label: '伺い（回議用紙・退職願）のコピー', resignOnly: true },
  { key: 'jinji', label: '人事システムに終了日等を入力（書類管理・配置・職名・雇用保険・休暇管理・任用）' },
  { key: 'rireki', label: '履歴管理システムに「辞職を承認する」を入力', resignOnly: true },
  { key: 'notice', label: '本人通知（退職）を伺いに添付し決裁' },
  { key: 'soshitsu', label: '雇用保険・社会保険の喪失届（電子申請）' },
  { key: 'rishoku', label: '離職票の作成・送付（59歳以上の退職者のみ）' },
];
function retireProcsFor(type) { return RETIRE_PROCS.filter((p) => type !== 'expiry' || !p.resignOnly); }
function renderRetire() {
  const fy = currentFy();
  const nextFy = fy + 1;
  document.getElementById('retire-title').textContent = `${fyShort(fy)}年度の職員の退職・残留（${fyShort(nextFy)}年度に残るか）`;
  const filter = document.getElementById('retire-filter').value;
  const all = sortByDept(C.latestAppointmentsOfFy(DATA, fy)).map((a) => ({ a, st: C.continuationStatus(DATA, a, DATA.settings) }));
  const cnt = (code) => all.filter((x) => x.st.code === code).length;
  document.getElementById('retire-summary').innerHTML = miniStats([
    ['残る（登録済み）', `${cnt('stay')}人`, 'ok'],
    ['残る見込み', `${cnt('stay_expected')}人`, 'ok'],
    ['公募の対象', `${cnt('public')}人`, 'info'],
    ['残らない見込み', `${cnt('leave_expected')}人`, cnt('leave_expected') ? 'warn' : ''],
    ['残らない（退職登録済み）', `${cnt('leave')}人`, cnt('leave') ? 'err' : ''],
    ['未定', `${cnt('undecided')}人`, cnt('undecided') ? 'warn' : ''],
  ]);
  const rows = all.filter((x) => !filter || x.st.code === filter);
  document.getElementById('retire-table').innerHTML = tableHtml(
    ['氏名', '所属', '業務内容', '区分', '任期', '3年周期', `${fyShort(nextFy)}年度の見込み`, '退職', '退職手続き', ''],
    rows.map(({ a, st }) => {
      const procs = a.retireType ? retireProcsFor(a.retireType) : [];
      const done = procs.filter((p) => (a.retireProcs || {})[p.key]).length;
      return `<tr class="${st.code === 'leave' ? 'row-error' : st.code === 'leave_expected' || st.code === 'undecided' ? 'row-warning' : ''}">
        <td>${nameLink(a.staffId)}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${C.KUBUN_LABEL[C.kubunOf(a)]}</td>
        <td>${C.toWarekiShort(a.start)}～${C.toWarekiShort(a.end)}${a.originalEnd ? `<br><small class="muted">当初 ～${C.toWarekiShort(a.originalEnd)}</small>` : ''}</td>
        <td>${C.yearInServiceOf(DATA, a)}年目</td>
        <td>${statusBadge(st)}</td>
        <td>${a.retireType ? `${C.RETIRE_LABEL[a.retireType]}<br><small>${C.toWarekiShort(a.retireDate)}</small>` : '<span class="muted">-</span>'}</td>
        <td>${a.retireType ? `<span class="badge ${done === procs.length ? 'ok' : 'warn'}">${done}/${procs.length}</span>` : '<span class="muted">-</span>'}</td>
        <td class="actions">${st.code === 'stay' ? '' : `<button class="btn-small" data-retire="${a.id}">${a.retireType ? '退職の編集' : '退職を登録'}</button>`}</td></tr>`;
    }),
    all.length ? '該当する職員はいません。' : `${C.fyLabel(fy)}の任用がありません。`,
  );
  document.querySelectorAll('#retire-table [data-retire]').forEach((b) => (b.onclick = () => openRetireForm(DATA.appointments.find((a) => a.id === b.dataset.retire))));
}
function openRetireForm(appt) {
  const fullEnd = appt.originalEnd || appt.end;
  const values = {
    retireType: appt.retireType || 'expiry',
    retireDate: appt.retireDate || fullEnd,
    retireNote: appt.retireNote || '',
  };
  const procHtml = (type) => `<div class="proc-list"><h4>退職手続き（申送事項「退職処理」）</h4>${retireProcsFor(type).map((p) =>
    `<label class="checkbox-label"><input type="checkbox" data-proc="${p.key}"${(appt.retireProcs || {})[p.key] ? ' checked' : ''}> ${escapeHtml(p.label)}</label>`).join('')}</div>`;
  openForm(`退職の登録：${staffName(appt.staffId)}（${C.toWarekiShort(appt.start)}～${C.toWarekiShort(fullEnd)}）`, [
    { key: 'retireType', label: '退職事由', type: 'select', options: Object.entries(C.RETIRE_LABEL) },
    { key: 'retireDate', label: '退職日（任期の最終日）', type: 'date', required: true, hint: '任期満了は任期の終了日。年度途中の退職は、任期の終了日をこの日に変更します' },
    { key: 'retireNote', label: '備考', type: 'textarea', full: true },
  ], values, (v) => {
    if (v.retireDate < appt.start || v.retireDate > fullEnd) return `<p class="error-text">退職日は任期（${appt.start}～${fullEnd}）の範囲で入力してください。</p>`;
    const procs = {};
    document.querySelectorAll('[data-proc]').forEach((c) => { procs[c.dataset.proc] = c.checked; });
    if (v.retireDate < fullEnd) { appt.originalEnd = fullEnd; appt.end = v.retireDate; } else { appt.end = fullEnd; delete appt.originalEnd; }
    Object.assign(appt, { retireType: v.retireType, retireDate: v.retireDate, retireNote: v.retireNote, retireProcs: procs });
    saveData();
    showToast('退職を登録しました。');
    return undefined;
  }, { wide: true, after: `<div id="proc-area">${procHtml(values.retireType)}</div>
    ${appt.retireType ? '<button type="button" class="btn-danger" id="retire-clear">退職の登録を取り消す</button>' : ''}` });
  document.getElementById('f-retireType').addEventListener('change', (e) => {
    document.getElementById('proc-area').innerHTML = procHtml(e.target.value);
    if (e.target.value === 'expiry') document.getElementById('f-retireDate').value = fullEnd;
  });
  const clear = document.getElementById('retire-clear');
  if (clear) clear.onclick = () => {
    if (!confirm('退職の登録を取り消し、任期を元に戻しますか？')) return;
    appt.end = fullEnd;
    for (const k of ['originalEnd', 'retireType', 'retireDate', 'retireNote', 'retireProcs']) delete appt[k];
    closeModal();
    saveData();
  };
}
function exportRetire() {
  const fy = currentFy();
  const rows = [['職員番号', '氏名', '所属', '業務内容', '区分', '任期（自）', '任期（至）', '3年周期', '翌年度の見込み', '詳細', '退職事由', '退職日', '手続き完了']];
  for (const a of sortByDept(C.latestAppointmentsOfFy(DATA, fy))) {
    const s = staffById(a.staffId) || {};
    const st = C.continuationStatus(DATA, a, DATA.settings);
    const procs = a.retireType ? retireProcsFor(a.retireType) : [];
    rows.push([s.number || '', s.name || '', a.dept, a.title, C.KUBUN_LABEL[C.kubunOf(a)], a.start, a.end, `${C.yearInServiceOf(DATA, a)}年目`, st.label, st.detail,
      a.retireType ? C.RETIRE_LABEL[a.retireType] : '', a.retireDate || '', a.retireType ? `${procs.filter((p) => (a.retireProcs || {})[p.key]).length}/${procs.length}` : '']);
  }
  writeWorkbook(`退職・残留_${C.fyLabel(fy)}_${stamp()}.xlsx`, [{ name: '退職・残留', rows }]);
}

/* ------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------ */
function renderAll() {
  renderFyChips();
  renderBackupBanner();
  renderHome();
  renderStaff();
  renderAppointments();
  renderEvaluations();
  renderExams();
  renderLaws();
  renderIntent();
  renderRecruit();
  renderReappoint();
  renderRetire();
}
function init() {
  loadData();
  initTabs();
  initFiscalYearPicker();
  document.getElementById('global-fy').addEventListener('change', (e) => { saveUi({ fy: e.target.value }); renderFyChips(); renderAll(); });
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('.name-link');
    if (!link) return;
    e.preventDefault();
    if (!document.getElementById('modal').classList.contains('hidden')) closeModal();
    openStaffDetail(link.dataset.staff);
  });
  document.getElementById('staff-fy-only').onchange = renderStaff;
  document.getElementById('btn-staff-add').onclick = () => openStaffForm(null);
  document.getElementById('staff-search').oninput = renderStaff;

  document.getElementById('btn-appoint-add').onclick = () => openAppointForm(null);
  ['appoint-search', 'appoint-status-filter', 'appoint-issue-only'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderAppointments);
    document.getElementById(id).addEventListener('change', renderAppointments);
  });
  document.getElementById('btn-appoint-export').onclick = () =>
    writeWorkbook(`${C.fyLabel(currentFy())}任用者一覧_${stamp()}.xlsx`, [{ name: 'Sheet1', rows: C.ninyoIchiranRows(DATA, currentFy(), DATA.settings) }]);

  document.getElementById('eval-missing-only').onchange = renderEvaluations;
  document.getElementById('btn-eval-export').onclick = () => {
    const fy = currentFy();
    const items = DATA.settings.evalItems;
    const rows = [['職員番号', '氏名', '年度', ...items, '総合評価', '再度の任用', '評価者', '評価日', '所見']];
    DATA.evaluations.filter((e) => Number(e.fiscalYear) === fy).forEach((e) => {
      const s = staffById(e.staffId) || {};
      rows.push([s.number || '', s.name || '', C.fyLabel(fy), ...items.map((it) => (e.items || {})[it] || ''), e.overall || '', C.RECOMMEND_LABEL[e.recommend || ''], e.evaluator || '', e.evaluatedAt || '', e.comment || '']);
    });
    writeWorkbook(`人事評価_${C.fyLabel(fy)}_${stamp()}.xlsx`, [{ name: '人事評価', rows }]);
  };

  document.getElementById('btn-exam-add').onclick = () => openExamForm(null);
  document.getElementById('intent-filter').onchange = renderIntent;
  document.getElementById('btn-intent-export').onclick = exportIntent;
  document.getElementById('btn-recruit-add').onclick = () => openRecruitForm(null);
  document.getElementById('btn-recruit-export').onclick = exportRecruit;
  document.getElementById('btn-reappoint-register').onclick = registerReappoint;
  document.getElementById('btn-reappoint-export').onclick = exportReappoint;
  document.getElementById('retire-filter').onchange = renderRetire;
  document.getElementById('btn-retire-export').onclick = exportRetire;

  document.getElementById('import-file').onchange = onImportFile;
  document.getElementById('import-kind').onchange = renderImportPreview;
  document.getElementById('import-sheet').onchange = renderImportPreview;
  document.getElementById('import-create-staff').onchange = renderImportPreview;
  document.getElementById('btn-import-template').onclick = downloadImportTemplate;

  document.getElementById('btn-backup').onclick = doBackup;
  document.getElementById('restore-file').onchange = (e) => { if (e.target.files[0]) doRestore(e.target.files[0]); e.target.value = ''; };
  document.getElementById('btn-export-all').onclick = exportAll;
  document.getElementById('btn-settings-save').onclick = saveSettings;
  document.getElementById('btn-clear-all').onclick = () => {
    if (!confirm('この端末に保存されているデータをすべて消去します。バックアップは保存しましたか？')) return;
    if (!confirm('本当に消去しますか？元に戻せません。')) return;
    DATA = C.emptyData();
    saveData();
    renderSettings();
    showToast('データを消去しました。');
  };

  window.addEventListener('afterprint', () => { document.getElementById('print-area').innerHTML = ''; });

  renderSettings();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
