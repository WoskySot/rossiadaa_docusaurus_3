/**
 * 脚注弹窗的「塞进视口」算法 —— 触屏与指针设备共用
 * ===========================================================================
 * 弹窗是绝对定位在编号旁边的，而它有两处先天不确定：
 *   · 竖直：往上弹是默认方向，但编号靠近页首时上方放不下；
 *   · 水平：`left: 50%` 居中于编号，但编号靠近版心左右边缘时左右会探出视口。
 * 这里把两处都按**实测**处理，顺序固定为四步：
 *   ① 上方优先；② 上方放不下 → 翻到下方；③ 水平越界 → 整体平移；④ 仍装不下 → 限高 + 内部滚动。
 *
 * 为什么两个平台要共用同一份实现
 *   触屏（footnoteTouchPopover.js，点开式）与指针设备（footnotePopoverHover.js，悬停式）
 *   只是"什么时候显示"不同；"显示在哪儿"完全一样。早先只有触屏有这套算法，于是同一个弹窗
 *   在窄桌面窗口里会探出视口、长注解会被视口裁掉——那是两份实现才会有的差异。
 *
 * 结果怎么传给 CSS
 *   不算出像素值再 inline 定位，而是只写两个 CSS 变量 + 三个状态属性，几何全留在 CSS 里：
 *     --fn-pop-max     高度上限 = 选中那一侧真正剩下的空间
 *     --fn-pop-shift   水平平移量 = 把居中位置推回视口所需的位移（小三角跟着同一个变量走）
 *     data-fn-flip     翻到下方（CSS 换边 + 小三角掉头）
 *     data-fn-scroll   内容高于上限 → 内部滚动（CSS 开 overflow 并藏掉小三角）
 *     data-fn-open     触屏的"已点开"状态（指针设备不用——那边由 :hover / :focus-within 显示）
 *   这样滚动、缩放、主题切换都不需要 JS 再介入，JS 只在"打开/调整"的瞬间写一次。
 *
 * 调用方约定
 *   两个模块都只在自己的平台上工作，门控查询是同一个常量（与 CSS 里的 @media 一字不差），
 *   互相排斥；本文件不注册任何监听，只提供纯函数。
 * ===========================================================================
 */

import {navbarInset} from './footnoteScrollCenter';

/** 与插件/主题一致的标记属性与选择器 */
export const REF_ATTR = 'data-footnote-ref';
export const BOX_SELECTOR = '.fnRef';
export const POP_SELECTOR = '.fnPop';

/** 状态属性（CSS 侧对应选择器写在 src/css/custom.css） */
export const OPEN_ATTR = 'data-fn-open';
export const FLIP_ATTR = 'data-fn-flip';
export const SCROLL_ATTR = 'data-fn-scroll';

/**
 * 门控查询。**必须与 CSS 里的一字不差**（src/css/custom.css 的两段 @media）。
 * 匹配 = 桌面式指针设备；不匹配 = 触屏（含"无悬停"或"粗指针"任一条成立）。
 */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** 视口安全边距（躲开裁切/圆角），以及弹窗与编号之间要求的最小竖直间距 */
export const SAFE_EDGE = 8;
export const SAFE_GAP = 8;

let finePointerQuery = null;

/**
 * 是否"桌面式指针设备"。用 matchMedia 现查（MediaQueryList.matches 会随设备变化更新），
 * 拿不到 matchMedia 的极老环境按"是"处理 —— 即按从前的默认行为（悬停式）走。
 */
export function isFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  if (!finePointerQuery) {
    finePointerQuery = window.matchMedia(FINE_POINTER_QUERY);
  }
  return finePointerQuery.matches;
}

/**
 * 复位一个容器的全部状态，**含实测出来的 CSS 变量**。
 * 必须连变量一起清：留着上一次的 --fn-pop-max，下次打开就会先被旧上限截一次，
 * 量到的"自然高度"是错的。
 */
export function resetPopover(box) {
  box.removeAttribute(OPEN_ATTR);
  box.removeAttribute(FLIP_ATTR);
  box.removeAttribute(SCROLL_ATTR);
  box.style.removeProperty('--fn-pop-max');
  box.style.removeProperty('--fn-pop-shift');
}

/**
 * 保证此刻能**量到真实几何**。
 * 基础层里 .fnPop 是 `display: none`（见 custom.css 的说明），隐藏时 getBoundingClientRect()
 * 全是 0。触屏路径会先挂 [data-fn-open] 再调 fit，所以本来就是可量的；但指针路径的显示
 * 由 `:hover` / `:focus-within` 决定，而"伪类生效"与"事件处理器执行"的先后并不适合依赖。
 * 于是这里统一兜底：量之前若仍是 display:none，临时打开（此时 visibility 仍是 hidden，
 * 不会闪一下），量完还原。
 */
function ensureMeasurable(pop) {
  const computed = window.getComputedStyle(pop).display;
  if (computed !== 'none') {
    return () => {};
  }
  const prev = pop.style.display;
  pop.style.display = 'block';
  return () => {
    if (prev) {
      pop.style.display = prev;
    } else {
      pop.style.removeProperty('display');
    }
  };
}

/**
 * 把弹窗塞进视口。四步，顺序不能换。
 */
export function fitPopover(box, pop) {
  const restore = ensureMeasurable(pop);
  try {
    const vh = document.documentElement.clientHeight;
    const vw = document.documentElement.clientWidth;

    // ① 量内容真实高度：先摘掉高度上限，否则量到的是被上一次上限截过的值
    pop.style.maxHeight = 'none';
    const natural = pop.getBoundingClientRect().height;
    pop.style.removeProperty('max-height');

    // ② 定竖直方向与高度上限
    const anchor = box.getBoundingClientRect();
    const safeTop = navbarInset() + SAFE_EDGE;
    const safeBottom = vh - SAFE_EDGE;
    const above = anchor.top - safeTop - SAFE_GAP;
    const below = safeBottom - anchor.bottom - SAFE_GAP;
    const side =
      above >= natural ? 'above' : below >= natural ? 'below' : above >= below ? 'above' : 'below';
    if (side === 'below') {
      box.setAttribute(FLIP_ATTR, 'below');
    } else {
      box.removeAttribute(FLIP_ATTR);
    }
    // 高度上限 = 选中那一侧真正剩下的空间，**不设下限**：
    // 宁可让它矮到内部滚动，也不能探出视口 —— 探出去的部分看不到也滚不到。
    // "太矮"有兜底：两侧都放不下时会选空间更大的那一侧，至少能拿到一半可用空间。
    const room = Math.max(side === 'above' ? above : below, 0);
    box.style.setProperty('--fn-pop-max', `${Math.round(room)}px`);

    // ③ 定水平平移：居中位置越出视口就整体推回来
    const rect = pop.getBoundingClientRect();
    let shift = 0;
    if (rect.left < SAFE_EDGE) {
      shift = SAFE_EDGE - rect.left;
    } else if (rect.right > vw - SAFE_EDGE) {
      shift = vw - SAFE_EDGE - rect.right;
    }
    if (shift) {
      box.style.setProperty('--fn-pop-shift', `${shift.toFixed(1)}px`);
    } else {
      box.style.removeProperty('--fn-pop-shift');
    }

    // ④ 内容确实高于上限 → 弹窗内部滚动（CSS 会顺手隐藏小三角并拦住滚动穿透）
    if (natural > room + 1) {
      box.setAttribute(SCROLL_ATTR, '');
    } else {
      box.removeAttribute(SCROLL_ATTR);
    }
  } finally {
    restore();
  }
}
