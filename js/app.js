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
  const ui = loadUi();
  if (ui.tab && document.getElementById(`panel-${ui.tab}`)) activate(ui.tab);
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
}

/* ------------------------------------------------------------
 * ホーム
 * ------------------------------------------------------------ */
function renderHome() {
  const t = todayISO();
  const fy = currentFy();
  const statuses = DATA.appointments.map((a) => C.appointmentStatus(a, t));
  const active = statuses.filter((s) => s === 'active').length;
  const planned = statuses.filter((s) => s === 'planned').length;
  const issueCount = DATA.appointments.filter((a) => a.status !== 'canceled' && C.validateAppointment(a, DATA, DATA.settings).length).length;
  const missing = C.missingEvaluations(DATA, fy);
  const openExams = DATA.exams.filter((e) => e.status !== 'closed');
  const stat = (label, value, tab, tone) =>
    `<button class="stat ${tone || ''}" data-goto="${tab}"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></button>`;
  document.getElementById('home-stats').innerHTML = [
    stat('本日在職中', `${active}人`, 'appoint'),
    stat('任用予定', `${planned}件`, 'appoint'),
    stat('要確認の任用', `${issueCount}件`, 'appoint', issueCount ? 'warn' : ''),
    stat(`${C.fyLabel(fy)} 評価未入力`, `${missing.length}人`, 'eval', missing.length ? 'warn' : ''),
    stat('実施中の試験', `${openExams.length}件`, 'exam'),
    stat('職員台帳', `${DATA.staff.length}人`, 'staff'),
  ].join('');
  document.querySelectorAll('#home-stats [data-goto]').forEach((b) => (b.onclick = () => window.activateTab(b.dataset.goto)));

  const exp = C.expiringAppointments(DATA, t, Number(DATA.settings.expiryAlertDays) || 60);
  document.getElementById('home-expiring').innerHTML = tableHtml(
    ['氏名', '所属', '職名', '任期', '残り日数', '次年度'],
    exp.map(({ appt, daysLeft }) => {
      const nextFy = C.fiscalYearOf(appt.start) + 1;
      const hasNext = DATA.appointments.some((a) => a.staffId === appt.staffId && a.status !== 'canceled' && C.fiscalYearOf(a.start) === nextFy);
      return `<tr><td>${escapeHtml(staffName(appt.staffId))}</td><td>${escapeHtml(appt.dept)}</td><td>${escapeHtml(appt.title)}</td>
        <td>${appt.start}〜${appt.end}</td><td>${daysLeft}日</td><td>${hasNext ? '登録済み' : '<span class="badge warn">未登録</span>'}</td></tr>`;
    }),
    '任期満了が近い職員はいません。',
  );
  document.getElementById('home-missing-eval').innerHTML = tableHtml(
    ['氏名', '所属', '職名', '任期'],
    missing.map((a) => `<tr><td>${escapeHtml(staffName(a.staffId))}</td><td>${escapeHtml(a.dept)}</td><td>${escapeHtml(a.title)}</td><td>${a.start}〜${a.end}</td></tr>`),
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
    { key: 'phone', label: '連絡先' },
    { key: 'address', label: '住所', full: true },
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
      saved = { id: C.uid('st'), ...v, createdAt: new Date().toISOString() };
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
  const list = DATA.staff
    .filter((s) => !q || [s.number, s.name, s.kana].some((x) => String(x || '').replace(/[\s　]/g, '').includes(q)))
    .sort((a, b) => String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'));
  document.getElementById('staff-table').innerHTML = tableHtml(
    ['番号', '氏名', 'ふりがな', '性別', '現在の任用', '任用回数', '直近の評価', ''],
    list.map((s) => {
      const appts = C.appointmentsOfStaff(DATA, s.id).filter((a) => a.status !== 'canceled');
      const cur = appts.find((a) => C.appointmentStatus(a, t) === 'active');
      const evs = DATA.evaluations.filter((e) => e.staffId === s.id).sort((a, b) => b.fiscalYear - a.fiscalYear);
      const fys = new Set(appts.map((a) => C.fiscalYearOf(a.start)));
      return `<tr><td>${escapeHtml(s.number)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.kana)}</td><td>${GENDER_LABEL[s.gender || '']}</td>
        <td>${cur ? `${escapeHtml(cur.dept)} ${escapeHtml(cur.title)}（〜${cur.end}）` : '<span class="muted">—</span>'}</td>
        <td>${fys.size}年度</td>
        <td>${evs[0] ? `${C.fyLabel(Number(evs[0].fiscalYear))}：${escapeHtml(evs[0].overall || '—')}` : '<span class="muted">—</span>'}</td>
        <td class="actions"><button class="btn-small" data-detail="${s.id}">詳細</button><button class="btn-small" data-edit="${s.id}">編集</button><button class="btn-danger" data-del="${s.id}">削除</button></td></tr>`;
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
function openStaffDetail(staffId) {
  const s = staffById(staffId);
  if (!s) return;
  const t = todayISO();
  const appts = C.appointmentsOfStaff(DATA, s.id);
  const evs = DATA.evaluations.filter((e) => e.staffId === s.id).sort((a, b) => b.fiscalYear - a.fiscalYear);
  const apps = DATA.applicants.filter((a) => a.staffId === s.id);
  const reappointNow = appts.length ? C.consecutiveReappointCount(DATA, s.id, appts[appts.length - 1]) : 0;
  const body = `
    <dl class="kv">
      <dt>職員番号</dt><dd>${escapeHtml(s.number) || '—'}</dd>
      <dt>氏名</dt><dd>${escapeHtml(s.name)}（${escapeHtml(s.kana)}）</dd>
      <dt>性別</dt><dd>${GENDER_LABEL[s.gender || ''] || '—'}</dd>
      <dt>生年月日</dt><dd>${s.birth ? C.formatDateJa(s.birth) : '—'}</dd>
      <dt>連絡先</dt><dd>${escapeHtml(s.phone) || '—'}</dd>
      <dt>公募によらない再度の任用</dt><dd>直近の任用時点で連続${reappointNow}回</dd>
    </dl>
    <h4>任用履歴</h4>
    ${tableHtml(['年度', '任期', '所属・職名', '区分', '採用方法', '状態'], appts.map((a) =>
      `<tr><td>${C.fyLabel(C.fiscalYearOf(a.start))}</td><td>${a.start}〜${a.end}</td><td>${escapeHtml(a.dept)} ${escapeHtml(a.title)}</td>
       <td>${C.APPOINT_TYPE_SHORT[a.type] || ''}</td><td>${C.RECRUIT_LABEL[a.recruitMethod] || ''}</td><td>${C.STATUS_LABEL[C.appointmentStatus(a, t)]}</td></tr>`), '任用の記録はありません。')}
    <h4>人事評価</h4>
    ${tableHtml(['年度', ...DATA.settings.evalItems, '総合', '所見（任用）', '評価者'], evs.map((e) =>
      `<tr><td>${C.fyLabel(Number(e.fiscalYear))}</td>${DATA.settings.evalItems.map((it) => `<td>${escapeHtml((e.items || {})[it] || '')}</td>`).join('')}
       <td>${escapeHtml(e.overall)}</td><td>${C.RECOMMEND_LABEL[e.recommend || '']}</td><td>${escapeHtml(e.evaluator)}</td></tr>`), '評価の記録はありません。')}
    <h4>採用試験の応募歴</h4>
    ${tableHtml(['試験', '結果'], apps.map((a) => {
      const ex = DATA.exams.find((x) => x.id === a.examId);
      return `<tr><td>${escapeHtml(ex ? ex.name : '（削除済み）')}</td><td>${C.RESULT_LABEL[a.result || 'pending']}</td></tr>`;
    }), '応募歴はありません。')}
    ${s.note ? `<h4>備考</h4><p>${escapeHtml(s.note)}</p>` : ''}
    <div class="row-actions end"><button class="btn-primary" id="detail-add-appt">この職員の任用を登録</button></div>`;
  openModal(`${s.name} さんの記録`, body, { wide: true });
  document.getElementById('detail-add-appt').onclick = () => { closeModal(); openAppointForm(null, { staffId: s.id }); };
}

/* ------------------------------------------------------------
 * 任用管理
 * ------------------------------------------------------------ */
function staffOptions(includeBlank = true) {
  const list = DATA.staff.slice().sort((a, b) => String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'));
  return (includeBlank ? [['', '選択してください']] : []).concat(list.map((s) => [s.id, `${s.name}${s.number ? `（${s.number}）` : ''}`]));
}
function appointFields() {
  return [
    { key: 'staffId', label: '職員', type: 'select', options: staffOptions(), required: true },
    { key: 'recruitMethod', label: '採用方法', type: 'select', options: Object.entries(C.RECRUIT_LABEL) },
    { key: 'dept', label: '所属（課）', required: true },
    { key: 'section', label: '係' },
    { key: 'title', label: '職名・業務', required: true },
    { key: 'type', label: '区分', type: 'select', options: Object.entries(C.APPOINT_TYPE_LABEL) },
    { key: 'start', label: '任期の開始日', type: 'date', required: true },
    { key: 'end', label: '任期の終了日', type: 'date', required: true, hint: '開始日の属する会計年度の3月31日まで' },
    { key: 'weeklyHours', label: '1週間当たりの勤務時間', type: 'number', step: '0.25', required: true, hint: `フルタイムは常勤と同一（設定値：${DATA.settings.fullTimeWeeklyHours}時間）` },
    { key: 'payType', label: '報酬の区分', type: 'select', options: Object.entries(C.PAY_TYPE_LABEL) },
    { key: 'payAmount', label: '報酬（給料）額（円）', type: 'number', hint: '【市】会計年度任用職員の給与等に関する条例・規則に基づく額' },
    { key: 'note', label: '備考', type: 'textarea', full: true },
    { key: 'canceled', label: 'この任用を取り消す（記録は残す）', type: 'checkbox', full: true },
  ];
}
function openAppointForm(appt, preset = {}) {
  if (!DATA.staff.length) { alert('先に職員台帳に職員を登録してください。'); return; }
  const isNew = !appt;
  const fy = currentFy();
  const values = appt ? { ...appt, canceled: appt.status === 'canceled' } : {
    recruitMethod: 'public', type: 'part', start: C.fiscalYearStart(fy), end: C.fiscalYearEnd(fy), payType: 'hourly', ...preset,
  };
  const trySave = (v, force) => {
    const rec = {
      ...(appt || { id: C.uid('ap'), renewals: [], createdAt: new Date().toISOString() }),
      ...v,
      fiscalYear: v.start ? C.fiscalYearOf(v.start) : '',
      status: v.canceled ? 'canceled' : '',
    };
    delete rec.canceled;
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
    if (preset.onSaved) preset.onSaved(rec);
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
  }, { wide: true });
  // 勤務時間からフル／パートを自動選択
  const hoursEl = document.getElementById('f-weeklyHours');
  hoursEl.addEventListener('change', () => {
    const h = Number(hoursEl.value);
    if (h > 0) document.getElementById('f-type').value = h === Number(DATA.settings.fullTimeWeeklyHours) ? 'full' : 'part';
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
    .filter((x) => !q || [staffName(x.a.staffId), x.a.dept, x.a.section, x.a.title].some((s) => String(s || '').includes(q)))
    .sort((x, y) => String(x.a.dept).localeCompare(String(y.a.dept), 'ja') || String(staffName(x.a.staffId)).localeCompare(staffName(y.a.staffId), 'ja'));
}
function renderAppointments() {
  const rows = filteredAppointments();
  document.getElementById('appoint-table').innerHTML = tableHtml(
    ['氏名', '所属', '職名', '区分', '任期', '週時間', '報酬', '採用方法', '状態', '点検', ''],
    rows.map(({ a, status, issues }) => `<tr class="${status === 'canceled' ? 'row-muted' : issues.some((i) => i.level === 'error') ? 'row-error' : issues.length ? 'row-warning' : ''}">
      <td>${escapeHtml(staffName(a.staffId))}</td><td>${escapeHtml(a.dept)}${a.section ? `<br><small>${escapeHtml(a.section)}</small>` : ''}</td><td>${escapeHtml(a.title)}</td>
      <td>${C.APPOINT_TYPE_SHORT[a.type] || ''}</td>
      <td>${a.start}〜${a.end}${(a.renewals || []).length ? `<br><small>更新${a.renewals.length}回</small>` : ''}</td>
      <td>${a.weeklyHours || ''}h</td><td>${C.PAY_TYPE_LABEL[a.payType] || ''} ${yen(a.payAmount)}</td>
      <td>${a.recruitMethod === 'reappoint' ? '再度の任用' : '公募'}</td><td>${C.STATUS_LABEL[status]}</td>
      <td>${issueBadges(issues)}${issuesHtml(issues)}</td>
      <td class="actions"><button class="btn-small" data-edit="${a.id}">編集</button>
        ${status !== 'canceled' ? `<button class="btn-small" data-renew="${a.id}">任期更新</button><button class="btn-small" data-print="${a.id}">明示書</button>` : ''}
        <button class="btn-danger" data-del="${a.id}">削除</button></td></tr>`),
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
function appointmentSheetRows(list) {
  const rows = [['職員番号', '氏名', '年度', '所属', '係', '職名', '区分', '任期（自）', '任期（至）', '週勤務時間', '報酬区分', '報酬額', '採用方法', '更新回数', '状態', '備考']];
  const t = todayISO();
  for (const a of list) {
    const s = staffById(a.staffId) || {};
    rows.push([s.number || '', s.name || '', C.fyLabel(C.fiscalYearOf(a.start)), a.dept, a.section || '', a.title,
      a.type === 'full' ? 'フルタイム' : 'パートタイム', a.start, a.end, a.weeklyHours, C.PAY_TYPE_LABEL[a.payType] || '', a.payAmount,
      a.recruitMethod === 'reappoint' ? '再度の任用' : '公募', (a.renewals || []).length, C.STATUS_LABEL[C.appointmentStatus(a, t)], a.note || '']);
  }
  return rows;
}

/* 次年度の任用案 */
function openNextYearPlan() {
  const fy = currentFy();
  const plans = C.buildNextYearPlan(DATA, fy, DATA.settings);
  if (!plans.length) { alert(`${C.fyLabel(fy)}の任用がありません。`); return; }
  const body = `<p class="hint">${C.fyLabel(fy)}の任用と人事評価をもとに、${C.fyLabel(fy + 1)}の「再度の任用」案を作ります。推薦となった職員には最初からチェックが入っています。登録後は「任用管理」で個別に修正できます。</p>
    ${tableHtml(['登録', '氏名', '所属・職名', `${C.fyLabel(fy)}の評価`, '再度の任用', '判定'], plans.map((p, i) => `<tr class="${p.recommend ? '' : 'row-warning'}">
      <td><input type="checkbox" data-plan="${i}" ${p.recommend ? 'checked' : ''} ${p.already ? 'disabled' : ''}></td>
      <td>${escapeHtml(staffName(p.staffId))}</td><td>${escapeHtml(p.base.dept)} ${escapeHtml(p.base.title)}</td>
      <td>${p.evaluation ? `${escapeHtml(p.evaluation.overall || '—')}／${C.RECOMMEND_LABEL[p.evaluation.recommend || '']}` : '未入力'}</td>
      <td>連続${p.reappointCount}回目</td>
      <td>${p.recommend ? '<span class="badge ok">推薦</span>' : `<span class="badge warn">要検討</span><br><small>${p.reasons.map(escapeHtml).join('<br>')}</small>`}</td></tr>`))}
    <div class="row-actions end"><button class="btn-secondary" id="plan-cancel">閉じる</button><button class="btn-primary" id="plan-save">チェックした任用案を登録</button></div>`;
  openModal(`${C.fyLabel(fy + 1)}の任用案`, body, { wide: true });
  document.getElementById('plan-cancel').onclick = closeModal;
  document.getElementById('plan-save').onclick = () => {
    const picked = [...document.querySelectorAll('[data-plan]:checked')].map((el) => plans[Number(el.dataset.plan)]);
    if (!picked.length) { alert('登録する任用案を選んでください。'); return; }
    for (const p of picked) DATA.appointments.push(p.draft);
    closeModal();
    saveData();
    showToast(`${picked.length}件の任用案を登録しました（${C.fyLabel(fy + 1)}）。`);
  };
}

/* 任期等の明示書（印刷） */
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
    ['氏名', '所属・職名', ...items.map(escapeHtml), '総合', '所見（任用）', '評価者', '評価日', ''],
    rows.map(({ a, ev }) => `<tr class="${ev ? '' : 'row-warning'}"><td>${escapeHtml(staffName(a.staffId))}</td><td>${escapeHtml(a.dept)} ${escapeHtml(a.title)}</td>
      ${items.map((it) => `<td>${ev ? escapeHtml((ev.items || {})[it] || '') : ''}</td>`).join('')}
      <td><strong>${ev ? escapeHtml(ev.overall) : ''}</strong></td><td>${ev ? C.RECOMMEND_LABEL[ev.recommend || ''] : '<span class="badge warn">未入力</span>'}</td>
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
    comment: ev ? ev.comment : '',
  };
  set.evalItems.forEach((it, i) => { values[`item_${i}`] = ev ? (ev.items || {})[it] || '' : ''; });
  openForm(`${C.fyLabel(fy)} 人事評価：${staffName(staffId)}`, [
    ...itemFields,
    { key: 'overall', label: '総合評価', type: 'select', options: grades, hint: '各項目を選ぶと目安が自動で入ります（変更可）' },
    { key: 'recommend', label: '所見（次年度の再度の任用）', type: 'select', options: Object.entries(C.RECOMMEND_LABEL) },
    { key: 'evaluator', label: '評価者' },
    { key: 'evaluatedAt', label: '評価日', type: 'date' },
    { key: 'comment', label: '所見・コメント', type: 'textarea', full: true, rows: 4 },
  ], values, (v) => {
    const items = {};
    set.evalItems.forEach((it, i) => { items[it] = v[`item_${i}`]; });
    const rec = { staffId, fiscalYear: fy, items, overall: v.overall, recommend: v.recommend, evaluator: v.evaluator, evaluatedAt: v.evaluatedAt, comment: v.comment };
    if (ev) Object.assign(ev, rec);
    else DATA.evaluations.push({ id: C.uid('ev'), ...rec });
    saveData();
    showToast('評価を保存しました。');
    return undefined;
  }, { wide: true });
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
    <td class="actions">${a.result === 'pass' ? (a.appointmentId ? '<span class="badge ok">任用登録済み</span>' : `<button class="btn-small" data-hire="${a.id}">任用登録</button>`) : ''}
      <button class="btn-small" data-edit-app="${a.id}">編集</button><button class="btn-danger" data-del-app="${a.id}">削除</button></td></tr>`;
  el.innerHTML = `<div class="card">
    <div class="card-header-row"><h2>${escapeHtml(exam.name)}：応募者・採点</h2>
      <div class="row-actions">
        <button class="btn-primary" id="btn-app-add">応募者を追加</button>
        <label class="btn-secondary file-btn">応募者をExcelから取込<input type="file" id="app-import" accept=".xlsx,.xls,.csv" hidden></label>
        <button class="btn-secondary" id="btn-app-export">結果をExcelに書き出す</button>
      </div></div>
    <p class="hint">得点を入力すると自動で保存され、合計点の高い順に並びます（辞退者は順位から除外）。採用予定人数：${exam.positions || '—'}人</p>
    ${tableHtml(['順位', '氏名', ...exam.stages.map(escapeHtml), '合計', '結果', ''],
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
      staffId: staff.id, recruitMethod: 'public', dept: exam.dept, title: exam.title, type: exam.type || 'part',
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
  const res = planImport(kind, result.records, document.getElementById('import-create-staff').checked, true);
  saveData();
  initFiscalYearPicker();
  document.getElementById('import-preview').innerHTML = `<p class="success-text">取込が完了しました：新規 ${res.add}件／更新 ${res.update}件／スキップ ${res.skip.length + result.skipped.length}件${res.newStaff ? `／職員を自動追加 ${res.newStaff}人` : ''}</p>`;
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
];
function renderLaws() {
  document.getElementById('law-list').innerHTML = LAWS.map((l) => {
    const saved = DATA.legalTexts[l.key] || {};
    const verified = !!(saved.text && saved.checkedAt);
    return `<div class="law-item">
      <div class="law-head"><span class="level level-${l.level === '国' ? 'national' : 'city'}">${l.level}</span><h3>${escapeHtml(l.title)}</h3>
        ${verified ? `<span class="badge ok">原文確認済み（${escapeHtml(saved.checkedAt)}）</span>` : '<span class="badge warn">原文未確認</span>'}</div>
      ${verified ? '' : `<p class="muted">${escapeHtml(l.status)}</p>`}
      <p class="muted">このシステムでの使いどころ：</p><ul>${l.uses.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
      ${l.url ? `<p class="muted">出典：<a href="${l.url}" target="_blank" rel="noopener">${l.url}</a>（インターネット接続端末で閲覧）</p>` : ''}
      <details><summary>条文の本文を貼り付ける・確認する</summary>
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
      <small>法律上の上限ではなく、市の運用方針として定める場合に入力します。</small></label>
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
    { name: '任用', rows: appointmentSheetRows(DATA.appointments.slice().sort((a, b) => a.start.localeCompare(b.start))) },
    { name: '人事評価', rows: evRows },
    { name: '採用試験', rows: exRows },
  ]);
}

/* ------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------ */
function renderAll() {
  renderBackupBanner();
  renderHome();
  renderStaff();
  renderAppointments();
  renderEvaluations();
  renderExams();
  renderLaws();
}
function init() {
  loadData();
  initTabs();
  initFiscalYearPicker();
  document.getElementById('global-fy').addEventListener('change', (e) => { saveUi({ fy: e.target.value }); renderAll(); });
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('btn-staff-add').onclick = () => openStaffForm(null);
  document.getElementById('staff-search').oninput = renderStaff;

  document.getElementById('btn-appoint-add').onclick = () => openAppointForm(null);
  document.getElementById('btn-next-plan').onclick = openNextYearPlan;
  ['appoint-search', 'appoint-status-filter', 'appoint-issue-only'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderAppointments);
    document.getElementById(id).addEventListener('change', renderAppointments);
  });
  document.getElementById('btn-appoint-export').onclick = () =>
    writeWorkbook(`任用一覧_${C.fyLabel(currentFy())}_${stamp()}.xlsx`, [{ name: '任用', rows: appointmentSheetRows(filteredAppointments().map((x) => x.a)) }]);

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
