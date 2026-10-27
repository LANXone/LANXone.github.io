// 置顶徽章:把「置顶」标签的文章标题后面挂一个小标签。
// 数据来自 scripts/pin.js 内联的 window.LANX_PINNED(文章 slug 列表)。
// 匹配不到就什么都不做 —— 排序本身不依赖这里。

(function () {
  var list = window.LANX_PINNED;
  if (!list || !list.length) return;

  var map = {};
  for (var i = 0; i < list.length; i++) map[list[i]] = 1;

  var arts = document.querySelectorAll('article[id^="post-"]');
  for (var j = 0; j < arts.length; j++) {
    var art = arts[j];
    if (!map[art.id.slice(5)]) continue;
    if (art.querySelector('.lanx-pin-badge')) continue;

    var title = art.querySelector('.p-name.article-title');
    if (!title || !title.parentNode) continue;

    var badge = document.createElement('span');
    badge.className = 'lanx-pin-badge';
    badge.textContent = '置顶';
    title.parentNode.insertBefore(badge, title.nextSibling);
  }
})();
