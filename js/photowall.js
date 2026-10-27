// ============ 照片墙 ============
// 数据来源:scripts/photos.js 把 source/_photos/*.md 内联成 window.LANX_PHOTOS,
// 这里只负责渲染:
//   1) 顶部「照片名字」
//   2) 大图卡片(左图 + 右描述/日期/季节),进页面随机抽一张
//   3) 下面的随机排版缩略图网格,点哪张上面就换成哪张
//
// 用 ES5 写法 + 不用模板字符串,老 WebView(百度/微信内核)也能跑。

(function () {
  var mount = document.getElementById('lanx-photo-wall');
  if (!mount) return;

  var photos = window.LANX_PHOTOS || [];
  mount.innerHTML = '';

  // ---------- 空状态 ----------
  if (!photos.length) {
    var empty = document.createElement('div');
    empty.className = 'lpw-empty';
    empty.innerHTML = '还没有照片。<br>在 <code>source/_photos/</code> 里放一个 .md' +
      '(NAME / TIME / IMAGE / 描述),重新生成就会出现在这里。';
    mount.appendChild(empty);
    return;
  }

  // ---------- 动画开关 ----------
  // 只在 JS 里加 .lpw-anim 才启用动效。系统开了「减少动态效果」就不加,
  // 页面退化成纯静态排版,不闪不抖。
  var animOn = true;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animOn = false;
    }
  } catch (e) {}

  // 同一个类要重播动画,得先摘掉、强制一次重排、再挂回去
  function replay(el, cls) {
    if (!animOn || !el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---------- 骨架 ----------
  var head = document.createElement('div');
  head.className = 'lpw-head';
  var label = document.createElement('span');
  label.className = 'lpw-head-label';
  label.textContent = '照片名字';
  var nameEl = document.createElement('span');
  nameEl.className = 'lpw-head-name';
  head.appendChild(label);
  head.appendChild(nameEl);

  var hero = document.createElement('div');
  hero.className = 'lpw-hero';

  var media = document.createElement('div');
  media.className = 'lpw-hero-media';
  var heroImg = document.createElement('img');
  heroImg.alt = '';
  heroImg.decoding = 'async';
  media.appendChild(heroImg);

  var side = document.createElement('div');
  side.className = 'lpw-hero-side';
  var descEl = document.createElement('p');
  descEl.className = 'lpw-desc';
  var meta = document.createElement('div');
  meta.className = 'lpw-meta';
  var dateEl = document.createElement('span');
  dateEl.className = 'lpw-chip lpw-chip-date';
  var seasonEl = document.createElement('span');
  seasonEl.className = 'lpw-chip lpw-chip-season';
  meta.appendChild(dateEl);
  meta.appendChild(seasonEl);
  side.appendChild(descEl);
  side.appendChild(meta);

  hero.appendChild(media);
  hero.appendChild(side);

  var grid = document.createElement('div');
  grid.className = 'lpw-grid';

  mount.appendChild(head);
  mount.appendChild(hero);
  mount.appendChild(grid);

  // ---------- 随机顺序(每次进页面都换一种排法) ----------
  var order = [];
  for (var i = 0; i < photos.length; i++) order.push(i);
  for (var k = order.length - 1; k > 0; k--) {
    var r = Math.floor(Math.random() * (k + 1));
    var tmp = order[k];
    order[k] = order[r];
    order[r] = tmp;
  }

  // ---------- 缩略图 ----------
  var cells = [];
  var GAP = 8;
  var UNIT = 6; // 与 css 的 grid-auto-rows 保持一致

  function colsNow() {
    var w = grid.clientWidth || mount.clientWidth || 0;
    return w && w < 470 ? 2 : 3;
  }

  function fitCell(cell, img) {
    var cols = colsNow();
    var gridW = grid.clientWidth || mount.clientWidth || 0;
    if (!gridW || !img.naturalWidth) return;

    // 30% 的图横向占两格,做出"大小不一"的随机感(两列布局时不放大)。
    // 只在第一次决定,重排时沿用,否则每次 resize 都会跳。
    if (!cell._span) {
      cell._span = cols === 3 && Math.random() < 0.32 ? 2 : 1;
    }
    var span = cell._span;

    var cellW = (gridW - GAP * (cols - 1)) / cols;
    var itemW = cellW * span + GAP * (span - 1);
    var ratio = img.naturalWidth / img.naturalHeight || 1.5;
    var itemH = itemW / ratio;
    var rows = Math.max(4, Math.ceil((itemH + GAP) / (UNIT + GAP)));

    cell.style.gridColumn = 'span ' + Math.min(span, cols);
    cell.style.gridRowEnd = 'span ' + rows;
  }

  for (var n = 0; n < order.length; n++) {
    (function (idx) {
      var p = photos[idx];
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'lpw-cell';
      cell.setAttribute('aria-label', p.name || '照片');
      cell._data = p;
      cell._idx = idx;

      var img = document.createElement('img');
      img.alt = p.name || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onload = function () {
        fitCell(cell, img);
        img.classList.add('is-ready');
      };
      img.onerror = function () {
        if (cell.parentNode) cell.parentNode.removeChild(cell);
      };
      img.src = p.img;
      // 缓存命中时 onload 可能已经在赋值前跑完了,补一刀
      if (img.complete && img.naturalWidth) {
        fitCell(cell, img);
        img.classList.add('is-ready');
      }
      cell.appendChild(img);

      var cap = document.createElement('span');
      cap.className = 'lpw-cell-name';
      cap.textContent = p.name || '';
      cell.appendChild(cap);

      cell.onclick = function () { select(idx, cell); };

      cells.push(cell);
      grid.appendChild(cell);
      fitCell(cell, img);
    })(order[n]);
  }

  // ---------- 大图切换 ----------
  var currentIdx = -1;
  var pending = 0;

  function select(idx, cell) {
    if (idx === currentIdx) return;
    var p = photos[idx];
    if (!p) return;
    currentIdx = idx;

    nameEl.textContent = p.name || '';
    nameEl.title = p.name || '';
    replay(nameEl, 'is-in');

    // 连着点两张时,丢掉前一张迟到的 onload
    pending++;
    var token = pending;
    // 先摘掉上一张的落定动画,否则动画的终态会盖住 is-loading 的变暗效果
    heroImg.classList.remove('is-in');
    media.className = 'lpw-hero-media is-loading';
    var probe = new Image();
    probe.onload = function () {
      if (token !== pending) return;
      heroImg.src = p.img;
      heroImg.alt = p.name || '';
      media.className = 'lpw-hero-media';
      replay(heroImg, 'is-in');
    };
    probe.onerror = function () {
      if (token !== pending) return;
      heroImg.removeAttribute('src');
      media.className = 'lpw-hero-media is-error';
    };
    probe.src = p.img;

    if (p.desc) {
      descEl.textContent = p.desc;
      hero.className = 'lpw-hero';
      replay(descEl, 'is-in');
    } else {
      descEl.textContent = '';
      hero.className = 'lpw-hero no-desc';
    }

    dateEl.textContent = p.date || '';
    seasonEl.textContent = p.season || '';
    seasonEl.style.display = p.season ? '' : 'none';

    for (var i = 0; i < cells.length; i++) {
      if (cells[i]._idx === idx) cells[i].className = 'lpw-cell is-active';
      else cells[i].className = 'lpw-cell';
    }
    if (!cell) {
      for (var j = 0; j < cells.length; j++) {
        if (cells[j]._idx === idx) { cell = cells[j]; break; }
      }
    }

    // 顺手把当前这张记到地址栏,方便复制给别人看(#photo-<id>)
    try {
      if (window.history && history.replaceState) {
        history.replaceState(null, '', '#photo-' + encodeURIComponent(p.id));
      }
    } catch (e) {}

    // 缩略图在下面看不到大图时,顺手把卡片带回来
    var top = hero.getBoundingClientRect().top;
    if (cell && top < 0) {
      try {
        hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        hero.scrollIntoView();
      }
    }
  }

  // ---------- 窗口变化时重排 ----------
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      for (var i = 0; i < cells.length; i++) {
        var img = cells[i].getElementsByTagName('img')[0];
        if (img) fitCell(cells[i], img);
      }
    }, 180);
  });

  // ---------- 首次:地址栏带了 #photo-xxx 就显示那张,否则随机抽 ----------
  function fromHash() {
    var raw = (window.location.hash || '').replace(/^#/, '');
    if (raw.indexOf('photo-') !== 0) return -1;
    var id = raw.slice(6);
    try {
      id = decodeURIComponent(id);
    } catch (e) {}
    for (var i = 0; i < photos.length; i++) {
      if (photos[i].id === id) return i;
    }
    return -1;
  }

  window.addEventListener('hashchange', function () {
    var i = fromHash();
    if (i >= 0 && i !== currentIdx) select(i, null);
  });

  // ---------- 入场:滚到看得见才播,别让人错过 ----------
  if (animOn) {
    mount.classList.add('lpw-anim');
    for (var q = 0; q < cells.length; q++) {
      // 越靠后的格子越晚浮上来,但封顶,免得后面的等太久
      cells[q].style.animationDelay = (0.18 + Math.min(q, 14) * 0.055) + 's';
    }

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (entries[e].isIntersecting) {
            mount.classList.add('lpw-play');
            io.disconnect();
            break;
          }
        }
      }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });
      io.observe(mount);
    } else {
      // 老内核没有 IntersectionObserver,直接播
      mount.classList.add('lpw-play');
    }
  }

  var first = fromHash();
  if (first < 0) first = Math.floor(Math.random() * photos.length);
  select(first, null);
})();
