// ============ 自律日志 - 文件驱动 + 动画 ============

(function() {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
  const WEEKDAY_NAMES = ['一','二','三','四','五','六','日'];
  const escapeHtml = s => { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };

  function getWeekDays(base) {
    const day = base.getDay();
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMon);
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate()+i); days.push(d); }
    return days;
  }
  function weekNumber(d) {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((Math.floor((d-jan1)/86400000) + jan1.getDay() + 1) / 7);
  }

  // ================================================
  // 动画系统
  // ================================================
  const FX = {
    // 粒子爆发
    burst(x, y, colors = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6']) {
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:9999;`;
      const n = 18;
      for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        const c = colors[Math.floor(Math.random()*colors.length)];
        const size = 6 + Math.random()*6;
        const angle = (i/n)*Math.PI*2 + Math.random()*0.5;
        const dist = 60 + Math.random()*80;
        p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${c};border-radius:50%;left:0;top:0;transform:translate(-50%,-50%);animation:lt-burst-${i%3} 0.9s cubic-bezier(.2,.7,.3,1) forwards;--dx:${Math.cos(angle)*dist}px;--dy:${Math.sin(angle)*dist}px;`;
        p.style.animationName = 'lt-particle';
        p.style.setProperty('--dx', Math.cos(angle)*dist + 'px');
        p.style.setProperty('--dy', Math.sin(angle)*dist + 'px');
        wrap.appendChild(p);
      }
      document.body.appendChild(wrap);
      setTimeout(() => wrap.remove(), 1000);
    },

    // +1 浮字
    floatText(x, y, text, color) {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = `position:fixed;left:${x}px;top:${y}px;color:${color};font-weight:700;font-size:20px;pointer-events:none;z-index:9999;animation:lt-floatup 1.2s ease-out forwards;text-shadow:0 2px 6px rgba(0,0,0,0.15);transform:translate(-50%,-50%);`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    },

    // confetti 彩屑
    confetti(duration = 3000) {
      const colors = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4'];
      const end = Date.now() + duration;
      (function frame() {
        for (let i = 0; i < 3; i++) {
          const el = document.createElement('div');
          el.style.cssText = `position:fixed;top:-10px;left:${Math.random()*100}vw;width:8px;height:14px;background:${colors[Math.floor(Math.random()*colors.length)]};z-index:9999;pointer-events:none;border-radius:1px;transform:rotate(${Math.random()*360}deg);animation:lt-confetti 2.5s cubic-bezier(.25,.46,.45,.94) forwards;animation-delay:${Math.random()*0.3}s;`;
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 3000);
        }
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    },

    // 热力图格子点亮 pulse
    pulseCell(ds) {
      const cell = document.querySelector(`.lt-heat-cell[data-date="${ds}"]`);
      if (!cell) return;
      cell.style.animation = 'none';
      cell.offsetHeight;
      cell.style.animation = 'lt-pulse 0.8s ease-out';
      setTimeout(() => cell.style.animation = '', 800);
    },
  };

  // ================================================
  // 连续打卡天数
  // ================================================
  function calcStreak() {
    const dates = new Set(appData.logs.map(l => l.date));
    return dates.size;
  }

  // ================================================
  // 文件 I/O 层
  // ================================================
  const FileIO = {
    fileName: '',
    parseMd(text) {
      const m = text.match(/~~~json\n([\s\S]*?)~~~/);
      if (m) { try { return JSON.parse(m[1].trim()); } catch {} }
      const m2 = text.match(/```json\n([\s\S]*?)```/);
      if (m2) { try { return JSON.parse(m2[1].trim()); } catch {} }
      return null;
    },

    toMd(appData) {
      const today = fmtDate(new Date());
      const nickname = appData.nickname || '朋友';
      const jsonLine = JSON.stringify({ v: 3, nickname: appData.nickname || '', logs: appData.logs });
      return `# 🌟 ${nickname} 的自律打卡纸

> 这是 ${nickname} 的自律日志。打开这个 .md 文件即可继续记录。
> 记得经常点「💾 保存」覆盖回这个文件。

---

## 📦 数据区

~~~json
${jsonLine}
~~~

> 最后更新 ${today}
`;
    },

    newTemplate(nickname) {
      return this.toMd({ nickname: nickname || '朋友', logs: [] });
    },

    async openFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,text/markdown';
        input.onchange = async () => {
          const f = input.files[0]; if (!f) return resolve(null);
          this.fileName = f.name;
          try {
            const text = await f.text();
            const data = this.parseMd(text);
            if (!data) return reject(new Error('不是有效的打卡纸文件'));
            resolve(data);
          } catch (e) { reject(e); }
        };
        input.onerror = () => reject(new Error('打开失败'));
        input.click();
      });
    },

    async saveFile(appData) {
      const mdText = this.toMd(appData);
      const blob = new Blob([mdText], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName || `lanx-journal-${fmtDate(new Date())}.md`;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    },

    newFile(nickname) {
      const text = this.newTemplate(nickname);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nickname || 'my'}-自律打卡纸-${fmtDate(new Date())}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  // ================================================
  // 数据层
  // ================================================
  let appData = { nickname: '', logs: [] };
  let fileLoaded = false;

  const Store = {
    getLogs() { return appData.logs; },
    getNickname() { return appData.nickname || '朋友'; },
    addLog(date, content, catName, catColor) {
      appData.logs.push({ id: uid(), date, content, catName, catColor });
    },
    deleteLog(id) {
      appData.logs = appData.logs.filter(l => l.id !== id);
    },
    getLogsByDate(ds) { return appData.logs.filter(l => l.date === ds); },
    getLogsByMonth(y, m) {
      const p = `${y}-${String(m).padStart(2,'0')}`;
      return appData.logs.filter(l => l.date.startsWith(p));
    },
    getAllCategories() {
      const map = {};
      appData.logs.forEach(l => { map[l.catName] = l.catColor; });
      return map;
    },
  };

  // ================================================
  // 图表 (加生长动画)
  // ================================================
  const Charts = {
    renderLineChart(year, month, mount, animate = false) {
      const logs = Store.getLogsByMonth(year, month);
      const daysInMonth = new Date(year, month, 0).getDate();
      const today = fmtDate(new Date());
      const catMap = {};
      logs.forEach(l => { catMap[l.catName] = l.catColor; });
      const cats = Object.keys(catMap);

      const daily = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        daily[ds] = {};
        cats.forEach(c => daily[ds][c] = 0);
        daily[ds].total = 0;
      }
      logs.forEach(l => {
        if (daily[l.date]) { daily[l.date][l.catName]++; daily[l.date].total++; }
      });

      const lastDs = (month === new Date().getMonth()+1 && year === new Date().getFullYear())
        ? today : `${year}-${String(month).padStart(2,'0')}-${daysInMonth}`;
      const lastDay = parseInt(lastDs.split('-')[2]);

      if (!cats.length) { mount.innerHTML = '<div class="lt-chart-no-data">本月暂无记录</div>'; return; }

      const W = 280, H = 120, padL = 28, padR = 8, padT = 12, padB = 20;
      const innerW = W - padL - padR, innerH = H - padT - padB;
      const maxY = Math.max(5, ...Object.values(daily).map(d => d.total));
      const dayStep = innerW / Math.max(lastDay - 1, 1);
      const xOf = d => padL + (d - 1) * dayStep;
      const yOf = v => padT + innerH - (v / maxY) * innerH;

      let svg = `<svg viewBox="0 0 ${W} ${H}" class="lt-line-chart" preserveAspectRatio="none">`;
      for (let i = 0; i <= 2; i++) {
        const v = (maxY / 2) * i, y = yOf(v);
        svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eee"/>`;
        svg += `<text x="${padL-4}" y="${y+3}" font-size="9" fill="#bbb" text-anchor="end">${v}</text>`;
      }
      cats.forEach((cat, catIdx) => {
        const points = [];
        for (let d = 1; d <= lastDay; d++) {
          const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const v = daily[ds][cat];
          if (v > 0) points.push({ x: xOf(d), y: yOf(v) });
        }
        if (!points.length) return;
        const pathD = points.map((p, i) => `${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const color = catMap[cat];
        const pathCls = animate ? `lt-line-draw lt-line-c${catIdx%4}` : '';
        svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="${pathCls}"/>`;
        points.forEach(p => {
          const delay = animate ? `;animation-delay:${catIdx*0.15+0.4}s` : '';
          svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" stroke="#fff" stroke-width="1.5" class="${animate?'lt-dot-pop':''}" style="${delay}"/>`;
        });
      });
      for (let d = 1; d <= lastDay; d += Math.max(5, Math.ceil(lastDay / 6))) {
        svg += `<text x="${xOf(d)}" y="${H-4}" font-size="9" fill="#bbb" text-anchor="middle">${d}</text>`;
      }
      svg += '</svg>';
      mount.innerHTML = svg;
    },

    renderHeatmap(year, month, mount, highlightDate = null) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const firstDay = new Date(year, month - 1, 1);
      let firstDow = firstDay.getDay();
      firstDow = firstDow === 0 ? 6 : firstDow - 1;

      const prefix = `${year}-${String(month).padStart(2,'0')}`;
      const logsByDay = {};
      Store.getLogs().forEach(l => {
        if (l.date.startsWith(prefix)) logsByDay[l.date] = (logsByDay[l.date] || 0) + 1;
      });

      const today = fmtDate(new Date());
      const sel = state.selectedDate;
      const header = ['一','二','三','四','五','六','日'];

      let html = `<div class="lt-heatmap-header">${header.map(h => `<span>${h}</span>`).join('')}</div>`;
      html += '<div class="lt-heatmap">';
      for (let i = 0; i < firstDow; i++) html += '<div class="lt-heat-blank"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${prefix}-${String(d).padStart(2,'0')}`;
        const cnt = logsByDay[ds] || 0;
        let level = 'lt-heat-l0';
        if (cnt >= 3) level = 'lt-heat-l3';
        else if (cnt >= 1) level = 'lt-heat-l1';
        const extra = (ds === today ? ' lt-heat-today' : '') + (ds === sel ? ' lt-heat-selected' : '') + (ds === highlightDate && cnt >= 3 ? ' lt-heat-new' : '');
        html += `<div class="lt-heat-cell ${level}${extra}" title="${month}月${d}日 · ${cnt}件" data-date="${ds}">${d}</div>`;
      }
      html += '</div>';
      mount.innerHTML = html;
    },

    renderPieChart(weekLogs, mount, animate = false) {
      if (!weekLogs.length) { mount.innerHTML = ''; return; }
      const counts = {};
      weekLogs.forEach(l => { counts[l.catName] = (counts[l.catName] || 0) + 1; });
      const total = weekLogs.length;
      const colors = {};
      weekLogs.forEach(l => { if (!colors[l.catName]) colors[l.catName] = l.catColor; });

      const CX = 70, CY = 70, R = 60;
      let sa = -Math.PI / 2, paths = '', idx = 0;
      Object.entries(counts).forEach(([cat, v]) => {
        if (!v) return;
        const angle = (v / total) * Math.PI * 2;
        const ea = sa + angle;
        const x1 = CX + R * Math.cos(sa), y1 = CY + R * Math.sin(sa);
        const x2 = CX + R * Math.cos(ea), y2 = CY + R * Math.sin(ea);
        const large = angle > Math.PI ? 1 : 0;
        const color = colors[cat];
        if (v === total) paths += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${color}"/>`;
        else paths += `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z" fill="${color}" class="${animate?'lt-pie-slice':''}" style="animation-delay:${idx*0.12}s"/>`;
        sa = ea; idx++;
      });
      const pieCls = animate ? 'lt-pie-pop' : '';
      mount.innerHTML = `<svg viewBox="0 0 140 140" class="${pieCls}">
        ${paths}
        <circle cx="${CX}" cy="${CY}" r="${R*0.5}" fill="#fff"/>
        <text x="${CX}" y="${CY-2}" text-anchor="middle" font-size="18" font-weight="700" fill="#111827">${total}</text>
        <text x="${CX}" y="${CY+14}" text-anchor="middle" font-size="10" fill="#9ca3af">本周总计</text>
      </svg>`;
    },
  };

  // ================================================
  // 主应用
  // ================================================
  let state = { selectedDate: fmtDate(new Date()), weekOffset: 0 };

  function init() {
    const mount = document.getElementById('lanx-todo-mount');
    if (!mount) return;
    document.body.classList.add('lanx-todo-active');
    mount.innerHTML = '<div id="lanx-todo-root"></div>';
    renderFileScreen();
  }

  // 时间问候
  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了, 注意休息';
    if (h < 11) return '早安, 一天才刚开始';
    if (h < 14) return '午好, 记得吃午饭';
    if (h < 18) return '下午继续加油';
    if (h < 22) return '晚上好, 今天辛苦了';
    return '夜已深, 早点休息吧';
  }

  function renderFileScreen() {
    const root = $('#lanx-todo-root');
    root.innerHTML = `
      <div class="lt-file-screen lt-enter">
        <div class="lt-file-icon">📋</div>
        <h2 class="lt-file-title">打卡器</h2>
        <p class="lt-file-desc">所有数据存储在你的本地 .md 文件中 · 无需注册 · 无需密码</p>
        <div class="lt-file-actions">
          <button class="lt-btn lt-btn-primary" id="lt-btn-open">📂 打开我的打卡纸</button>
          <button class="lt-btn" id="lt-btn-new">✨ 生成空白模板</button>
        </div>
        <div class="lt-file-hint">
          1. 生成空白模板 → 把 .md 文件放到你想放的地方<br>
          2. 每次使用 → 打开这个 .md → 添加记录 → 保存覆盖<br>
          3. 换设备 → 复制 .md 过去, 打开继续
        </div>
      </div>`;
    $('#lt-btn-open').onclick = async () => {
      try {
        const data = await FileIO.openFile();
        if (!data) return;
        appData = { nickname: data.nickname || '', logs: data.logs || [] };
        fileLoaded = true;
        renderMain();
        FX.confetti(2500);
      } catch (e) { alert('打开失败: ' + e.message); }
    };
    $('#lt-btn-new').onclick = () => {
      openNicknameModal(name => {
        FileIO.newFile(name);
        alert('空白模板已下载, 打开这个文件即可开始使用');
      });
    };
  }

  function openNicknameModal(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'lt-modal-overlay';
    overlay.innerHTML = `
      <div class="lt-modal">
        <h3 class="lt-modal-title">给自己起个名字</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 12px;">打卡纸会用这个名字生成问候语</p>
        <input class="lt-modal-input" id="lt-nick-input" placeholder="我的名字" maxlength="16"/>
        <div class="lt-modal-actions">
          <button class="lt-btn" id="lt-nick-skip">跳过</button>
          <button class="lt-btn lt-btn-primary" id="lt-nick-ok">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = $('#lt-nick-input', overlay);
    input.focus();
    const done = () => {
      const v = input.value.trim() || '朋友';
      overlay.remove();
      callback(v);
    };
    $('#lt-nick-ok', overlay).onclick = done;
    $('#lt-nick-skip', overlay).onclick = done;
    input.onkeydown = e => { if (e.key === 'Enter') done(); };
  }

  function renderMain() {
    const nickname = Store.getNickname();
    const streak = calcStreak();
    const weekDays = getWeekDays(getBaseDate());

    const root = $('#lanx-todo-root');
    root.innerHTML = `
      <div class="lt-greeting lt-enter">
        <div class="lt-greet-text">
          <div class="lt-greet-hello">你好, <span class="lt-greet-name">${escapeHtml(nickname)}</span></div>
          <div class="lt-greet-streak">您已经坚持 <span class="lt-greet-num">${streak}</span> 天</div>
          <div class="lt-greet-sub">${getTimeGreeting()}, 请继续保持 ✨</div>
        </div>
        <div class="lt-greet-visual">
          <div class="lt-fire-emoji">🔥</div>
          <div class="lt-streak-ring">
            <svg viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17" fill="none" stroke="#e5e7eb" stroke-width="3"/>
              <circle cx="20" cy="20" r="17" fill="none" stroke="#f97316" stroke-width="3"
                stroke-dasharray="${Math.min(streak, 30) * 3.56} 110" stroke-linecap="round"
                transform="rotate(-90 20 20)" class="lt-ring-draw"/>
            </svg>
          </div>
        </div>
      </div>

      <div class="lt-toolbar">
        <div class="lt-toolbar-left">
          <h2 class="lt-title">📝 打卡器</h2>
          <span class="lt-file-badge">📄 ${escapeHtml(FileIO.fileName || '未命名.md')}</span>
        </div>
        <div class="lt-toolbar-right">
          <button class="lt-btn" id="lt-btn-open2">📂 换文件</button>
          <button class="lt-btn" id="lt-btn-save">💾 保存</button>
        </div>
      </div>

      <div class="lt-week-nav">
        <button class="lt-week-arrow" id="lt-week-prev">◀</button>
        <div class="lt-week-days" id="lt-week-days"></div>
        <button class="lt-week-arrow" id="lt-week-next">▶</button>
      </div>

      <div class="lt-main">
        <div class="lt-panel">
          <h3 class="lt-panel-title" id="lt-today-title">📝 今日记录</h3>
          <div class="lt-log-list" id="lt-log-list"></div>
          <div class="lt-add-row">
            <button class="lt-add-btn" id="lt-add-btn">+ 添加今日做的事</button>
          </div>
        </div>
        <div class="lt-panel">
          <h3 class="lt-panel-title">📊 本月数据</h3>
          <div class="lt-chart-section">
            <div class="lt-chart-label" id="lt-line-legend">每日趋势</div>
            <div id="lt-line-chart"></div>
          </div>
          <div class="lt-chart-section">
            <div class="lt-chart-label">月度热力图 · 3件及以上标亮</div>
            <div class="lt-heatmap-wrap" id="lt-heatmap"></div>
          </div>
        </div>
      </div>

      <div class="lt-summary">
        <h3 class="lt-summary-title" id="lt-summary-title">📋 本周总结</h3>
        <div class="lt-summary-content">
          <div class="lt-summary-text" id="lt-summary-text"></div>
          <div class="lt-pie-wrap" id="lt-pie-chart"></div>
        </div>
      </div>
    `;
    renderWeekDays(weekDays);
    renderLogList();
    renderMonthCharts(true);
    renderWeekSummary(weekDays, true);
    bindEvents();
  }

  function renderWeekDays(weekDays) {
    const cont = $('#lt-week-days');
    const today = fmtDate(new Date());
    cont.innerHTML = weekDays.map(d => {
      const ds = fmtDate(d);
      const cnt = Store.getLogsByDate(ds).length;
      const isToday = ds === today ? 'lt-today' : '';
      const isSel = ds === state.selectedDate ? 'lt-selected' : '';
      return `<div class="lt-week-day ${isToday} ${isSel}" data-date="${ds}">
        <span class="lt-day-name">${WEEKDAY_NAMES[(d.getDay()+6)%7]}</span>
        <span class="lt-day-date">${d.getMonth()+1}/${d.getDate()}</span>
        <span class="lt-day-count">${cnt > 0 ? cnt + '件' : ''}</span>
      </div>`;
    }).join('');
  }

  function renderLogList(animateNew = null) {
    const cont = $('#lt-log-list');
    const title = $('#lt-today-title');
    const d = parseDate(state.selectedDate);
    title.textContent = `📝 ${d.getMonth()+1}月${d.getDate()}日 记录`;
    const logs = Store.getLogsByDate(state.selectedDate);
    if (!logs.length) {
      cont.innerHTML = '<div class="lt-log-empty">这一天还没记录~ 点下面 + 号开始吧</div>';
      return;
    }
    cont.innerHTML = logs.map((l, i) => {
      const bgColor = l.catColor + '1f';
      const isNew = animateNew && l.id === animateNew ? ' lt-log-new' : '';
      const delay = isNew ? `;animation-delay:${i*0.05}s` : '';
      return `<div class="lt-log-item${isNew}" data-id="${l.id}" style="border-left-color:${l.catColor};background:${bgColor}${delay}">
        <span class="lt-log-cat" style="background:${l.catColor};color:#fff">${escapeHtml(l.catName)}</span>
        <span class="lt-log-text">${escapeHtml(l.content)}</span>
        <button class="lt-log-del" data-id="${l.id}" title="删除">×</button>
      </div>`;
    }).join('');
  }

  function renderMonthCharts(animate = false) {
    const d = parseDate(state.selectedDate);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    Charts.renderLineChart(y, m, $('#lt-line-chart'), animate);
    const cats = Store.getAllCategories();
    const items = Object.entries(cats).map(([name, color]) =>
      `<span><span class="lt-legend-dot" style="background:${color}"></span>${escapeHtml(name)}</span>`
    ).join('');
    $('#lt-line-legend').innerHTML = '每日趋势 ' + (items || '<span style="color:#d1d5db">(暂无数据)</span>');
    Charts.renderHeatmap(y, m, $('#lt-heatmap'));
  }

  function renderWeekSummary(weekDays, animate = false) {
    $('#lt-summary-title').textContent = `📋 本周总结 · ${weekDays[0].getMonth()+1}/${weekDays[0].getDate()} — ${weekDays[6].getMonth()+1}/${weekDays[6].getDate()}`;
    const keys = weekDays.map(fmtDate);
    const list = Store.getLogs().filter(l => keys.includes(l.date));
    const textEl = $('#lt-summary-text');
    if (list.length) {
      const counts = {}, colors = {};
      list.forEach(l => { counts[l.catName] = (counts[l.catName] || 0) + 1; if (!colors[l.catName]) colors[l.catName] = l.catColor; });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const maxV = Math.max(...entries.map(e => e[1]));
      textEl.innerHTML = entries.map(([name, v], i) => {
        const color = colors[name];
        const pct = (v / maxV * 100).toFixed(0);
        const animDelay = animate ? `animation-delay:${i*0.1}s;` : '';
        return `<div class="lt-summary-line" style="${animDelay}">
          <div class="lt-summary-meta">
            <span><span class="lt-legend-dot" style="background:${color}"></span>${escapeHtml(name)}</span>
            <span>${v} 件</span>
          </div>
          <div class="lt-summary-bar">
            <div class="lt-summary-bar-fill${animate?' lt-bar-grow':''}" style="width:${pct}%;background:${color};${animDelay}"></div>
          </div>
        </div>`;
      }).join('');
      const first = entries[0][0], last = entries[entries.length - 1][0];
      const hint = entries.length > 1
        ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">本周「${escapeHtml(first)}」最多 ｜「${escapeHtml(last)}」相对少</div>`
        : `<div style="font-size:12px;color:#6b7280;margin-top:4px;">本周主要在「${escapeHtml(first)}」</div>`;
      textEl.insertAdjacentHTML('beforeend', hint);
      Charts.renderPieChart(list, $('#lt-pie-chart'), animate);
    } else {
      textEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;">本周暂无记录</div>';
      $('#lt-pie-chart').innerHTML = '';
    }
  }

  function bindEvents() {
    $('#lt-week-prev').onclick = () => { state.weekOffset--; refreshAll(); };
    $('#lt-week-next').onclick = () => { state.weekOffset++; refreshAll(); };
    $('#lt-week-days').addEventListener('click', e => {
      const el = e.target.closest('.lt-week-day');
      if (el) { state.selectedDate = el.dataset.date; refreshAll(); }
    });
    $('#lt-heatmap').addEventListener('click', e => {
      const el = e.target.closest('.lt-heat-cell');
      if (el) { state.selectedDate = el.dataset.date; state.weekOffset = 0; refreshAll(); }
    });
    $('#lt-add-btn').onclick = () => openAddModal();
    $('#lt-log-list').addEventListener('click', e => {
      const btn = e.target.closest('.lt-log-del');
      if (btn && confirm('删除这条记录?')) { Store.deleteLog(btn.dataset.id); refreshAll(); }
    });
    $('#lt-btn-open2').onclick = async () => {
      try {
        const data = await FileIO.openFile();
        if (!data) return;
        appData = { nickname: data.nickname || '', logs: data.logs || [] }; fileLoaded = true;
        renderMain(); FX.confetti(2000);
      } catch (e) { alert('打开失败: ' + e.message); }
    };
    $('#lt-btn-save').onclick = async () => {
      try {
        await FileIO.saveFile(appData);
        const btn = $('#lt-btn-save');
        const oldText = btn.textContent;
        btn.textContent = '✅ 已保存';
        setTimeout(() => btn.textContent = oldText, 1500);
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  }

  function getBaseDate() {
    const d = new Date();
    d.setDate(d.getDate() + state.weekOffset * 7);
    return d;
  }

  function refreshAll(animate = false, highlightDate = null) {
    const wd = getWeekDays(getBaseDate());
    renderWeekDays(wd);
    renderLogList();
    renderMonthCharts(animate);
    renderWeekSummary(wd, animate);
    if (highlightDate) FX.pulseCell(highlightDate);
  }

  function refreshWithNewRecord(newId) {
    const wd = getWeekDays(getBaseDate());
    renderWeekDays(wd);
    renderLogList(newId);
    renderMonthCharts();
    renderWeekSummary(wd);
    const today = fmtDate(new Date());
    if (state.selectedDate === today) FX.pulseCell(today);
  }

  function openAddModal() {
    const existingCats = Store.getAllCategories();
    const catEntries = Object.entries(existingCats);
    const hasExisting = catEntries.length > 0;

    const overlay = document.createElement('div');
    overlay.className = 'lt-modal-overlay';
    overlay.innerHTML = `
      <div class="lt-modal">
        <h3 class="lt-modal-title">添加今日做的事</h3>
        <input class="lt-modal-input" id="lt-f-content" placeholder="做了什么" maxlength="200"/>
        ${hasExisting ? `
        <div class="lt-preset-cats" id="lt-preset-cats">
          <span class="lt-preset-label">已有分类</span>
          ${catEntries.map(([name, color]) =>
            `<button class="lt-preset-cat" data-name="${escapeHtml(name)}" style="border-color:${color};color:${color}">${escapeHtml(name)}</button>`
          ).join('')}
        </div>` : ''}
        <div class="lt-cat-new">
          <input class="lt-modal-input" id="lt-f-cat" placeholder="新分类名" maxlength="20"/>
          <input type="color" class="lt-color-input" id="lt-f-color" value="${catEntries[0]?.[1] || '#3b82f6'}"/>
        </div>
        <div class="lt-modal-actions">
          <button class="lt-btn" id="lt-f-cancel">取消</button>
          <button class="lt-btn lt-btn-primary" id="lt-f-save">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cInput = $('#lt-f-content', overlay);
    const catInput = $('#lt-f-cat', overlay);
    const colorInput = $('#lt-f-color', overlay);
    cInput.focus();

    overlay.onclick = e => { if (e.target === overlay) close(); };
    $('#lt-f-cancel', overlay).onclick = close;

    overlay.querySelectorAll('.lt-preset-cat').forEach(btn => {
      btn.onclick = () => {
        catInput.value = btn.dataset.name;
        colorInput.value = existingCats[btn.dataset.name];
        overlay.querySelectorAll('.lt-preset-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cInput.focus();
      };
    });

    catInput.addEventListener('input', () => {
      const v = catInput.value.trim();
      if (existingCats[v]) colorInput.value = existingCats[v];
    });

    $('#lt-f-save', overlay).onclick = () => {
      const content = cInput.value.trim();
      const catName = catInput.value.trim();
      if (!content) { cInput.focus(); return; }
      if (!catName) { catInput.focus(); return; }

      // 粒子爆发 + +1 浮字
      const btn = overlay.querySelector('#lt-f-save');
      const r = btn.getBoundingClientRect();
      FX.burst(r.left + r.width/2, r.top);
      FX.floatText(r.left + r.width/2, r.top - 20, '+1', colorInput.value);

      const newId = uid();
      Store.addLog(state.selectedDate, content, catName, colorInput.value);
      close();
      refreshWithNewRecord(newId);

      // 如果达到 3 件, 热力图点亮
      if (state.selectedDate === fmtDate(new Date())) {
        const cntToday = Store.getLogsByDate(state.selectedDate).length;
        if (cntToday === 3) FX.confetti(2000);
      }
    };

    cInput.onkeydown = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') $('#lt-f-save', overlay).click(); };
    catInput.onkeydown = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') $('#lt-f-save', overlay).click(); };

    function close() { overlay.remove(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

})();
