/* ==========================================================================
   LifeHub — 개인 생산성 통합 웹앱 (SPA)
   ========================================================================== */

const API = '/api';

const state = {
  token: localStorage.getItem('lh_token') || null,
  user: JSON.parse(localStorage.getItem('lh_user') || 'null'),
  settings: null,
  view: 'dashboard',
  cache: { tags: [], checklist: null }
};

/* ---------- API 클라이언트 ---------- */
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && auth) { logout(); throw new Error('세션이 만료되었습니다.'); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.detail || '요청에 실패했습니다.');
  return data;
}

/* ---------- 유틸 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

function toast(msg, type = 'info') {
  const colors = { info: 'bg-slate-800', success: 'bg-emerald-600', error: 'bg-rose-600', warn: 'bg-amber-500' };
  const el = document.createElement('div');
  el.className = `toast-item ${colors[type]} text-white px-4 py-2.5 rounded-xl shadow-lg text-sm`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2600);
}

function openModal(title, bodyHtml, footerHtml = '') {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" id="modal-backdrop">
      <div class="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto view-enter">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 class="font-bold text-lg">${esc(title)}</h3>
          <button data-close class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="p-5">${bodyHtml}</div>
        ${footerHtml ? `<div class="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0 bg-white">${footerHtml}</div>` : ''}
      </div>
    </div>`;
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function relTime(s) {
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return fmtDate(s);
}
function todayStr() { return fmtDate(new Date()); }

// 문자열을 안전하게 timestamp(ms)로 변환.
// 'YYYY-MM-DD HH:MM:SS'(D1/SQLite, UTC) 및 ISO('...Z') 두 형식을 모두 처리.
function toMs(s) {
  if (!s) return 0;
  let v = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) v = v.replace(' ', 'T') + 'Z';
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

/* ---------- 인증 ---------- */
function saveAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('lh_token', token);
  localStorage.setItem('lh_user', JSON.stringify(user));
}
function logout() {
  localStorage.removeItem('lh_token');
  localStorage.removeItem('lh_user');
  state.token = null; state.user = null;
  render();
}

/* ---------- 네비게이션 ---------- */
const NAV = [
  { id: 'dashboard', label: '대시보드', icon: 'fa-gauge-high' },
  { id: 'calendar', label: '달력', icon: 'fa-calendar-days' },
  { id: 'checklist', label: '체크리스트', icon: 'fa-list-check' },
  { id: 'notes', label: '메모', icon: 'fa-note-sticky' },
  { id: 'goals', label: '목표', icon: 'fa-bullseye' },
  { id: 'stats', label: '통계', icon: 'fa-chart-line' },
  { id: 'settings', label: '설정', icon: 'fa-gear' }
];

function navBar() {
  return NAV.map((n) => `
    <button data-nav="${n.id}" class="nav-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition
      ${state.view === n.id ? 'text-indigo-600 bg-indigo-50' : 'text-slate-500 hover:text-slate-800'}">
      <i class="fas ${n.icon} text-lg"></i><span>${n.label}</span>
    </button>`).join('');
}

/* ---------- 라우터 ---------- */
const VIEWS = {};
async function render() {
  const root = $('#root');
  if (!state.token) { VIEWS.login(root); return; }
  root.innerHTML = `
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100">
      <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-indigo-600 text-white grid place-items-center"><i class="fas fa-bolt"></i></div>
          <span class="font-bold text-lg">LifeHub</span>
        </div>
        <div class="flex items-center gap-3">
          <button data-nav="settings" class="text-slate-500 hover:text-slate-800"><i class="fas fa-bell"></i></button>
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-sm font-bold">${esc((state.user?.username || 'U')[0].toUpperCase())}</div>
          </div>
        </div>
      </div>
    </header>
    <main class="max-w-5xl mx-auto px-4 pb-28 pt-4"><div id="view" class="view-enter"></div></main>
    <nav class="fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 z-30">
      <div class="max-w-5xl mx-auto flex justify-around py-2">${navBar()}</div>
    </nav>`;
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.nav; render(); }));
  const view = $('#view');
  try { await VIEWS[state.view](view); }
  catch (e) { view.innerHTML = `<div class="p-8 text-center text-rose-500">${esc(e.message)}</div>`; }
}

/* ---------- 대시보드 ---------- */
VIEWS.dashboard = async (el) => {
  const d = await api('/dashboard/stats?period=week');
  const s = d.summary;
  const maxDaily = Math.max(1, ...d.daily_breakdown.map((x) => x.completed_count + x.memos));
  el.innerHTML = `
    <section class="mb-5">
      <h1 class="text-2xl font-bold">안녕하세요, ${esc(state.user?.username || '')}님 👋</h1>
      <p class="text-slate-500 text-sm mt-1">${todayStr()} · 이번 주 활동 요약</p>
    </section>
    <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      ${statCard('체크리스트', s.completed_checklist + ' / ' + s.total_checklist, 'fa-list-check', 'indigo', s.completion_rate + '%') }
      ${statCard('작성한 메모', s.memos_created, 'fa-note-sticky', 'amber', '이번 주')}
      ${statCard('달력 일정', s.calendar_hours + 'h', 'fa-calendar-check', 'emerald', '이번 주')}
      ${statCard('완료율', s.completion_rate + '%', 'fa-circle-check', 'rose', '전체')}
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold"><i class="fas fa-chart-column text-indigo-500 mr-2"></i>이번 주 활동</h2>
        <div class="flex gap-3 text-xs text-slate-500">
          <span><i class="fas fa-circle text-indigo-500"></i> 완료</span>
          <span><i class="fas fa-circle text-amber-400"></i> 메모</span>
        </div>
      </div>
      <div class="flex items-end justify-between gap-1.5 h-32">
        ${d.daily_breakdown.map((x) => {
          const total = x.completed_count + x.memos;
          const h = Math.round((total / maxDaily) * 100);
          const dow = ['일','월','화','수','목','금','토'][new Date(x.date).getDay()];
          return `<div class="flex-1 flex flex-col items-center gap-1 group" title="${x.date}: 완료 ${x.completed_count}, 메모 ${x.memos}">
            <div class="w-full flex flex-col justify-end gap-0.5" style="height:100px">
              <div class="w-full bg-amber-400 rounded-t" style="height:${Math.round((x.memos/maxDaily)*100)}%"></div>
              <div class="w-full bg-indigo-500 rounded-t" style="height:${Math.round((x.completed_count/maxDaily)*100)}%"></div>
            </div>
            <span class="text-[10px] text-slate-400">${dow}</span>
          </div>`;
        }).join('')}
      </div>
    </section>

    <div class="grid md:grid-cols-2 gap-5">
      <section class="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 class="font-bold mb-4"><i class="fas fa-bullseye text-rose-500 mr-2"></i>목표 진행률</h2>
        ${d.goals.length ? d.goals.map((g) => `
          <div class="mb-3">
            <div class="flex justify-between text-sm mb-1"><span class="font-medium">${esc(g.title)}</span><span class="text-slate-500">${g.progress}%</span></div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full ${g.progress >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}" style="width:${g.progress}%"></div></div>
          </div>`).join('')
          : `<p class="text-slate-400 text-sm">아직 목표가 없습니다. <button data-nav="goals" class="text-indigo-600 underline">목표 추가</button></p>`}
      </section>
      <section class="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 class="font-bold mb-4"><i class="fas fa-clock-rotate-left text-slate-400 mr-2"></i>최근 활동</h2>
        ${d.recent_activity.length ? `<ul class="space-y-3">${d.recent_activity.map((a) => `
          <li class="flex items-start gap-3 text-sm">
            <span class="w-7 h-7 rounded-full bg-slate-100 grid place-items-center text-slate-500 shrink-0"><i class="fas ${actIcon(a.entity)}"></i></span>
            <div><p>${esc(actLabel(a))}</p><span class="text-xs text-slate-400">${relTime(a.created_at)}</span></div>
          </li>`).join('')}</ul>`
          : `<p class="text-slate-400 text-sm">활동 기록이 없습니다.</p>`}
      </section>
    </div>`;
  $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.nav; render(); }));
};

function statCard(label, value, icon, color, sub) {
  return `<div class="bg-white rounded-2xl border border-slate-100 p-4 card">
    <div class="w-9 h-9 rounded-xl bg-${color}-100 text-${color}-600 grid place-items-center mb-3"><i class="fas ${icon}"></i></div>
    <p class="text-2xl font-bold">${esc(value)}</p>
    <p class="text-slate-500 text-xs mt-0.5">${esc(label)} · ${esc(sub)}</p>
  </div>`;
}
function actIcon(entity) {
  return { checklist: 'fa-list-check', note: 'fa-note-sticky', event: 'fa-calendar-days', goal: 'fa-bullseye', user: 'fa-user' }[entity] || 'fa-circle';
}
function actLabel(a) {
  const map = { create: '생성', complete: '완료', reopen: '되돌림', register: '가입' };
  const e = { checklist: '체크리스트', note: '메모', event: '일정', goal: '목표', user: '사용자' }[a.entity] || a.entity;
  return `${e} ${map[a.action] || a.action}${a.detail ? ': ' + a.detail : ''}`;
}

/* ---------- 달력 ---------- */
state.cal = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: todayStr(), events: [], holidays: {}, lunar: {} };
state.holidayCache = {};

async function loadHolidayYear(year) {
  if (state.holidayCache[year]) return state.holidayCache[year];
  try {
    const d = await api('/calendar/holidays?year=' + year);
    const map = {}; d.holidays.forEach((h) => { map[h.date] = h.name; });
    state.holidayCache[year] = { map, list: d.holidays };
    return state.holidayCache[year];
  } catch (e) { return { map: {}, list: [] }; }
}

VIEWS.calendar = async (el) => {
  const { year, month } = state.cal;
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();

  const startStr = fmtDate(new Date(year, month, 1));
  const endStr = fmtDate(new Date(year, month + 1, 0));
  const showLunar = !!state.settings?.lunar_display;
  const [data, hol, lunarData] = await Promise.all([
    api(`/calendar/events?start_date=${startStr}&end_date=${endStr}`),
    loadHolidayYear(year),
    showLunar ? api(`/calendar/lunar-month?year=${year}&month=${month + 1}`) : Promise.resolve({ cells: [] })
  ]);
  state.cal.events = data.items;
  state.cal.holidays = hol.map;
  state.cal.lunar = {};
  lunarData.cells.forEach((c) => { state.cal.lunar[c.solar] = c; });
  const byDay = {};
  data.items.forEach((e) => { const k = e.occurrence_date || fmtDate(e.start_time); (byDay[k] = byDay[k] || []).push(e); });

  let cells = '';
  for (let i = 0; i < startPad; i++) cells += `<div class="cal-cell p-1"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = fmtDate(new Date(year, month, d));
    const evs = byDay[key] || [];
    const isToday = key === todayStr();
    const isSel = key === state.cal.selected;
    const dow = new Date(year, month, d).getDay();
    const holiday = state.cal.holidays[key];
    const lunar = state.cal.lunar[key];
    const isRed = dow === 0 || holiday;
    const maxEv = (holiday || showLunar) ? 1 : 2;
    cells += `<button data-day="${key}" class="cal-cell p-1 text-left border border-slate-100 rounded-lg hover:bg-indigo-50 transition relative
      ${isSel ? 'ring-2 ring-indigo-500' : ''} ${isToday ? 'bg-indigo-50' : holiday ? 'bg-rose-50/60' : 'bg-white'}">
      <div class="flex items-start justify-between gap-0.5">
        <span class="text-xs font-semibold ${isRed ? 'text-rose-500' : isToday ? 'text-indigo-600' : 'text-slate-600'}">${d}</span>
        ${showLunar && lunar ? `<span class="text-[9px] leading-tight text-slate-400 text-right">${esc(lunar.label)}</span>` : ''}
      </div>
      ${holiday ? `<div class="text-[9px] text-rose-500 truncate leading-tight">${esc(holiday)}</div>` : ''}
      <div class="mt-0.5 space-y-0.5">
        ${evs.slice(0, maxEv).map((e) => `<div class="text-[10px] px-1 py-0.5 rounded truncate ${e.holiday_moved ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}">${e.holiday_moved ? '⏰' : ''}${esc(e.title)}</div>`).join('')}
        ${evs.length > maxEv ? `<div class="text-[10px] text-slate-400 pl-1">+${evs.length - maxEv}개</div>` : ''}
      </div>
    </button>`;
  }

  const selEvents = byDay[state.cal.selected] || [];
  const selLunar = state.cal.lunar[state.cal.selected];
  const selHoliday = state.cal.holidays[state.cal.selected];
  el.innerHTML = `
    <section class="flex items-center justify-between mb-3">
      <h1 class="text-2xl font-bold">${year}년 ${month + 1}월</h1>
      <div class="flex gap-1">
        <button data-mv="-1" class="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50"><i class="fas fa-chevron-left"></i></button>
        <button data-mv="0" class="px-3 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-sm">오늘</button>
        <button data-mv="1" class="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50"><i class="fas fa-chevron-right"></i></button>
      </div>
    </section>
    <section class="flex items-center justify-between mb-3">
      <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
        <input type="checkbox" id="lunar-toggle" ${showLunar ? 'checked' : ''} class="w-4 h-4 rounded accent-indigo-600" />
        <i class="fas fa-moon text-indigo-400"></i>음력 표시
      </label>
      <button data-holiday-manage class="text-sm text-slate-500 hover:text-indigo-600"><i class="fas fa-flag mr-1"></i>휴일 관리</button>
    </section>
    <section class="bg-white rounded-2xl border border-slate-100 p-2 sm:p-4 mb-5">
      <div class="grid grid-cols-7 text-center text-xs font-semibold text-slate-400 mb-2">
        ${['일','월','화','수','목','금','토'].map((d, i) => `<div class="${i === 0 ? 'text-rose-400' : i === 6 ? 'text-indigo-400' : ''}">${d}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7 gap-1">${cells}</div>
      ${(showLunar || Object.keys(state.cal.holidays).length) ? `<p class="text-[10px] text-slate-400 mt-2 text-center"><i class="fas fa-circle text-rose-400"></i> 빨강=휴일/일요일 · 음력은 우측 상단 작게 표시</p>` : ''}
    </section>
    <section class="flex items-center justify-between mb-3">
      <h2 class="font-bold">
        <i class="fas fa-calendar-day text-indigo-500 mr-2"></i>${state.cal.selected}
        ${selLunar ? `<span class="text-xs font-normal text-slate-400 ml-1">음력 ${esc(selLunar.lunar.monthName)} ${esc(selLunar.lunar.dayName)}</span>` : ''}
        ${selHoliday ? `<span class="text-xs font-normal text-rose-500 ml-1"><i class="fas fa-flag"></i> ${esc(selHoliday)}</span>` : ''}
        <span class="text-slate-400 text-sm">(${selEvents.length})</span>
      </h2>
      <button data-add-day class="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-1"></i>추가</button>
    </section>
    <section class="space-y-2">
      ${selEvents.length ? selEvents.map((e) => eventCard(e)).join('') : `<p class="text-slate-400 text-sm py-6 text-center bg-white rounded-2xl border border-dashed border-slate-200">이 날의 일정이 없습니다.</p>`}
    </section>
    <section class="mt-5">
      <button data-recurring class="text-sm text-slate-500 hover:text-indigo-600"><i class="fas fa-rotate mr-1"></i>반복 일정 관리</button>
    </section>`;

  $$('[data-mv]', el).forEach((b) => b.addEventListener('click', () => {
    const mv = Number(b.dataset.mv);
    if (mv === 0) { state.cal.year = new Date().getFullYear(); state.cal.month = new Date().getMonth(); state.cal.selected = todayStr(); }
    else { state.cal.month += mv; if (state.cal.month < 0) { state.cal.month = 11; state.cal.year--; } if (state.cal.month > 11) { state.cal.month = 0; state.cal.year++; } }
    render();
  }));
  $('#lunar-toggle', el).addEventListener('change', async (e) => {
    state.settings = { ...(state.settings || {}), lunar_display: e.target.checked };
    try { await api('/settings', { method: 'PUT', body: { lunar_display: e.target.checked } }); } catch (err) { /* */ }
    render();
  });
  $('[data-holiday-manage]', el).addEventListener('click', () => holidayModal(state.cal.year));
  $$('[data-day]', el).forEach((b) => b.addEventListener('click', () => { state.cal.selected = b.dataset.day; render(); }));
  $('[data-add-day]', el).addEventListener('click', () => eventModal(null, state.cal.selected));
  $$('[data-edit-ev]', el).forEach((b) => b.addEventListener('click', () => {
    const ev = state.cal.events.find((x) => x.id === Number(b.dataset.editEv));
    eventModal(ev);
  }));
  $$('[data-del-ev]', el).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('일정을 삭제할까요?')) return;
    await api('/calendar/events/' + b.dataset.delEv, { method: 'DELETE' });
    toast('삭제되었습니다.', 'success'); render();
  }));
  $$('[data-map-ev]', el).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const ev = state.cal.events.find((x) => x.id === Number(b.dataset.mapEv));
    if (ev) openMapModal(ev);
  }));
  $$('[data-link-ev]', el).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const ev = state.cal.events.find((x) => x.id === Number(b.dataset.linkEv));
    if (ev) openLink(ev.link_url);
  }));
  $('[data-recurring]', el).addEventListener('click', recurringModal);
};

function eventCard(e) {
  const hasLoc = !!(e.location && e.location.trim());
  const hasLink = !!(e.link_url && e.link_url.trim());
  return `<div class="bg-white rounded-xl border border-slate-100 p-4 flex items-start justify-between group">
    <div class="flex gap-3">
      <div class="w-1 rounded-full ${e.holiday_moved ? 'bg-amber-400' : 'bg-indigo-500'} self-stretch" style="min-height:36px"></div>
      <div>
        <p class="font-semibold">${esc(e.title)} ${e.is_utility ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 align-middle">공과금</span>' : ''} ${e.recur_basis === 'LUNAR' && ['MONTHLY', 'YEARLY'].includes(e.recurrence) ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 align-middle"><i class="fas fa-moon"></i> 음력반복</span>' : ''}</p>
        <p class="text-xs text-slate-500 mt-0.5"><i class="far fa-clock"></i> ${fmtTime(e.start_time)}${e.end_time && fmtTime(e.end_time) !== fmtTime(e.start_time) ? ' ~ ' + fmtTime(e.end_time) : ''}${e.location ? ' · ' + esc(e.location) : ''}</p>
        ${hasLoc || hasLink ? `<div class="flex flex-wrap gap-1.5 mt-2">
          ${hasLoc ? `<button data-map-ev="${e.id}" class="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium"><i class="${mapIcon()} mr-1"></i>${mapLabel()}</button>` : ''}
          ${hasLink ? `<button data-link-ev="${e.id}" class="text-[11px] px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-medium"><i class="fas fa-arrow-up-right-from-square mr-1"></i>링크 열기</button>` : ''}
        </div>` : ''}
        ${e.holiday_moved ? `<p class="text-[11px] text-amber-600 mt-1"><i class="fas fa-arrow-right-arrow-left"></i> ${esc(e.holiday_moved.reason)} (원래 ${e.holiday_moved.from})</p>` : ''}
        ${e.holiday_name ? `<p class="text-[11px] text-rose-500 mt-0.5"><i class="fas fa-flag"></i> ${esc(e.holiday_name)}</p>` : ''}
        ${e.tags?.length ? `<div class="flex gap-1 mt-1.5">${e.tags.map((t) => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
      <button data-edit-ev="${e.id}" class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500"><i class="fas fa-pen text-xs"></i></button>
      <button data-del-ev="${e.id}" class="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-500"><i class="fas fa-trash text-xs"></i></button>
    </div>
  </div>`;
}

/* ---------- 지도 · 링크 연동 ---------- */
function mapLabel() { return (state.settings?.default_map === 'kakao') ? '카카오맵' : '네이버지도'; }
function mapIcon() { return (state.settings?.default_map === 'kakao') ? 'fas fa-map-location-dot' : 'fas fa-map'; }

// 주소 → 지도 검색 URL (사용자 선택 지도)
function mapUrlFor(address, provider) {
  const q = encodeURIComponent(address);
  return provider === 'kakao'
    ? `https://map.kakao.com/?q=${q}`
    : `https://map.naver.com/v5/search/${q}`;
}

// 지도 열기 모달 (네이버/카카오 선택 가능)
function openMapModal(ev) {
  const addr = (ev.location || '').trim();
  if (!addr) return;
  const pref = state.settings?.default_map || 'naver';
  openModal('지도에서 열기', `
    <p class="text-sm text-slate-500 mb-1">주소</p>
    <p class="font-medium mb-4">${esc(addr)}</p>
    <p class="text-xs text-slate-400 mb-2">원하는 지도 앱을 선택하세요. (기본값은 설정에서 변경 가능)</p>
    <div class="grid gap-2">
      <a href="${mapUrlFor(addr, 'naver')}" target="_blank" rel="noopener" class="flex items-center gap-3 px-4 py-3 rounded-xl border ${pref === 'naver' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}">
        <i class="fas fa-map text-emerald-600 text-lg"></i>
        <span class="font-medium">네이버 지도로 열기</span>
        ${pref === 'naver' ? '<span class="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">기본</span>' : ''}
      </a>
      <a href="${mapUrlFor(addr, 'kakao')}" target="_blank" rel="noopener" class="flex items-center gap-3 px-4 py-3 rounded-xl border ${pref === 'kakao' ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}">
        <i class="fas fa-map-location-dot text-amber-500 text-lg"></i>
        <span class="font-medium">카카오맵으로 열기</span>
        ${pref === 'kakao' ? '<span class="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-white">기본</span>' : ''}
      </a>
    </div>`);
}

// 링크 열기 (사용자 설정 방식 반영)
function openLink(url) {
  let u = String(url || '').trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const mode = state.settings?.default_link_open || 'system';
  if (mode === 'inapp') {
    openModal('링크 미리보기', `
      <p class="text-xs text-slate-400 break-all mb-3">${esc(u)}</p>
      <iframe src="${esc(u)}" class="w-full h-[60vh] rounded-xl border border-slate-200"></iframe>
      <p class="text-[11px] text-slate-400 mt-2">사이트가 미리보기를 차단하면 새 탭으로 여세요.</p>`,
      `<a href="${esc(u)}" target="_blank" rel="noopener" class="px-4 py-2 rounded-xl bg-indigo-600 text-white">새 탭으로 열기</a>`);
    return;
  }
  // system | newtab → OS 기본 브라우저/앱 새 탭
  window.open(u, '_blank', 'noopener');
}

async function eventModal(ev, dayStr) {
  const tags = await loadTags();
  const d = dayStr || (ev ? fmtDate(ev.start_time) : todayStr());
  const isUtil = !!ev?.is_utility;
  openModal(ev ? '일정 수정' : '일정 추가', `
    <form id="ev-form" class="space-y-3">
      <input name="title" required placeholder="제목" value="${esc(ev?.title || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <textarea name="description" placeholder="설명" rows="2" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">${esc(ev?.description || '')}</textarea>
      <div class="grid grid-cols-2 gap-3">
        <input type="date" name="date" value="${d}" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <input type="time" name="start" value="${ev ? fmtTime(ev.start_time) : '09:00'}" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input type="time" name="end" value="${ev ? fmtTime(ev.end_time) : '10:00'}" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <input name="location" placeholder="장소" value="${esc(ev?.location || '')}" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
      <input name="link_url" type="url" placeholder="링크 (URL) — 화상회의·예약 페이지 등" value="${esc(ev?.link_url || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <div class="grid grid-cols-2 gap-3">
        <select name="reminder" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
          ${[[0,'알림 없음'],[15,'15분 전'],[60,'1시간 전'],[1440,'1일 전']].map(([v, l]) => `<option value="${v}" ${ev?.reminder_time === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select name="recurrence" class="px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
          ${[['NONE','반복 없음'],['DAILY','매일'],['WEEKLY','매주'],['MONTHLY','매월'],['YEARLY','매년']].map(([v, l]) => `<option value="${v}" ${ev?.recurrence === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div id="recur-basis-box" class="${['MONTHLY','YEARLY'].includes(ev?.recurrence) ? '' : 'hidden'}">
        <label class="text-xs text-slate-500 mb-1 block">반복 기준 (매월·매년 반복 시)</label>
        <div class="flex bg-slate-100 rounded-xl p-1 text-sm">
          <button type="button" data-basis="SOLAR" class="flex-1 py-2 rounded-lg ${ev?.recur_basis !== 'LUNAR' ? 'bg-white shadow font-medium' : 'text-slate-500'}"><i class="fas fa-sun mr-1 text-amber-500"></i>양력</button>
          <button type="button" data-basis="LUNAR" class="flex-1 py-2 rounded-lg ${ev?.recur_basis === 'LUNAR' ? 'bg-white shadow font-medium' : 'text-slate-500'}"><i class="fas fa-moon mr-1 text-indigo-500"></i>음력</button>
        </div>
        <input type="hidden" name="recur_basis" value="${ev?.recur_basis === 'LUNAR' ? 'LUNAR' : 'SOLAR'}" />
        <p class="text-[11px] text-slate-400 mt-1"><i class="fas fa-circle-info mr-0.5"></i>음력 기준: 음력 생일·명절처럼 음력 같은 날짜가 매년 양력으로 환산되어 표시됩니다.</p>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer bg-slate-50 rounded-xl px-3 py-2.5">
        <input type="checkbox" name="is_utility" id="util-check" ${isUtil ? 'checked' : ''} class="w-4 h-4 rounded accent-indigo-600" />
        <i class="fas fa-file-invoice-dollar text-amber-500"></i>공과금 납부일 (휴일 자동 조정)
      </label>
      <div id="holiday-rule-box" class="${isUtil ? '' : 'hidden'}">
        <label class="text-xs text-slate-500 mb-1 block">휴일(공휴일·주말) 겹칠 때 처리 방식</label>
        <select name="holiday_rule" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
          ${[['NONE','그대로 표시'],['BEFORE','휴일 직전 평일로 이동'],['AFTER','휴일 다음날(평일)로 이동'],['POSTPONE','자동 이월 (다음 평일)']].map(([v, l]) => `<option value="${v}" ${ev?.holiday_rule === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <p class="text-[11px] text-slate-400 mt-1">커스텀 휴일도 자동 반영됩니다.</p>
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">태그</label>
        <div class="flex flex-wrap gap-1.5" id="tag-pick">
          ${tags.map((t) => `<button type="button" data-tag="${esc(t.name)}" class="tag-chip text-xs px-2.5 py-1 rounded-full border ${ev?.tags?.includes(t.name) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">${esc(t.name)}</button>`).join('') || '<span class="text-xs text-slate-400">태그 없음 — 설정에서 추가하세요</span>'}
        </div>
      </div>
    </form>`,
    `<button data-close class="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">취소</button>
     <button id="ev-save" class="px-5 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700">저장</button>`);

  const picked = new Set(ev?.tags || []);
  $$('#tag-pick [data-tag]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (picked.has(t)) { picked.delete(t); b.className = 'tag-chip text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-600'; }
    else { picked.add(t); b.className = 'tag-chip text-xs px-2.5 py-1 rounded-full border bg-indigo-600 text-white border-indigo-600'; }
  }));
  $('#util-check').addEventListener('change', (e) => { $('#holiday-rule-box').classList.toggle('hidden', !e.target.checked); });
  // 반복 주기 변경 시 → 반복 기준(양력/음력) 박스 노출 (매월·매년만 해당)
  $('#ev-form [name="recurrence"]').addEventListener('change', (e) => {
    $('#recur-basis-box').classList.toggle('hidden', !['MONTHLY', 'YEARLY'].includes(e.target.value));
  });
  // 양력/음력 기준 토글
  $$('#recur-basis-box [data-basis]').forEach((b) => b.addEventListener('click', () => {
    $('#ev-form [name="recur_basis"]').value = b.dataset.basis;
    $$('#recur-basis-box [data-basis]').forEach((x) => x.className = 'flex-1 py-2 rounded-lg ' + (x.dataset.basis === b.dataset.basis ? 'bg-white shadow font-medium' : 'text-slate-500'));
  }));
  $('#ev-save').addEventListener('click', async () => {
    const f = $('#ev-form');
    if (!f.title.value.trim()) return toast('제목을 입력하세요.', 'warn');
    const start = `${f.date.value}T${f.start.value}:00`;
    const end = `${f.date.value}T${f.end.value}:00`;
    const monthlyOrYearly = ['MONTHLY', 'YEARLY'].includes(f.recurrence.value);
    const body = {
      title: f.title.value.trim(), description: f.description.value,
      start_time: start, end_time: end, location: f.location.value, link_url: f.link_url.value.trim(),
      reminder_time: Number(f.reminder.value), recurrence: f.recurrence.value,
      recur_basis: monthlyOrYearly ? f.recur_basis.value : 'SOLAR',
      is_utility: f.is_utility.checked, holiday_rule: f.is_utility.checked ? f.holiday_rule.value : 'NONE',
      tags: [...picked]
    };
    try {
      if (ev) await api('/calendar/events/' + ev.id, { method: 'PUT', body });
      else {
        const cf = await api('/calendar/check-conflicts', { method: 'POST', body: { start_time: start, end_time: end } });
        if (cf.has_conflict && !confirm(`동시간대 일정이 ${cf.conflict_count}개 있습니다. 계속 저장할까요?`)) return;
        await api('/calendar/events', { method: 'POST', body });
      }
      closeModal(); toast('저장되었습니다.', 'success'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function holidayModal(year) {
  const data = await api('/calendar/holidays?year=' + year);
  const customs = data.holidays.filter((h) => h.kind === 'CUSTOM');
  const builtins = data.holidays.filter((h) => h.kind !== 'CUSTOM');
  openModal(`휴일 관리 · ${year}년`, `
    <p class="text-xs text-slate-500 mb-3">여기서 추가한 휴일은 공과금 납부일 자동 조정에 함께 반영됩니다.</p>
    <form id="hol-add" class="flex gap-2 mb-4">
      <input type="date" name="date" required class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <input name="name" required placeholder="휴일명" class="flex-[1.4] px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <button class="px-4 rounded-xl bg-indigo-600 text-white"><i class="fas fa-plus"></i></button>
    </form>
    <div class="mb-4">
      <p class="text-xs font-semibold text-slate-500 mb-2">내가 추가한 휴일 (${customs.length})</p>
      ${customs.length ? `<ul class="divide-y divide-slate-100 rounded-xl border border-slate-100">${customs.map((h) => `
        <li class="py-2.5 px-3 flex items-center justify-between">
          <div><p class="text-sm font-medium">${esc(h.name)}</p><p class="text-xs text-slate-400">${h.date}</p></div>
          <button data-del-h="${h.id}" class="text-rose-500 text-sm hover:bg-rose-50 rounded-lg px-2 py-1"><i class="fas fa-trash"></i></button>
        </li>`).join('')}</ul>` : `<p class="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl">추가한 휴일이 없습니다.</p>`}
    </div>
    <div>
      <p class="text-xs font-semibold text-slate-500 mb-2">공휴일 · 대체공휴일 (${builtins.length})</p>
      <ul class="divide-y divide-slate-100 rounded-xl border border-slate-100 max-h-64 overflow-y-auto">
        ${builtins.map((h) => `<li class="py-2 px-3 flex items-center justify-between">
          <span class="text-sm">${esc(h.name)}</span>
          <span class="text-xs ${h.kind === 'SUBSTITUTE' ? 'text-amber-600' : 'text-slate-400'}">${h.date}${h.kind === 'SUBSTITUTE' ? ' · 대체' : ''}</span>
        </li>`).join('')}
      </ul>
    </div>`);
  $('#hol-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/calendar/holidays', { method: 'POST', body: { date: f.date.value, name: f.name.value } });
      state.holidayCache = {};
      toast('휴일이 추가되었습니다.', 'success');
      holidayModal(year); render();
    } catch (err) { toast(err.message, 'error'); }
  });
  $$('[data-del-h]').forEach((b) => b.addEventListener('click', async () => {
    await api('/calendar/holidays/' + b.dataset.delH, { method: 'DELETE' });
    state.holidayCache = {};
    toast('삭제되었습니다.', 'success');
    holidayModal(year); render();
  }));
}

async function recurringModal() {
  const data = await api('/calendar/recurring-list');
  openModal('반복 일정 관리', `
    ${data.items.length ? `<ul class="divide-y divide-slate-100">${data.items.map((e) => `
      <li class="py-3 flex items-center justify-between">
        <div>
          <p class="font-medium text-sm">${esc(e.title)} ${e.is_utility ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">공과금</span>' : ''}</p>
          <p class="text-xs text-slate-500">${e.recurrence} · ${fmtDate(e.start_time)} ${fmtTime(e.start_time)}${e.is_utility && e.holiday_rule !== 'NONE' ? ' · 휴일: ' + ({ BEFORE: '직전 평일', AFTER: '다음 평일', POSTPONE: '자동 이월' }[e.holiday_rule] || '') : ''}</p>
        </div>
        <button data-del-r="${e.id}" class="text-rose-500 text-sm hover:bg-rose-50 rounded-lg px-2 py-1"><i class="fas fa-trash"></i></button>
      </li>`).join('')}</ul>`
      : `<p class="text-slate-400 text-sm text-center py-6">반복 일정이 없습니다.</p>`}`);
  $$('[data-del-r]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 반복 일정을 삭제할까요?')) return;
    await api('/calendar/events/' + b.dataset.delR, { method: 'DELETE' });
    toast('삭제되었습니다.', 'success'); recurringModal(); render();
  }));
}

async function loadTags() {
  if (state.cache.tags.length) return state.cache.tags;
  try { const d = await api('/tags'); state.cache.tags = d.items; } catch (e) { /* */ }
  return state.cache.tags;
}

/* ---------- 체크리스트 ---------- */
state.cl = { labels: [], filter: null, showCompleted: false, showAllDone: false, completedLimit: 10 };
VIEWS.checklist = async (el) => {
  const q = state.cl.filter ? `?labels=${encodeURIComponent(state.cl.filter)}` : '';
  const [data, stats] = await Promise.all([api('/checklist' + q), api('/checklist/labels/stats')]);
  const labels = stats.labels;
  const showDone = !!state.cl.showCompleted;

  // 완료 항목: 최근 완료일(completed_at) 내림차순 정렬
  const completedAll = [...data.completed.items].sort((a, b) => toMs(b.completed_at) - toMs(a.completed_at));
  // 기본은 최근 1개월 이내만 노출, '전체 보기' 시 전 기간
  const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const completedRecent = completedAll.filter((i) => toMs(i.completed_at) >= oneMonthAgo);
  const olderCount = completedAll.length - completedRecent.length;
  // 기본(최근 1개월)은 10개씩 끊어 더보기 / 전체 보기는 한 번에 전부 노출
  const shownCompleted = state.cl.showAllDone ? completedAll : completedRecent.slice(0, state.cl.completedLimit);
  const hasMore = !state.cl.showAllDone && completedRecent.length > shownCompleted.length;

  const completedSection = !completedAll.length ? '' : (() => {
    const scopeNote = state.cl.showAllDone
      ? '전체 기간 · 최근 완료순'
      : `최근 1개월 · 최근 완료순${olderCount ? ` · 이전 완료 ${olderCount}개 숨김` : ''}`;
    const rowsHtml = shownCompleted.length
      ? `<div class="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100 opacity-80">${shownCompleted.map((i) => clRow(i, true)).join('')}</div>`
      : `<p class="text-slate-400 text-sm text-center py-6">최근 1개월 내 완료 항목이 없습니다.</p>`;
    const btns = [
      hasMore ? `<button data-more-done class="w-full py-2.5 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50"><i class="fas fa-ellipsis mr-1"></i>더보기</button>` : '',
      (!state.cl.showAllDone && olderCount > 0) ? `<button data-show-all-done class="w-full py-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 text-sm text-indigo-600 hover:bg-indigo-50"><i class="fas fa-clock-rotate-left mr-1"></i>전체 완료 항목 보기 (${completedAll.length}개)</button>` : '',
      state.cl.showAllDone ? `<button data-toggle-all-done class="w-full py-2.5 rounded-xl border border-slate-200 text-xs text-slate-400 hover:text-indigo-600"><i class="fas fa-chevron-up mr-1"></i>최근 1개월만 보기</button>` : ''
    ].join('');
    return `<section>
      <button data-toggle-done class="w-full flex items-center justify-between px-1 mb-2 text-slate-500 hover:text-indigo-600">
        <span class="font-bold text-sm"><i class="fas fa-check-double mr-1"></i>완료 항목 (${completedAll.length})</span>
        <span class="text-xs">${showDone ? '<i class="fas fa-chevron-up mr-1"></i>접기' : '<i class="fas fa-chevron-down mr-1"></i>펼쳐보기'}</span>
      </button>
      <div class="${showDone ? '' : 'hidden'}">
        ${showDone ? `<p class="text-[11px] text-slate-400 px-1 mb-1.5">${scopeNote}</p>${rowsHtml}<div class="flex flex-col gap-2 mt-2">${btns}</div>` : ''}
      </div>
    </section>`;
  })();


  el.innerHTML = `
    <section class="mb-4">
      <h1 class="text-2xl font-bold mb-1">체크리스트</h1>
      <p class="text-slate-500 text-sm">할 일 ${data.pending.total}개 · 완료 ${data.completed.total}개</p>
    </section>

    <form id="cl-add" class="bg-white rounded-2xl border border-slate-100 p-3 mb-4 space-y-2">
      <div class="flex gap-2">
        <input name="title" placeholder="할 일을 입력하고 Enter" class="flex-1 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <button class="px-4 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"><i class="fas fa-plus"></i></button>
      </div>
      <div id="cl-desc-wrap" class="hidden">
        <textarea name="description" rows="2" placeholder="부연 설명 (선택) — 메모·참고사항을 자유롭게 적어두세요" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 text-sm"></textarea>
      </div>
      <button type="button" id="cl-desc-toggle" class="text-xs text-slate-400 hover:text-indigo-600 ml-1"><i class="fas fa-comment-dots mr-1"></i>부연 설명 추가</button>
    </form>

    ${labels.length ? `<div class="flex flex-wrap gap-1.5 mb-4">
      <button data-label="" class="text-xs px-3 py-1.5 rounded-full border ${!state.cl.filter ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">전체</button>
      ${labels.map((l) => `<button data-label="${esc(l.name)}" class="text-xs px-3 py-1.5 rounded-full border ${state.cl.filter === l.name ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">${esc(l.name)} <span class="opacity-60">${l.completed}/${l.total}</span></button>`).join('')}
    </div>` : ''}

    <section class="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100 mb-5">
      ${data.pending.items.length ? data.pending.items.map((i) => clRow(i, false)).join('')
        : `<p class="text-slate-400 text-sm text-center py-8">남은 할 일이 없습니다 🎉</p>`}
    </section>

    ${completedSection}`;

  // 부연 설명 토글
  const descToggle = $('#cl-desc-toggle', el);
  if (descToggle) descToggle.addEventListener('click', () => {
    const w = $('#cl-desc-wrap', el);
    w.classList.toggle('hidden');
    if (!w.classList.contains('hidden')) $('textarea[name="description"]', el).focus();
  });

  $('#cl-add', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = e.target.title.value.trim();
    if (!title) return;
    await api('/checklist', {
      method: 'POST',
      body: { title, description: e.target.description.value.trim(), labels: state.cl.filter ? [state.cl.filter] : [] }
    });
    toast('추가되었습니다.', 'success'); render();
  });
  $$('[data-label]', el).forEach((b) => b.addEventListener('click', () => { state.cl.filter = b.dataset.label || null; render(); }));
  const doneToggle = $('[data-toggle-done]', el);
  if (doneToggle) doneToggle.addEventListener('click', () => { state.cl.showCompleted = !state.cl.showCompleted; render(); });
  const moreDone = $('[data-more-done]', el);
  if (moreDone) moreDone.addEventListener('click', () => { state.cl.completedLimit += 10; render(); });
  const showAllDone = $('[data-show-all-done]', el);
  if (showAllDone) showAllDone.addEventListener('click', () => { state.cl.showAllDone = true; state.cl.completedLimit = 10; render(); });
  const toggleAllDone = $('[data-toggle-all-done]', el);
  if (toggleAllDone) toggleAllDone.addEventListener('click', () => { state.cl.showAllDone = false; state.cl.completedLimit = 10; render(); });
  bindClRows(el);
};

function clRow(i, done) {
  const hasDesc = !!(i.description && i.description.trim());
  const descId = `cl-desc-${i.id}`;
  return `<div class="px-4 py-3 group">
    <div class="flex items-start gap-3">
      <button data-toggle="${i.id}" class="mt-0.5 w-6 h-6 rounded-full border-2 grid place-items-center shrink-0 ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-indigo-500'}">
        ${done ? '<i class="fas fa-check text-xs"></i>' : ''}
      </button>
      <div class="flex-1 min-w-0">
        <p class="text-sm ${done ? 'line-through text-slate-400' : 'font-medium'}">${esc(i.title)}</p>
        ${hasDesc ? `<p class="text-xs text-slate-500 mt-1 ${done ? 'whitespace-pre-wrap' : 'hidden'}" id="${descId}">${esc(i.description)}</p>
          ${done ? '' : `<button data-desc-toggle="${i.id}" class="text-[11px] text-indigo-500 hover:text-indigo-700 mt-0.5"><i class="fas fa-comment-dots mr-1"></i>부연 설명</button>`}` : ''}
        <div class="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
          <span class="text-[10px] text-slate-400"><i class="far fa-calendar-plus mr-0.5"></i>등록 ${fmtDate(i.created_at)}</span>
          ${i.labels?.length ? i.labels.map((l) => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${esc(l)}</span>`).join('') : ''}
          ${done && i.completed_at ? `<span class="text-[10px] text-emerald-500">${relTime(i.completed_at)} 완료</span>` : ''}
          ${i.recurrence && i.recurrence !== 'NONE' ? `<span class="text-[10px] text-indigo-500"><i class="fas fa-rotate"></i> ${i.recurrence}</span>` : ''}
        </div>
      </div>
      <div class="flex gap-1 shrink-0">
        <button data-edit-cl="${i.id}" class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100"><i class="fas fa-pen text-xs"></i></button>
        <button data-del-cl="${i.id}" class="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-400 opacity-0 group-hover:opacity-100"><i class="fas fa-trash text-xs"></i></button>
      </div>
    </div>
  </div>`;
}

function bindClRows(el) {
  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/checklist/${b.dataset.toggle}/complete`, { method: 'PATCH' });
    if (r.regenerated) toast('반복 항목이 자동 생성되었습니다.', 'success');
    render();
  }));
  $$('[data-del-cl]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('삭제할까요?')) return;
    await api('/checklist/' + b.dataset.delCl, { method: 'DELETE' });
    toast('삭제되었습니다.', 'success'); render();
  }));
  $$('[data-edit-cl]', el).forEach((b) => b.addEventListener('click', () => editChecklist(Number(b.dataset.editCl))));
  $$('[data-desc-toggle]', el).forEach((b) => b.addEventListener('click', () => {
    const d = $(`#cl-desc-${b.dataset.descToggle}`, el);
    if (d) d.classList.toggle('hidden');
  }));
}

async function editChecklist(id) {
  const data = await api('/checklist');
  const all = [...data.pending.items, ...data.completed.items];
  const i = all.find((x) => x.id === id);
  if (!i) return;
  const tags = await loadTags();
  openModal('할 일 수정', `
    <form id="cl-edit" class="space-y-3">
      <input name="title" value="${esc(i.title)}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <div>
        <label class="text-xs text-slate-500 mb-1 block">부연 설명 (선택)</label>
        <textarea name="description" rows="3" placeholder="메모·참고사항을 자유롭게 적어두세요" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 text-sm">${esc(i.description || '')}</textarea>
      </div>
      <select name="recurrence" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
        ${[['NONE','반복 없음'],['DAILY','매일'],['WEEKLY','매주'],['MONTHLY','매월']].map(([v, l]) => `<option value="${v}" ${i.recurrence === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <div><label class="text-xs text-slate-500 mb-1 block">라벨</label>
        <div class="flex flex-wrap gap-1.5" id="cl-labels">${tags.map((t) => `<button type="button" data-lt="${esc(t.name)}" class="lt text-xs px-2.5 py-1 rounded-full border ${i.labels?.includes(t.name) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">${esc(t.name)}</button>`).join('') || '<span class="text-xs text-slate-400">설정에서 태그를 추가하세요</span>'}</div>
      </div>
    </form>`,
    `<button data-close class="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">취소</button>
     <button id="cl-save" class="px-5 py-2 rounded-xl bg-indigo-600 text-white font-medium">저장</button>`);
  const picked = new Set(i.labels || []);
  $$('.lt').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.lt;
    if (picked.has(t)) { picked.delete(t); b.className = 'lt text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-600'; }
    else { picked.add(t); b.className = 'lt text-xs px-2.5 py-1 rounded-full border bg-indigo-600 text-white border-indigo-600'; }
  }));
  $('#cl-save').addEventListener('click', async () => {
    const f = $('#cl-edit');
    await api('/checklist/' + id, { method: 'PUT', body: { title: f.title.value, description: f.description.value, recurrence: f.recurrence.value, labels: [...picked] } });
    closeModal(); toast('저장되었습니다.', 'success'); render();
  });
}

/* ---------- 메모 ---------- */
state.note = { filter: 'ALL', search: '' };

/* --- 메모 HTML 유틸 (리치텍스트 + 네이버 블로그 호환 복사) --- */
// 저장된 content → 표시/편집용 HTML (평문이면 줄바꿈만 변환)
function contentToHTML(content) {
  const s = String(content ?? '');
  if (!/<[a-z][\s\S]*>/i.test(s)) return esc(s).replace(/\n/g, '<br>');
  // HTML 본문에 섞인 리터럴 줄바꿈도 표시·복사 시 유지되도록 <br> 로 변환
  // 단, 태그 사이(> ... <)의 순수 공백 줄바꿈은 제거하고 그 외는 <br> 로 바꾼다.
  return sanitizeHTML(s).replace(/\n+/g, (m, off, str) => {
    const before = str[off - 1] || '';
    const after = str[off + m.length] || '';
    return (before === '>' && after === '<') ? '' : '<br>';
  });
}
// content → 순수 텍스트 (검색/미리보기/플레인 복사)
function contentToText(content) {
  const s = String(content ?? '');
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  const d = document.createElement('div');
  d.innerHTML = sanitizeHTML(s);
  return d.textContent || '';
}
// 간이 HTML 살균 — script/iframe/이벤트핸들러/javascript: URL 제거
function sanitizeHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html ?? '');
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,textarea,select,button').forEach((n) => n.remove());
  const allowed = new Set(['B','STRONG','I','EM','U','S','STRIKE','DEL','BR','P','DIV','SPAN','H1','H2','H3','H4','H5','H6','UL','OL','LI','A','BLOCKQUOTE','CODE','PRE','HR','IMG','MARK','FONT','SUB','SUP']);
  Array.from(tpl.content.querySelectorAll('*')).forEach((el) => {
    if (!allowed.has(el.tagName)) {
      const p = el.parentNode;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      return;
    }
    Array.from(el.attributes).forEach((a) => {
      const an = a.name.toLowerCase();
      if (an.startsWith('on')) el.removeAttribute(a.name);
      if ((an === 'href' || an === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A' && el.getAttribute('href')) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
  });
  return tpl.innerHTML;
}
// 클래스 제거 + 계산된 스타일을 인라인화 → 네이버 블로그 등에 붙여넣어도 스타일 유지
// 부모와 다른(=사용자가 실제 지정한) 속성만 인라인화하고, 다크모드 영향은 라이트 기준으로 무력화한다.
const INLINE_PROPS = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line', 'text-align'];
function inlineStyleHTML(srcHtml) {
  const wrap = document.createElement('div');
  // 라이트 기준 색/배경을 명시해 다크모드에서 흰 글씨가 복사되는 문제 방지
  wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:760px;background:#ffffff;color:#1f2937;';
  document.body.appendChild(wrap);
  wrap.innerHTML = contentToHTML(srcHtml);
  Array.from(wrap.querySelectorAll('*')).forEach((el) => {
    const cs = getComputedStyle(el);
    const pcs = el.parentElement ? getComputedStyle(el.parentElement) : getComputedStyle(wrap);
    for (const p of INLINE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (v === pcs.getPropertyValue(p)) continue; // 부모와 동일 = 상속값 → 생략
      if (['normal', 'none', 'auto', 'start', 'left', 'rgba(0, 0, 0, 0)', 'transparent'].includes(v)) continue;
      el.style.setProperty(p, v);
    }
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      // Tailwind 프리플라이트가 ul/ol 을 list-style:none·padding:0 으로 리셋하므로
      // 붙여넣기 대상(네이버 블로그 등)에서 마커가 보이도록 표준값을 명시
      el.style.setProperty('list-style-type', el.tagName === 'OL' ? 'decimal' : 'disc');
      if (!el.style.getPropertyValue('padding-left')) el.style.setProperty('padding-left', '1.4em');
      if (!el.style.getPropertyValue('margin')) el.style.setProperty('margin', '6px 0');
    }
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  const out = wrap.innerHTML;
  document.body.removeChild(wrap);
  return out;
}

VIEWS.notes = async (el) => {
  const qs = [];
  if (state.note.filter !== 'ALL') qs.push('note_type=' + state.note.filter);
  if (state.note.search) qs.push('search=' + encodeURIComponent(state.note.search));
  const data = await api('/notes' + (qs.length ? '?' + qs.join('&') : ''));
  const types = [['ALL','전체','fa-layer-group'],['TEXT','텍스트','fa-align-left'],['LINK','링크','fa-link'],['VOICE','음성','fa-microphone'],['IMAGE','이미지','fa-image']];

  el.innerHTML = `
    <section class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">메모</h1>
      <button data-add-note class="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-1"></i>메모</button>
    </section>
    <div class="flex gap-2 mb-4 overflow-x-auto pb-1">
      ${types.map(([v, l, ic]) => `<button data-type="${v}" class="shrink-0 text-xs px-3 py-2 rounded-xl border ${state.note.filter === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600'}"><i class="fas ${ic} mr-1"></i>${l}</button>`).join('')}
    </div>
    <input id="note-search" value="${esc(state.note.search)}" placeholder="메모 검색..." class="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 mb-4" />
    <section class="grid sm:grid-cols-2 gap-3">
      ${data.items.length ? data.items.map((n) => noteCard(n)).join('')
        : `<p class="text-slate-400 text-sm text-center py-10 col-span-2">메모가 없습니다. 첫 메모를 작성해 보세요!</p>`}
    </section>`;

  $('[data-add-note]', el).addEventListener('click', () => noteModal(null));
  $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => { state.note.filter = b.dataset.type; render(); }));
  let t;
  $('#note-search', el).addEventListener('input', (e) => { clearTimeout(t); state.note.search = e.target.value; t = setTimeout(() => { render(); }, 400); });
  // 카드 클릭 → 상세 보기 (수정/삭제 버튼 클릭은 제외)
  $$('[data-view-note]', el).forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit-note],[data-del-note],[data-open-link]')) return;
    const n = data.items.find((x) => x.id === Number(card.dataset.viewNote));
    if (n) openNoteDetail(n);
  }));
  $$('[data-edit-note]', el).forEach((b) => b.addEventListener('click', async () => {
    const n = data.items.find((x) => x.id === Number(b.dataset.editNote));
    noteModal(n);
  }));
  $$('[data-del-note]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('메모를 삭제할까요?')) return;
    await api('/notes/' + b.dataset.delNote, { method: 'DELETE' });
    toast('삭제되었습니다.', 'success'); render();
  }));
};

const NOTE_META = { TEXT: ['fa-align-left', 'indigo'], LINK: ['fa-link', 'sky'], VOICE: ['fa-microphone', 'amber'], IMAGE: ['fa-image', 'emerald'] };
function noteCard(n) {
  const [ic, c] = NOTE_META[n.note_type] || NOTE_META.TEXT;
  const preview = n.note_type === 'LINK' ? (n.og_desc || n.link_url || '') : contentToText(n.content).slice(0, 160);
  return `<div data-view-note="${n.id}" class="bg-white rounded-2xl border border-slate-100 p-4 card relative group flex flex-col cursor-pointer">
    <div class="flex items-start gap-2 mb-2">
      <span class="w-7 h-7 rounded-lg bg-${c}-100 text-${c}-600 grid place-items-center text-xs"><i class="fas ${ic}"></i></span>
      <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 self-center">${n.note_type}</span>
      <div class="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100">
        <button data-edit-note="${n.id}" class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400"><i class="fas fa-pen text-[10px]"></i></button>
        <button data-del-note="${n.id}" class="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400"><i class="fas fa-trash text-[10px]"></i></button>
      </div>
    </div>
    <h3 class="font-semibold mb-1">${esc(n.title || '(제목 없음)')}</h3>
    ${n.link_url ? `<a data-open-link href="${esc(n.link_url)}" target="_blank" rel="noopener" class="text-xs text-sky-600 break-all hover:underline">${esc(n.og_title || n.link_url)}</a>` : ''}
    <p class="text-sm text-slate-500 clamp-3 flex-1 whitespace-pre-wrap">${esc(preview)}</p>
    <div class="flex items-center justify-between mt-2 gap-2">
      <div class="flex flex-wrap gap-1">${(n.tags || []).map((tg) => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${esc(tg)}</span>`).join('')}</div>
      <span class="text-[10px] text-slate-400 shrink-0">${relTime(n.created_at)}</span>
    </div>
  </div>`;
}

// 태그 칩 HTML
function tagChip(name, selected) {
  return `<button type="button" data-nt="${esc(name)}" class="ntag text-xs px-2.5 py-1 rounded-full border ${selected ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">${esc(name)}</button>`;
}
function setChip(btn, on) {
  btn.className = `ntag text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}`;
}

/* --- 메모 상세 보기 --- */
function openNoteDetail(n) {
  const [ic, c] = NOTE_META[n.note_type] || NOTE_META.TEXT;
  const bodyHtml = n.note_type === 'LINK'
    ? `<a href="${esc(n.link_url || '#')}" target="_blank" rel="noopener" class="text-sky-600 hover:underline break-all">${esc(n.og_title || n.link_url || '')}</a>
       ${n.og_desc ? `<p class="text-sm text-slate-500 mt-2 whitespace-pre-wrap">${esc(n.og_desc)}</p>` : ''}`
    : `<div class="note-content text-[15px] leading-relaxed" id="note-view-content">${contentToHTML(n.content)}</div>`;
  const tagHtml = (n.tags || []).length
    ? n.tags.map((tg) => `<span class="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600">${esc(tg)}<button data-del-note-tag="${esc(tg)}" class="hover:text-rose-500" title="태그 삭제"><i class="fas fa-xmark text-[10px]"></i></button></span>`).join('')
    : '<span class="text-xs text-slate-400">태그 없음</span>';
  openModal('메모 보기', `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-lg bg-${c}-100 text-${c}-600 grid place-items-center text-xs"><i class="fas ${ic}"></i></span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${n.note_type}</span>
        <span class="text-[11px] text-slate-400 ml-auto">${relTime(n.created_at)}</span>
      </div>
      <h2 class="text-lg font-bold">${esc(n.title || '(제목 없음)')}</h2>
      ${bodyHtml}
      <div class="pt-3 border-t border-slate-100">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-slate-500">태그</span>
          <button type="button" data-detail-new-tag class="text-[11px] text-indigo-600"><i class="fas fa-plus mr-0.5"></i>새 태그</button>
        </div>
        <div class="flex flex-wrap gap-1.5" id="detail-tags">${tagHtml}</div>
        <div id="detail-new-tag-wrap" class="hidden mt-2 flex gap-2">
          <input id="detail-new-tag" placeholder="새 태그 이름" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-indigo-500" />
          <button type="button" id="detail-new-tag-add" class="px-3 rounded-xl bg-indigo-600 text-white text-sm">추가</button>
        </div>
      </div>
    </div>`,
    `<button id="note-copy-text" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm" title="서식 없이 제목·본문 텍스트만 (순수 텍스트)"><i class="fas fa-align-left mr-1"></i>텍스트 복사</button>
     <button id="note-view-html" class="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm" title="붙여넣기 미리보기 + HTML 소스 (직접 선택해 복사)"><i class="fas fa-code mr-1"></i>HTML 보기/복사</button>
     <button id="note-edit" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm"><i class="fas fa-pen mr-1"></i>수정</button>
     <button id="note-detail-del" class="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-sm"><i class="fas fa-trash mr-1"></i>삭제</button>`);

  $('#note-copy-text').addEventListener('click', () => copyNote(n));
  $('#note-view-html').addEventListener('click', () => openNoteHTML(n));
  $('#note-edit').addEventListener('click', () => { closeModal(); noteModal(n); });
  $('#note-detail-del').addEventListener('click', async () => {
    if (!confirm('메모를 삭제할까요?')) return;
    await api('/notes/' + n.id, { method: 'DELETE' });
    closeModal(); toast('삭제되었습니다.', 'success'); render();
  });
  $$('[data-del-note-tag]').forEach((b) => b.addEventListener('click', () => removeNoteTag(n, b.dataset.delNoteTag)));
  $('[data-detail-new-tag]').addEventListener('click', () => $('#detail-new-tag-wrap').classList.toggle('hidden'));
  $('#detail-new-tag-add').addEventListener('click', () => {
    const name = $('#detail-new-tag').value.trim();
    if (name) addNoteTag(n, name);
  });
  $('#detail-new-tag').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const name = e.target.value.trim(); if (name) addNoteTag(n, name); }
  });
}

/* --- 메모 HTML 보기: 붙여넣기 미리보기 + HTML 소스 (직접 선택 후 Ctrl+C 로 복사) --- */
// 브라우저의 자동 클립보드 쓰기가 iframe 등에서 차단되어도, 사용자가 직접 선택해 Ctrl+C 하는
// 방식은 항상 동작한다. 그래서 '복사' 버튼 대신 '전체 선택'만 제공한다.
function openNoteHTML(n) {
  const inner = inlineStyleHTML(n.content);
  const html = `<div>${n.title ? `<h2>${esc(n.title)}</h2>` : ''}${inner}</div>`;
  openModal('HTML 보기 / 복사', `
    <div class="space-y-3">
      <p class="text-xs text-slate-500 leading-relaxed">아래 <b>미리보기</b>는 블로그에 붙여넣었을 때의 모습입니다. <b>미리보기 선택</b> 후 <b>Ctrl+C</b> (맥은 ⌘+C) 하면 서식(HTML 태그)까지 그대로 복사됩니다.</p>
      <div>
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-medium text-slate-600">미리보기 (붙여넣기 결과)</span>
          <button type="button" id="html-prev-select" class="text-[11px] text-indigo-600"><i class="fas fa-arrow-pointer mr-0.5"></i>미리보기 선택</button>
        </div>
        <div id="html-prev" class="note-content text-[15px] leading-relaxed border border-slate-200 rounded-xl p-3 bg-white">${html}</div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-medium text-slate-600">HTML 소스</span>
          <button type="button" id="html-src-select" class="text-[11px] text-indigo-600"><i class="fas fa-arrow-pointer mr-0.5"></i>소스 전체 선택</button>
        </div>
        <textarea id="html-src" readonly rows="6" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-600 outline-none focus:border-indigo-500"></textarea>
        <p id="html-src-note" class="text-[11px] text-slate-400 mt-1"></p>
      </div>
    </div>`,
    `<button data-close class="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium">확인</button>`);
  const ta = $('#html-src');
  ta.value = html;
  // 제목(h2)·래퍼(div)·<br> 은 제외하고, 실제 서식 태그(inner 기준)만 검사
  const hasMarkup = /<(b|strong|i|em|u|s|strike|del|span|h[1-6]|ul|ol|li|blockquote|a|mark|font|sub|sup|p)\b/i.test(inner);
  $('#html-src-note').textContent = hasMarkup
    ? '서식(HTML 태그)이 포함되어 있습니다. 붙여넣으면 서식이 유지됩니다.'
    : '이 메모에는 별도 서식(굵게·색·목록 등)이 없어 HTML 소스가 일반 텍스트와 동일합니다.';
  $('#html-prev-select').addEventListener('click', () => {
    const el = $('#html-prev');
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
    toast('선택했습니다. Ctrl+C 로 복사하세요.', 'success');
  });
  $('#html-src-select').addEventListener('click', () => { ta.focus(); ta.select(); toast('선택했습니다. Ctrl+C 로 복사하세요.', 'success'); });
}

async function removeNoteTag(n, tag) {
  const tags = (n.tags || []).filter((x) => x !== tag);
  await api('/notes/' + n.id, { method: 'PUT', body: { tags } });
  n.tags = tags;
  closeModal(); openNoteDetail(n);
  toast('태그가 제거되었습니다.', 'success');
}
async function addNoteTag(n, name) {
  try { await api('/tags', { method: 'POST', body: { name } }); } catch (e) { /* 이미 존재하면 무시 */ }
  state.cache.tags = [];
  const tags = Array.from(new Set([...(n.tags || []), name]));
  await api('/notes/' + n.id, { method: 'PUT', body: { tags } });
  n.tags = tags;
  closeModal(); openNoteDetail(n);
  toast('태그가 추가되었습니다.', 'success');
}

// execCommand('copy')는 iframe 의 permissions policy(clipboard-write)와 무관하게 동작한다.
// copy 이벤트를 가로채 우리가 만든 깨끗한 HTML/평문을 클립보드에 직접 써넣는다.
// → 브라우저가 선택영역의 계산된 스타일(다크모드 색, Tailwind --tw-* 변수)을 통째로 복사하는 문제를 모두 방지.
function execCopyWith(html, plain) {
  let ok = false;
  const onCopy = (e) => {
    const cb = e.clipboardData;
    if (!cb) return;
    let wroteHtml = false;
    if (html != null) {
      // 우리가 만든 깨끗한 HTML(클래스 제거·인라인화)을 우선 시도
      try { cb.setData('text/html', html); wroteHtml = !!cb.getData('text/html'); } catch (err) { wroteHtml = false; }
    }
    try { cb.setData('text/plain', plain); } catch (err) { /* */ }
    // ★ 우리가 넣은 깨끗한 HTML 이 실제로 실렸을 때만 기본 동작을 막는다.
    //   실리지 않으면(e.preventDefault() 를 안 하면) 브라우저가 holder 의 '서식 HTML' 을 스스로 복사한다.
    if (html == null || wroteHtml) e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('copy', onCopy, true);
  const holder = document.createElement('div');
  holder.setAttribute('contenteditable', 'true');
  holder.setAttribute('aria-hidden', 'true');
  // 1px 투명 요소가 브라우저(특히 WebKit)에서 복사가 더 안정적. 라이트 기준 색으로 다크모드 색 번짐 방지.
  holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;color:#1f2937;background:#ffffff;';
  // ★ 핵심: 가로채기가 실패해도 브라우저가 '서식 있는 HTML' 을 스스로 복사하도록 holder 에 서식 HTML 을 넣어 둔다.
  //   (평문만 넣으면 그 환경에서 텍스트만 복사되는 문제가 생긴다)
  if (html != null) holder.innerHTML = html; else holder.textContent = plain || ' ';
  document.body.appendChild(holder);
  const sel = window.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  try {
    holder.focus();
    const range = document.createRange();
    range.selectNodeContents(holder);
    sel.removeAllRanges();
    sel.addRange(range);
    ok = document.execCommand('copy');
  } catch (err) { ok = false; }
  document.removeEventListener('copy', onCopy, true);
  try { sel.removeAllRanges(); if (saved) sel.addRange(saved); } catch (err) { /* */ }
  document.body.removeChild(holder);
  return ok;
}

// 텍스트 복사 — 서식 없이 제목·본문만 순수 텍스트 (text/plain)
// 서식(HTML 태그)까지 복사하려면 'HTML 보기/복사' → 미리보기 선택 → Ctrl+C 를 사용한다.
// 1순위: execCommand + copy 이벤트 가로채기 → 2순위: 비동기 Clipboard API
async function copyNote(n) {
  const plain = [n.title || '', contentToText(n.content)].filter((s) => s && s.trim()).join('\n\n');
  if (execCopyWith(null, plain)) { toast('텍스트를 복사했습니다.', 'success'); return; }
  if (await copyViaClipboardAPI(null, plain)) return;
  toast('복사에 실패했습니다. 내용을 길게 눌러 직접 복사해 주세요.', 'error');
}

// 2순위 폴백: 비동기 Clipboard API (최상위 문서/HTTPS 환경)
async function copyViaClipboardAPI(html, plain) {
  try {
    if (!(navigator.clipboard && window.ClipboardItem)) return false;
    const item = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
    if (html != null) item['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(item)]);
    toast('복사되었습니다. 블로그에 붙여넣어 보세요.', 'success');
    return true;
  } catch (e) { return false; }
}

/* --- 간이 리치 텍스트 에디터 (contenteditable + execCommand) --- */
function rteToolbarHTML() {
  const btn = (cmd, icon, title, val = '') => `<button type="button" data-cmd="${cmd}" ${val ? `data-val="${val}"` : ''} title="${title}" class="rte-btn"><i class="fas ${icon}"></i></button>`;
  return `<div class="rte-toolbar flex flex-wrap items-center gap-0.5 p-1.5 border border-slate-200 rounded-t-xl bg-slate-50">
    ${btn('bold', 'fa-bold', '굵게')}${btn('italic', 'fa-italic', '기울임')}${btn('underline', 'fa-underline', '밑줄')}${btn('strikeThrough', 'fa-strikethrough', '취소선')}
    <span class="w-px h-5 bg-slate-200 mx-0.5"></span>
    <label class="rte-btn relative overflow-hidden" title="글자색"><i class="fas fa-font"></i><input type="color" id="rte-fore" value="#e11d48" class="absolute inset-0 opacity-0 cursor-pointer" /></label>
    <label class="rte-btn relative overflow-hidden" title="형광펜"><i class="fas fa-highlighter"></i><input type="color" id="rte-hilite" value="#fef08a" class="absolute inset-0 opacity-0 cursor-pointer" /></label>
    <span class="w-px h-5 bg-slate-200 mx-0.5"></span>
    ${btn('formatBlock', 'fa-heading', '제목', 'h2')}${btn('formatBlock', 'fa-paragraph', '본문', 'p')}
    ${btn('insertUnorderedList', 'fa-list-ul', '글머리 기호')}${btn('insertOrderedList', 'fa-list-ol', '번호 목록')}
    ${btn('formatBlock', 'fa-quote-right', '인용', 'blockquote')}
    <span class="w-px h-5 bg-slate-200 mx-0.5"></span>
    ${btn('link', 'fa-link', '링크')}${btn('removeFormat', 'fa-eraser', '서식 지움')}
  </div>`;
}
function initRTE(root) {
  const editor = $('#rte-editor', root);
  if (!editor) return null;
  try { document.execCommand('styleWithCSS', false, 'true'); } catch (e) { /* */ }
  let saved = null;
  const saveSel = () => { const s = window.getSelection(); if (s && s.rangeCount && editor.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => { if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); } };
  ['keyup', 'mouseup', 'input', 'focus', 'blur'].forEach((ev) => editor.addEventListener(ev, saveSel));
  const exec = (cmd, val) => { restoreSel(); editor.focus(); document.execCommand(cmd, false, val); saveSel(); };
  $$('.rte-btn[data-cmd]', root).forEach((b) => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); saveSel(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = b.dataset.cmd;
      if (cmd === 'link') { const url = prompt('링크 URL을 입력하세요', 'https://'); if (url) exec('createLink', url); return; }
      exec(cmd, b.dataset.val || null);
    });
  });
  const fore = $('#rte-fore', root), hilite = $('#rte-hilite', root);
  if (fore) { fore.addEventListener('mousedown', saveSel); fore.addEventListener('input', () => exec('foreColor', fore.value)); }
  if (hilite) { hilite.addEventListener('mousedown', saveSel); hilite.addEventListener('input', () => exec('hiliteColor', hilite.value)); }
  return editor;
}

async function noteModal(n) {
  const tags = await loadTags();
  const type = n?.note_type || 'TEXT';
  const initialContent = type === 'TEXT' ? contentToHTML(n?.content || '') : '';
  openModal(n ? '메모 수정' : '새 메모', `
    <form id="note-form" class="space-y-3">
      <div class="flex gap-1.5">
        ${[['TEXT','텍스트'],['LINK','링크']].map(([v, l]) => `<button type="button" data-ntype="${v}" class="nt flex-1 py-2 rounded-xl border text-sm ${type === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}">${l}</button>`).join('')}
        <button type="button" disabled class="flex-1 py-2 rounded-xl border border-dashed border-slate-200 text-slate-300 text-xs">음성·이미지 (Phase 2)</button>
      </div>
      <input name="title" placeholder="제목" value="${esc(n?.title || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <div id="link-field" class="${type === 'LINK' ? '' : 'hidden'}">
        <input name="link_url" placeholder="https://..." value="${esc(n?.link_url || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
      <div id="content-field" class="${type === 'LINK' ? 'hidden' : ''}">
        ${rteToolbarHTML()}
        <div id="rte-editor" contenteditable="true" data-ph="내용을 입력하세요 (드래그 후 툴바로 서식 지정)" class="rte-editor min-h-[150px] px-3.5 py-3 border border-t-0 border-slate-200 rounded-b-xl outline-none focus:border-indigo-500">${initialContent}</div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-slate-500">태그</label>
          <button type="button" data-new-tag-toggle class="text-[11px] text-indigo-600"><i class="fas fa-plus mr-0.5"></i>새 태그</button>
        </div>
        <div class="flex flex-wrap gap-1.5" id="note-tags">${tags.map((t) => tagChip(t.name, n?.tags?.includes(t.name))).join('') || '<span class="text-xs text-slate-400">태그가 없습니다. "새 태그"로 추가하세요.</span>'}</div>
        <div id="new-tag-wrap" class="hidden mt-2 flex gap-2">
          <input id="new-tag-input" placeholder="새 태그 이름" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-indigo-500" />
          <input id="new-tag-color" type="color" value="#6366f1" class="w-10 h-10 rounded-xl border border-slate-200" />
          <button type="button" id="new-tag-add" class="px-3 rounded-xl bg-indigo-600 text-white text-sm">추가</button>
        </div>
      </div>
    </form>`,
    `<button data-close class="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">취소</button>
     <button id="note-save" class="px-5 py-2 rounded-xl bg-indigo-600 text-white font-medium">저장</button>`);

  let ntype = type;
  const picked = new Set(n?.tags || []);
  const editor = initRTE(document);

  // 텍스트/링크 전환
  $$('.nt').forEach((b) => b.addEventListener('click', () => {
    ntype = b.dataset.ntype;
    $$('.nt').forEach((x) => x.className = 'nt flex-1 py-2 rounded-xl border text-sm border-slate-200 text-slate-600');
    b.className = 'nt flex-1 py-2 rounded-xl border text-sm bg-indigo-600 text-white border-indigo-600';
    $('#link-field').classList.toggle('hidden', ntype !== 'LINK');
    $('#content-field').classList.toggle('hidden', ntype === 'LINK');
  }));

  // 기존 태그 부착/해제
  $$('.ntag').forEach((b) => b.addEventListener('click', () => {
    const tg = b.dataset.nt;
    if (picked.has(tg)) { picked.delete(tg); setChip(b, false); }
    else { picked.add(tg); setChip(b, true); }
  }));

  // 새 태그 인라인 생성
  $('[data-new-tag-toggle]').addEventListener('click', () => { $('#new-tag-wrap').classList.toggle('hidden'); $('#new-tag-input').focus(); });
  const createTag = async () => {
    const name = $('#new-tag-input').value.trim();
    if (!name) return;
    try { await api('/tags', { method: 'POST', body: { name, color: $('#new-tag-color').value } }); } catch (e) { /* dup */ }
    state.cache.tags = [];
    const wrap = $('#note-tags');
    if (wrap.querySelector('.text-slate-400')) wrap.innerHTML = '';
    if (!wrap.querySelector(`[data-nt="${CSS.escape(name)}"]`)) wrap.insertAdjacentHTML('beforeend', tagChip(name, true));
    picked.add(name);
    $('#new-tag-input').value = '';
    $('#new-tag-wrap').classList.add('hidden');
    toast('태그가 추가되었습니다.', 'success');
  };
  $('#new-tag-add').addEventListener('click', createTag);
  $('#new-tag-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createTag(); } });

  $('#note-save').addEventListener('click', async () => {
    const f = $('#note-form');
    const content = editor ? sanitizeHTML(editor.innerHTML).trim() : '';
    if (ntype === 'TEXT' && !contentToText(content).trim()) return toast('내용을 입력하세요.', 'warn');
    if (ntype === 'LINK' && !f.link_url.value.trim()) return toast('링크 URL을 입력하세요.', 'warn');
    const body = { title: f.title.value, content, note_type: ntype, link_url: f.link_url?.value || null, tags: [...picked] };
    try {
      if (n) await api('/notes/' + n.id, { method: 'PUT', body });
      else await api('/notes', { method: 'POST', body });
      closeModal(); toast('저장되었습니다.', 'success'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------- 목표 ---------- */
const LEVEL_LABEL = { LIFE: '인생', YEARLY: '연간', QUARTERLY: '분기', MONTHLY: '월간', WEEKLY: '주간', DAILY: '일간' };
const SOURCE_LABEL = { CHECKLIST: '체크리스트 완료', EVENT: '일정 시간(h)', NOTE: '메모 개수', MANUAL: '수동 입력' };
state.goal = { level: 'ALL' };

VIEWS.goals = async (el) => {
  const q = state.goal.level !== 'ALL' ? '?goal_level=' + state.goal.level : '';
  const data = await api('/goals' + q);
  el.innerHTML = `
    <section class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">목표</h1>
      <button data-add-goal class="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-1"></i>목표</button>
    </section>
    <div class="flex gap-2 mb-4 overflow-x-auto pb-1">
      ${[['ALL','전체'],['LIFE','인생'],['YEARLY','연간'],['QUARTERLY','분기'],['MONTHLY','월간'],['WEEKLY','주간'],['DAILY','일간']].map(([v, l]) => `<button data-level="${v}" class="shrink-0 text-xs px-3 py-2 rounded-xl border ${state.goal.level === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600'}">${l}</button>`).join('')}
    </div>
    <section class="grid md:grid-cols-2 gap-4">
      ${data.items.length ? data.items.map((g) => goalCard(g)).join('')
        : `<p class="text-slate-400 text-sm text-center py-10 col-span-2 bg-white rounded-2xl border border-dashed border-slate-200">아직 목표가 없습니다. 목표를 추가해 보세요!</p>`}
    </section>`;

  $('[data-add-goal]', el).addEventListener('click', () => goalModal(null));
  $$('[data-level]', el).forEach((b) => b.addEventListener('click', () => { state.goal.level = b.dataset.level; render(); }));
  $$('[data-prog]', el).forEach((b) => b.addEventListener('click', () => progressModal(Number(b.dataset.prog))));
  $$('[data-edit-goal]', el).forEach((b) => b.addEventListener('click', () => {
    const g = data.items.find((x) => x.id === Number(b.dataset.editGoal)); goalModal(g);
  }));
  $$('[data-del-goal]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('목표를 삭제할까요?')) return;
    await api('/goals/' + b.dataset.delGoal, { method: 'DELETE' });
    toast('삭제되었습니다.', 'success'); render();
  }));
};

function goalCard(g) {
  const pct = g.progress_percentage ?? 0;
  const color = pct >= 100 ? 'emerald' : pct >= 97 ? 'lime' : pct > 0 ? 'indigo' : 'slate';
  const statusLabel = { COMPLETED: '충족 ✅', ALMOST: '거의 다 왔어요', IN_PROGRESS: '진행 중', NOT_STARTED: '시작 전', INSUFFICIENT: '부족' }[g.status] || g.status;
  return `<div class="bg-white rounded-2xl border border-slate-100 p-5 card">
    <div class="flex items-start justify-between mb-2">
      <div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">${LEVEL_LABEL[g.goal_level] || g.goal_level}</span>
        <h3 class="font-bold text-lg mt-1">${esc(g.title)}</h3>
        ${g.description ? `<p class="text-sm text-slate-500 clamp-2">${esc(g.description)}</p>` : ''}
      </div>
      <div class="flex gap-0.5">
        <button data-edit-goal="${g.id}" class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400"><i class="fas fa-pen text-[10px]"></i></button>
        <button data-del-goal="${g.id}" class="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400"><i class="fas fa-trash text-[10px]"></i></button>
      </div>
    </div>
    <div class="flex items-end justify-between mt-3 mb-1">
      <span class="text-2xl font-bold text-${color}-600">${pct}%</span>
      <span class="text-xs text-slate-500">${g.current_value ?? 0} / ${g.target_value} ${esc(g.measurement_unit || '')}</span>
    </div>
    <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div class="h-full rounded-full bg-${color}-500 transition-all" style="width:${Math.min(100, pct)}%"></div>
    </div>
    <div class="flex items-center justify-between mt-3">
      <span class="text-[11px] text-slate-400">${SOURCE_LABEL[g.source] || g.source}${g.source_label ? ' · ' + esc(g.source_label) : ''}</span>
      <button data-prog="${g.id}" class="text-xs text-indigo-600 hover:underline">상세 <i class="fas fa-chevron-right text-[9px]"></i></button>
    </div>
    <p class="text-[11px] mt-1.5 ${pct >= 100 ? 'text-emerald-600' : pct >= 97 ? 'text-lime-600' : 'text-slate-400'}">${statusLabel}</p>
  </div>`;
}

async function goalModal(g) {
  const tags = await loadTags();
  openModal(g ? '목표 수정' : '새 목표', `
    <form id="goal-form" class="space-y-3">
      <input name="title" required placeholder="목표 제목 (예: 영어 공부)" value="${esc(g?.title || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      <textarea name="description" rows="2" placeholder="설명" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">${esc(g?.description || '')}</textarea>
      <div class="grid grid-cols-2 gap-3">
        <select name="goal_level" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
          ${Object.entries(LEVEL_LABEL).map(([v, l]) => `<option value="${v}" ${g?.goal_level === v ? 'selected' : ''}>${l} 목표</option>`).join('')}
        </select>
        <select name="source" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500">
          ${Object.entries(SOURCE_LABEL).map(([v, l]) => `<option value="${v}" ${g?.source === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input type="number" step="0.1" name="target_value" placeholder="목표값" value="${g?.target_value ?? 10}" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <input name="measurement_unit" placeholder="단위 (회/시간/개)" value="${esc(g?.measurement_unit || '회')}" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input type="date" name="start_date" value="${g?.start_date || todayStr()}" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <input type="date" name="end_date" value="${g?.end_date || new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0,10)}" class="px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">연결 태그/라벨 (자동 진행률 소스) — 선택</label>
        <input name="source_label" placeholder="예: 영어 (비우면 전체 집계)" value="${esc(g?.source_label || '')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
      </div>
    </form>`,
    `<button data-close class="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">취소</button>
     <button id="goal-save" class="px-5 py-2 rounded-xl bg-indigo-600 text-white font-medium">저장</button>`);
  $('#goal-save').addEventListener('click', async () => {
    const f = $('#goal-form');
    if (!f.title.value.trim()) return toast('제목을 입력하세요.', 'warn');
    const body = {
      title: f.title.value, description: f.description.value, goal_level: f.goal_level.value,
      source: f.source.value, source_label: f.source_label.value || null,
      target_value: Number(f.target_value.value), measurement_unit: f.measurement_unit.value,
      start_date: f.start_date.value, end_date: f.end_date.value
    };
    try {
      if (g) await api('/goals/' + g.id, { method: 'PUT', body });
      else await api('/goals', { method: 'POST', body });
      closeModal(); toast('저장되었습니다.', 'success'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function progressModal(id) {
  const p = await api(`/goals/${id}/progress`);
  const d = p.calculation_detail || {};
  openModal('진행률 상세', `
    <div class="text-center mb-4">
      <p class="text-3xl font-bold text-indigo-600">${p.progress_percentage}%</p>
      <p class="text-sm text-slate-500 mt-1">${esc(p.title)}</p>
      <p class="text-xs text-slate-400">현재 ${p.current_value} / 목표 ${p.target_value}</p>
    </div>
    <div class="h-3 bg-slate-100 rounded-full overflow-hidden mb-4"><div class="h-full bg-indigo-500" style="width:${Math.min(100, p.progress_percentage)}%"></div></div>
    <div class="bg-slate-50 rounded-xl p-4 text-sm space-y-1.5">
      <p class="font-medium mb-1 text-slate-600">자동 계산 근거</p>
      ${Object.entries(d).map(([k, val]) => `<div class="flex justify-between"><span class="text-slate-500">${k}</span><span class="font-medium">${typeof val === 'object' ? JSON.stringify(val) : esc(String(val))}</span></div>`).join('') || '<p class="text-slate-400">수동 입력 목표입니다.</p>'}
    </div>`);
}

/* ---------- 통계 ---------- */
VIEWS.stats = async (el) => {
  const [d, hm] = await Promise.all([api('/dashboard/stats?period=month'), api('/dashboard/heatmap?days=91')]);
  const max = Math.max(1, ...hm.cells.map((c) => c.count));
  el.innerHTML = `
    <section class="mb-4">
      <h1 class="text-2xl font-bold mb-1">통계</h1>
      <p class="text-slate-500 text-sm">최근 30일 / 활동 잔디</p>
    </section>
    <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      ${statCard('완료 체크리스트', d.summary.completed_checklist, 'fa-list-check', 'indigo', '30일')}
      ${statCard('작성 메모', d.summary.memos_created, 'fa-note-sticky', 'amber', '30일')}
      ${statCard('일정 시간', d.summary.calendar_hours + 'h', 'fa-calendar-check', 'emerald', '30일')}
      ${statCard('연속 달성', hm.streak + '일', 'fa-fire', 'rose', '스트릭')}
    </section>
    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
      <h2 class="font-bold mb-4"><i class="fas fa-seedling text-emerald-500 mr-2"></i>활동 잔디 (최근 13주)</h2>
      <div class="overflow-x-auto">
        <div class="grid grid-flow-col grid-rows-7 gap-1 w-max">
          ${hm.cells.map((c) => {
            const level = c.count === 0 ? 0 : Math.min(4, Math.ceil((c.count / max) * 4));
            const colors = ['bg-slate-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400', 'bg-emerald-600'];
            return `<div class="grass-cell ${colors[level]}" title="${c.date}: ${c.count} 활동"></div>`;
          }).join('')}
        </div>
      </div>
      <div class="flex items-center gap-2 mt-3 text-[10px] text-slate-400">
        <span>적음</span>
        ${['bg-slate-100','bg-emerald-200','bg-emerald-300','bg-emerald-400','bg-emerald-600'].map((c) => `<div class="grass-cell ${c}"></div>`).join('')}
        <span>많음</span>
      </div>
    </section>
    <section class="bg-white rounded-2xl border border-slate-100 p-5">
      <h2 class="font-bold mb-4"><i class="fas fa-chart-line text-indigo-500 mr-2"></i>일별 활동 추이 (30일)</h2>
      <canvas id="trend" height="120"></canvas>
    </section>`;
  const ctx = $('#trend', el);
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: d.daily_breakdown.map((x) => x.date.slice(5)),
      datasets: [
        { label: '체크리스트 완료', data: d.daily_breakdown.map((x) => x.completed_count), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.1)', tension: .3, fill: true },
        { label: '메모', data: d.daily_breakdown.map((x) => x.memos), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.1)', tension: .3, fill: true }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
};

/* ---------- 설정 ---------- */
VIEWS.settings = async (el) => {
  const s = await api('/settings');
  const tags = await loadTags();
  el.innerHTML = `
    <section class="mb-4"><h1 class="text-2xl font-bold">설정</h1></section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-user text-indigo-500 mr-2"></i>계정</h2>
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-xl font-bold">${esc((state.user?.username || 'U')[0].toUpperCase())}</div>
        <div><p class="font-semibold">${esc(state.user?.username || '')}</p><p class="text-sm text-slate-500">${esc(state.user?.email || '')}</p></div>
      </div>
      <button id="logout" class="mt-4 text-sm text-rose-600 hover:bg-rose-50 rounded-xl px-3 py-2"><i class="fas fa-right-from-bracket mr-1"></i>로그아웃</button>
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-palette text-rose-500 mr-2"></i>외관</h2>
      <div class="space-y-4">
        <div class="flex items-center justify-between"><span class="text-sm">다크 모드</span>
          <button data-tog="theme" class="w-12 h-7 rounded-full transition relative ${s.theme === 'dark' ? 'bg-indigo-600' : 'bg-slate-300'}">
            <span class="absolute top-0.5 ${s.theme === 'dark' ? 'left-6' : 'left-0.5'} w-6 h-6 bg-white rounded-full transition-all shadow"></span>
          </button>
        </div>
        <div>
          <label class="text-sm text-slate-600 block mb-2">테마 색상</label>
          <div class="flex gap-2">${['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'].map((c) => `<button data-accent="${c}" class="w-9 h-9 rounded-full border-2 ${s.accent === c ? 'border-slate-800' : 'border-transparent'}" style="background:${c}"></button>`).join('')}</div>
        </div>
        <div>
          <label class="text-sm text-slate-600 block mb-2">폰트 크기</label>
          <div class="flex bg-slate-100 rounded-xl p-1 text-sm">
            ${[['small','작게'],['medium','보통'],['large','크게']].map(([v, l]) => `<button data-font="${v}" class="flex-1 py-2 rounded-lg ${s.font_size === v ? 'bg-white shadow font-medium' : 'text-slate-500'}">${l}</button>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-map-location-dot text-emerald-500 mr-2"></i>지도 · 링크 연동</h2>
      <div class="space-y-4">
        <div>
          <label class="text-sm text-slate-600 block mb-2">주소가 있는 일정 → 기본 지도 앱</label>
          <div class="grid grid-cols-2 gap-2">
            <button data-map-pref="naver" class="flex items-center justify-center gap-2 py-2.5 rounded-xl border ${(s.default_map || 'naver') === 'naver' ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}"><i class="fas fa-map"></i>네이버 지도</button>
            <button data-map-pref="kakao" class="flex items-center justify-center gap-2 py-2.5 rounded-xl border ${s.default_map === 'kakao' ? 'border-amber-400 bg-amber-50 text-amber-600 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}"><i class="fas fa-map-location-dot"></i>카카오맵</button>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5">일정 카드의 지도 버튼은 이 지도로 열리며, 열기 모달에서 언제든 다른 지도를 고를 수 있습니다.</p>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm">링크 여는 방식</span>
            <p class="text-[11px] text-slate-400">일정의 링크를 어떻게 열지 선택</p>
          </div>
          <select data-sel="default_link_open" class="px-3 py-2 rounded-xl border border-slate-200 text-sm">
            <option value="system" ${(s.default_link_open || 'system') === 'system' ? 'selected' : ''}>기본 브라우저/앱 (새 탭)</option>
            <option value="newtab" ${s.default_link_open === 'newtab' ? 'selected' : ''}>새 탭</option>
            <option value="inapp" ${s.default_link_open === 'inapp' ? 'selected' : ''}>앱 내 미리보기</option>
          </select>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-tags text-amber-500 mr-2"></i>태그 관리</h2>
      <form id="tag-add" class="flex gap-2 mb-3">
        <input name="name" placeholder="새 태그 이름" class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-500" />
        <input name="color" type="color" value="#6366f1" class="w-11 h-11 rounded-xl border border-slate-200" />
        <button class="px-4 rounded-xl bg-indigo-600 text-white"><i class="fas fa-plus"></i></button>
      </form>
      <div class="flex flex-wrap gap-2">
        ${tags.map((t) => `<span class="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-full bg-slate-100">
          <span class="w-2.5 h-2.5 rounded-full" style="background:${esc(t.color)}"></span>${esc(t.name)}
          <button data-del-tag="${t.id}" class="text-slate-400 hover:text-rose-500 ml-1"><i class="fas fa-xmark text-xs"></i></button>
        </span>`).join('') || '<span class="text-sm text-slate-400">태그가 없습니다.</span>'}
      </div>
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-sliders text-emerald-500 mr-2"></i>일반</h2>
      <div class="space-y-3">
        <div class="flex items-center justify-between"><span class="text-sm">음력 표시</span>
          <button data-tog="lunar_display" class="w-12 h-7 rounded-full transition relative ${s.lunar_display ? 'bg-indigo-600' : 'bg-slate-300'}"><span class="absolute top-0.5 ${s.lunar_display ? 'left-6' : 'left-0.5'} w-6 h-6 bg-white rounded-full transition-all shadow"></span></button></div>
        <div class="flex items-center justify-between"><span class="text-sm">주 시작 요일</span>
          <select data-sel="week_start" class="px-3 py-2 rounded-xl border border-slate-200 text-sm">
            <option value="monday" ${s.week_start === 'monday' ? 'selected' : ''}>월요일</option>
            <option value="sunday" ${s.week_start === 'sunday' ? 'selected' : ''}>일요일</option>
          </select>
        </div>
        <div class="flex items-center justify-between"><span class="text-sm">일정 중복 허용 시간(분)</span>
          <input type="number" data-num="conflict_tolerance" value="${s.conflict_tolerance}" class="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right" />
        </div>
      </div>
    </section>

    <section class="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
      <h2 class="font-bold mb-4"><i class="fas fa-database text-slate-500 mr-2"></i>데이터</h2>
      <button id="export" class="text-sm px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50"><i class="fas fa-download mr-1"></i>데이터 내보내기 (JSON)</button>
    </section>

    <p class="text-center text-xs text-slate-400 py-4">LifeHub v1.0 · Cloudflare Workers + D1</p>`;

  $('#logout', el).addEventListener('click', () => { if (confirm('로그아웃할까요?')) logout(); });
  $$('[data-tog]', el).forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.tog;
    const val = key === 'theme' ? (s.theme === 'dark' ? 'light' : 'dark') : !s[key];
    s[key] = val;
    state.settings = await api('/settings', { method: 'PUT', body: s });
    applyAppearance(); toast('저장되었습니다.', 'success'); render();
  }));
  $$('[data-accent]', el).forEach((b) => b.addEventListener('click', async () => {
    s.accent = b.dataset.accent;
    state.settings = await api('/settings', { method: 'PUT', body: s });
    applyAppearance(); toast('저장되었습니다.', 'success'); render();
  }));
  $$('[data-font]', el).forEach((b) => b.addEventListener('click', async () => {
    s.font_size = b.dataset.font;
    state.settings = await api('/settings', { method: 'PUT', body: s });
    applyAppearance(); toast('저장되었습니다.', 'success'); render();
  }));
  $$('[data-sel]', el).forEach((sel) => sel.addEventListener('change', async () => {
    s[sel.dataset.sel] = sel.value;
    state.settings = await api('/settings', { method: 'PUT', body: s }); toast('저장되었습니다.', 'success');
  }));
  $$('[data-num]', el).forEach((inp) => inp.addEventListener('change', async () => {
    s[inp.dataset.num] = Number(inp.value);
    state.settings = await api('/settings', { method: 'PUT', body: s }); toast('저장되었습니다.', 'success');
  }));
  $('#tag-add', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/tags', { method: 'POST', body: { name: e.target.name.value, color: e.target.color.value } });
      state.cache.tags = []; toast('태그가 추가되었습니다.', 'success'); render();
    } catch (err) { toast(err.message, 'error'); }
  });
  $$('[data-del-tag]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('태그를 삭제할까요?')) return;
    await api('/tags/' + b.dataset.delTag, { method: 'DELETE' });
    state.cache.tags = []; toast('삭제되었습니다.', 'success'); render();
  }));
  $('#export', el).addEventListener('click', async () => {
    const [notes, cl, ev, goals] = await Promise.all([api('/notes'), api('/checklist'), api('/calendar/events?start_date=1970-01-01&end_date=2999-12-31'), api('/goals')]);
    const blob = new Blob([JSON.stringify({ notes, checklist: cl, events: ev, goals, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lifehub-export.json'; a.click();
  });
};

// === MODULES_MARKER ===

/* ---------- 부트 ---------- */
async function boot() {
  if (state.token) {
    try { state.settings = await api('/settings'); applyAppearance(); }
    catch (e) { /* ignore */ }
  }
  render();
}

function applyAppearance() {
  const s = state.settings || {};
  document.documentElement.classList.toggle('dark', s.theme === 'dark');
  document.body.classList.remove('font-small', 'font-medium', 'font-large');
  document.body.classList.add('font-' + (s.font_size || 'medium'));
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
}

VIEWS.login = (root) => {
  root.innerHTML = `
    <div class="min-h-screen grid place-items-center p-4 bg-gradient-to-br from-indigo-50 via-white to-slate-50">
      <div class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-7 view-enter">
        <div class="text-center mb-6">
          <div class="w-14 h-14 rounded-2xl bg-indigo-600 text-white grid place-items-center mx-auto mb-3 text-2xl"><i class="fas fa-bolt"></i></div>
          <h1 class="text-2xl font-bold">LifeHub</h1>
          <p class="text-slate-500 text-sm mt-1">달력·메모·체크리스트·목표를 한 곳에서</p>
        </div>
        <div class="flex bg-slate-100 rounded-xl p-1 mb-5 text-sm font-medium">
          <button data-tab="login" class="tab-btn flex-1 py-2 rounded-lg bg-white shadow">로그인</button>
          <button data-tab="register" class="tab-btn flex-1 py-2 rounded-lg text-slate-500">회원가입</button>
        </div>
        <form id="auth-form" class="space-y-3">
          <div id="extra" class="hidden">
            <input name="username" placeholder="사용자명" class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none" />
          </div>
          <input name="email" type="email" required placeholder="이메일" class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none" />
          <input name="password" type="password" required placeholder="비밀번호" class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none" />
          <button type="submit" class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">시작하기</button>
        </form>
        <p class="text-center text-xs text-slate-400 mt-4">데모 계정: <b>demo@lifehub.app</b> / <b>demo1234</b></p>
      </div>
    </div>`;
  let mode = 'login';
  $$('.tab-btn', root).forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    $$('.tab-btn', root).forEach((x) => x.className = 'tab-btn flex-1 py-2 rounded-lg text-slate-500');
    b.className = 'tab-btn flex-1 py-2 rounded-lg bg-white shadow';
    $('#extra', root).classList.toggle('hidden', mode !== 'register');
  }));
  $('#auth-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      const out = mode === 'login'
        ? await api('/auth/login', { method: 'POST', body, auth: false })
        : await api('/auth/register', { method: 'POST', body, auth: false });
      saveAuth(out.access_token, out.user);
      state.settings = await api('/settings');
      applyAppearance();
      toast(mode === 'login' ? '로그인되었습니다.' : '환영합니다!', 'success');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
};

boot();
