/* =================================================================
 * Good Morning Eli — front-end logic (v2)
 * Single global namespace: window.GME
 * ================================================================= */
(function () {
  'use strict';

  const CFG = window.DASHBOARD_CONFIG || {};
  const LS = {
    theme: 'gme.theme',
    units: 'gme.units',
    tickers: 'gme.tickers',
    coords: 'gme.coords',
    newsCategory: 'gme.newsCategory',
    autoRefresh: 'gme.autoRefresh',
    activeCity: 'gme.activeCity',
    savedCities: 'gme.savedCities',
    newsExpanded: 'gme.newsExpanded',
  };

  // ---------- State ----------
  const today0 = new Date();
  const state = {
    coords: null,
    units: localStorage.getItem(LS.units) || CFG.weatherUnits || 'imperial',
    theme: localStorage.getItem(LS.theme) || 'dark',
    tickers: JSON.parse(localStorage.getItem(LS.tickers) || 'null') || CFG.tickers || [],
    newsCategory: localStorage.getItem(LS.newsCategory) || (CFG.newsCategories && CFG.newsCategories[0]) || 'Top',
    autoRefresh: Number(localStorage.getItem(LS.autoRefresh) ?? 300000),
    autoTimer: null,
    stockTab: 'positions',
    sortKey: 'symbol',
    sortDir: 'asc',
    expandedTicker: null,
    stockFilter: '',
    // Weather cities
    savedCities: JSON.parse(localStorage.getItem(LS.savedCities) || 'null') || (CFG.defaultSavedCities || []),
    activeCity: JSON.parse(localStorage.getItem(LS.activeCity) || 'null') || { label: 'Current location', isCurrentLocation: true },
    // Calendar
    calView: { year: today0.getFullYear(), month: today0.getMonth() },
    calSelectedDate: null,
    eventsByDate: new Map(),
    // News accordion
    newsExpanded: localStorage.getItem(LS.newsExpanded) === 'true',
    newsLoaded: false,
    cache: { weather: null, stocks: null, calendar: null, inbox: null, worldNews: null, stockNewsMap: {}, stockChartMap: {} },
    lastPrices: {},
    charts: {},
  };
  window.GME = { state };

  // ---------- Utilities ----------
  const $  = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const numFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  const pctFmt = (v) => `${v >= 0 ? '+' : ''}${(v || 0).toFixed(2)}%`;
  const priceFmt = (v) => v == null ? '—' : numFmt.format(v);
  const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function relTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    if (Number.isNaN(diff)) return '';
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function tempUnit() { return state.units === 'metric' ? '°C' : '°F'; }
  function speedUnit() { return state.units === 'metric' ? 'km/h' : 'mph'; }

  async function fetchJSON(url) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({ error: 'bad_json' }));
      if (!res.ok && !data.error) data.error = `http_${res.status}`;
      return data;
    } catch (e) {
      return { error: 'network', message: e.message };
    }
  }

  function renderIcons(root = document) {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons({ attrs: {}, nameAttr: 'data-lucide' }); } catch (e) { /* noop */ }
    }
  }

  function stateBlock({ icon = 'circle-alert', title, msg, action, onAction }) {
    const wrap = document.createElement('div');
    wrap.className = 'state-block';
    wrap.innerHTML = `
      <i data-lucide="${icon}"></i>
      <div class="state-title">${escapeHtml(title || '')}</div>
      <div class="state-msg">${escapeHtml(msg || '')}</div>
      ${action ? `<button class="pill-btn" data-state-action>${escapeHtml(action)}</button>` : ''}
    `;
    if (action && onAction) {
      setTimeout(() => {
        const btn = wrap.querySelector('[data-state-action]');
        if (btn) btn.addEventListener('click', onAction);
      }, 0);
    }
    return wrap;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ---------- Theme / settings ----------
  function applyTheme() {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    document.documentElement.classList.toggle('light', state.theme === 'light');
    const lbl = $('#theme-label');
    if (lbl) lbl.textContent = state.theme === 'dark' ? 'Dark' : 'Light';
    if (window.Chart) {
      Chart.defaults.color = state.theme === 'dark' ? '#cbd5e1' : '#334155';
      Chart.defaults.borderColor = state.theme === 'dark' ? '#1e293b' : '#e2e8f0';
      Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui';
    }
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(LS.theme, state.theme);
    applyTheme();
    Object.keys(state.charts).forEach(k => { try { state.charts[k].update(); } catch (e) {} });
  }

  function setUnits(u) {
    state.units = u;
    localStorage.setItem(LS.units, u);
    $$('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === u));
    loadWeather();
  }

  function startAutoRefresh() {
    if (state.autoTimer) clearInterval(state.autoTimer);
    if (state.autoRefresh > 0) {
      state.autoTimer = setInterval(() => refreshAll(false), state.autoRefresh);
    }
  }

  // ---------- Clock + Hero ----------
  function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    let greeting = 'Good morning';
    if (hours >= 12 && hours < 17) greeting = 'Good afternoon';
    else if (hours >= 17 || hours < 5) greeting = 'Good evening';
    const userName = CFG.userName || 'Eli';
    const greetEl = $('#greeting');
    if (greetEl && !greetEl.dataset.locked) greetEl.textContent = `${greeting}, ${userName}`;
    const clockEl = $('#hero-clock');
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const dateStr = dateFmt.format(now);
    const hd = $('#hero-date'); if (hd) hd.textContent = dateStr;
    const td = $('#topbar-date'); if (td) td.textContent = dateStr;
  }

  // ---------- Geolocation ----------
  function getCoords() {
    return new Promise((resolve) => {
      const cached = JSON.parse(localStorage.getItem(LS.coords) || 'null');
      if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) {
        state.coords = cached;
        return resolve(cached);
      }
      if (!navigator.geolocation) {
        state.coords = { lat: 40.7128, lon: -74.0060, ts: Date.now(), fallback: true };
        return resolve(state.coords);
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
          localStorage.setItem(LS.coords, JSON.stringify(c));
          state.coords = c;
          resolve(c);
        },
        () => {
          state.coords = { lat: 40.7128, lon: -74.0060, ts: Date.now(), fallback: true };
          resolve(state.coords);
        },
        { timeout: 8000, maximumAge: 3600 * 1000 }
      );
    });
  }

  // Resolve the coords for whichever city is active.
  async function getActiveCoords() {
    const ac = state.activeCity;
    if (ac && !ac.isCurrentLocation && Number.isFinite(ac.lat) && Number.isFinite(ac.lon)) {
      return { lat: ac.lat, lon: ac.lon, label: ac.label, isCurrentLocation: false };
    }
    const c = await getCoords();
    return { lat: c.lat, lon: c.lon, label: null, isCurrentLocation: true, fallback: c.fallback };
  }

  // ============================================================
  //  WEATHER
  // ============================================================
  async function loadWeather() {
    const body = $('#weather-body');
    if (!body) return;
    body.innerHTML = `<div class="skeleton h-16 rounded-xl mb-2"></div><div class="skeleton h-20 rounded-xl mb-2"></div><div class="skeleton h-14 rounded-xl"></div>`;

    const ac = await getActiveCoords();
    const data = await fetchJSON(`/api/weather?lat=${ac.lat}&lon=${ac.lon}&units=${state.units}`);
    state.cache.weather = data;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'cloud-off', title: 'Weather unavailable',
        msg: data.message || 'Could not load weather.',
        action: 'Retry', onAction: loadWeather
      }));
      renderIcons();
      return;
    }

    const cur = data.current || {};
    const cityLabel = ac.isCurrentLocation
      ? (data.location || (ac.fallback ? 'New York City' : 'Current location'))
      : (ac.label || data.location || 'Weather');
    const lbl = $('#weather-city-label');
    if (lbl) lbl.textContent = cityLabel;

    body.innerHTML = `
      <div class="weather-hero">
        <div class="weather-icon-big"><i data-lucide="${weatherIcon(cur.icon, cur.conditions)}"></i></div>
        <div class="min-w-0">
          <div class="weather-temp">${Math.round(cur.temp ?? 0)}<span class="weather-temp-unit">${tempUnit()}</span></div>
          <div class="text-sm text-slate-300 mt-0.5">${escapeHtml(cur.conditions || '')}</div>
          <div class="text-xs text-slate-500">Feels ${Math.round(cur.feelsLike ?? cur.temp ?? 0)}${tempUnit()} · Humidity ${cur.humidity ?? '—'}% · Wind ${cur.wind ?? '—'} ${speedUnit()}</div>
        </div>
      </div>

      <div class="weather-section-label">Next 12 hours</div>
      <div class="weather-hourly"><canvas id="weather-hourly-chart"></canvas></div>

      <div class="weather-section-label">7-day forecast</div>
      <div class="weather-daily" id="weather-daily"></div>

      <div class="sun-progress">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center gap-1"><i data-lucide="sunrise" class="w-3.5 h-3.5 text-amber-400"></i>${cur.sunrise ? timeFmt.format(new Date(cur.sunrise)) : '—'}</span>
          <span class="flex items-center gap-1"><i data-lucide="sunset" class="w-3.5 h-3.5 text-orange-400"></i>${cur.sunset ? timeFmt.format(new Date(cur.sunset)) : '—'}</span>
        </div>
        <div class="sun-bar" id="sun-bar"></div>
      </div>
    `;

    renderHourly(data.hourly || []);
    renderDaily(data.daily || []);
    renderSunBar(cur.sunrise, cur.sunset);
    renderIcons();
    updateHeroWeatherPill(cur);
  }

  function weatherIcon(icon, conditions) {
    const c = (conditions || '').toLowerCase();
    if (c.includes('thunder') || c.includes('storm')) return 'cloud-lightning';
    if (c.includes('snow') || c.includes('sleet')) return 'cloud-snow';
    if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'cloud-rain';
    if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloud-fog';
    if (c.includes('cloud') || c.includes('overcast')) return 'cloud';
    if (c.includes('clear') || c.includes('sun')) return (icon && /n$/.test(icon)) ? 'moon' : 'sun';
    if (icon && /n$/.test(icon)) return 'moon';
    return 'sun';
  }

  function renderHourly(hourly) {
    const canvas = $('#weather-hourly-chart');
    if (!canvas || !hourly.length) return;
    if (state.charts.hourly) state.charts.hourly.destroy();
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 90);
    grad.addColorStop(0, 'rgba(56,189,248,0.42)');
    grad.addColorStop(1, 'rgba(56,189,248,0.02)');
    state.charts.hourly = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hourly.slice(0, 12).map(h => h.time ? new Date(h.time).getHours() + ':00' : ''),
        datasets: [{
          data: hourly.slice(0, 12).map(h => h.temp),
          borderColor: '#38bdf8', backgroundColor: grad, fill: true,
          tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
        }]
      },
      options: chartOptions({ unit: tempUnit() })
    });
  }

  function renderDaily(daily) {
    const cont = $('#weather-daily');
    if (!cont) return;
    const days = daily.slice(0, 7);
    if (!days.length) { cont.innerHTML = '<div class="text-xs text-slate-500">No forecast available.</div>'; return; }
    const allTemps = days.flatMap(d => [d.high, d.low]).filter(v => v != null);
    const minT = Math.min(...allTemps, 0);
    const maxT = Math.max(...allTemps, 1);
    const span = maxT - minT || 1;
    cont.innerHTML = days.map(d => {
      const lo = d.low ?? 0, hi = d.high ?? 0;
      const left = ((lo - minT) / span) * 100;
      const width = Math.max(6, ((hi - lo) / span) * 100);
      return `
        <div class="weather-day" title="${escapeHtml(d.conditions || '')}">
          <div class="weather-day-label">${escapeHtml((d.day || '').slice(0, 3))}</div>
          <div class="weather-day-icon"><i data-lucide="${weatherIcon(d.icon, d.conditions)}"></i></div>
          <div class="weather-day-bar">
            <div class="weather-day-bar-fill" style="left:${left}%; width:${width}%;"></div>
          </div>
          <div class="weather-day-temp"><span>${Math.round(hi)}°</span><span class="text-slate-500">${Math.round(lo)}°</span></div>
        </div>
      `;
    }).join('');
    renderIcons(cont);
  }

  function renderSunBar(sunrise, sunset) {
    const bar = $('#sun-bar');
    if (!bar || !sunrise || !sunset) return;
    const sr = new Date(sunrise).getTime();
    const ss = new Date(sunset).getTime();
    const now = Date.now();
    let pct = ((now - sr) / (ss - sr)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    bar.innerHTML = `<div class="sun-bar-fill" style="width:${pct}%"></div><div class="sun-marker" style="left:${pct}%"></div>`;
  }

  function updateHeroWeatherPill(cur) {
    const pill = $('#hero-weather-pill');
    if (!pill || !cur) return;
    pill.innerHTML = `<i data-lucide="${weatherIcon(cur.icon, cur.conditions)}" class="w-4 h-4 text-sky-300"></i> <span>${Math.round(cur.temp ?? 0)}${tempUnit()} · ${escapeHtml(cur.conditions || '')}</span>`;
    renderIcons(pill);
  }

  // ---------- Weather city dropdown ----------
  function renderCityMenu() {
    const menu = $('#weather-city-menu');
    if (!menu) return;
    const ac = state.activeCity || {};
    const items = [];
    items.push({ label: 'Current location', isCurrentLocation: true, icon: 'locate-fixed' });
    state.savedCities.forEach((c, i) => items.push({ ...c, icon: 'map-pin', idx: i }));
    menu.innerHTML = items.map(it => {
      const active = (it.isCurrentLocation && ac.isCurrentLocation) ||
                     (!it.isCurrentLocation && !ac.isCurrentLocation && ac.label === it.label);
      return `<button class="city-menu-item ${active ? 'active' : ''}" data-current="${it.isCurrentLocation ? '1' : '0'}" data-idx="${it.idx != null ? it.idx : ''}">
        <i data-lucide="${it.icon}" class="w-3.5 h-3.5"></i>
        <span class="truncate flex-1">${escapeHtml(it.label)}</span>
        ${active ? '<i data-lucide="check" class="w-3.5 h-3.5 text-sky-300"></i>' : ''}
      </button>`;
    }).join('') +
    `<button class="city-menu-item city-menu-manage" data-manage="1">
       <i data-lucide="settings-2" class="w-3.5 h-3.5"></i><span>Manage cities</span>
     </button>`;
    renderIcons(menu);
    menu.querySelectorAll('.city-menu-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.manage === '1') {
          menu.classList.add('hidden');
          openCitiesModal();
          return;
        }
        if (btn.dataset.current === '1') {
          state.activeCity = { label: 'Current location', isCurrentLocation: true };
        } else {
          const c = state.savedCities[Number(btn.dataset.idx)];
          if (c) state.activeCity = { ...c, isCurrentLocation: false };
        }
        localStorage.setItem(LS.activeCity, JSON.stringify(state.activeCity));
        menu.classList.add('hidden');
        renderCityMenu();
        loadWeather();
      });
    });
  }

  function bindCityMenu() {
    const btn = $('#weather-city-btn');
    const menu = $('#weather-city-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      renderCityMenu();
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return;
      if (!e.target.closest('#weather-city-menu') && !e.target.closest('#weather-city-btn')) {
        menu.classList.add('hidden');
      }
    });
  }

  // ---------- Cities modal ----------
  function openCitiesModal() {
    $('#settings-menu')?.classList.add('hidden');
    renderCityList();
    const inp = $('#city-input'); if (inp) inp.value = '';
    const sug = $('#city-suggestions'); if (sug) { sug.innerHTML = ''; sug.classList.add('hidden'); }
    openModal('cities-modal');
  }

  function renderCityList() {
    const list = $('#city-list');
    if (!list) return;
    if (!state.savedCities.length) {
      list.innerHTML = `<div class="text-xs text-slate-500 py-2">No saved cities yet. Search above to add one.</div>`;
      return;
    }
    list.innerHTML = state.savedCities.map((c, i) => `
      <div class="city-list-row">
        <i data-lucide="map-pin" class="w-4 h-4 text-sky-300"></i>
        <span class="flex-1 truncate text-sm">${escapeHtml(c.label)}</span>
        <button class="icon-btn-sm" data-remove-city="${i}"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
      </div>
    `).join('');
    renderIcons(list);
    list.querySelectorAll('[data-remove-city]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.removeCity);
        const removed = state.savedCities[idx];
        state.savedCities.splice(idx, 1);
        localStorage.setItem(LS.savedCities, JSON.stringify(state.savedCities));
        // If the removed city was active, fall back to current location.
        if (removed && !state.activeCity.isCurrentLocation && state.activeCity.label === removed.label) {
          state.activeCity = { label: 'Current location', isCurrentLocation: true };
          localStorage.setItem(LS.activeCity, JSON.stringify(state.activeCity));
          loadWeather();
        }
        renderCityList();
        renderCityMenu();
      });
    });
  }

  function addCity(city) {
    if (state.savedCities.some(c => c.label === city.label)) return;
    if (state.savedCities.length >= 6) {
      alert('You can save up to 6 cities. Remove one first.');
      return;
    }
    state.savedCities.push(city);
    localStorage.setItem(LS.savedCities, JSON.stringify(state.savedCities));
    renderCityList();
    renderCityMenu();
  }

  const runGeocode = debounce(async (q) => {
    const sug = $('#city-suggestions');
    if (!sug) return;
    if (!q || q.length < 2) { sug.innerHTML = ''; sug.classList.add('hidden'); return; }
    const data = await fetchJSON(`/api/weather/geocode?q=${encodeURIComponent(q)}`);
    const results = (data && data.results) || [];
    if (!results.length) {
      sug.innerHTML = `<div class="city-suggestion text-slate-500">No matches</div>`;
      sug.classList.remove('hidden');
      return;
    }
    sug.innerHTML = results.map((r, i) => {
      const label = [r.name, r.state, r.country].filter(Boolean).join(', ');
      return `<button class="city-suggestion" data-i="${i}">${escapeHtml(label)}</button>`;
    }).join('');
    sug.classList.remove('hidden');
    sug.querySelectorAll('.city-suggestion[data-i]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = results[Number(btn.dataset.i)];
        const label = [r.name, r.state, r.country].filter(Boolean).join(', ');
        addCity({ label, lat: r.lat, lon: r.lon, isCurrentLocation: false });
        const inp = $('#city-input'); if (inp) inp.value = '';
        sug.innerHTML = ''; sug.classList.add('hidden');
      });
    });
  }, 320);

  function bindCitiesModal() {
    const manageBtn = $('#manage-cities-btn');
    if (manageBtn) manageBtn.addEventListener('click', openCitiesModal);
    const closeBtn = $('#cities-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal('cities-modal'));
    const saveBtn = $('#cities-save');
    if (saveBtn) saveBtn.addEventListener('click', () => closeModal('cities-modal'));
    const inp = $('#city-input');
    if (inp) inp.addEventListener('input', (e) => runGeocode(e.target.value.trim()));
  }

  // ============================================================
  //  STOCKS
  // ============================================================
  async function loadStocks() {
    const body = $('#stocks-body');
    if (!body) return;
    if (!state.tickers || !state.tickers.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'list-plus', title: 'No tickers yet',
        msg: 'Add tickers to start tracking.',
        action: 'Manage tickers', onAction: () => openModal('tickers-modal')
      }));
      renderIcons();
      return;
    }

    const data = await fetchJSON(`/api/stocks?symbols=${encodeURIComponent(state.tickers.join(','))}`);
    state.cache.stocks = data;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'wifi-off', title: 'Markets unavailable',
        msg: data.message || 'Could not load quotes.',
        action: 'Retry', onAction: loadStocks
      }));
      renderIcons();
      return;
    }

    renderStockSummary(data.quotes || []);
    if (state.stockTab === 'positions') renderPositions(data.quotes || []);
    else renderAllNews();
    updateHeroMarketPill(data.quotes || []);
  }

  function renderStockSummary(quotes) {
    const sum = $('#stocks-summary');
    if (!sum) return;
    const indexes = ['SPY', 'QQQ', 'DIA'];
    const present = indexes.map(s => quotes.find(q => q.symbol === s)).filter(Boolean);
    if (!present.length) {
      const avg = quotes.reduce((a, q) => a + (q.changePct || 0), 0) / Math.max(1, quotes.length);
      sum.innerHTML = `
        <div class="summary-tile"><div class="summary-label">Tickers</div><div class="summary-value">${quotes.length}</div></div>
        <div class="summary-tile"><div class="summary-label">Avg change</div><div class="summary-value ${avg >= 0 ? 'stock-up' : 'stock-down'}">${pctFmt(avg)}</div></div>
        <div class="summary-tile"><div class="summary-label">Gainers</div><div class="summary-value stock-up">${quotes.filter(q => (q.changePct || 0) > 0).length}</div></div>
      `;
      return;
    }
    sum.innerHTML = present.map(q => `
      <div class="summary-tile">
        <div class="summary-label">${q.symbol}</div>
        <div class="flex items-baseline gap-1.5">
          <span class="summary-value">${priceFmt(q.price)}</span>
          <span class="text-xs ${q.changePct >= 0 ? 'stock-up' : 'stock-down'}">${pctFmt(q.changePct)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderPositions(quotes) {
    const body = $('#stocks-body');
    if (!body) return;
    const filtered = quotes.filter(q => {
      if (!state.stockFilter) return true;
      const f = state.stockFilter.toLowerCase();
      return (q.symbol || '').toLowerCase().includes(f) || (q.name || '').toLowerCase().includes(f);
    });
    const sorted = [...filtered].sort((a, b) => {
      const k = state.sortKey;
      const va = a[k]; const vb = b[k];
      if (typeof va === 'string') return state.sortDir === 'asc' ? va.localeCompare(vb || '') : (vb || '').localeCompare(va || '');
      return state.sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });

    body.innerHTML = `
      <div class="stock-row stock-row-head">
        <div class="sortable-th" data-sort="symbol" ${state.sortKey === 'symbol' ? `data-dir="${state.sortDir}"` : ''}>Symbol</div>
        <div class="sortable-th" data-sort="name" ${state.sortKey === 'name' ? `data-dir="${state.sortDir}"` : ''}>Name</div>
        <div class="sortable-th" data-sort="price" ${state.sortKey === 'price' ? `data-dir="${state.sortDir}"` : ''}>Price</div>
        <div class="sortable-th" data-sort="changePct" ${state.sortKey === 'changePct' ? `data-dir="${state.sortDir}"` : ''}>Day %</div>
        <div class="sortable-th sparkline-cell">30D</div>
      </div>
      <div id="stock-rows"></div>
    `;

    const rowsEl = $('#stock-rows');
    sorted.forEach((q) => {
      const last = state.lastPrices[q.symbol];
      const moved = last != null && Math.abs((q.price || 0) - last) > 0.001;
      const movedDir = last != null ? (q.price > last ? 'moved-up' : 'moved-down') : '';
      state.lastPrices[q.symbol] = q.price;

      const row = document.createElement('div');
      row.className = `stock-row ${moved ? movedDir : ''}`;
      row.dataset.symbol = q.symbol;
      row.innerHTML = `
        <div class="stock-symbol">${q.symbol}</div>
        <div class="stock-name">${escapeHtml(q.name || '')}</div>
        <div class="tabular-nums">$${priceFmt(q.price)}</div>
        <div class="${q.changePct >= 0 ? 'stock-up' : 'stock-down'} font-semibold">${pctFmt(q.changePct)}</div>
        <div class="sparkline-cell"><canvas class="sparkline" id="spark-${q.symbol}"></canvas></div>
      `;
      row.addEventListener('click', () => toggleStockDetail(q.symbol));
      rowsEl.appendChild(row);

      if (state.expandedTicker === q.symbol) {
        row.classList.add('expanded');
        row.after(buildStockDetail(q));
      }
    });

    setTimeout(() => {
      sorted.forEach(q => {
        const c = document.getElementById(`spark-${q.symbol}`);
        if (!c) return;
        const up = (q.changePct || 0) >= 0;
        drawSparkline(c, q.sparkline || [], up ? '#10b981' : '#ef4444');
      });
    }, 0);

    $$('#stocks-body .sortable-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = k; state.sortDir = 'asc'; }
        renderPositions(state.cache.stocks?.quotes || []);
      });
    });
  }

  function drawSparkline(canvas, data, color) {
    if (!data || data.length < 2) { canvas.style.display = 'none'; return; }
    canvas.style.display = '';
    const key = 'spark_' + canvas.id;
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map((_, i) => i),
        datasets: [{ data, borderColor: color, borderWidth: 1.5, fill: false, pointRadius: 0, pointHoverRadius: 3, tension: 0.35 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true, callbacks: { label: (c) => `$${numFmt.format(c.raw)}` }, displayColors: false }
        },
        scales: { x: { display: false }, y: { display: false } },
        animation: false,
      }
    });
  }

  function buildStockDetail(q) {
    const det = document.createElement('div');
    det.className = 'stock-detail';
    const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}`;
    det.innerHTML = `
      <div class="stock-detail-grid">
        <div class="stock-detail-chartwrap">
          <div class="flex flex-wrap gap-1 mb-2" id="tf-${q.symbol}">
            ${['1D','5D','1M','3M','1Y','5Y'].map((t, i) => `<button class="timeframe-btn ${i === 2 ? 'active' : ''}" data-tf="${t}">${t}</button>`).join('')}
          </div>
          <div class="stock-detail-chart"><canvas id="detail-chart-${q.symbol}"></canvas></div>
        </div>
        <div class="stock-detail-stats">
          <div class="stat-price">$${priceFmt(q.price)}</div>
          <div class="text-sm ${q.changePct >= 0 ? 'stock-up' : 'stock-down'} font-semibold mb-2">
            ${q.change != null ? (q.change >= 0 ? '+' : '') + numFmt.format(q.change) : '—'} (${pctFmt(q.changePct)})
          </div>
          <div class="stat-row"><span>Day high</span><span>$${priceFmt(q.dayHigh)}</span></div>
          <div class="stat-row"><span>Day low</span><span>$${priceFmt(q.dayLow)}</span></div>
          <div class="stat-row"><span>52w high</span><span>$${priceFmt(q.fiftyTwoWeekHigh)}</span></div>
          <div class="stat-row"><span>52w low</span><span>$${priceFmt(q.fiftyTwoWeekLow)}</span></div>
          <div class="stat-row"><span>Volume</span><span>${q.volume != null ? compactFmt.format(q.volume) : '—'}</span></div>
          <a href="${yahooUrl}" target="_blank" rel="noopener" class="pill-btn justify-center mt-2 text-xs"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> Yahoo Finance</a>
        </div>
      </div>
      <div class="mt-3">
        <div class="weather-section-label">News for ${q.symbol}</div>
        <div id="detail-news-${q.symbol}" class="space-y-2">
          <div class="skeleton h-14 rounded-lg"></div>
          <div class="skeleton h-14 rounded-lg"></div>
        </div>
      </div>
    `;
    setTimeout(() => {
      renderIcons(det);
      loadDetailChart(q, '1M');
      det.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          det.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadDetailChart(q, btn.dataset.tf);
        });
      });
      loadStockNews(q.symbol);
    }, 0);
    return det;
  }

  // Maps the UI timeframe label to the /api/stock-chart range param.
  const TF_RANGE = { '1D': '1d', '5D': '5d', '1M': '1mo', '3M': '3mo', '1Y': '1y', '5Y': '5y' };

  async function loadDetailChart(q, tf) {
    const canvas = document.getElementById(`detail-chart-${q.symbol}`);
    if (!canvas) return;
    const range = TF_RANGE[tf] || '1mo';
    const cacheKey = `${q.symbol}:${range}`;
    let payload = state.cache.stockChartMap[cacheKey];
    if (!payload) {
      payload = await fetchJSON(`/api/stock-chart?symbol=${encodeURIComponent(q.symbol)}&range=${range}`);
      if (!payload.error) state.cache.stockChartMap[cacheKey] = payload;
    }
    const chartKey = 'detail_' + q.symbol;
    if (state.charts[chartKey]) { state.charts[chartKey].destroy(); delete state.charts[chartKey]; }

    if (payload.error || !payload.points || !payload.points.length) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const wrap = canvas.parentElement;
      if (wrap) wrap.innerHTML = `<div class="text-xs text-slate-500 grid place-items-center h-full">Chart data unavailable for this range.</div>`;
      return;
    }

    const pts = payload.points;
    const closes = pts.map(p => p.close);
    const up = closes[closes.length - 1] >= closes[0];
    const intraday = (range === '1d' || range === '5d');
    const labels = pts.map(p => {
      const d = new Date(p.t);
      return intraday
        ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, up ? 'rgba(16,185,129,0.38)' : 'rgba(239,68,68,0.38)');
    grad.addColorStop(1, up ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)');

    state.charts[chartKey] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: closes, borderColor: up ? '#10b981' : '#ef4444', backgroundColor: grad,
          fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)', borderColor: 'rgba(99,102,241,0.3)', borderWidth: 1,
            titleColor: '#cbd5e1', bodyColor: '#e2e8f0', padding: 10, displayColors: false,
            callbacks: { label: (c) => `$${numFmt.format(c.raw)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 7, autoSkip: true } },
          y: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#64748b', font: { size: 9 }, callback: (v) => '$' + Math.round(v) } }
        },
        animation: { duration: 350 },
      }
    });
  }

  async function loadStockNews(symbol) {
    const container = document.getElementById(`detail-news-${symbol}`);
    if (!container) return;
    let news = state.cache.stockNewsMap[symbol];
    if (!news) {
      const data = await fetchJSON(`/api/stock-news?symbol=${encodeURIComponent(symbol)}`);
      if (data.error) { container.innerHTML = `<div class="text-xs text-slate-500">News unavailable.</div>`; return; }
      news = data.news || [];
      state.cache.stockNewsMap[symbol] = news;
    }
    if (!news.length) { container.innerHTML = `<div class="text-xs text-slate-500">No recent news.</div>`; return; }
    container.innerHTML = news.slice(0, 5).map(n => `
      <a href="${n.url}" target="_blank" rel="noopener" class="block bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 rounded-lg p-2.5 transition">
        <div class="flex items-start justify-between gap-2">
          <div class="font-medium text-sm text-slate-200 leading-snug">${escapeHtml(n.title || '')}</div>
          <span class="sentiment-badge sentiment-${n.sentiment || 'neutral'}">${n.sentiment || 'neutral'}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">${escapeHtml(n.source || '')} · ${relTime(n.publishedAt)}</div>
      </a>
    `).join('');
  }

  function toggleStockDetail(symbol) {
    state.expandedTicker = state.expandedTicker === symbol ? null : symbol;
    renderPositions(state.cache.stocks?.quotes || []);
  }

  async function renderAllNews() {
    const body = $('#stocks-body');
    if (!body) return;
    body.innerHTML = `<div class="space-y-2"><div class="skeleton h-14 rounded-lg"></div><div class="skeleton h-14 rounded-lg"></div><div class="skeleton h-14 rounded-lg"></div></div>`;
    const topTickers = state.tickers.slice(0, 6);
    const results = await Promise.all(topTickers.map(async (s) => {
      if (state.cache.stockNewsMap[s]) return { s, news: state.cache.stockNewsMap[s] };
      const d = await fetchJSON(`/api/stock-news?symbol=${encodeURIComponent(s)}`);
      const news = d.news || [];
      state.cache.stockNewsMap[s] = news;
      return { s, news };
    }));
    const all = [];
    results.forEach(({ s, news }) => news.forEach(n => all.push({ ...n, symbol: s })));
    all.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    if (!all.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'newspaper', title: 'No news', msg: 'No recent news for your tickers.' }));
      renderIcons();
      return;
    }
    body.innerHTML = `<div class="space-y-2 max-h-96 overflow-y-auto pr-1">
      ${all.slice(0, 30).map(n => `
        <a href="${n.url}" target="_blank" rel="noopener" class="flex items-start gap-3 bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/40 rounded-lg p-3 transition">
          <div class="ticker-chip text-xs flex-shrink-0">${n.symbol}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm text-slate-200 leading-snug">${escapeHtml(n.title || '')}</div>
            <div class="text-xs text-slate-500 mt-1">${escapeHtml(n.source || '')} · ${relTime(n.publishedAt)}</div>
          </div>
          <span class="sentiment-badge sentiment-${n.sentiment || 'neutral'} flex-shrink-0">${n.sentiment || 'neutral'}</span>
        </a>
      `).join('')}
    </div>`;
  }

  function updateHeroMarketPill(quotes) {
    const indexes = ['SPY', 'QQQ', 'DIA'];
    const present = indexes.map(s => quotes.find(q => q.symbol === s)).filter(Boolean);
    const pill = $('#hero-market-pill');
    if (!pill) return;
    if (!present.length) {
      const avg = quotes.reduce((a, q) => a + (q.changePct || 0), 0) / Math.max(1, quotes.length);
      pill.innerHTML = `<i data-lucide="${avg >= 0 ? 'trending-up' : 'trending-down'}" class="w-4 h-4 ${avg >= 0 ? 'text-emerald-400' : 'text-red-400'}"></i> <span>Avg ${pctFmt(avg)}</span>`;
    } else {
      pill.innerHTML = present.map(q => `
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-slate-400">${q.symbol}</span>
          <span class="${q.changePct >= 0 ? 'stock-up' : 'stock-down'} font-semibold text-sm">${pctFmt(q.changePct)}</span>
        </span>
      `).join('<span class="text-slate-700 mx-1">·</span>');
    }
    renderIcons(pill);
  }

  // ============================================================
  //  CALENDAR (monthly view)
  // ============================================================
  function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function eventDateKey(ev) {
    if (!ev.start) return null;
    // All-day events: start is 'YYYY-MM-DD'
    if (/^\d{4}-\d{2}-\d{2}$/.test(ev.start)) return ev.start;
    const d = new Date(ev.start);
    if (isNaN(d.getTime())) return null;
    return localDateKey(d);
  }

  function isAllDay(ev) {
    return /^\d{4}-\d{2}-\d{2}$/.test(ev.start || '');
  }

  async function loadCalendar() {
    const body = $('#calendar-body');
    if (!body) return;
    const data = await fetchJSON('/api/calendar');
    state.cache.calendar = data;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'calendar-x', title: 'Calendar unavailable', msg: data.message || 'Try again later.', action: 'Retry', onAction: loadCalendar }));
      renderIcons();
      return;
    }

    if (data.authenticated === false) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'calendar-clock', title: 'Connect Google Calendar',
        msg: "See your month at a glance every morning.",
        action: 'Connect',
        onAction: () => {
          if (data.authUrl) {
            window.open(data.authUrl, '_gauth', 'width=560,height=720');
            const fh = () => { loadCalendar(); window.removeEventListener('focus', fh); };
            window.addEventListener('focus', fh);
          }
        }
      }));
      const cc = $('#calendar-count'); if (cc) cc.textContent = '';
      const ep = $('#hero-events-pill'); if (ep) ep.innerHTML = `<i data-lucide="calendar" class="w-4 h-4"></i> <span>Not connected</span>`;
      renderIcons();
      return;
    }

    const events = (data.events || []).filter(e => e.start);
    // Group events by local date key.
    state.eventsByDate = new Map();
    events.forEach(ev => {
      const k = eventDateKey(ev);
      if (!k) return;
      if (!state.eventsByDate.has(k)) state.eventsByDate.set(k, []);
      state.eventsByDate.get(k).push(ev);
    });
    // Sort each day's events by start time.
    state.eventsByDate.forEach(list => list.sort((a, b) => new Date(a.start) - new Date(b.start)));

    const todayKey = localDateKey(new Date());
    const todayEvents = state.eventsByDate.get(todayKey) || [];
    const cc = $('#calendar-count');
    if (cc) cc.textContent = `${todayEvents.length} today`;
    const ep = $('#hero-events-pill');
    if (ep) ep.innerHTML = `<i data-lucide="calendar" class="w-4 h-4 text-violet-300"></i> <span>${todayEvents.length} today</span>`;

    // Default selected day = today.
    if (!state.calSelectedDate) state.calSelectedDate = todayKey;
    renderCalendarMonth();
  }

  function renderCalendarMonth() {
    const body = $('#calendar-body');
    if (!body) return;
    const { year, month } = state.calView;
    const todayKey = localDateKey(new Date());

    const firstDow = new Date(year, month, 1).getDay();      // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    // Today's events summary
    const todayEvents = state.eventsByDate.get(todayKey) || [];
    let summaryHtml = '';
    if (todayEvents.length) {
      summaryHtml = `
        <div class="cal-today">
          <div class="cal-today-head">Today · ${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'}</div>
          ${todayEvents.slice(0, 5).map(e => `
            <div class="cal-today-row">
              <span class="cal-today-time">${isAllDay(e) ? 'all day' : timeFmt.format(new Date(e.start))}</span>
              <span class="truncate">${escapeHtml(e.title || '(no title)')}</span>
            </div>`).join('')}
        </div>`;
    } else {
      summaryHtml = `<div class="cal-today cal-today-empty"><i data-lucide="sparkles" class="w-4 h-4"></i> No events today — your calendar is clear.</div>`;
    }

    // Build 42 cells
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const offset = i - firstDow;
      let cellYear = year, cellMonth = month, cellDay, other = false;
      if (offset < 0) {
        other = true; cellDay = prevMonthDays + offset + 1;
        cellMonth = month - 1; if (cellMonth < 0) { cellMonth = 11; cellYear--; }
      } else if (offset >= daysInMonth) {
        other = true; cellDay = offset - daysInMonth + 1;
        cellMonth = month + 1; if (cellMonth > 11) { cellMonth = 0; cellYear++; }
      } else {
        cellDay = offset + 1;
      }
      const cellDate = new Date(cellYear, cellMonth, cellDay);
      const key = localDateKey(cellDate);
      const dayEvents = state.eventsByDate.get(key) || [];
      const isToday = key === todayKey;
      const isSel = key === state.calSelectedDate;
      const dots = dayEvents.slice(0, 3).map(() => `<span class="cal-dot"></span>`).join('') +
                   (dayEvents.length > 3 ? `<span class="cal-dot-more">+</span>` : '');
      cells += `
        <button class="cal-day ${other ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${dayEvents.length ? 'has-events' : ''}" data-key="${key}">
          <span class="cal-day-num">${cellDay}</span>
          <span class="cal-dots">${dots}</span>
        </button>`;
    }

    body.innerHTML = `
      ${summaryHtml}
      <div class="cal-nav">
        <button class="icon-btn-sm" id="cal-prev"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <button class="cal-month-label" id="cal-today-btn">${MONTHS[month]} ${year}</button>
        <button class="icon-btn-sm" id="cal-next"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
      </div>
      <div class="cal-grid cal-daynames">
        ${['S','M','T','W','T','F','S'].map(d => `<div class="cal-dayname">${d}</div>`).join('')}
      </div>
      <div class="cal-grid" id="cal-cells">${cells}</div>
      <div id="cal-day-panel" class="cal-day-panel"></div>
    `;

    // Nav handlers
    $('#cal-prev').addEventListener('click', () => {
      state.calView.month--;
      if (state.calView.month < 0) { state.calView.month = 11; state.calView.year--; }
      renderCalendarMonth();
    });
    $('#cal-next').addEventListener('click', () => {
      state.calView.month++;
      if (state.calView.month > 11) { state.calView.month = 0; state.calView.year++; }
      renderCalendarMonth();
    });
    $('#cal-today-btn').addEventListener('click', () => {
      const now = new Date();
      state.calView = { year: now.getFullYear(), month: now.getMonth() };
      state.calSelectedDate = localDateKey(now);
      renderCalendarMonth();
    });

    // Day cell clicks
    $$('#cal-cells .cal-day').forEach(cell => {
      cell.addEventListener('click', () => {
        state.calSelectedDate = cell.dataset.key;
        $$('#cal-cells .cal-day').forEach(c => c.classList.toggle('selected', c === cell));
        renderDayPanel(cell.dataset.key);
      });
    });

    renderDayPanel(state.calSelectedDate);
    renderIcons(body);
  }

  function renderDayPanel(key) {
    const panel = $('#cal-day-panel');
    if (!panel || !key) return;
    const events = state.eventsByDate.get(key) || [];
    const d = new Date(key + 'T00:00:00');
    const heading = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!events.length) {
      panel.innerHTML = `<div class="cal-panel-head">${heading}</div><div class="text-xs text-slate-500 py-1">No events.</div>`;
      return;
    }
    panel.innerHTML = `<div class="cal-panel-head">${heading} · ${events.length} event${events.length === 1 ? '' : 's'}</div>` +
      events.map((e, i) => {
        const meetLink = (e.link || '').match(/(meet\.google|zoom\.us|teams\.microsoft)/i) ? e.link : null;
        const timeStr = isAllDay(e) ? 'All day'
          : `${timeFmt.format(new Date(e.start))}${e.end ? ' – ' + timeFmt.format(new Date(e.end)) : ''}`;
        return `
          <div class="cal-event" data-i="${i}">
            <div class="cal-event-time">${timeStr}</div>
            <div class="cal-event-body">
              <div class="cal-event-title">${escapeHtml(e.title || '(no title)')}</div>
              <div class="cal-event-meta">
                ${e.location ? `<span class="inline-flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3"></i>${escapeHtml(e.location)}</span>` : ''}
                ${e.attendees && e.attendees.length ? `<span class="inline-flex items-center gap-1"><i data-lucide="users" class="w-3 h-3"></i>${e.attendees.length}</span>` : ''}
                ${meetLink ? `<a href="${meetLink}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><i data-lucide="video" class="w-3 h-3"></i>Join</a>` : ''}
              </div>
              ${e.description ? `<div class="cal-event-desc hidden">${escapeHtml(e.description).slice(0, 600)}</div>` : ''}
            </div>
          </div>`;
      }).join('');
    panel.querySelectorAll('.cal-event').forEach(row => {
      const desc = row.querySelector('.cal-event-desc');
      if (desc) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          desc.classList.toggle('hidden');
        });
      }
    });
    renderIcons(panel);
  }

  // ============================================================
  //  INBOX
  // ============================================================
  const CATEGORY_CLASS = {
    'Action Required': 'cat-action',
    'Finance': 'cat-finance',
    'Work': 'cat-work',
    'Personal': 'cat-personal',
    'Notification': 'cat-notification',
  };

  async function loadInbox() {
    const body = $('#inbox-body');
    if (!body) return;
    const data = await fetchJSON('/api/inbox');
    state.cache.inbox = data;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'mail-x', title: 'Inbox unavailable', msg: data.message || 'Try again later.', action: 'Retry', onAction: loadInbox }));
      renderIcons();
      return;
    }

    if (data.authenticated === false) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'mail', title: 'Connect Gmail',
        msg: 'See your important morning emails here.',
        action: 'Connect',
        onAction: () => {
          if (data.authUrl) {
            window.open(data.authUrl, '_gauth', 'width=560,height=720');
            const fh = () => { loadInbox(); window.removeEventListener('focus', fh); };
            window.addEventListener('focus', fh);
          }
        }
      }));
      const ic = $('#inbox-count'); if (ic) ic.textContent = '';
      const ip = $('#hero-inbox-pill'); if (ip) ip.innerHTML = `<i data-lucide="mail" class="w-4 h-4"></i> <span>Not connected</span>`;
      renderIcons();
      return;
    }

    const highlights = data.highlights || [];
    const ic = $('#inbox-count'); if (ic) ic.textContent = `${highlights.length}`;
    const highCount = highlights.filter(h => h.importance === 'high').length;
    const actionCount = highlights.reduce((a, h) => a + ((h.actionItems || []).length ? 1 : 0), 0);
    const ip = $('#hero-inbox-pill');
    if (ip) ip.innerHTML = `<i data-lucide="mail" class="w-4 h-4 text-amber-300"></i> <span>${highlights.length} highlights${actionCount ? ` · ${actionCount} to action` : (highCount ? ` · ${highCount} priority` : '')}</span>`;

    if (!highlights.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'inbox', title: 'Inbox is calm', msg: 'No new highlights this morning.' }));
      renderIcons();
      return;
    }

    body.innerHTML = '';
    highlights.forEach(h => {
      const card = document.createElement('a');
      card.className = 'inbox-card';
      card.href = h.threadUrl || '#';
      card.target = '_blank';
      card.rel = 'noopener';
      const catClass = CATEGORY_CLASS[h.category] || 'cat-notification';
      const actionsHtml = (h.actionItems || []).slice(0, 3).map(a =>
        `<span class="action-chip"><i data-lucide="circle-dot" class="w-3 h-3"></i>${escapeHtml(a)}</span>`).join('');
      card.innerHTML = `
        <div class="inbox-card-top">
          <span class="importance-dot importance-${h.importance || 'low'}" title="${h.importance || ''} priority"></span>
          <span class="category-chip ${catClass}">${escapeHtml(h.category || 'Mail')}</span>
          <span class="inbox-time">${relTime(h.receivedAt)}</span>
        </div>
        <div class="inbox-sender">${escapeHtml(h.from || '')}${h.fromEmail ? ` <span class="inbox-email">${escapeHtml(h.fromEmail)}</span>` : ''}</div>
        <div class="inbox-subject">${escapeHtml(h.subject || '(no subject)')}</div>
        <div class="inbox-snippet">${escapeHtml(h.snippet || '')}</div>
        ${actionsHtml ? `<div class="inbox-actions">${actionsHtml}</div>` : ''}
      `;
      body.appendChild(card);
    });
    renderIcons();
  }

  // ============================================================
  //  WORLD NEWS (accordion)
  // ============================================================
  function buildNewsChips() {
    const cats = CFG.newsCategories || ['Top'];
    const chips = $('#news-chips');
    if (!chips) return;
    chips.innerHTML = cats.map(c => `<button class="news-chip ${c === state.newsCategory ? 'active' : ''}" data-cat="${c}">${escapeHtml(c)}</button>`).join('');
    chips.querySelectorAll('.news-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.newsCategory = btn.dataset.cat;
        localStorage.setItem(LS.newsCategory, state.newsCategory);
        chips.querySelectorAll('.news-chip').forEach(b => b.classList.toggle('active', b === btn));
        loadWorldNews();
      });
    });
  }

  function applyNewsExpanded() {
    const coll = $('#news-collapsible');
    const chev = $('#news-chevron');
    if (coll) coll.classList.toggle('hidden', !state.newsExpanded);
    if (chev) chev.style.transform = state.newsExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
  }

  function bindNewsAccordion() {
    const header = $('#news-header');
    if (!header) return;
    header.addEventListener('click', (e) => {
      // Don't toggle when the refresh control inside the header is clicked.
      if (e.target.closest('[data-refresh]')) return;
      state.newsExpanded = !state.newsExpanded;
      localStorage.setItem(LS.newsExpanded, String(state.newsExpanded));
      applyNewsExpanded();
      if (state.newsExpanded && !state.newsLoaded) loadWorldNews();
    });
    applyNewsExpanded();
  }

  async function loadWorldNews() {
    const body = $('#news-body');
    if (!body) return;
    body.innerHTML = `<div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div>`;
    const data = await fetchJSON(`/api/world-news?category=${encodeURIComponent(state.newsCategory)}`);
    state.cache.worldNews = data;
    state.newsLoaded = true;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'newspaper', title: 'News unavailable', msg: data.message || 'Try again later.', action: 'Retry', onAction: loadWorldNews }));
      renderIcons();
      return;
    }
    const articles = data.articles || [];
    const countEl = $('#news-count'); if (countEl) countEl.textContent = String(articles.length);
    const updEl = $('#news-updated'); if (updEl) updEl.textContent = data.asOf ? `updated ${relTime(data.asOf)}` : '';

    if (!articles.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'newspaper', title: 'No stories', msg: `No ${state.newsCategory} stories right now.` }));
      renderIcons();
      return;
    }
    body.innerHTML = articles.map(a => `
      <a class="news-tile" href="${a.url}" target="_blank" rel="noopener">
        ${a.image ? `<div class="news-tile-img" style="background-image:url('${a.image}')"></div>` : ''}
        <div class="news-tile-body">
          <div class="news-source-badge">${escapeHtml(a.source || a.category || '')}</div>
          <div class="news-tile-title">${escapeHtml(a.title || '')}</div>
          <div class="news-tile-summary">${escapeHtml(a.summary || '')}</div>
          <div class="news-tile-meta">${relTime(a.publishedAt)}</div>
        </div>
      </a>
    `).join('');
    renderIcons();
  }

  // ============================================================
  //  CHART OPTIONS
  // ============================================================
  function chartOptions({ unit = '' } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          borderColor: 'rgba(99,102,241,0.3)',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#e2e8f0',
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (c) => unit === '$' ? `$${numFmt.format(c.raw)}` : `${Math.round(c.raw)}${unit}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } },
        y: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#64748b', font: { size: 10 } } }
      },
      animation: { duration: 500 }
    };
  }

  // ============================================================
  //  REFRESH ORCHESTRATION
  // ============================================================
  async function refreshAll(showSpinner = true) {
    const btn = $('#refresh-all');
    if (showSpinner && btn) btn.classList.add('spinning');
    state.cache.stockNewsMap = {};
    state.cache.stockChartMap = {};
    await Promise.all([
      loadWeather(), loadStocks(), loadCalendar(), loadInbox(), loadWorldNews()
    ]);
    if (btn) btn.classList.remove('spinning');
  }

  function bindCardRefresh() {
    $$('[data-refresh]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = btn.dataset.refresh;
        btn.classList.add('spinning');
        const fnMap = { weather: loadWeather, stocks: loadStocks, calendar: loadCalendar, inbox: loadInbox, news: loadWorldNews };
        Promise.resolve(fnMap[k] && fnMap[k]()).finally(() => btn.classList.remove('spinning'));
      });
    });
  }

  // ============================================================
  //  TICKERS MODAL
  // ============================================================
  function renderTickerList() {
    const list = $('#ticker-list');
    if (!list) return;
    list.innerHTML = state.tickers.map(t => `
      <span class="ticker-chip">${t}<button data-remove="${t}"><i data-lucide="x" class="w-3 h-3"></i></button></span>
    `).join('');
    renderIcons(list);
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tickers = state.tickers.filter(t => t !== btn.dataset.remove);
        renderTickerList();
      });
    });
  }

  function openModal(id) { const m = $(`#${id}`); if (m) m.classList.remove('hidden'); }
  function closeModal(id) { const m = $(`#${id}`); if (m) m.classList.add('hidden'); }

  function bindTickerModal() {
    const mb = $('#manage-tickers-btn');
    if (mb) mb.addEventListener('click', () => { renderTickerList(); openModal('tickers-modal'); $('#settings-menu')?.classList.add('hidden'); });
    const cb = $('#tickers-close');
    if (cb) cb.addEventListener('click', () => closeModal('tickers-modal'));
    const addBtn = $('#ticker-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      const inp = $('#ticker-input');
      const v = (inp.value || '').trim().toUpperCase();
      if (v && !state.tickers.includes(v)) { state.tickers.push(v); renderTickerList(); }
      inp.value = '';
    });
    const ti = $('#ticker-input');
    if (ti) ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ticker-add').click(); });
    const rs = $('#tickers-reset');
    if (rs) rs.addEventListener('click', () => { state.tickers = [...(CFG.tickers || [])]; renderTickerList(); });
    const sv = $('#tickers-save');
    if (sv) sv.addEventListener('click', () => {
      localStorage.setItem(LS.tickers, JSON.stringify(state.tickers));
      closeModal('tickers-modal');
      loadStocks();
    });
  }

  // ============================================================
  //  SETTINGS
  // ============================================================
  function bindSettings() {
    const sb = $('#settings-btn');
    if (sb) sb.addEventListener('click', (e) => {
      e.stopPropagation();
      $('#settings-menu')?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      const m = $('#settings-menu');
      if (!m || m.classList.contains('hidden')) return;
      if (!e.target.closest('#settings-menu') && !e.target.closest('#settings-btn')) m.classList.add('hidden');
    });
    const tt = $('#theme-toggle');
    if (tt) tt.addEventListener('click', toggleTheme);
    $$('.unit-btn').forEach(b => b.addEventListener('click', () => setUnits(b.dataset.unit)));
    const ar = $('#autorefresh-select');
    if (ar) {
      ar.value = String(state.autoRefresh);
      ar.addEventListener('change', (e) => {
        state.autoRefresh = Number(e.target.value);
        localStorage.setItem(LS.autoRefresh, String(state.autoRefresh));
        startAutoRefresh();
      });
    }
  }

  function bindTabs() {
    $$('.stock-tab').forEach(t => {
      t.addEventListener('click', () => {
        $$('.stock-tab').forEach(x => x.classList.remove('tab-active'));
        t.classList.add('tab-active');
        state.stockTab = t.dataset.tab;
        if (state.cache.stocks?.quotes) {
          if (state.stockTab === 'positions') renderPositions(state.cache.stocks.quotes);
          else renderAllNews();
        }
      });
    });
  }

  function bindSearch() {
    const s = $('#stock-search');
    if (s) s.addEventListener('input', (e) => {
      state.stockFilter = e.target.value || '';
      if (state.cache.stocks?.quotes && state.stockTab === 'positions') renderPositions(state.cache.stocks.quotes);
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refreshAll(true); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleTheme(); }
      else if (e.key === 'Escape') { $$('.modal-backdrop').forEach(m => m.classList.add('hidden')); }
    });
    $$('.modal-backdrop').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
  }

  // ============================================================
  //  INIT
  // ============================================================
  async function init() {
    applyTheme();
    $$('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === state.units));
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(() => {
      const w = state.cache.weather?.current;
      if (w?.sunrise && w?.sunset) renderSunBar(w.sunrise, w.sunset);
    }, 60000);

    bindCardRefresh();
    bindSettings();
    bindTabs();
    bindSearch();
    bindKeyboard();
    bindTickerModal();
    bindCityMenu();
    bindCitiesModal();
    bindNewsAccordion();
    buildNewsChips();
    renderCityMenu();

    const ra = $('#refresh-all');
    if (ra) ra.addEventListener('click', () => refreshAll(true));

    renderIcons();
    await getCoords();
    refreshAll(false);
    startAutoRefresh();

    window.addEventListener('focus', () => {
      if (state.cache.calendar?.authenticated === false) loadCalendar();
      if (state.cache.inbox?.authenticated === false) loadInbox();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose for debugging
  window.GME.refreshAll = refreshAll;
  window.GME.loadWeather = loadWeather;
  window.GME.loadStocks = loadStocks;
  window.GME.loadCalendar = loadCalendar;
  window.GME.loadInbox = loadInbox;
  window.GME.loadWorldNews = loadWorldNews;
})();
