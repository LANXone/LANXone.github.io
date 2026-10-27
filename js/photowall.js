// ============ 照片墙(/photos 独立页面) ============
// 数据来源:scripts/photos.js 把 source/_photos/*.md 内联成 window.LANX_PHOTOS,
// 这里只负责渲染:
//   1) 顶部工具条(张数 + 换个排法)
//   2) 当前照片的名字
//   3) 大图卡片(左图 + 右描述/日期/季节)
//   4) 整行对齐的瀑布墙:按每张图片的真实宽高比铺满整行
//
// 排版算法(justified rows,Google Photos / Flickr 那种):
//   一行一行地累加图片,直到"按目标行高摆放会超出容器宽度"为止;
//   这时把这一行等比缩放到正好铺满宽度(行高 = 可用宽度 / 宽高比之和)。
//   每行的目标行高带一点随机抖动,所以行高不会整齐得像表格;
//   图片本身按原始比例,不裁不拉伸。
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

  // ---------- 顶部工具条 ----------
  var bar = document.createElement('div');
  bar.className = 'lpw-bar';

  var barText = document.createElement('span');
  barText.className = 'lpw-bar-text';
  barText.textContent = '共 ' + photos.length + ' 张 · 顺序每次打开都不一样';

  var shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'lpw-shuffle';
  shuffleBtn.textContent = '换个排法';

  bar.appendChild(barText);
  bar.appendChild(shuffleBtn);

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

  mount.appendChild(bar);
  mount.appendChild(head);
  mount.appendChild(hero);
  mount.appendChild(grid);

  // ---------- 随机顺序(每次进页面都换一种排法) ----------
  function newOrder(n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(i);
    for (var k = arr.length - 1; k > 0; k--) {
      var r = Math.floor(Math.random() * (k + 1));
      var t = arr[k];
      arr[k] = arr[r];
      arr[r] = t;
    }
    return arr;
  }

  // ---------- 缩略图 ----------
  var cells = [];
  var imgLeft = 0;
  var ready = false;
  var layoutTimer = null;

  function aspectOf(cell) {
    return cell._aspect || 1.5;
  }

  function targetRowHeight(w) {
    if (w >= 1080) return 250;
    if (w >= 860) return 235;
    if (w >= 640) return 215;
    if (w >= 460) return 195;
    return 170;
  }

  function gapFor(w) {
    if (w >= 860) return 12;
    if (w >= 460) return 8;
    return 6;
  }

  function schedule() {
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(layout, 120);
  }

  // ---------- 核心:整行对齐排版 ----------
  function layout() {
    var W = grid.clientWidth || mount.clientWidth || 0;
    if (!W) return;

    var gap = gapFor(W);
    var base = targetRowHeight(W);

    // 先把还在的图挑出来(加载失败的会标 _dead)
    var live = [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i]._dead) live.push(cells[i]);
    }
    if (!live.length) {
      grid.style.height = '';
      return;
    }

    var rows = [];
    var cur = [];
    var sum = 0;
    // 每行的目标行高轻微抖动:行高不完全一样,但都在基准附近,不会乱
    var tgt = base * (0.9 + Math.random() * 0.2);

    for (var a = 0; a < live.length; a++) {
      var cell = live[a];
      var asp = aspectOf(cell);
      cur.push(cell);
      sum += asp;

      var avail = W - gap * (cur.length - 1);
      if (sum * tgt < avail) continue; // 还铺不满,继续加

      var h = avail / sum;

      // 一张特别宽的长图会把整行压得很矮,看着像根面条。
      // 遇到这种情况把它挪到下一行开头,当前这行按剩下的图收尾
      // —— 但得先确认剩下的图单独也能排成一条正常高度的行,
      // 否则挪走之后它们会被撑成一整屏高的巨行。
      if (h < base * 0.62 && cur.length > 1) {
        var restSum = sum - asp;
        var restH = (W - gap * (cur.length - 2)) / restSum;
        if (restH <= base * 1.4) {
          cur.pop();
          sum = restSum;
          rows.push({ items: cur, h: restH, fill: true });
          cur = [cell];
          sum = asp;
        } else {
          rows.push({ items: cur, h: h, fill: true });
          cur = [];
          sum = 0;
        }
      } else {
        rows.push({ items: cur, h: h, fill: true });
        cur = [];
        sum = 0;
      }
      tgt = base * (0.9 + Math.random() * 0.2);
    }

    // 剩下的末行:差一点点就满的话直接铺满更好看,差太多就按目标高度左对齐
    if (cur.length) {
      var availEnd = W - gap * (cur.length - 1);
      var hFull = availEnd / sum;
      var canFill = hFull <= base * 1.35;
      rows.push({ items: cur, h: canFill ? hFull : base, fill: canFill });
    }

    var y = 0;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var h = Math.round(row.h);
      var x = 0;
      for (var j = 0; j < row.items.length; j++) {
        var c2 = row.items[j];
        var w = Math.round(aspectOf(c2) * h);
        // 行末那一格吃掉取整误差,否则右边会留 1~2px 的缝
        if (row.fill && j === row.items.length - 1) w = W - x;
        c2.style.left = x + 'px';
        c2.style.top = y + 'px';
        c2.style.width = w + 'px';
        c2.style.height = h + 'px';
        x += w + gap;
      }
      y += h + gap;
    }

    grid.style.height = Math.max(0, y - gap) + 'px';
  }

  // ---------- 建格子 ----------
  var order = newOrder(photos.length);
  imgLeft = order.length;

  function tick() {
    imgLeft--;
    if (imgLeft > 0) return;
    if (ready) return;
    ready = true;
    layout();
    armReveal();
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
      cell._aspect = 1.5; // 图还没量出尺寸前先用 3:2 占位

      var img = document.createElement('img');
      img.alt = p.name || '';
      img.decoding = 'async';

      // 缓存命中时 onload 和下面的 img.complete 检查会各走一遍,
      // 用 once 保证每张图只计一次数
      var counted = false;
      function once() {
        if (counted) return;
        counted = true;
        tick();
      }

      // 不用 loading="lazy":排版要拿每张图的真实宽高比,
      // 懒加载会让屏幕外的图量不出尺寸,整行就排不齐了。
      img.onload = function () {
        var a = img.naturalWidth / img.naturalHeight;
        if (a && isFinite(a) && Math.abs(a - cell._aspect) > 0.01) {
          cell._aspect = a;
          schedule();
        }
        img.classList.add('is-ready');
        once();
      };
      img.onerror = function () {
        cell._dead = true;
        cell.style.display = 'none';
        schedule();
        once();
      };
      img.src = p.img;
      cell.appendChild(img);

      var cap = document.createElement('span');
      cap.className = 'lpw-cell-name';
      cap.textContent = p.name || '';
      cell.appendChild(cap);

      cell.onclick = function () { select(idx, cell); };

      cells.push(cell);
      grid.appendChild(cell);

      // 缓存命中时 onload 可能已经错过了,补一刀
      if (img.complete && img.naturalWidth) {
        cell._aspect = img.naturalWidth / img.naturalHeight;
        img.classList.add('is-ready');
        once();
      }
    })(order[n]);
  }

  // 图片加载太慢也别一直空着:1.5s 后先按占位比例排一版
  setTimeout(function () {
    if (ready) return;
    ready = true;
    imgLeft = 0;
    layout();
    armReveal();
  }, 1500);

  // ---------- 大图切换 ----------
  var currentIdx = -1;
  var pending = 0;

  function select(idx, cell) {
    var p = photos[idx];
    if (!p) return;
    var same = idx === currentIdx;
    currentIdx = idx;

    if (!same) {
      nameEl.textContent = p.name || '';
      nameEl.title = p.name || '';
      replay(nameEl, 'is-in');
    }

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
      if (!same) replay(descEl, 'is-in');
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

  // ---------- 换个排法 ----------
  shuffleBtn.onclick = function () {
    if (!cells.length) return;

    // 打乱格子本身,同时重排 DOM(tab 顺序才跟视觉一致)
    for (var k = cells.length - 1; k > 0; k--) {
      var r = Math.floor(Math.random() * (k + 1));
      var t = cells[k];
      cells[k] = cells[r];
      cells[r] = t;
    }
    for (var i = 0; i < cells.length; i++) grid.appendChild(cells[i]);

    layout();

    // 顺手换一张大图,免得大图一直跟排在第一格的那张重复
    var alive = [];
    for (var a = 0; a < cells.length; a++) {
      if (!cells[a]._dead) alive.push(cells[a]);
    }
    if (alive.length) {
      var pick = alive[Math.floor(Math.random() * alive.length)];
      select(pick._idx, pick);
    }

    // 整体重播一次入场,切换才有"重排"的感觉
    if (animOn) {
      mount.classList.remove('lpw-play');
      void mount.offsetWidth;
      mount.classList.add('lpw-play');
    }
  };

  // ---------- 入场:滚到看得见才播 ----------
  function armReveal() {
    if (!animOn) return;
    mount.classList.add('lpw-anim');

    for (var q = 0; q < cells.length; q++) {
      // 越靠后的格子越晚浮上来,但封顶,免得后面的等太久
      cells[q].style.animationDelay = (0.12 + Math.min(q, 14) * 0.045) + 's';
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

  // ---------- 窗口变化时重排 ----------
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      if (!ready) return;
      layout();
    }, 160);
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

  var first = fromHash();
  if (first < 0) first = Math.floor(Math.random() * photos.length);
  select(first, null);
})();
