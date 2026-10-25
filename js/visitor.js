/* ============================================================
   LANX 访客统计 · 页脚统计条 + 访客明细页
   ------------------------------------------------------------
   - 访客身份:浏览器指纹(UA / 屏幕 / 时区 / 语言 / 硬件 / Canvas)
     哈希成一个稳定的 16 进制短 ID,存在 localStorage 复用。
     同一设备同一浏览器 = 同一访客;换浏览器 / 无痕 = 新访客。
     MAC 地址浏览器拿不到,任何网页都拿不到。
   - 数据落地:Supabase(见 visitor-setup.sql)。未配置时降级为
     "仅本机记录",明细页给出接入指引。
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.LANX_VISITOR_CFG || {};
  var SB_URL = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var SB_KEY = String(CFG.supabaseKey || '');
  var ENABLED = !!(SB_URL && SB_KEY);
  var WITH_GEO = CFG.geo !== false;

  var TZ_SHIFT = 8 * 3600 * 1000; // 站点时区 UTC+8(hexo _config.yml 里是 Asia/Shanghai)
  var PAGE_SIZE = 12;
  var MAX_ROWS = 1000;

  var LS_VID = 'lanx_vid_v1';
  var LS_GEO = 'lanx_geo_v1';

  /* ---------------- 小工具 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function siteDate(ms) {
    var d = new Date((ms == null ? Date.now() : ms) + TZ_SHIFT);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function siteMonth(ms) {
    return siteDate(ms).slice(0, 7);
  }

  function fmtTime(iso, withDate) {
    if (!iso) return '未知';
    var t = Date.parse(iso);
    if (isNaN(t)) return '未知';
    var d = new Date(t + TZ_SHIFT);
    var hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    if (!withDate) return hm;
    return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + hm;
  }

  function cut(s, n) {
    if (!s) return '';
    s = String(s);
    return s.length > n ? s.slice(0, n) : s;
  }

  function num(n) {
    if (n == null || isNaN(n)) return '—';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }
  function lsJson(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }

  /* ---------------- 设备指纹 ---------------- */
  function canvasSig() {
    try {
      var c = document.createElement('canvas');
      c.width = 220; c.height = 44;
      var x = c.getContext('2d');
      if (!x) return '';
      x.textBaseline = 'top';
      x.font = '15px "Arial"';
      x.fillStyle = '#f60';
      x.fillRect(0, 0, 96, 20);
      x.fillStyle = '#069';
      x.fillText('LANX 2026 · 访客', 2, 16);
      x.fillStyle = 'rgba(102,204,0,0.7)';
      x.fillText('LANX 2026 · 访客', 4, 18);
      return c.toDataURL();
    } catch (e) { return ''; }
  }

  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function hex8(n) {
    var s = n.toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  function visitorId() {
    var saved = lsGet(LS_VID);
    if (saved && /^[0-9a-f]{16}$/.test(saved)) return saved;

    var n = navigator;
    var parts = [
      n.userAgent || '',
      n.language || '',
      (n.languages || []).join(','),
      n.platform || '',
      n.hardwareConcurrency || 0,
      n.deviceMemory || 0,
      n.maxTouchPoints || 0,
      screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || 0),
      window.devicePixelRatio || 1,
      (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      canvasSig()
    ];
    var s = parts.join('|#|');
    var id = hex8(fnv(s, 0x811c9dc5)) + hex8(fnv(s, 0x01000193));
    lsSet(LS_VID, id);
    return id;
  }

  /* ---------------- UA 解析 ---------------- */
  function parseUA(ua) {
    ua = ua || '';
    var out = { device: 'unknown', os: '未知', browser: '未知', model: '' };

    // 设备形态
    if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) ||
        (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
      out.device = 'tablet';
    } else if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry/i.test(ua)) {
      out.device = 'mobile';
    } else {
      out.device = 'desktop';
    }

    // 操作系统
    var m;
    if (/Windows NT 10\.0/i.test(ua)) out.os = 'Windows 10/11';
    else if (/Windows NT 6\.3/i.test(ua)) out.os = 'Windows 8.1';
    else if (/Windows NT 6\.1/i.test(ua)) out.os = 'Windows 7';
    else if (/Windows/i.test(ua)) out.os = 'Windows';
    else if (/iPhone|iPad|iPod/i.test(ua)) {
      m = /OS (\d+)[._](\d+)/.exec(ua);
      out.os = m ? 'iOS ' + m[1] + '.' + m[2] : 'iOS';
    } else if (/Android/i.test(ua)) {
      m = /Android (\d+(?:\.\d+)?)/.exec(ua);
      out.os = m ? 'Android ' + m[1] : 'Android';
    } else if (/Mac OS X|Macintosh/i.test(ua)) {
      m = /Mac OS X (\d+)[._](\d+)/.exec(ua);
      out.os = m ? 'macOS ' + m[1] + '.' + m[2] : 'macOS';
    } else if (/CrOS/i.test(ua)) out.os = 'ChromeOS';
    else if (/Linux/i.test(ua)) out.os = 'Linux';

    // 机型(安卓 UA 里通常带型号)
    m = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build[^;)]*)?[;)]/.exec(ua);
    if (m) {
      var mm = m[1].replace(/\s*(wv|Mobile|Tablet)$/i, '').trim();
      if (mm && mm.length <= 24 && !/^(K|wv)$/i.test(mm)) out.model = mm;
    } else if (/iPhone/i.test(ua)) out.model = 'iPhone';
    else if (/iPad/i.test(ua)) out.model = 'iPad';

    // 浏览器(顺序有讲究:壳浏览器先判)
    if (/MicroMessenger/i.test(ua)) out.browser = '微信内置';
    else if (/QQBrowser|QQ\//i.test(ua)) out.browser = 'QQ 浏览器';
    else if (/UCBrowser/i.test(ua)) out.browser = 'UC 浏览器';
    else if (/Quark/i.test(ua)) out.browser = '夸克';
    else if (/HuaweiBrowser/i.test(ua)) out.browser = '华为浏览器';
    else if (/MiuiBrowser/i.test(ua)) out.browser = '小米浏览器';
    else if (/Edg[A|iOS]?\/(\d+)/i.test(ua)) out.browser = 'Edge ' + /Edg[A|iOS]?\/(\d+)/i.exec(ua)[1];
    else if (/OPR\/(\d+)/i.test(ua)) out.browser = 'Opera ' + /OPR\/(\d+)/i.exec(ua)[1];
    else if (/Firefox\/(\d+)/i.test(ua)) out.browser = 'Firefox ' + /Firefox\/(\d+)/.exec(ua)[1];
    else if (/CriOS\/(\d+)/i.test(ua)) out.browser = 'Chrome ' + /CriOS\/(\d+)/.exec(ua)[1];
    else if (/Chrome\/(\d+)/i.test(ua)) out.browser = 'Chrome ' + /Chrome\/(\d+)/.exec(ua)[1];
    else if (/Version\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari/i.test(ua)) {
      out.browser = 'Safari ' + /Version\/(\d+)/.exec(ua)[1];
    } else if (/Safari\//i.test(ua)) out.browser = 'Safari';
    else out.browser = '未知';

    return out;
  }

  /* ---------------- 大致位置(可选) ---------------- */
  // 国家代码 → 中文名。ipinfo 只给 "CN" 这种代码,直接显示不好看。
  var COUNTRY_CN = {
    CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
    US: '美国', JP: '日本', KR: '韩国', SG: '新加坡', MY: '马来西亚',
    TH: '泰国', VN: '越南', PH: '菲律宾', ID: '印度尼西亚', IN: '印度',
    GB: '英国', DE: '德国', FR: '法国', NL: '荷兰', IT: '意大利',
    ES: '西班牙', RU: '俄罗斯', CA: '加拿大', AU: '澳大利亚', BR: '巴西',
    AE: '阿联酋', NZ: '新西兰', CH: '瑞士', SE: '瑞典'
  };

  // 依次尝试,前一个失败才降级到下一个。实测 ipapi.co 现在会被 Cloudflare
  // 拦成验证页(返回 HTML 而不是 JSON),所以它只能排最后。
  var GEO_PROVIDERS = [
    {
      url: 'https://ipinfo.io/json',
      map: function (d) {
        if (!d || !d.country) return null;
        return {
          country: COUNTRY_CN[d.country] || d.country,
          region: d.region,
          city: d.city
        };
      }
    },
    {
      url: 'https://ipwho.is/',
      map: function (d) {
        if (!d || d.success === false) return null;
        return {
          country: d.country || COUNTRY_CN[d.country_code] || '',
          region: d.region,
          city: d.city
        };
      }
    },
    {
      url: 'https://ipapi.co/json/',
      map: function (d) {
        if (!d || d.error) return null;
        return {
          country: d.country_name || COUNTRY_CN[d.country_code] || '',
          region: d.region,
          city: d.city
        };
      }
    }
  ];

  // 去掉空值/占位符/"Guangdong Sheng" 这类后缀
  function geoClean(g) {
    function s(v) {
      if (!v || typeof v !== 'string') return '';
      v = v.replace(/\s+(Sheng|Shi|Province|Municipality|Prefecture)$/i, '').trim();
      return v === '-' ? '' : v.slice(0, 40);
    }
    return { country: s(g.country), region: s(g.region), city: s(g.city) };
  }

  function getGeo() {
    if (!WITH_GEO) return Promise.resolve(null);

    var cached = lsJson(LS_GEO);
    if (cached && cached.t && Date.now() - cached.t < 86400000) {
      return Promise.resolve(cached.d);
    }

    // 整条链共用一个总预算,别让访问记录等太久
    var deadline = Date.now() + 3200;

    function grab(url, ms) {
      var timer = null;
      var timeout = new Promise(function (resolve) {
        timer = setTimeout(function () { resolve(null); }, ms);
      });
      var req = fetch(url, { mode: 'cors', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
      return Promise.race([req, timeout]).then(function (d) {
        if (timer) clearTimeout(timer);
        return d;
      });
    }

    function attempt(i) {
      if (i >= GEO_PROVIDERS.length) return Promise.resolve(null);
      var left = deadline - Date.now();
      if (left < 500) return Promise.resolve(null);

      var p = GEO_PROVIDERS[i];
      return grab(p.url, Math.min(left, 2000)).then(function (d) {
        var g = null;
        try { g = d ? p.map(d) : null; } catch (e) { g = null; }
        if (g) {
          var c = geoClean(g);
          if (c.country || c.region || c.city) return c;
        }
        return attempt(i + 1);
      }).catch(function () { return attempt(i + 1); });
    }

    return attempt(0).then(function (d) {
      if (d) lsSet(LS_GEO, JSON.stringify({ t: Date.now(), d: d }));
      return d;
    }).catch(function () { return null; });
  }

  /* ---------------- 存储层 ---------------- */
  var HEAD = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  };

  function sbGet(path) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 9000) : null;
    return fetch(SB_URL + '/rest/v1/' + path, {
      headers: HEAD,
      cache: 'no-store',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function sbInsert(row) {
    return fetch(SB_URL + '/rest/v1/visits', {
      method: 'POST',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, HEAD),
      body: JSON.stringify(row),
      keepalive: true
    });
  }

  /* ---------------- 记录一次访问 ---------------- */
  function logVisit() {
    if (!ENABLED) return;
    if (!/^https?:$/.test(location.protocol)) return;

    var ua = navigator.userAgent || '';
    var p = parseUA(ua);
    var dev = p.device;
    var gpu = '';
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    } catch (e) { gpu = ''; }

    var vid = visitorId();

    getGeo().then(function (geo) {
      var row = {
        day: siteDate(),
        visitor_id: vid,
        path: cut(location.pathname + location.search, 200),
        ref: cut(document.referrer || '', 200),
        ua: cut(ua, 320),
        device: dev,
        os: cut(p.os, 40),
        browser: cut(p.browser, 40),
        screen: cut(screen.width + '×' + screen.height, 20),
        lang: cut(navigator.language || '', 20),
        tz: cut((Intl.DateTimeFormat().resolvedOptions().timeZone) || '', 40),
        cores: navigator.hardwareConcurrency || null,
        mem: navigator.deviceMemory || null,
        gpu: cut(gpu, 80),
        country: geo ? cut(geo.country, 40) : null,
        region: geo ? cut(geo.region, 40) : null,
        city: geo ? cut(geo.city, 40) : null
      };
      sbInsert(row).catch(function (e) {
        if (window.console) console.warn('[visitor] 记录失败:', e && e.message);
      });
    });
  }

  /* ---------------- 页脚统计条 ---------------- */
  function localCount(key) {
    return parseInt(lsGet(key) || '0', 10) || 0;
  }
  function localBump(key) {
    var v = localCount(key) + 1;
    lsSet(key, String(v));
    return v;
  }

  function buildFooter() {
    var fi = document.querySelector('#footer-info');
    if (!fi) return false;
    if (fi.querySelector('.lv-footer')) return true;

    var today = siteDate();
    var month = siteMonth();
    var qs = '?range=today';
    var qsMonth = '?range=month';

    var wrap = el('div', 'lv-footer');

    function cell(label, isLink, href) {
      var c = isLink ? el('a', 'lv-footer-cell is-link') : el('div', 'lv-footer-cell');
      if (isLink) c.href = href;
      var l = el('span', 'lv-footer-label', label);
      if (isLink) {
        var ar = el('span', 'lv-arrow', '›');
        l.appendChild(ar);
      }
      var n = el('span', 'lv-footer-num is-unknown', '—');
      var sub = el('span', 'lv-footer-sub', '');
      c.appendChild(l); c.appendChild(n); c.appendChild(sub);
      wrap.appendChild(c);
      return { cell: c, num: n, sub: sub };
    }

    var base = CFG.root || '/';
    if (base.charAt(base.length - 1) !== '/') base += '/';
    var visitorsUrl = base + 'visitors/';

    var cToday = cell('今日访客', true, visitorsUrl + qs);
    var cMonth = cell('本月访客', true, visitorsUrl + qsMonth);

    var cUv = cell('总访客', false);
    cUv.num.classList.remove('is-unknown');
    cUv.num.id = 'busuanzi_value_site_uv';
    cUv.num.textContent = '--';

    var cPv = cell('总浏览', false);
    cPv.num.classList.remove('is-unknown');
    cPv.num.id = 'busuanzi_value_site_pv';
    cPv.num.textContent = '--';

    fi.appendChild(wrap);

    // 本机兜底数字(未接后端时至少能看到自己的)
    var lToday = localBump('lv_' + today);
    var lMonth = localBump('lv_' + month);

    // 历史总量一直由不蒜子累计,和有没有接 Supabase 无关
    loadBusuanzi(cUv, cPv);

    if (!ENABLED) {
      cToday.num.textContent = lToday;
      cToday.num.classList.remove('is-unknown');
      cToday.sub.textContent = '本机';
      cMonth.num.textContent = lMonth;
      cMonth.num.classList.remove('is-unknown');
      cMonth.sub.textContent = '本机';
      return true;
    }

    sbGet('visit_daily?select=uv,pv&day=eq.' + today).then(function (rows) {
      var r = rows && rows[0];
      cToday.num.textContent = r ? num(r.uv) : '0';
      cToday.num.classList.remove('is-unknown');
      cToday.sub.textContent = r ? num(r.pv) + ' 次浏览' : '暂无';
    }).catch(function () {
      cToday.num.textContent = '—';
      cToday.sub.textContent = '读取失败';
    });

    sbGet('visit_monthly?select=uv,pv&month=eq.' + month).then(function (rows) {
      var r = rows && rows[0];
      cMonth.num.textContent = r ? num(r.uv) : '0';
      cMonth.num.classList.remove('is-unknown');
      cMonth.sub.textContent = r ? num(r.pv) + ' 次浏览' : '暂无';
    }).catch(function () {
      cMonth.num.textContent = '—';
      cMonth.sub.textContent = '读取失败';
    });

    return true;
  }

  // 不蒜子要等 #busuanzi_value_site_uv 存在才认得出目标,所以建完 DOM 再加载
  function loadBusuanzi(cUv, cPv) {
    if (window.__lanxBszLoaded) return;
    window.__lanxBszLoaded = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://cdn.jsdelivr.net/npm/busuanzi@2.3.0/bsz.pure.mini.js';
    s.onerror = function () { timeout(); };
    document.body.appendChild(s);

    var done = false;
    function timeout() {
      if (done) return;
      done = true;
      [cUv, cPv].forEach(function (c) {
        if (c.num.textContent === '--' || c.num.textContent === '') {
          c.num.textContent = '—';
          c.num.classList.add('is-unknown');
          c.num.title = '总量统计脚本被拦截或加载失败';
        }
      });
    }
    setTimeout(timeout, 6000);
  }

  function mountFooter() {
    if (buildFooter()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (buildFooter() || tries > 40) clearInterval(timer);
    }, 150);
  }

  /* ---------------- 明细页 ---------------- */
  var RANGES = {
    today: { label: '今日', from: function () { return siteDate(); } },
    month: { label: '本月', from: function () { return siteMonth() + '-01'; } },
    all: { label: '全部', from: function () { return '2000-01-01'; } }
  };

  var state = {
    range: 'today',
    page: 1,
    rows: null,
    visitors: [],
    pv: 0,
    sum: null,
    loading: false,
    error: '',
    mount: null
  };

  function rangeFrom(r) { return RANGES[r] ? RANGES[r].from() : siteDate(); }

  function summaryQuery(range) {
    if (range === 'today') return 'visit_daily?select=uv,pv&day=eq.' + siteDate();
    if (range === 'month') return 'visit_monthly?select=uv,pv&month=eq.' + siteMonth();
    return 'visit_total?select=uv,pv';
  }

  function readRangeFromUrl() {
    var m = /[?&]range=(today|month|all)/.exec(location.search);
    return m ? m[1] : 'today';
  }

  function iconFor(device) {
    if (device === 'mobile') return '📱';
    if (device === 'tablet') return '📟';
    if (device === 'desktop') return '🖥️';
    return '❓';
  }

  function deviceText(device) {
    if (device === 'mobile') return '手机';
    if (device === 'tablet') return '平板';
    if (device === 'desktop') return '电脑';
    return '未知设备';
  }

  function aggregate(rows) {
    var map = {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var id = r.visitor_id;
      if (!map[id]) {
        map[id] = {
          id: id,
          hits: 0,
          first: r.ts,
          last: r.ts,
          info: r
        };
        order.push(id);
      }
      var v = map[id];
      v.hits++;
      if (Date.parse(r.ts) > Date.parse(v.last)) { v.last = r.ts; v.info = r; }
      if (Date.parse(r.ts) < Date.parse(v.first)) v.first = r.ts;
    }
    var list = order.map(function (k) { return map[k]; });
    list.sort(function (a, b) { return Date.parse(b.last) - Date.parse(a.last); });
    return list;
  }

  function renderSkeleton(box) {
    box.innerHTML = '';
    var wrap = el('div', 'lv-skel');
    for (var i = 0; i < 4; i++) wrap.appendChild(el('div', 'lv-skel-item'));
    box.appendChild(wrap);
  }

  function renderSummary(box) {
    var sum = el('div', 'lv-sum');
    function item(v, label) {
      var d = el('div', 'lv-sum-item');
      d.appendChild(el('b', null, v));
      d.appendChild(el('span', null, label));
      return d;
    }
    var pv = state.sum ? state.sum.pv : state.pv;
    var uv = state.sum ? state.sum.uv : state.visitors.length;
    var avg = uv ? (pv / uv).toFixed(1) : '—';
    sum.appendChild(item(num(uv), '位访客'));
    sum.appendChild(item(num(pv), '次浏览'));
    sum.appendChild(item(avg, '人均浏览'));
    box.appendChild(sum);
  }

  function renderCard(v) {
    var i = v.info;
    var card = el('div', 'lv-card');

    var ava = el('div', 'lv-ava', iconFor(i.device));
    card.appendChild(ava);

    var main = el('div', 'lv-main');

    var row1 = el('div', 'lv-row1');
    var name = el('div', 'lv-name', '访客 ');
    var code = el('code', null, String(v.id).slice(0, 4).toUpperCase());
    name.appendChild(code);
    row1.appendChild(name);

    if (v.hits >= 3) {
      var b = el('span', 'lv-badge is-back', '反复来访');
      row1.appendChild(b);
    }
    main.appendChild(row1);

    // 设备描述
    var desc = el('div', 'lv-desc');
    var bits = [];
    var devTxt = deviceText(i.device);
    if (i.device === 'mobile' || i.device === 'tablet') {
      var p = parseUA(i.ua || '');
      if (p.model && p.model !== 'iPhone' && p.model !== 'iPad') devTxt = p.model;
      else if (p.model) devTxt = p.model;
    }
    bits.push(devTxt);
    bits.push(i.os || '未知');
    bits.push(i.browser || '未知');
    if (i.screen) bits.push(String(i.screen).replace('x', '×'));
    for (var k = 0; k < bits.length; k++) {
      if (k) desc.appendChild(el('span', 'lv-sep', '·'));
      var t = el('span', null, bits[k]);
      desc.appendChild(t);
    }
    main.appendChild(desc);

    // 标签行
    var tags = el('div', 'lv-tags');

    function tag(text, unknown) {
      tags.appendChild(el('span', unknown ? 'lv-tag is-unknown' : 'lv-tag', text));
    }

    // 去重:ipinfo 有时 region 与 city 同名(如 "Singapore"),拼起来会重复
    var locParts = [];
    [i.country, i.region, i.city].forEach(function (v) {
      if (v && locParts.indexOf(v) === -1) locParts.push(v);
    });
    var loc = locParts.join(' · ');
    tag('📍 ' + (loc || '位置未知'), !loc);
    tag('🕐 ' + (i.tz || '时区未知'), !i.tz);
    tag('🗣 ' + (i.lang || '语言未知'), !i.lang);
    if (i.cores) tag('⚙️ ' + i.cores + ' 核');
    if (i.mem) tag('🧠 ' + i.mem + ' GB');
    main.appendChild(tags);

    // 时间行
    var times = el('div', 'lv-times');
    var isToday = v.first && siteDate(Date.parse(v.first)) === siteDate();
    times.appendChild(el('span', null, '首次 '));
    times.appendChild(el('b', null, fmtTime(v.first, !isToday)));
    times.appendChild(el('span', null, ' · 最近 '));
    times.appendChild(el('b', null, fmtTime(v.last, !isToday)));
    main.appendChild(times);

    card.appendChild(main);

    var hits = el('div', 'lv-hits', String(v.hits));
    hits.appendChild(el('span', null, '次'));
    card.appendChild(hits);

    return card;
  }

  function renderPager(box) {
    var total = Math.ceil(state.visitors.length / PAGE_SIZE);
    if (total <= 1) return;

    var pager = el('div', 'lv-pager');

    function btn(text, page, disabled, current) {
      var b = el('button', current ? 'is-current' : null, text);
      b.type = 'button';
      if (disabled) b.disabled = true;
      if (!current) {
        b.addEventListener('click', function () {
          state.page = page;
          renderBody();
          var top = state.mount.getBoundingClientRect().top + window.pageYOffset - 80;
          window.scrollTo({ top: top, behavior: 'smooth' });
        });
      }
      return b;
    }

    pager.appendChild(btn('‹', state.page - 1, state.page <= 1, false));

    var pages = [];
    for (var p = 1; p <= total; p++) {
      if (p === 1 || p === total || Math.abs(p - state.page) <= 1) pages.push(p);
      else if (pages[pages.length - 1] !== '…') pages.push('…');
    }
    for (var i = 0; i < pages.length; i++) {
      if (pages[i] === '…') {
        pager.appendChild(el('span', 'lv-pager-info', '…'));
      } else {
        pager.appendChild(btn(String(pages[i]), pages[i], false, pages[i] === state.page));
      }
    }

    pager.appendChild(btn('›', state.page + 1, state.page >= total, false));
    box.appendChild(pager);
  }

  // 把常见的接入失败翻译成人话,省得去翻控制台
  function errorTip(msg) {
    msg = String(msg || '');
    if (/HTTP 401|HTTP 403/.test(msg)) {
      return 'anon key 不对,或者 SQL 里的 RLS 策略 / GRANT 没跑完。';
    }
    if (/HTTP 404/.test(msg)) {
      return '表还不存在 —— visitor-setup.sql 里的 SQL 还没在 Supabase 执行。';
    }
    if (/HTTP 5\d\d/.test(msg)) {
      return 'Supabase 那边出错了,稍后再试;项目如果是 Free 版长时间没人访问会被暂停,去控制台恢复一下。';
    }
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return '连不上数据库:检查 _config.yml 里的 supabase_url 是否写对,或者网络被挡了。';
    }
    return '';
  }

  function renderBody() {
    var mount = state.mount;
    if (!mount) return;

    var box = mount.querySelector('.lv-body');
    if (!box) return;
    box.innerHTML = '';

    if (state.loading) { renderSkeleton(box); return; }

    if (state.error) {
      var e = el('div', 'lv-empty');
      e.appendChild(el('span', 'lv-emoji', '⚠️'));
      e.appendChild(el('span', null, '读取访客数据失败:' + state.error));

      var tip = errorTip(state.error);
      if (tip) {
        var tipEl = el('div', null, tip);
        tipEl.style.cssText = 'margin-top:8px;font-size:12px;color:#b45309;';
        e.appendChild(tipEl);
      }

      var retry = el('div', null);
      retry.style.marginTop = '14px';
      var btn = el('button', 'lv-tab active', '重新加载');
      btn.type = 'button';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function () { load(state.range); });
      retry.appendChild(btn);
      e.appendChild(retry);
      box.appendChild(e);
      return;
    }

    if (!state.visitors.length) {
      var empty = el('div', 'lv-empty');
      empty.appendChild(el('span', 'lv-emoji', '🌙'));
      empty.appendChild(el('span', null, RANGES[state.range].label + '还没有访客记录'));
      var hint = el('div', null, '等第一个访客来敲敲门吧');
      hint.style.fontSize = '11.5px';
      hint.style.color = '#c2c8d0';
      empty.appendChild(hint);
      box.appendChild(empty);
      return;
    }

    renderSummary(box);

    var list = el('div', 'lv-list');
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = state.visitors.slice(start, start + PAGE_SIZE);
    for (var i = 0; i < slice.length; i++) list.appendChild(renderCard(slice[i]));
    box.appendChild(list);

    renderPager(box);

    if (state.rows && state.rows.length >= MAX_ROWS) {
      box.appendChild(el('p', 'lv-note',
        '记录超过 ' + MAX_ROWS + ' 条,列表只列出最近这些;上方汇总数字仍是全量统计。'));
    }
  }

  function load(range) {
    state.range = range;
    state.page = 1;
    state.loading = true;
    state.error = '';
    state.sum = null;
    syncTabs();
    renderBody();

    var from = rangeFrom(range);
    var to = range === 'all' ? '2999-12-31' : siteDate();

    var url = 'visits?select=visitor_id,ts,ua,device,os,browser,screen,lang,tz,cores,mem,country,region,city'
      + '&day=gte.' + from
      + '&day=lte.' + to
      + '&order=ts.desc'
      + '&limit=' + MAX_ROWS;

    Promise.all([
      sbGet(url),
      sbGet(summaryQuery(range)).catch(function () { return null; })
    ]).then(function (res) {
      var rows = res[0] || [];
      var agg = res[1] && res[1][0];
      if (agg) state.sum = { uv: agg.uv, pv: agg.pv };
      state.rows = rows;
      state.pv = rows.length;
      state.visitors = aggregate(rows);
      state.loading = false;
      renderBody();
    }).catch(function (e) {
      state.loading = false;
      state.error = (e && e.message) || '网络异常';
      renderBody();
    });
  }

  function syncTabs() {
    if (!state.mount) return;
    var tabs = state.mount.querySelectorAll('.lv-tab');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-range') === state.range) tabs[i].classList.add('active');
      else tabs[i].classList.remove('active');
    }
  }

  function buildPage(mount) {
    state.mount = mount;
    mount.className = 'lv-page';
    mount.innerHTML = '';

    var head = el('div', 'lv-head');
    // 页面标题由主题的 article-header 渲染,这里只放一句说明,避免重复
    head.appendChild(el('p', null,
      '这里记录每一位来访设备的浏览器信息。同一台设备的同一个浏览器算作同一位访客。'));
    mount.appendChild(head);

    if (!ENABLED) {
      var setup = el('div', 'lv-setup');
      setup.appendChild(el('h3', null, '还没接入访客数据后端'));
      var ol = el('ol');
      var steps = [
        '打开 supabase.com 建一个免费 project',
        '进入 SQL Editor,把项目根目录 visitor-setup.sql 的全部内容粘进去执行',
        'Project Settings → API,复制 Project URL 与 anon public key',
        '填进 _config.yml 的 visitor.supabase_url / visitor.supabase_anon_key,重新发布'
      ];
      for (var i = 0; i < steps.length; i++) ol.appendChild(el('li', null, steps[i]));
      setup.appendChild(ol);
      var hint = el('p', 'lv-setup-hint',
        '在接入之前,页脚只显示"你本机"的浏览次数,看不到别的访客。');
      setup.appendChild(hint);
      mount.appendChild(setup);
      return;
    }

    var tabs = el('div', 'lv-tabs');
    ['today', 'month', 'all'].forEach(function (r) {
      var b = el('button', 'lv-tab', RANGES[r].label);
      b.type = 'button';
      b.setAttribute('data-range', r);
      b.addEventListener('click', function () {
        if (state.range === r) return;
        var u = location.pathname + '?range=' + r;
        history.replaceState(null, '', u);
        load(r);
      });
      tabs.appendChild(b);
    });
    mount.appendChild(tabs);

    var body = el('div', 'lv-body');
    mount.appendChild(body);

    var note = el('p', 'lv-note');
    note.innerHTML =
      '<b>关于"是谁"</b> · 网页<b>拿不到</b> MAC 地址,也拿不到真实身份,'
      + '所以这里用的是浏览器指纹:User-Agent、屏幕分辨率、时区、语言、硬件信息和 Canvas 特征'
      + '组合出的一个哈希 ID,能稳定区分不同设备。<br>'
      + '同一台电脑换浏览器、开无痕窗口、或清了浏览器数据,都会被当成新访客;'
      + '同一型号的手机也可能因为系统版本不同而算出不同 ID。这不采集 IP、不采集任何账号信息。<br>'
      + '<b>位置</b> · 大致到省/市级,来自免费的 IP 归属地查询,失败时显示"未知"。';
    mount.appendChild(note);

    state.range = readRangeFromUrl();
    load(state.range);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    mountFooter();
    logVisit();

    var mount = document.getElementById('lanx-visitors-mount');
    if (mount) buildPage(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
