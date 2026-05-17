/* =================================================================
 * Good Morning Eli — front-end logic
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
  };

  // ---------- State ----------
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
    cache: { weather: null, stocks: null, calendar: null, inbox: null, worldNews: null, stockNewsMap: {} },
    lastPrices: {},   // for flash animations
    charts: {},       // chart.js instances by id
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
      <div class="state-title">${title || ''}</div>
      <div class="state-msg">${msg || ''}</div>
      ${action ? `<button class="pill-btn" data-state-action>${action}</button>` : ''}
    `;
    if (action && onAction) {
      setTimeout(() => {
        const btn = wrap.querySelector('[data-state-action]');
        if (btn) btn.addEventListener('click', onAction);
      }, 0);
    }
    return wrap;
  }

  // ---------- Theme / settings ----------
  function applyTheme() {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    document.documentElement.classList.toggle('light', state.theme === 'light');
    const lbl = $('#theme-label');
    if (lbl) lbl.textContent = state.theme === 'dark' ? 'Dark' : 'Light';
    // Update chart.js defaults
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
    // Re-render charts to pick up new colors
    Object.keys(state.charts).forEach(k => { try { state.charts[k].update(); } catch(e){} });
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
    $('#hero-clock').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const dateStr = dateFmt.format(now);
    $('#hero-date').textContent = dateStr;
    $('#topbar-date').textContent = dateStr;
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
        resolve(state.coords);
        return;
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

  // ============================================================
  //  WEATHER
  // ============================================================
  async function loadWeather() {
    const body = $('#weather-body');
    if (!state.coords) await getCoords();
    const { lat, lon } = state.coords;
    body.innerHTML = `<div class="skeleton h-40 rounded-xl mb-3"></div><div class="skeleton h-24 rounded-xl mb-3"></div><div class="skeleton h-16 rounded-xl"></div>`;

    const data = await fetchJSON(`/api/weather?lat=${lat}&lon=${lon}&units=${state.units}`);
    state.cache.weather = data;

    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({
        icon: 'cloud-off',
        title: 'Weather unavailable',
        msg: data.message || 'Could not load weather.',
        action: 'Retry', onAction: loadWeather
      }));
      renderIcons();
      return;
    }

    const cur = data.current || {};
    const loc = data.location || (state.coords.fallback ? 'New York City' : '');
    $('#weather-location').textContent = loc;

    const alertsHtml = (data.alerts || []).slice(0, 2).map(a => `
      <div class="bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs px-3 py-2 rounded-lg mb-2">
        <div class="font-semibold">${a.event || 'Alert'}</div>
        <div class="opacity-80">${a.description || ''}</div>
      </div>
    `).join('');

    body.innerHTML = `
      ${alertsHtml}
      <div class="weather-hero">
        <div class="weather-icon-big"><i data-lucide="${weatherIcon(cur.icon, cur.conditions)}"></i></div>
        <div>
          <div class="weather-temp">${Math.round(cur.temp ?? 0)}<span class="text-2xl text-slate-400 font-medium">${tempUnit()}</span></div>
          <div class="text-sm text-slate-400 mt-1">${cur.conditions || ''} · Feels like ${Math.round(cur.feelsLike ?? cur.temp ?? 0)}${tempUnit()}</div>
          <div class="text-xs text-slate-500 mt-1">Humidity ${cur.humidity ?? '—'}% · Wind ${cur.wind ?? '—'} ${speedUnit()}</div>
        </div>
      </div>

      <div class="weather-hourly-wrap">
        <div class="text-xs text-slate-400 uppercase tracking-widest mb-1">Next 12 hours</div>
        <div class="weather-hourly"><canvas id="weather-hourly-chart"></canvas></div>
      </div>

      <div class="text-xs text-slate-400 uppercase tracking-widest mt-3 mb-1">7-day</div>
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
    if (c.includes('snow')) return 'cloud-snow';
    if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'cloud-rain';
    if (c.includes('cloud')) return 'cloud';
    if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloud-fog';
    if (c.includes('clear') || c.includes('sun')) return 'sun';
    if (icon && /n$/.test(icon)) return 'moon';
    return 'sun';
  }

  function renderHourly(hourly) {
    const canvas = $('#weather-hourly-chart');
    if (!canvas || !hourly.length) return;
    if (state.charts.hourly) state.charts.hourly.destroy();
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 120);
    grad.addColorStop(0, 'rgba(56,189,248,0.4)');
    grad.addColorStop(1, 'rgba(56,189,248,0.02)');

    state.charts.hourly = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hourly.slice(0, 12).map(h => h.time ? new Date(h.time).getHours() + ':00' : ''),
        datasets: [{
          data: hourly.slice(0, 12).map(h => h.temp),
          borderColor: '#38bdf8',
          backgroundColor: grad,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        }]
      },
      options: chartOptions({ unit: tempUnit() })
    });
  }

  function renderDaily(daily) {
    const cont = $('#weather-daily');
    if (!cont) return;
    const days = daily.slice(0, 7);
    const allTemps = days.flatMap(d => [d.high, d.low]).filter(v => v != null);
    const minT = Math.min(...allTemps, 0);
    const maxT = Math.max(...allTemps, 1);
    const span = maxT - minT || 1;
    cont.innerHTML = days.map(d => {
      const lo = d.low ?? 0, hi = d.high ?? 0;
      const left = ((lo - minT) / span) * 100;
      const width = ((hi - lo) / span) * 100;
      return `
        <div class="weather-day" title="${d.conditions || ''}">
          <div class="weather-day-label">${d.day || ''}</div>
          <div class="weather-day-bar">
            <div class="weather-day-bar-fill" style="left:${left}%; width:${width}%;"></div>
          </div>
          <div class="weather-day-temp"><span class="text-sky-300">${Math.round(lo)}°</span> / <span>${Math.round(hi)}°</span></div>
        </div>
      `;
    }).join('');
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
    pill.innerHTML = `<i data-lucide="${weatherIcon(cur.icon, cur.conditions)}" class="w-4 h-4 text-sky-300"></i> <span>${Math.round(cur.temp ?? 0)}${tempUnit()} · ${cur.conditions || ''}</span>`;
    renderIcons(pill);
  }

  // ============================================================
  //  STOCKS
  // ============================================================
  async function loadStocks() {
    if (!state.tickers || !state.tickers.length) {
      $('#stocks-body').innerHTML = '';
      $('#stocks-body').appendChild(stateBlock({
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
      $('#stocks-body').innerHTML = '';
      $('#stocks-body').appendChild(stateBlock({
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
    const indexes = ['SPY', 'QQQ', 'DIA'];
    const present = indexes.map(s => quotes.find(q => q.symbol === s)).filter(Boolean);
    if (!present.length) {
      // total portfolio approximation = avg change
      const avg = quotes.reduce((a, q) => a + (q.changePct || 0), 0) / Math.max(1, quotes.length);
      sum.innerHTML = `
        <div class="rounded-lg bg-slate-800/50 border border-slate-700 p-2">
          <div class="text-[10px] uppercase text-slate-500 tracking-widest">Tickers</div>
          <div class="font-bold text-lg">${quotes.length}</div>
        </div>
        <div class="rounded-lg bg-slate-800/50 border border-slate-700 p-2">
          <div class="text-[10px] uppercase text-slate-500 tracking-widest">Avg change</div>
          <div class="font-bold text-lg ${avg >= 0 ? 'stock-up' : 'stock-down'}">${pctFmt(avg)}</div>
        </div>
        <div class="rounded-lg bg-slate-800/50 border border-slate-700 p-2">
          <div class="text-[10px] uppercase text-slate-500 tracking-widest">Gainers</div>
          <div class="font-bold text-lg stock-up">${quotes.filter(q => (q.changePct || 0) > 0).length}</div>
        </div>
      `;
      return;
    }
    sum.innerHTML = present.map(q => `
      <div class="rounded-lg bg-slate-800/50 border border-slate-700 p-2">
        <div class="text-[10px] uppercase text-slate-500 tracking-widest">${q.symbol}</div>
        <div class="flex items-baseline gap-1">
          <span class="font-bold tabular-nums">${priceFmt(q.price)}</span>
          <span class="text-xs ${q.changePct >= 0 ? 'stock-up' : 'stock-down'}">${pctFmt(q.changePct)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderPositions(quotes) {
    const body = $('#stocks-body');
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
      <div class="stock-row !cursor-default !border-0 !py-1 hover:!bg-transparent">
        <div class="sortable-th" data-sort="symbol" ${state.sortKey==='symbol' ? `data-dir="${state.sortDir}"`:''}>Symbol</div>
        <div class="sortable-th" data-sort="name" ${state.sortKey==='name' ? `data-dir="${state.sortDir}"`:''}>Name</div>
        <div class="sortable-th" data-sort="price" ${state.sortKey==='price' ? `data-dir="${state.sortDir}"`:''}>Price</div>
        <div class="sortable-th" data-sort="changePct" ${state.sortKey==='changePct' ? `data-dir="${state.sortDir}"`:''}>Chg %</div>
        <div class="sortable-th sparkline-cell">Spark</div>
      </div>
      <div id="stock-rows"></div>
    `;

    const rowsEl = $('#stock-rows');
    sorted.forEach((q, i) => {
      const last = state.lastPrices[q.symbol];
      const moved = last != null && Math.abs((q.price || 0) - last) > 0.001;
      const movedDir = last != null ? (q.price > last ? 'moved-up' : 'moved-down') : '';
      state.lastPrices[q.symbol] = q.price;

      const row = document.createElement('div');
      row.className = `stock-row ${moved ? movedDir : ''}`;
      row.dataset.symbol = q.symbol;
      row.innerHTML = `
        <div class="stock-symbol">${q.symbol}</div>
        <div class="stock-name">${q.name || ''}</div>
        <div class="tabular-nums">$${priceFmt(q.price)}</div>
        <div class="${q.changePct >= 0 ? 'stock-up' : 'stock-down'} font-semibold">${pctFmt(q.changePct)}</div>
        <div class="sparkline-cell"><canvas class="sparkline" id="spark-${q.symbol}"></canvas></div>
      `;
      row.addEventListener('click', () => toggleStockDetail(q.symbol, row));
      rowsEl.appendChild(row);

      if (state.expandedTicker === q.symbol) {
        row.classList.add('expanded');
        const detail = buildStockDetail(q);
        row.after(detail);
      }
    });

    // sparklines
    setTimeout(() => {
      sorted.forEach(q => {
        const c = document.getElementById(`spark-${q.symbol}`);
        if (!c) return;
        drawSparkline(c, q.sparkline || [], q.changePct >= 0 ? '#10b981' : '#ef4444');
      });
    }, 0);

    // sort handlers
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
    if (!data || data.length < 2) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = '';
    if (state.charts['spark_' + canvas.id]) state.charts['spark_' + canvas.id].destroy();
    state.charts['spark_' + canvas.id] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map((_, i) => i),
        datasets: [{
          data, borderColor: color, borderWidth: 1.5, fill: false,
          pointRadius: 0, pointHoverRadius: 3, tension: 0.35
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          enabled: true,
          callbacks: { label: (c) => `$${numFmt.format(c.raw)}` },
          displayColors: false
        }},
        scales: { x: { display: false }, y: { display: false } },
        animation: false,
      }
    });
  }

  function buildStockDetail(q) {
    const det = document.createElement('div');
    det.className = 'stock-detail';
    det.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div class="text-2xl font-bold tabular-nums">$${priceFmt(q.price)}
            <span class="text-base ${q.changePct >= 0 ? 'stock-up' : 'stock-down'}">${pctFmt(q.changePct)}</span>
          </div>
          <div class="text-xs text-slate-400 mt-1">
            Day: $${priceFmt(q.dayLow)} – $${priceFmt(q.dayHigh)} · Vol ${compactFmt.format(q.volume || 0)} · MCap ${compactFmt.format(q.marketCap || 0)}
          </div>
        </div>
        <div class="flex gap-1">
          ${['1D','5D','1M','3M','1Y','5Y'].map((t, i) => `<button class="timeframe-btn ${i===0?'active':''}" data-tf="${t}">${t}</button>`).join('')}
        </div>
      </div>
      <div style="height:200px;"><canvas id="detail-chart-${q.symbol}"></canvas></div>
      <div class="mt-4">
        <div class="text-xs text-slate-400 uppercase tracking-widest mb-2">News for ${q.symbol}</div>
        <div id="detail-news-${q.symbol}" class="space-y-2">
          <div class="skeleton h-16 rounded-lg"></div>
          <div class="skeleton h-16 rounded-lg"></div>
        </div>
      </div>
    `;
    setTimeout(() => {
      drawDetailChart(q, '1D');
      det.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          det.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          drawDetailChart(q, btn.dataset.tf);
        });
      });
      loadStockNews(q.symbol);
    }, 0);
    return det;
  }

  function drawDetailChart(q, tf) {
    const canvas = document.getElementById(`detail-chart-${q.symbol}`);
    if (!canvas) return;
    if (state.charts['detail_' + q.symbol]) state.charts['detail_' + q.symbol].destroy();
    // Synthetic series from sparkline + small variation per tf
    const base = (q.sparkline && q.sparkline.length) ? q.sparkline : Array.from({ length: 24 }, (_, i) => q.price);
    const seedMap = { '1D': 1, '5D': 1.4, '1M': 2.1, '3M': 3.5, '1Y': 5, '5Y': 9 };
    const factor = seedMap[tf] || 1;
    const seed = q.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const len = Math.min(80, Math.max(20, base.length * factor));
    const data = Array.from({ length: Math.round(len) }, (_, i) => {
      const v = base[i % base.length];
      const noise = Math.sin((seed + i) / 3) * (q.price || 100) * 0.005 * factor;
      return v + noise * (i % 5 === 0 ? 1 : -1);
    });

    const ctx = canvas.getContext('2d');
    const up = q.changePct >= 0;
    const grad = ctx.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, up ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)');
    grad.addColorStop(1, up ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)');
    state.charts['detail_' + q.symbol] = new Chart(ctx, {
      type: 'line',
      data: { labels: data.map((_, i) => i), datasets: [{
        data, borderColor: up ? '#10b981' : '#ef4444', backgroundColor: grad,
        fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2
      }]},
      options: chartOptions({ unit: '$' })
    });
  }

  async function loadStockNews(symbol) {
    const container = document.getElementById(`detail-news-${symbol}`);
    if (!container) return;
    let news = state.cache.stockNewsMap[symbol];
    if (!news) {
      const data = await fetchJSON(`/api/stock-news?symbol=${encodeURIComponent(symbol)}`);
      if (data.error) {
        container.innerHTML = `<div class="text-xs text-slate-500">News unavailable.</div>`;
        return;
      }
      news = data.news || [];
      state.cache.stockNewsMap[symbol] = news;
    }
    if (!news.length) {
      container.innerHTML = `<div class="text-xs text-slate-500">No recent news.</div>`;
      return;
    }
    container.innerHTML = news.slice(0, 5).map(n => `
      <a href="${n.url}" target="_blank" rel="noopener" class="block bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 rounded-lg p-2.5 transition">
        <div class="flex items-start justify-between gap-2">
          <div class="font-medium text-sm text-slate-200 leading-snug">${n.title}</div>
          <span class="sentiment-badge sentiment-${n.sentiment || 'neutral'}">${n.sentiment || 'neutral'}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">${n.source || ''} · ${relTime(n.publishedAt)}</div>
      </a>
    `).join('');
  }

  function toggleStockDetail(symbol, row) {
    if (state.expandedTicker === symbol) {
      state.expandedTicker = null;
    } else {
      state.expandedTicker = symbol;
    }
    renderPositions(state.cache.stocks?.quotes || []);
  }

  async function renderAllNews() {
    const body = $('#stocks-body');
    body.innerHTML = `<div class="space-y-2"><div class="skeleton h-14 rounded-lg"></div><div class="skeleton h-14 rounded-lg"></div><div class="skeleton h-14 rounded-lg"></div></div>`;
    // Aggregate top 5 tickers' news (or cached)
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
            <div class="font-medium text-sm text-slate-200 leading-snug">${n.title}</div>
            <div class="text-xs text-slate-500 mt-1">${n.source || ''} · ${relTime(n.publishedAt)}</div>
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
  //  CALENDAR
  // ============================================================
  async function loadCalendar() {
    const body = $('#calendar-body');
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
      const block = stateBlock({
        icon: 'calendar-clock',
        title: 'Connect Google Calendar',
        msg: 'See today\'s events here every morning.',
        action: 'Connect',
        onAction: () => {
          if (data.authUrl) {
            window.open(data.authUrl, '_gauth', 'width=560,height=720');
            const focusHandler = () => { loadCalendar(); window.removeEventListener('focus', focusHandler); };
            window.addEventListener('focus', focusHandler);
          }
        }
      });
      body.appendChild(block);
      $('#calendar-count').textContent = '';
      $('#hero-events-pill').innerHTML = `<i data-lucide="calendar" class="w-4 h-4"></i> <span>Not connected</span>`;
      renderIcons();
      return;
    }

    const events = data.events || [];
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const todayEnd = todayStart + 24 * 3600 * 1000;
    const todayEvents = events.filter(e => {
      const t = new Date(e.start).getTime();
      return t >= todayStart && t < todayEnd;
    });
    const tomorrowEvents = events.filter(e => {
      const t = new Date(e.start).getTime();
      return t >= todayEnd && t < todayEnd + 24 * 3600 * 1000;
    });

    $('#calendar-count').textContent = `${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'}`;
    $('#hero-events-pill').innerHTML = `<i data-lucide="calendar" class="w-4 h-4 text-violet-300"></i> <span>${todayEvents.length} today</span>`;

    if (!todayEvents.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'sparkles', title: 'No events today', msg: 'Your calendar is clear. Enjoy.' }));
      if (tomorrowEvents.length) body.appendChild(buildTomorrowSection(tomorrowEvents));
      renderIcons();
      return;
    }

    body.innerHTML = '';
    todayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    todayEvents.forEach((e, idx) => body.appendChild(buildEventRow(e, idx)));
    if (tomorrowEvents.length) body.appendChild(buildTomorrowSection(tomorrowEvents));
    renderIcons();
  }

  function buildEventRow(e, idx) {
    const row = document.createElement('div');
    row.className = 'event-row';
    const start = e.start ? timeFmt.format(new Date(e.start)) : '—';
    const end = e.end ? timeFmt.format(new Date(e.end)) : '';
    const meetLink = (e.link || '').match(/(meet\.google|zoom\.us|teams\.microsoft)/i) ? e.link : null;
    row.innerHTML = `
      <div class="event-time">${start}<br><span class="text-slate-500">${end}</span></div>
      <div class="event-card" data-idx="${idx}">
        <div class="event-title">${e.title || '(Untitled)'}</div>
        <div class="event-meta">
          ${e.location ? `<span class="inline-flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3"></i>${e.location}</span>` : ''}
          ${e.attendees && e.attendees.length ? `<span class="inline-flex items-center gap-1"><i data-lucide="users" class="w-3 h-3"></i>${e.attendees.length}</span>` : ''}
          ${meetLink ? `<a href="${meetLink}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><i data-lucide="video" class="w-3 h-3"></i>Join</a>` : ''}
        </div>
        <div class="event-description hidden">${e.description || ''}</div>
      </div>
    `;
    const card = row.querySelector('.event-card');
    card.addEventListener('click', () => {
      const desc = card.querySelector('.event-description');
      if (desc && desc.textContent.trim()) desc.classList.toggle('hidden');
    });
    return row;
  }

  function buildTomorrowSection(events) {
    const wrap = document.createElement('details');
    wrap.className = 'mt-3 pt-3 border-t border-slate-800';
    wrap.innerHTML = `
      <summary class="cursor-pointer text-xs uppercase tracking-widest text-slate-400 hover:text-slate-200">
        Tomorrow preview · ${events.length}
      </summary>
      <div class="mt-3 space-y-2 opacity-80">
        ${events.slice(0, 5).map(e => `
          <div class="text-xs text-slate-300">
            <span class="text-violet-300 tabular-nums mr-2">${e.start ? timeFmt.format(new Date(e.start)) : ''}</span>
            ${e.title || ''}
          </div>
        `).join('')}
      </div>
    `;
    return wrap;
  }

  // ============================================================
  //  INBOX
  // ============================================================
  async function loadInbox() {
    const body = $('#inbox-body');
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
      const block = stateBlock({
        icon: 'mail',
        title: 'Connect Gmail',
        msg: 'See your important morning emails here.',
        action: 'Connect',
        onAction: () => {
          if (data.authUrl) {
            window.open(data.authUrl, '_gauth', 'width=560,height=720');
            const focusHandler = () => { loadInbox(); window.removeEventListener('focus', focusHandler); };
            window.addEventListener('focus', focusHandler);
          }
        }
      });
      body.appendChild(block);
      $('#inbox-count').textContent = '';
      $('#hero-inbox-pill').innerHTML = `<i data-lucide="mail" class="w-4 h-4"></i> <span>Not connected</span>`;
      renderIcons();
      return;
    }

    const highlights = data.highlights || [];
    $('#inbox-count').textContent = `${highlights.length}`;
    const highCount = highlights.filter(h => h.importance === 'high').length;
    $('#hero-inbox-pill').innerHTML = `<i data-lucide="mail" class="w-4 h-4 text-amber-300"></i> <span>${highlights.length} highlights${highCount ? ` · ${highCount} priority` : ''}</span>`;

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
      const initial = (h.from || '?').trim().charAt(0).toUpperCase();
      const colorIdx = (h.from || '').length % 6;
      const palette = ['#6366f1','#f43f5e','#10b981','#f59e0b','#06b6d4','#a855f7'];
      const avatarBg = palette[colorIdx];
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="category-chip">${h.category || 'Mail'}</span>
          <span class="importance-dot importance-${h.importance || 'low'}" title="${h.importance || ''}"></span>
        </div>
        <div class="flex items-center gap-2">
          <div class="inbox-avatar" style="background:${avatarBg}">${initial}</div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate">${h.from || ''}</div>
            <div class="text-xs text-slate-500">${relTime(h.receivedAt)}</div>
          </div>
        </div>
        <div class="font-semibold text-sm truncate">${h.subject || ''}</div>
        <div class="text-xs text-slate-400 line-clamp-2" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${h.snippet || ''}</div>
      `;
      body.appendChild(card);
    });
    renderIcons();
  }

  // ============================================================
  //  WORLD NEWS
  // ============================================================
  function buildNewsChips() {
    const cats = CFG.newsCategories || ['Top'];
    const chips = $('#news-chips');
    chips.innerHTML = cats.map(c => `<button class="news-chip ${c === state.newsCategory ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('');
    chips.querySelectorAll('.news-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.newsCategory = btn.dataset.cat;
        localStorage.setItem(LS.newsCategory, state.newsCategory);
        chips.querySelectorAll('.news-chip').forEach(b => b.classList.toggle('active', b === btn));
        loadWorldNews();
      });
    });
  }

  async function loadWorldNews() {
    const body = $('#news-body');
    body.innerHTML = `<div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div>`;
    const data = await fetchJSON(`/api/world-news?category=${encodeURIComponent(state.newsCategory)}`);
    state.cache.worldNews = data;
    if (data.error) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'newspaper', title: 'News unavailable', msg: data.message || 'Try again later.', action: 'Retry', onAction: loadWorldNews }));
      renderIcons();
      return;
    }
    const articles = data.articles || [];
    if (!articles.length) {
      body.innerHTML = '';
      body.appendChild(stateBlock({ icon: 'newspaper', title: 'No stories', msg: `No ${state.newsCategory} stories right now.` }));
      renderIcons();
      return;
    }
    body.innerHTML = articles.slice(0, 8).map(a => `
      <a class="news-tile" href="${a.url}" target="_blank" rel="noopener">
        ${a.image ? `<div class="news-tile-img" style="background-image:url('${a.image}')"></div>` : ''}
        <div class="news-tile-body">
          <div class="news-source-badge">${a.source || a.category || ''}</div>
          <div class="news-tile-title">${a.title || ''}</div>
          <div class="news-tile-summary">${a.summary || ''}</div>
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
      animation: { duration: 600 }
    };
  }

  // ============================================================
  //  REFRESH ORCHESTRATION
  // ============================================================
  async function refreshAll(showSpinner = true) {
    const btn = $('#refresh-all');
    if (showSpinner && btn) btn.classList.add('spinning');
    state.cache.stockNewsMap = {};
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
        Promise.resolve(fnMap[k]?.()).finally(() => btn.classList.remove('spinning'));
      });
    });
  }

  // ============================================================
  //  TICKERS MODAL
  // ============================================================
  function renderTickerList() {
    const list = $('#ticker-list');
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

  function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
  function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

  function bindTickerModal() {
    $('#manage-tickers-btn').addEventListener('click', () => { renderTickerList(); openModal('tickers-modal'); $('#settings-menu').classList.add('hidden'); });
    $('#tickers-close').addEventListener('click', () => closeModal('tickers-modal'));
    $('#ticker-add').addEventListener('click', () => {
      const inp = $('#ticker-input');
      const v = (inp.value || '').trim().toUpperCase();
      if (v && !state.tickers.includes(v)) { state.tickers.push(v); renderTickerList(); }
      inp.value = '';
    });
    $('#ticker-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ticker-add').click(); });
    $('#tickers-reset').addEventListener('click', () => { state.tickers = [...(CFG.tickers || [])]; renderTickerList(); });
    $('#tickers-save').addEventListener('click', () => {
      localStorage.setItem(LS.tickers, JSON.stringify(state.tickers));
      closeModal('tickers-modal');
      loadStocks();
    });
  }

  function bindLocationModal() {
    $('#set-location-btn').addEventListener('click', () => { openModal('location-modal'); $('#settings-menu').classList.add('hidden'); });
    $('#location-close').addEventListener('click', () => closeModal('location-modal'));
    $('#location-detect').addEventListener('click', () => {
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
          localStorage.setItem(LS.coords, JSON.stringify(c));
          state.coords = c;
          closeModal('location-modal');
          loadWeather();
        },
        () => alert('Geolocation denied. Enter coordinates manually.')
      );
    });
    $('#location-save').addEventListener('click', () => {
      const lat = parseFloat($('#lat-input').value);
      const lon = parseFloat($('#lon-input').value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const c = { lat, lon, ts: Date.now() };
        localStorage.setItem(LS.coords, JSON.stringify(c));
        state.coords = c;
        closeModal('location-modal');
        loadWeather();
      }
    });
  }

  // ============================================================
  //  SETTINGS
  // ============================================================
  function bindSettings() {
    $('#settings-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#settings-menu').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      const m = $('#settings-menu');
      if (!m || m.classList.contains('hidden')) return;
      if (!e.target.closest('#settings-menu') && !e.target.closest('#settings-btn')) m.classList.add('hidden');
    });
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $$('.unit-btn').forEach(b => b.addEventListener('click', () => setUnits(b.dataset.unit)));
    $('#autorefresh-select').value = String(state.autoRefresh);
    $('#autorefresh-select').addEventListener('change', (e) => {
      state.autoRefresh = Number(e.target.value);
      localStorage.setItem(LS.autoRefresh, String(state.autoRefresh));
      startAutoRefresh();
    });
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
    $('#stock-search').addEventListener('input', (e) => {
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
      // Update sun progress without re-rendering everything
      const w = state.cache.weather?.current;
      if (w?.sunrise && w?.sunset) renderSunBar(w.sunrise, w.sunset);
    }, 60000);

    bindCardRefresh();
    bindSettings();
    bindTabs();
    bindSearch();
    bindKeyboard();
    bindTickerModal();
    bindLocationModal();
    buildNewsChips();

    $('#refresh-all').addEventListener('click', () => refreshAll(true));

    renderIcons();
    await getCoords();
    refreshAll(false);
    startAutoRefresh();

    // Re-poll calendar/inbox on focus (auth flow)
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
