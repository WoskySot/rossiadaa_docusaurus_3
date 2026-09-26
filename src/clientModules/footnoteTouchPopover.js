/**
 * 触屏上的脚注弹窗：第一下点开弹窗，第二下才跳转
 * ===========================================================================
 * 桌面端（指针设备）是"悬停弹窗、点击即跳转"，这套在触屏上不成立：手指没有悬停态，
 * 若照搬"点一下就跳到文末"，读者就没法在原文旁边读到注解。所以触屏把点击拆成两段：
 *
 *   第一下点正文编号 → 就地弹出对应注解（不跳转、不改地址栏）
 *   再点这个编号     → 关掉弹窗并放行，由 footnoteScrollCenter.js 接手：
 *                      文末条目滚到视口**垂直居中** + 1.6s 落点高亮
 *
 * 本模块同时服务**词条弹窗**（Dictionary）：那也是 .fnRef 容器 + .fnPop 面板，
 * 只是引用换成了正文里的普通链接（带 data-dict-ref）。于是触屏上词条链接同样
 * 第一下弹窗、第二下才跳转；插件会在弹窗底部放一个「查看全文 →」出口，
 * 免得读者以为链接"点不动"。
 *
 * 其余细节：
 *   · 点正文其他任何地方、或点弹窗自身的空白 → 收起弹窗；
 *   · 点**另一个**编号 → 换成它的弹窗（不跳转）——同一时刻只留一个弹窗，符合直觉；
 *   · 滚动页面、旋转屏幕、按 Esc → 收起（弹窗跟随编号，滚走了就没必要留着）；
 *   · 弹窗里的链接照常可点（注解里可能有），点这类链接不收起；
 *   · 键盘 Enter / 辅助技术激活（click 的 detail === 0）直接放行，保持原生跳转，
 *     否则键盘读者要按两下才跳得走；
 *   · 指针设备（hover:hover + pointer:fine）本模块**完全不介入**，桌面行为与从前一模一样
 *     （门控查询与 src/css/custom.css 里的一字不差）。平板外接键鼠属于这一类。
 *
 * 为什么挂在**捕获阶段**
 *   本模块与 footnoteScrollCenter.js 都监听 document 的 click，而后者一看到
 *   event.defaultPrevented 就放手。捕获阶段先于冒泡阶段，且与两个监听器的注册顺序无关，
 *   于是"第一下只开弹窗"是确定的，不依赖 import 顺序；而第二次点击本模块不
 *   preventDefault，冒泡阶段那个模块照常接管跳转。
 *
 * 分工
 *   弹窗长什么样、显示在哪儿，全在 CSS 基础层 + footnotePopoverFit.js（与指针设备共用同一套
 *   「上方优先 → 翻面 → 贴边平移 → 限高内部滚动」算法）。本模块只管**开与关**，
 *   以及触屏特有的收起时机。
 *
 * 挂载位置：src/theme/Root.js。事件以委托方式挂在 document 上，SPA 换页无需重新绑定。
 * ===========================================================================
 */

import {
  BOX_SELECTOR,
  DICT_ATTR,
  OPEN_ATTR,
  POP_SELECTOR,
  REF_ATTR,
  fitPopover,
  isFinePointer,
  resetPopover,
} from './footnotePopoverFit';

/** 当前打开的 .fnRef 容器（同一时刻最多一个） */
let openBox = null;
let installed = false;

/** 收起当前弹窗 */
export function closeFootnotePopover() {
  if (openBox) {
    resetPopover(openBox);
    openBox = null;
  }
}

/** 打开某个编号的弹窗；返回是否真的打开了 */
function open(box) {
  const pop = box.querySelector(POP_SELECTOR);
  if (!pop) {
    return false;
  }
  if (openBox && openBox !== box) {
    resetPopover(openBox);
  }
  // 先把上一个容器量出来的变量清干净，再定位；否则会拿旧上限去截新弹窗
  resetPopover(box);
  box.setAttribute(OPEN_ATTR, '');
  openBox = box;
  fitPopover(box, pop);
  return true;
}

function onClick(event) {
  // 指针设备：那边由 footnotePopoverHover.js 负责，本模块完全不介入
  if (isFinePointer()) {
    return;
  }
  // 只接管"左键 + 无修饰键"的普通点击；已被别人处理过的（例如居中落点模块）放过
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  // 键盘 Enter / 辅助技术触发的点击没有坐标（detail === 0）：保持原生跳转，别让键盘读者多点一下
  if (event.detail === 0) {
    return;
  }

  const node = event.target instanceof Element ? event.target : null;
  if (!node) {
    return;
  }

  // 点在已打开的弹窗内部：链接照常走，其余（空白/文字）视为"点了一下弹窗"，收起
  if (openBox && openBox.contains(node)) {
    if (!node.closest('a[href]')) {
      closeFootnotePopover();
      event.preventDefault();
    }
    return;
  }

  const box = node.closest(BOX_SELECTOR);
  // 两种弹窗引用都算：脚注编号（data-footnote-ref）与词条链接（data-dict-ref）。
  // 少了后者，触屏上点词条链接会被当成"点了正文别处"——弹窗直接收起、且第一下就跳走。
  if (!box || !box.querySelector(`a[${REF_ATTR}], a[${DICT_ATTR}]`)) {
    closeFootnotePopover(); // 点了正文别处：收起
    return;
  }

  if (box === openBox) {
    // 第二下：收起弹窗并**放行** —— 冒泡阶段的 footnoteScrollCenter.js 接着做居中跳转
    closeFootnotePopover();
    return;
  }

  if (open(box)) {
    event.preventDefault(); // 第一下只开弹窗，不跳转、不动地址栏
  }
}

/**
 * 页面一滚就收起。
 * 例外：弹窗**自己**在滚（长注解）不算——它的 overflow 里有 overscroll-behavior: contain，
 * 滚动不会穿透到页面，这里也认一下事件的 target 是不是弹窗内部。
 */
function onScroll(event) {
  if (!openBox) {
    return;
  }
  const target = event.target;
  if (target instanceof Node && openBox.contains(target)) {
    return;
  }
  closeFootnotePopover();
}

/** 视口尺寸变了（旋转屏幕、地址栏收放）：直接收起，等读者需要时再点一次即可 */
function onViewportChange() {
  closeFootnotePopover();
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    closeFootnotePopover();
  }
}

/**
 * 安装委托监听。返回卸载函数（React 严格模式下会 install → cleanup → install）。
 */
export function installFootnoteTouchPopover() {
  if (installed || typeof document === 'undefined') {
    return () => {};
  }
  installed = true;
  // 捕获阶段：保证"第一下只开弹窗"先于居中落点模块拿到这次点击（与注册顺序无关）
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, {capture: true, passive: true});
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  document.addEventListener('keydown', onKeydown);

  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll, {capture: true});
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
    document.removeEventListener('keydown', onKeydown);
    closeFootnotePopover();
    installed = false;
  };
}

export default installFootnoteTouchPopover;
