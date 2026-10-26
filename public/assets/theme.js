// Темы оформления. Выбор у каждого свой и хранится в браузере.
// Скрипт подключён в <head>, чтобы тема включилась до того, как страница отрисуется.
(() => {
  'use strict';

  const THEMES = [
    { id: 'warm', name: 'Тёплый вечер', hint: 'янтарь и искорки' },
    { id: 'winter', name: 'Зимний вечер', hint: 'снежинки' },
    { id: 'night', name: 'Ночь', hint: 'потемнее, со звёздами' },
    { id: 'newyear', name: 'Новый год', hint: 'гирлянда и снег' },
    { id: 'valentine', name: 'Валентинка', hint: 'розовое и сердечки' },
    { id: 'auto', name: 'Авто', hint: 'по сезону и праздникам' },
  ];
  const KEY = 'kz_theme';

  const read = () => { try { return localStorage.getItem(KEY) || 'warm'; } catch { return 'warm'; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* приватный режим */ } };

  // «Авто»: Новый год — с 15 декабря по 14 января, День влюблённых — 7–15 февраля, зима — снег
  function byDate(d = new Date()) {
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if ((m === 12 && day >= 15) || (m === 1 && day <= 14)) return 'newyear';
    if (m === 2 && day >= 7 && day <= 15) return 'valentine';
    if (m === 12 || m === 1 || m === 2) return 'winter';
    return 'warm';
  }

  function resolve(choice) {
    if (choice === 'auto') return byDate();
    return THEMES.some((t) => t.id === choice) ? choice : 'warm';
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  function el(cls, style) {
    const s = document.createElement('span');
    s.className = cls;
    if (style) s.setAttribute('style', style);
    return s;
  }

  function sparks(n, cls) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(el(cls, `top:${rnd(2, 98).toFixed(1)}%;left:${rnd(1, 99).toFixed(1)}%;animation-delay:${rnd(0, 5).toFixed(2)}s;animation-duration:${rnd(3.5, 6.5).toFixed(2)}s`));
    }
    return out;
  }

  function snow(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const size = rnd(2, 5.5).toFixed(1);
      const dur = rnd(9, 20).toFixed(1);
      out.push(el('flake', `left:${rnd(0, 100).toFixed(1)}%;width:${size}px;height:${size}px;opacity:${rnd(0.35, 0.9).toFixed(2)};` +
        `animation-duration:${dur}s,${rnd(3, 6).toFixed(1)}s;animation-delay:-${rnd(0, dur).toFixed(1)}s,-${rnd(0, 6).toFixed(1)}s`));
    }
    return out;
  }

  function hearts(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const size = rnd(10, 22).toFixed(0);
      const dur = rnd(14, 26).toFixed(1);
      out.push(el('rheart', `left:${rnd(0, 100).toFixed(1)}%;width:${size}px;height:${size}px;opacity:${rnd(0.18, 0.45).toFixed(2)};` +
        `animation-duration:${dur}s;animation-delay:-${rnd(0, dur).toFixed(1)}s`));
    }
    return out;
  }

  function garland() {
    const g = el('garland');
    const n = Math.max(12, Math.round(window.innerWidth / 70));
    for (let i = 0; i < n; i++) {
      g.append(el(`bulb b${i % 4}`, `left:${((i + 0.5) / n * 100).toFixed(2)}%;top:${(8 + Math.sin((i / (n - 1)) * Math.PI) * 18).toFixed(1)}px;animation-delay:${((i % 4) * 0.45).toFixed(2)}s`));
    }
    return [g];
  }

  function fill(bg, theme) {
    const nodes = [];
    if (theme === 'warm') nodes.push(el('sheen'), ...sparks(12, 'spark'));
    else if (theme === 'winter') nodes.push(...snow(45));
    else if (theme === 'night') nodes.push(...sparks(55, 'star'), el('shooting'));
    else if (theme === 'newyear') nodes.push(...garland(), ...snow(28), ...sparks(8, 'spark'));
    else if (theme === 'valentine') nodes.push(el('sheen'), ...hearts(16));
    bg.replaceChildren(...nodes);
  }

  let current = resolve(read());
  document.documentElement.dataset.theme = current;

  function paint() {
    const bg = document.querySelector('.bg');
    if (bg) fill(bg, current);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();

  window.KZTheme = {
    list: THEMES,
    choice: read,
    current: () => current,
    set(choice) {
      write(choice);
      current = resolve(choice);
      document.documentElement.dataset.theme = current;
      paint();
    },
  };
})();
