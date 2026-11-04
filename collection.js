/* ChrisCollection v3
 * 特殊台词：符合日期条件时优先抽取；每条特殊台词全局只解锁一次。
 * 普通台词：优先抽未解锁条目；全部收集后才允许重复。
 * render() 只展示，不会触发解锁。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'timelog-chris-collection-v1';
  const POOLS = [
    { key: 'nightStandard', title: '普通夜间', type: 'night', special: false },
    { key: 'morningStandard', title: '普通早晨', type: 'morning', special: false },
    { key: 'nightSpecial', title: '特殊夜间', type: 'night', special: true },
    { key: 'morningSpecial', title: '特殊早晨', type: 'morning', special: true }
  ];
  const SPECIAL = () => window.CHRIS_SPECIAL_LINES || {};
  const STANDARD = () => window.CHRIS_LINES || {};
  const emptyState = () => ({
    version: 3,
    unlocked: {
      nightStandard: [], morningStandard: [],
      nightSpecial: [], morningSpecial: []
    }
  });

  function textOf(item) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return item.text ?? item.line ?? item.content ?? item.message ?? '';
  }
  function idOf(item, fallback) {
    if (item && typeof item === 'object' && item.id != null) return String(item.id);
    return fallback == null ? '' : String(fallback);
  }
  function normalizeEntry(item, fallbackId) {
    const text = textOf(item);
    const id = idOf(item, fallbackId);
    return id && text ? { id, text: String(text) } : null;
  }
  function dedupe(entries) {
    const seen = new Set();
    return entries.filter(x => x && !seen.has(x.id) && seen.add(x.id));
  }

  // 兼容数组、{morning:[],night:[]}、{id,text} 等多种分组结构。
  function flatten(node, type, prefix) {
    if (node == null) return [];
    if (Array.isArray(node)) {
      return node.flatMap((item, i) => flatten(item, type, `${prefix || 'S'}${i + 1}`));
    }
    if (typeof node === 'string') return [];
    if (typeof node !== 'object') return [];

    const ownText = textOf(node);
    if (ownText) {
      if (node.type && node.type !== type) return [];
      return [normalizeEntry(node, prefix)].filter(Boolean);
    }

    if (Object.prototype.hasOwnProperty.call(node, type)) {
      return flatten(node[type], type, `${prefix || 'S'}-${type}`);
    }
    if (node.lines) return flatten(node.lines, type, `${prefix || 'S'}-lines`);
    if (node.dialogues) return flatten(node.dialogues, type, `${prefix || 'S'}-dialogues`);

    // 对象映射（如星期数字、日期字符串、season 名称）。
    return Object.keys(node).flatMap(key => {
      if (key === 'months' || key === 'name' || key === 'label' || key === 'type') return [];
      return flatten(node[key], type, `${prefix || 'S'}-${key}`);
    });
  }

  function weekdayName(day) {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day];
  }
  function monthDay(date) {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function monthEnd(date) {
    return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }
  function allSpecialForType(type) {
    const s = SPECIAL();
    const out = [];
    const add = (node, key) => out.push(...flatten(node, type, key));

    if (type === 'morning') add(s.weekdayMorning, 'weekdayMorning');
    if (type === 'night') {
      const sn = s.specialNight || {};
      add(sn.friday, 'specialNight-friday');
      add(sn.sunday, 'specialNight-sunday');
    }
    add(s.monthStart, 'monthStart');
    add(s.monthEnd, 'monthEnd');
    add(s.holidays, 'holidays');

    const seasons = s.seasons;
    if (Array.isArray(seasons)) {
      seasons.forEach((season, i) => {
        if (season && typeof season === 'object') {
          add(season[type] ?? season.lines ?? season.dialogues, `season-${season.name || i}`);
        }
      });
    } else if (seasons && typeof seasons === 'object') {
      Object.keys(seasons).forEach(key => add(seasons[key]?.[type] ?? seasons[key]?.lines ?? seasons[key], `season-${key}`));
    }
    return dedupe(out);
  }

  function eligibleSpecialGroups(type, date) {
    const s = SPECIAL();
    const groups = [];
    const push = (name, entries) => {
      const clean = dedupe(entries || []);
      if (clean.length) groups.push({ name, entries: clean });
    };
    const dateKey = monthDay(date);

    // 优先级 1：具体节日。
    if (s.holidays && Object.prototype.hasOwnProperty.call(s.holidays, dateKey)) {
      push('holiday', flatten(s.holidays[dateKey], type, `holiday-${dateKey}`));
    }

    // 优先级 2：月初 / 月末。
    if (date.getDate() === 1) push('monthStart', flatten(s.monthStart, type, 'monthStart'));
    if (monthEnd(date)) push('monthEnd', flatten(s.monthEnd, type, 'monthEnd'));

    // 优先级 3：星期专属。
    if (type === 'morning') {
      const wm = s.weekdayMorning || {};
      const entry = wm[date.getDay()] ?? wm[String(date.getDay())] ?? wm[weekdayName(date.getDay())];
      push('weekdayMorning', flatten(entry, type, `weekday-${date.getDay()}`));
    } else if (type === 'night') {
      const sn = s.specialNight || {};
      if (date.getDay() === 5) push('fridayNight', flatten(sn.friday, type, 'fridayNight'));
      if (date.getDay() === 0) push('sundayNight', flatten(sn.sunday, type, 'sundayNight'));
    }

    // 优先级 4：季节。月份由 seasonal-lines.js 定义，不依赖天气 API。
    const month = date.getMonth() + 1;
    if (Array.isArray(s.seasons)) {
      s.seasons.forEach((season, i) => {
        if (season && Array.isArray(season.months) && season.months.includes(month)) {
          push(`season-${season.name || i}`, flatten(season[type] ?? season.lines ?? season.dialogues, type, `season-${season.name || i}`));
        }
      });
    } else if (s.seasons && typeof s.seasons === 'object') {
      Object.keys(s.seasons).forEach(key => {
        const season = s.seasons[key];
        if (season && Array.isArray(season.months) && season.months.includes(month)) {
          push(`season-${key}`, flatten(season[type] ?? season.lines ?? season, type, `season-${key}`));
        }
      });
    }
    return groups;
  }

  function standardEntries(type) {
    const raw = STANDARD()[type] || [];
    return dedupe((Array.isArray(raw) ? raw : []).map((x, i) => normalizeEntry(x, `${type === 'night' ? 'N' : 'M'}${String(i + 1).padStart(3, '0')}`)).filter(Boolean));
  }

  function loadState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
    return normalizeState(saved);
  }
  function normalizeUnlockList(list) {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    list.forEach(item => {
      const id = typeof item === 'string' ? item : item && item.id != null ? String(item.id) : '';
      if (!id) return;
      const date = typeof item === 'object' && item ? (item.date || null) : null;
      if (!map.has(id)) map.set(id, { id, date });
      else if (!map.get(id).date && date) map.get(id).date = date;
    });
    return [...map.values()];
  }
  function normalizeState(saved) {
    const base = emptyState();
    if (!saved || typeof saved !== 'object') return base;
    const u = saved.unlocked || {};
    Object.keys(base.unlocked).forEach(key => { base.unlocked[key] = normalizeUnlockList(u[key]); });
    return base;
  }
  let state = loadState();
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  // 将旧版仅保存 ID 的状态迁移为带日期字段的 v3 结构；旧日期无法还原。
  persist();
  function specialUnlocked(id) {
    return state.unlocked.morningSpecial.some(x => x.id === id) || state.unlocked.nightSpecial.some(x => x.id === id);
  }
  function isUnlocked(poolKey, id) {
    return state.unlocked[poolKey].some(x => x.id === id);
  }
  function unlock(poolKey, entry, date) {
    if (!isUnlocked(poolKey, entry.id)) {
      state.unlocked[poolKey].push({ id: entry.id, date: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` });
      persist();
      return true;
    }
    return false;
  }
  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function getDialogue(type, date = new Date()) {
    if (type !== 'morning' && type !== 'night') return null;
    const when = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(+when)) return null;
    const specialPool = type === 'morning' ? 'morningSpecial' : 'nightSpecial';
    const standardPool = type === 'morning' ? 'morningStandard' : 'nightStandard';

    // 特殊台词按优先级逐组检查；只从尚未解锁的特殊条目中抽取。
    // 特殊台词一旦在任一时段解锁，便不会再次出现。
    for (const group of eligibleSpecialGroups(type, when)) {
      const fresh = group.entries.filter(entry => !specialUnlocked(entry.id));
      if (fresh.length) {
        const chosen = pickRandom(fresh);
        unlock(specialPool, chosen, when);
        return { ...chosen, newlyUnlocked: true, special: true, group: group.name };
      }
    }

    // 当前日期没有可收集的特殊台词时，才进入普通池。
    const standard = standardEntries(type);
    if (!standard.length) return null;
    const fresh = standard.filter(entry => !isUnlocked(standardPool, entry.id));
    const chosen = pickRandom(fresh.length ? fresh : standard);
    const newlyUnlocked = unlock(standardPool, chosen, when);
    return { ...chosen, newlyUnlocked, special: false, group: 'standard' };
  }

  function getProgress(poolKey) {
    const pool = POOLS.find(x => x.key === poolKey);
    if (!pool) return { total: 0, unlocked: 0, remaining: 0, percent: 0 };
    const entries = pool.special ? allSpecialForType(pool.type) : standardEntries(pool.type);
    const total = entries.length;
    const unlocked = pool.special ? entries.filter(x => specialUnlocked(x.id)).length : state.unlocked[poolKey].length;
    return { total, unlocked, remaining: Math.max(0, total - unlocked), percent: total ? Math.round(unlocked / total * 100) : 0 };
  }
  function getAllProgress() {
    return Object.fromEntries(POOLS.map(p => [p.key, getProgress(p.key)]));
  }
  function getState() {
    return JSON.parse(JSON.stringify(state));
  }
  function restoreState(saved) {
    state = normalizeState(saved);
    const valid = {
      nightStandard: new Set(standardEntries('night').map(x => x.id)),
      morningStandard: new Set(standardEntries('morning').map(x => x.id)),
      nightSpecial: new Set(allSpecialForType('night').map(x => x.id)),
      morningSpecial: new Set(allSpecialForType('morning').map(x => x.id))
    };
    Object.keys(state.unlocked).forEach(key => {
      state.unlocked[key] = state.unlocked[key].filter(x => valid[key].has(x.id));
    });
    persist();
    return getState();
  }
  function resetCollection() {
    state = emptyState();
    persist();
    return getState();
  }
  function getPools() { return POOLS.map(x => ({ ...x })); }
  function getSpecial(type) { return allSpecialForType(type); }
  function getSpecialCount() { return dedupe([...allSpecialForType('morning'), ...allSpecialForType('night')]).length; }
  function getStandardCount() { return standardEntries('morning').length + standardEntries('night').length; }

  function render(container) {
    if (!container) return;
    const poolKeyDefault = container.dataset.activePool || 'morningStandard';
    const activeKey = POOLS.some(x => x.key === poolKeyDefault) ? poolKeyDefault : 'morningStandard';
    const specialAll = dedupe([...allSpecialForType('morning'), ...allSpecialForType('night')]);
    const specialDone = specialAll.filter(x => specialUnlocked(x.id)).length;
    const standardTotal = getStandardCount();
    const standardDone = state.unlocked.morningStandard.length + state.unlocked.nightStandard.length;
    const totalProgress = { total: standardTotal + specialAll.length, unlocked: standardDone + specialDone };
    const tabs = POOLS.map(p => `<button type="button" class="chris-collection-tab ${p.key === activeKey ? 'active' : ''}" data-pool="${p.key}">${p.title}</button>`).join('');
    const pool = POOLS.find(x => x.key === activeKey);
    const entries = pool.special ? allSpecialForType(pool.type) : standardEntries(pool.type);
    const unlockedMap = pool.special
      ? new Map([...state.unlocked.morningSpecial, ...state.unlocked.nightSpecial].map(x => [x.id, x]))
      : new Map(state.unlocked[activeKey].map(x => [x.id, x]));
    const cards = entries.map((entry, i) => {
      const record = unlockedMap.get(entry.id);
      if (!record) return `<div class="chris-collection-entry locked"><div class="chris-collection-summary"><span class="chris-collection-question">?</span><span class="chris-collection-id">${entry.id}</span><span class="chris-collection-status">未解锁</span></div></div>`;
      const dateLabel = record.date || '日期未记录';
      return `<details class="chris-collection-entry unlocked"><summary><span class="chris-collection-check">✓</span><span class="chris-collection-id">${entry.id}</span><span class="chris-collection-status">${dateLabel}</span></summary><div class="chris-collection-text">${escapeHTML(entry.text)}</div><div class="chris-collection-date">解锁日期：${dateLabel}</div></details>`;
    }).join('') || '<div class="empty">这个收藏池暂时没有台词。</div>';
    const progress = getProgress(activeKey);
    container.dataset.activePool = activeKey;
    container.innerHTML = `
      <div class="chris-collection-header"><b>Chris 台词收藏</b><span class="chris-collection-total">总收集 ${totalProgress.unlocked} / ${totalProgress.total}</span></div>
      <div class="chris-collection-progress"><div style="display:flex;justify-content:space-between;gap:8px"><span>${pool.title}</span><span>${progress.unlocked} / ${progress.total}</span></div><div style="height:6px;background:#edf0f8;border-radius:99px;overflow:hidden;margin-top:6px"><div class="chris-collection-progress-fill" style="width:${progress.percent}%;height:100%"></div></div></div>
      <div class="chris-collection-tabs">${tabs}</div>
      <div class="chris-collection-list">${cards}</div>`;
    container.querySelectorAll('[data-pool]').forEach(button => {
      button.addEventListener('click', () => {
        container.dataset.activePool = button.dataset.pool;
        render(container);
      });
    });
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.ChrisCollection = {
    getDialogue, render, getProgress, getAllProgress, getState, restoreState,
    resetCollection, getPools, getSpecial, getSpecialCount, getStandardCount
  };
})();
