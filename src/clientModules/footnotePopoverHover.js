/**
 * 指针设备上的脚注弹窗：悬停/键盘聚焦时显示，并把它塞进视口
 * ===========================================================================
 * 桌面端"显示不显示"仍然完全由 CSS 决定（`.fnRef:hover > .fnPop` / `:focus-within > .fnPop`），
 * 本模块**不改变可见性**，只补一件事：**显示在哪儿**。
 *
 * 为什么需要它
 *   `.fnPop` 是绝对定位在编号旁边的：默认往上弹、水平居中于编号。这在正文中间很合适，
 *   但有两处会出问题——编号靠近页首时上方放不下（弹窗顶到视口外），编号靠近版心边缘时
 *   左右探出视口。触屏那边早就有"上方优先 → 放不下翻面 → 贴边平移 → 限高内部滚动"这套实测算法
 *   （footnotePopoverFit.js），而指针设备一直靠 CSS 静态定位，于是同一个弹窗在窄窗口/长注解下
 *   会探出视口或被裁掉。本模块把同一套算法接过来，两边表现就此一致。
 *
 * 为什么用 pointerover/pointerout 而不是 pointerenter/pointerleave
 *   `pointerenter`/`pointerleave` **不冒泡**，没法用 document 上的委托监听；而弹窗是随正文
 *   动态渲染的，逐个绑定既麻烦又要在 SPA 换页后重绑。`pointerover`/`pointerout` 会冒泡，
 *   配合 relatedTarget 判断"真的进出了这个容器"，语义与 enter/leave 等价。
 *   注意鼠标移到**弹窗自身**上时 relatedTarget 仍在容器内 → 不当作离开，弹窗保持展开
 *   （与 CSS 里 `:hover` 覆盖到子节点一致）。
 *
 * 键盘路径
 *   Tab 聚焦编号时由 CSS 的 `:focus-within` 显示弹窗，这里同步在 focusin 时套一次算法；
 *   焦点离开容器则复位。两条路径共用同一个"当前容器"，不会互相打架。
 *
 * 与触屏模块的关系
 *   门控查询取反（isFinePointer）：两个模块永远只有一个在工作。所以指针设备上
 *   "悬停弹窗、点击即跳转"的原行为一点没变 —— 本模块只是让弹窗落地更讲究。
 *
 * 挂载位置：src/theme/Root.js。
 * ===========================================================================
 */

import {
  BOX_SELECTOR,
  POP_SELECTOR,
  fitPopover,
  isFinePointer,
  resetPopover,
} from './footnotePopoverFit';

/** 当前正被悬停/聚焦的 .fnRef（同一时刻最多一个） */
let activeBox = null;
let installed = false;
let rafId = 0;

/** 判断某个节点是不是"在容器内部"（relatedTarget 可能是 null / window / 文本节点） */
function contains(box, node) {
  return node instanceof Node && box.contains(node);
}

/** 让某个容器成为"当前容器"并套用定位算法 */
function activate(box) {
  if (box === activeBox) {
    return;
  }
  if (activeBox) {
    resetPopover(activeBox);
  }
  const pop = box.querySelector(POP_SELECTOR);
  if (!pop) {
    activeBox = null;
    return;
  }
  activeBox = box;
  fitPopover(box, pop);
}

/** 复位并释放当前容器 */
function deactivate() {
  if (activeBox) {
    resetPopover(activeBox);
    activeBox = null;
  }
}

/**
 * 悬停/聚焦期间页面滚动或窗口缩放：重新套一次算法。
 * 不收起弹窗（桌面上弹窗是"跟着指针"的，收起反而要去够；重算即可），
 * 但用 rAF 合并连续事件，免得滚动时每帧量好几次。
 */
function refit() {
  if (!activeBox || rafId) {
    return;
  }
  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    if (!activeBox) {
      return;
    }
    const pop = activeBox.querySelector(POP_SELECTOR);
    if (pop) {
      fitPopover(activeBox, pop);
    }
  });
}

function onPointerOver(event) {
  if (!isFinePointer() || event.pointerType === 'touch') {
    return;
  }
  const node = event.target instanceof Element ? event.target : null;
  if (!node) {
    return;
  }
  const box = node.closest(BOX_SELECTOR);
  if (!box) {
    return;
  }
  // 从容器内部移动到容器内部（例如移到弹窗自身上）不算"重新进入"
  if (contains(box, event.relatedTarget)) {
    return;
  }
  activate(box);
}

function onPointerOut(event) {
  if (!activeBox) {
    return;
  }
  const node = event.target instanceof Element ? event.target : null;
  const box = node ? node.closest(BOX_SELECTOR) : null;
  if (box !== activeBox) {
    return;
  }
  // 移到容器内部别处（弹窗、编号）→ 还在悬停，不动
  if (contains(box, event.relatedTarget)) {
    return;
  }
  deactivate();
}

function onFocusIn(event) {
  if (!isFinePointer()) {
    return;
  }
  const node = event.target instanceof Element ? event.target : null;
  const box = node ? node.closest(BOX_SELECTOR) : null;
  if (box) {
    activate(box);
  }
}

function onFocusOut(event) {
  if (!activeBox) {
    return;
  }
  const node = event.target instanceof Element ? event.target : null;
  const box = node ? node.closest(BOX_SELECTOR) : null;
  if (box !== activeBox) {
    return;
  }
  // 焦点在容器内部转移（编号 → 弹窗里的链接）不算离开
  if (contains(box, event.relatedTarget)) {
    return;
  }
  deactivate();
}

/**
 * 安装委托监听。返回卸载函数（React 严格模式下会 install → cleanup → install）。
 */
export function installFootnotePopoverHover() {
  if (installed || typeof document === 'undefined') {
    return () => {};
  }
  installed = true;
  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', refit, {capture: true, passive: true});
  window.addEventListener('resize', refit);

  return () => {
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('scroll', refit, {capture: true});
    window.removeEventListener('resize', refit);
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    deactivate();
    installed = false;
  };
}

export default installFootnotePopoverHover;
