/**
 * 脚注跳转的「垂直居中落点」—— 客户端交互补丁（双向）
 * ===========================================================================
 * 两条路径，一套算法
 *   ① 正文编号 → 文末条目：<a data-footnote-ref href="#user-content-fn-1">
 *   ② 文末 ↩  → 正文编号：<a data-footnote-backref href="#user-content-fnref-1">
 *   两者走的都是**浏览器原生片段导航**：浏览器只保证目标"进入视口"，对齐方式是顶边对齐
 *   （再把元素自身声明的 scroll-margin 一起算进去）。于是：
 *     · 路径 ① 的目标是文末那个 <li>，它带 3.75rem 的 scroll-margin-top ——
 *       跳过去停在导航栏下方一丁点，看到的是"注解第一行刚好贴着页头"，长注解还得自己往下滚；
 *     · 路径 ② 的目标是正文里半个字大的编号，落到顶边后几乎认不出来，还得往回找。
 *   本模块把两条路径都改成：目标滚动到视口**垂直居中**，并给 1.6s 落点高亮。
 *
 * 为什么不用 scrollIntoView({block:'center'})
 *   它最省事，但会把元素自身的 scroll-margin 一起算进"对齐区域"：
 *   Docusaurus 给每个带 id 的锚点目标都加了 class="anchorTargetStickyNavbar_*"
 *   （scroll-margin-top = 导航栏高度 + 0.5rem，见 @docusaurus/theme-common 的 anchorUtils），
 *   而文末 <li id="user-content-fn-1"> 正是这种元素 —— 居中点会整体下移约半个边距（实测 34px），
 *   "居中"就变成了"差不多居中"。所以这里**自己算 scrollTop**：
 *   几何完全可控、scroll-margin 一概不参与，顺带还能在"元素比可用高度还高"时
 *   退回"开头对齐到导航栏下方"，让它从第一行开始读，而不是被导航栏吃掉首行。
 *
 * 为什么不用一条 CSS 的 scroll-margin-top: calc(50dvh - .5em)
 *   那等于把"居中"写进元素自身的几何：此后**任何**一次片段导航 / Tab 聚焦都会带上
 *   半个视口的边距，顺手把别处的滚动行为改坏（例如 Tab 走到正文中间那个编号时，
 *   页面会被硬推到居中）。这里只在"点击脚注链接"这一个动作上做居中。
 *
 * ⚠️ 为什么刻意**不更新 URL 的 hash**
 *   实测（Docusaurus 3.10.2 + 无头 Chrome）：仅用 history.pushState 改 hash，路由层**不会**
 *   跟着滚一次——页面停在原处，说明 ClientLifecyclesDispatcher 的 scrollAfterNavigation 没被触发。
 *   也就是说理论上可以顺手把地址栏同步成目标的 id。这里仍然不做，是为了避开与路由层的耦合：
 *   一旦将来某个版本补上"hash 变化就滚动"的逻辑（scrollAfterNavigation 做的正是顶格对齐），
 *   居中就会被悄悄覆盖，而且构建期发现不了。代价只是地址栏停在跳去脚注时那个 hash 上。
 *
 * 挂载位置
 *   src/theme/Root.js 在应用挂载后调用 installFootnoteScrollCenter()。
 *   事件以**委托**方式挂在 document 上，所以 SPA 换页、正文异步渲染都不需要重新绑定。
 *   禁用 JS 时页面照旧可用：退回浏览器原生的"顶格跳转"。
 * ===========================================================================
 */

/** GFM 给引用/返回箭头打的标记属性 */
const REF_ATTR = 'data-footnote-ref';
const BACKREF_ATTR = 'data-footnote-backref';

/**
 * 按 href 指向的 id 形状判定方向（两个前缀互不包含，不会误判）：
 *   fn-     → 文末条目（正文编号点过去的方向）
 *   fnref-  → 正文编号（返回箭头的方向）
 * 用 id 形状而不是只认 data-* 属性：`user-content-` 前缀由 mdast-util-to-hast 加，
 * 同一条注解被引用多次时还会带 -2 之类的序号后缀，只有前缀是稳定的。
 * 形状兜底也抗上游改名 —— data-* 属性哪天被换掉，这里仍然认得出来。
 */
const NOTE_ID_RE = /^(?:user-content-)?fn-/;
const REF_ID_RE = /^(?:user-content-)?fnref-/;

/**
 * 居中时优先用的元素：插件（plugins/footnote-popover）给每个正文引用包的那层容器。
 * 为什么返回箭头这一侧不用 href 直接指向的那个 <a>：它带 34px 的 scroll-margin（同上），
 * 而且只有半个字大；`.fnRef` 是插件自己造的容器，正好是"编号 + 弹窗"这个整体。
 * 文末 <li> 不在任何 .fnRef 里，closest 返回 null，自然就用它自己。
 */
const REF_BOX_SELECTOR = '.fnRef';

/** 落点高亮的类名与时长：类名对应的样式在 src/css/custom.css */
const FLASH_CLASS = 'fnRefFlash';
const FLASH_DURATION = 1600;

/** 原生的可聚焦元素，判定用；这些元素**不能**被我们补 tabindex="-1"（会把它挪出 Tab 顺序） */
const NATURALLY_FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex]';

/** 元素比可用高度还高时的边距，以及底部留白（避免贴住视口下沿 / 遮挡物） */
const EDGE_PAD = 8;
const BOTTOM_PAD = 24;

/** 校正回合的容差与时限：偏差小于这个值就不动，超过时限就不再校正 */
const SETTLE_TOLERANCE = 2;
const SETTLE_DEADLINE = 900;

let installed = false;
/** 元素 -> 未过期的复位定时器，快速连点时用它重置，避免反复叠加 */
const flashTimers = new WeakMap();

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 真正的文档滚动容器（标准模式下是 <html>） */
const docScroller = () => document.scrollingElement || document.documentElement;

const isDocScroller = (el) =>
  el === docScroller() || el === document.documentElement || el === document.body;

/**
 * 从内往外找最近的**可滚动祖先**：目标可能不在文档流那一层（将来的布局改成
 * 视口内滚动容器也不用改这里）。只认 overflow-y 为 auto/scroll/overlay 的元素，
 * **不认 hidden** —— 文档里可能有用 overflow:hidden 裁掉溢出内容的盒子（弹窗就是靠它裁的），
 * 把它当滚动容器会让落点算到错误的坐标系里。
 */
function findScroller(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (isDocScroller(node)) {
      break;
    }
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight - node.clientHeight > 1
    ) {
      return node;
    }
  }
  return docScroller();
}

/**
 * 吸顶导航栏遮住的高度。
 * 只在它确实 fixed/sticky 且正贴在视口顶部时才算 ——
 * Docusaurus 的导航栏在 hideOnScroll 下会被平移出视口，那时不该留边距。
 * 静态定位的导航栏本来就随页面滚走，也不用留。
 * 导出给触屏弹窗模块（footnoteTouchPopover.js）共用：它也要躲开吸顶导航栏。
 */
export function navbarInset() {
  const nav = document.querySelector('.navbar');
  if (!nav) {
    return 0;
  }
  const rect = nav.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= EDGE_PAD) {
    return 0;
  }
  const position = getComputedStyle(nav).position;
  if (position !== 'fixed' && position !== 'sticky') {
    return 0;
  }
  // 只有还贴在顶部时才算遮挡（sticky 元素滚到一半时 top 会大于 0）
  if (rect.top > EDGE_PAD) {
    return 0;
  }
  return rect.bottom;
}

/**
 * 算出"把 box 放到视口垂直居中"所需的 scrollTop。
 * 三处细节都是为了"桌面端/移动端都算得准、不被页头与边界带偏"：
 *   1) 坐标系：元素在**滚动内容**里的位置 = rect.top - 滚动视口顶 + 当前 scrollTop。
 *      文档滚动时滚动视口顶就是 0；元素在某个 overflow 容器里时是那个容器的 rect.top。
 *   2) 边界：先夹进 [0, scrollHeight - 视口高]，页尾附近就自然停在最优位置而不是强行居中。
 *   3) 遮挡：把结果夹进"完整可见"的区间 —— 上不过吸顶导航栏、下不贴视口下沿。
 *      元素比可用高度还高时退回"开头对齐到导航栏下方"，保证首行可读。
 */
function centerScrollTop(scroller, box) {
  const isDoc = isDocScroller(scroller);
  const viewTop = isDoc ? 0 : scroller.getBoundingClientRect().top;
  // clientHeight 而不是 innerHeight：它就是 scrollHeight 的参照系（含/不含滚动条一致）
  const viewH = scroller.clientHeight;
  const maxTop = Math.max(0, scroller.scrollHeight - viewH);

  const rect = box.getBoundingClientRect();
  const top = rect.top - viewTop + scroller.scrollTop;
  const height = rect.height;

  const inset = (isDoc ? navbarInset() : 0) + EDGE_PAD;
  const upper = top - inset; // 再往下滚就顶到导航栏了
  const lower = top + height + BOTTOM_PAD - viewH; // 再往上滚底边就出去了
  const centered = top - (viewH - height) / 2;

  const desired =
    lower <= upper
      ? Math.min(Math.max(centered, lower), upper) // 放得下：居中，边界处自然被夹住
      : upper; // 放不下：从导航栏下方开始，让读者从第一行读起

  return Math.min(Math.max(desired, 0), maxTop);
}

/** 滚动。instant 用显式值：若将来给 html 加了 scroll-behavior:smooth，'auto' 会变成平滑 */
function scrollTo(scroller, top) {
  const behavior = prefersReducedMotion() ? 'instant' : 'smooth';
  try {
    scroller.scrollTo({top, behavior});
  } catch {
    // 不认 ScrollToOptions / 不认 'instant' 的旧浏览器
    try {
      scroller.scrollTo(0, top);
    } catch {
      scroller.scrollTop = top;
    }
  }
}

/**
 * 滚动结束后校正一次。
 * 移动端地址栏在滚动过程中收起/展开会改变视口高度，落点会因此偏掉几十像素；
 * 偏差超过容差就静默纠一次（用即时滚动，不再触发第二次动画）。
 * 两道保险避免"把读者自己滚到的位置纠回来"：
 *   · 只在 SETTLE_DEADLINE 内有效；
 *   · 焦点已经不在落点上（读者点了别处/移到别处了）就直接放弃。
 */
function settle(scroller, box, anchorEl, deadline) {
  const onSettled = () => {
    if (Date.now() > deadline) {
      return;
    }
    if (anchorEl !== document.activeElement && !anchorEl.contains(document.activeElement)) {
      return; // 读者已经去做别的事了，别再动他的滚动位置
    }
    const again = centerScrollTop(scroller, box);
    if (Math.abs(again - scroller.scrollTop) > SETTLE_TOLERANCE) {
      try {
        scroller.scrollTo({top: again, behavior: 'instant'});
      } catch {
        scroller.scrollTop = again;
      }
    }
  };

  if ('onscrollend' in scroller) {
    scroller.addEventListener('scrollend', onSettled, {once: true});
  } else {
    // 不支持 scrollend 的老浏览器：按最长的平滑动画时长估一个时刻
    window.setTimeout(onSettled, prefersReducedMotion() ? 0 : 500);
  }
}

/**
 * 落点聚焦：原生片段导航会把"顺序焦点导航起点"挪到目标上（之后按 Tab 从这里继续），
 * preventDefault 之后必须自己补上，否则键盘读者会被留在原地。
 * <li> 之类默认不可聚焦的元素要补 tabindex="-1"；注意别给 <a href> 补，
 * 那会把本来在 Tab 顺序里的链接挪出去。
 */
function focusTarget(el) {
  if (typeof el.focus !== 'function') {
    return;
  }
  if (!el.matches(NATURALLY_FOCUSABLE)) {
    el.setAttribute('tabindex', '-1');
  }
  try {
    // preventScroll：万一浏览器聚焦时自己滚了一下，也会被紧随其后的定位覆盖
    el.focus({preventScroll: true});
  } catch {
    try {
      el.focus();
    } catch {
      /* 焦点不是必要功能，取不到就算了 */
    }
  }
}

/** 短暂高亮落点：长段落/长注解里靠它一眼找到刚才那一处 */
function flash(target) {
  window.clearTimeout(flashTimers.get(target));
  // 先摘类再强制重排，连续点击时动画才会重新开始播放
  target.classList.remove(FLASH_CLASS);
  void target.offsetWidth;
  target.classList.add(FLASH_CLASS);
  flashTimers.set(
    target,
    window.setTimeout(() => {
      target.classList.remove(FLASH_CLASS);
      flashTimers.delete(target);
    }, FLASH_DURATION),
  );
}

/** 一次跳转的全部动作：聚焦 -> 居中 -> 高亮 -> 结束后校正 */
function jumpTo(target) {
  const box = target.closest(REF_BOX_SELECTOR) ?? target;
  const scroller = findScroller(box);
  focusTarget(target);
  scrollTo(scroller, centerScrollTop(scroller, box));
  flash(target);
  settle(scroller, box, target, Date.now() + SETTLE_DEADLINE);
}

/**
 * 从点击目标解析出"脚注链接"。
 * 目标通常就是那个 <a>，但也可能是包着它的 .fnRef 容器 —— 触屏上编号的点击热区
 * 被撑大过（见 custom.css 里 @media (hover: none) 那段），手指落在 <sup> 或编号
 * 边缘时命中的就是外层容器。容器里第一个 `#` 链接正是引用本身（弹窗副本排在它后面），
 * 所以这种情况同样按"点了编号"处理 —— 否则触屏上就会出现"弹窗关掉了却没跳转"。
 */
function resolveAnchor(node) {
  if (!(node instanceof Element)) {
    return null;
  }
  const direct = node.closest('a[href]');
  if (direct) {
    return direct;
  }
  const box = node.closest(REF_BOX_SELECTOR);
  return box ? box.querySelector('a[href^="#"]') : null;
}

function onClick(event) {
  // 只接管"左键 + 无修饰键"的普通点击；中键、Ctrl/Cmd 新标签页、已被别人处理过的都放过
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const anchor = resolveAnchor(event.target);
  if (!anchor) {
    return;
  }

  const href = anchor.getAttribute('href') ?? '';
  if (!href.startsWith('#')) {
    return;
  }

  const id = decodeURIComponent(href.slice(1));
  const isBackref = anchor.hasAttribute(BACKREF_ATTR);
  const isRef = anchor.hasAttribute(REF_ATTR);
  // 方向由"href 指向的目标"与标记属性共同决定，两种判据任一成立就接管
  if (!isBackref && !isRef && !NOTE_ID_RE.test(id) && !REF_ID_RE.test(id)) {
    return;
  }

  const target = document.getElementById(id);
  if (!target) {
    return; // 目标不在本页（例如被摘掉的注解），让浏览器按原生方式兜底
  }

  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return; // 未渲染（如折叠容器内），让浏览器兜底
  }

  event.preventDefault();
  jumpTo(target);
}

/**
 * 安装委托监听。返回卸载函数（React 严格模式下会 install → cleanup → install）。
 */
export function installFootnoteScrollCenter() {
  if (installed || typeof document === 'undefined') {
    return () => {};
  }
  installed = true;
  document.addEventListener('click', onClick, false);

  return () => {
    document.removeEventListener('click', onClick, false);
    installed = false;
  };
}

export default installFootnoteScrollCenter;
