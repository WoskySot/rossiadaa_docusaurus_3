/**
 * 边码（汉译书籍式「原文页码」）
 * ===========================================================================
 * 边码不是行号。它是**译文与原文页码的对应关系**：书页外侧那一列数字表示
 * "从这里往下，是原文第 42 页的内容"，好让读者拿译本去核对原书。
 *
 * 页码属于原文书，是固定事实——作者知道，浏览器算不出来。
 * 所以这个组件的分工是：
 *   1. 作者在正文里写 ^^42^^（构建期被 plugins/bianma-mark 转成零宽锚点）；
 *   2. 浏览器实测每个锚点落在哪一条**视觉行**——
 *      一行文字折成几行取决于视口宽度、字号、字体是否已加载，构建期量不出来；
 *   3. 把页码画进版心外那条白边，与所在行垂直居中；相邻两个页码之间拉一条细线，
 *      线从本页页码一直画到下一页页码出现为止，表示"这段行文属于哪一页"。
 *
 * 与行号的关键区别：数字由作者给定，**不随折行变化**，变的是它的落点。
 * 所以"原文第 42 页"可以当稳定引用（页面重排也只是位置挪动），而"第几行"不行。
 *
 * ---------------------------------------------------------------------------
 * 落点规则
 *
 * 段落中间写标记，页码就对齐那一行；写在段首（前面是别的块），就对齐该段第一行。
 * 一句话：**页码贴在你写标记的那一行**。
 *
 * 同一行里若挤进两个页码（两个标记离得太近），后一个会往下让开一点，
 * 并带上 data-bianma-pushed 标记（样式上表现为虚线小勾），避免叠成一团。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 关于 SSR：数字依赖浏览器测量，所以服务端渲染与首次客户端渲染都渲染一个
 * **空的白边**（见下方 view 初值）。测量放在 useEffect 里，与官方「Static site
 * generation」文档的要求一致——首屏客户端渲染必须与 SSR 产物完全一致，
 * 否则 React 会对着错误的 DOM 做 hydration。
 * 白边由 CSS 无条件预留，所以数字"迟到"不会引起布局跳动。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

/* 属性名与插件约定一致：plugins/bianma-mark/index.js */
const ANCHOR_SELECTOR = '[data-bianma-mark]';
const ROOT_ATTR = 'data-bianma-root';
const GUTTER_SELECTOR = '[data-bianma-gutter]';

/** 默认参数。front matter 与组件 props 共用这一套语义 */
export const BIANMA_DEFAULTS = {
  /** 白边在正文哪一侧：'left' | 'right' */
  side: 'left',
  /** 版心外白边宽度（px）。页码多为 2–3 位，56 够用；写 "p. 142" 这类长文本再调大 */
  gutter: 56,
  /** 是否在相邻页码之间拉细线（用来表示"这一段属于哪一页"） */
  rule: true,
};

/** 同一行里挤了两个页码时，下面那个往下让出的最小间距（px） */
const MIN_MARK_GAP = 2;
/** 页码与它下方那截细线之间留的空隙（px） */
const RULE_GAP = 2;
/** 空视图：SSR 与首次客户端渲染都用它 */
const EMPTY_VIEW = {marks: [], rules: [], bottom: 0};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

/**
 * 把 front matter 里的 `bianma` 值归一化成组件 props。
 *
 * 返回 null 表示"这一页不开边码"——此时 DocItem/Content 会原样渲染，
 * 页面 DOM 与没装这个功能时完全一致，不会多出一层容器。
 *
 * @param {boolean|string|object|null|undefined} raw front matter 里的原始值
 */
export function normalizeBianmaOptions(raw) {
  if (raw === undefined || raw === null || raw === false || raw === 'false') {
    return null;
  }
  // bianma: true —— 全部走默认参数
  if (raw === true || raw === 'true' || raw === '') {
    return {...BIANMA_DEFAULTS};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      ...BIANMA_DEFAULTS,
      side: raw.side === 'right' ? 'right' : 'left',
      gutter: toPositiveInt(raw.gutter, BIANMA_DEFAULTS.gutter),
      rule: raw.rule === undefined ? BIANMA_DEFAULTS.rule : raw.rule !== false && raw.rule !== 'false',
    };
  }
  return null;
}

/** 读出锚点要显示的文本：优先读属性，读不到就退回子节点 */
const anchorText = (element) => {
  const attr = element.getAttribute('data-bianma-mark');
  return String(attr ?? element.textContent ?? '').trim();
};

/**
 * 从锚点出发，朝前（dir=1）或朝后（dir=-1）找第一个**非空白字符**。
 * 用 TreeWalker 直接以锚点为起点，天然保持文档顺序；
 * 过滤掉边码栏自身（嵌套 <Bianma> 的白边里也有文字，但那不是正文）。
 */
function scanText(walker, anchor, dir) {
  walker.currentNode = anchor;
  let node = dir > 0 ? walker.nextNode() : walker.previousNode();

  while (node !== null) {
    const value = node.nodeValue ?? '';
    if (dir > 0) {
      const index = value.search(/\S/);
      if (index >= 0) {
        return {node, index};
      }
    } else {
      const match = /\S\s*$/.exec(value);
      if (match) {
        return {node, index: match.index};
      }
    }
    node = dir > 0 ? walker.nextNode() : walker.previousNode();
  }

  return null;
}

/** 行内级 display 值：找"段落"时要跨过它们 */
const INLINE_DISPLAY =
  /^(inline|inline-block|inline-flex|inline-grid|ruby|ruby-base|ruby-text|ruby-base-container|ruby-text-container|contents)$/;

/** 从锚点往上找最近的块级祖先（也就是"它属于哪一段"） */
function blockAncestorOf(element, content) {
  const view = element.ownerDocument.defaultView;
  let node = element.parentElement;
  while (node && node !== content) {
    if (!INLINE_DISPLAY.test(view.getComputedStyle(node).display)) {
      return node;
    }
    node = node.parentElement;
  }
  return node;
}

/**
 * 取"锚点所在那一条视觉行"的矩形（坐标已换算成相对容器顶部）。
 *
 * 锚点自身零宽零高，量不到行盒，于是借它旁边的**真实字符**来量。规则只有一条：
 * **页码贴在作者写下标记的那一行。**
 *   · 锚点前面若还有它所属段落里的文字 → 量前一个字符所在行（锚点就紧跟它）；
 *   · 锚点在某一段的开头（前面是别的块）→ 量后面第一个字符所在行，即该段第一行。
 * 于是写在段首的 ^^42^^ 落在第一行，写在段末的 ^^41^^ 落在本段最后一行，
 * 与"把标记插在原文分页的那个位置"这一直觉一致。
 *
 * 为什么不用 getComputedStyle 判 display:none：
 * 隐藏祖先包住的元素，它的 computed display 仍是自己的值（不是 none），判不出来；
 * 而 Range.getClientRects() 对隐藏内容天然返回空列表——拿不到矩形就不画，既准确又省事。
 */
function lineRectOf(anchor, content, originTop) {
  const doc = content.ownerDocument;
  const range = doc.createRange();

  const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      // 白边自己的文字不算正文（嵌套 <Bianma> 的白边里也有页码）
      if (parent.closest(GUTTER_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      // 锚点自身那份隐藏文本也不算：它不是"锚点旁边"的字，
      // 而且零宽矩形会把落点判断带偏（这一点踩过坑）。
      if (parent.closest(ANCHOR_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  /** 取最后一个"真实文字"矩形：锚点自身会产生零宽矩形，要滤掉 */
  const pick = (rects) => {
    let best = null;
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      if (rect.width >= 0.5 && rect.height >= 1) {
        best = rect;
      }
    }
    return best;
  };

  const before = scanText(walker, anchor, -1);
  const after = scanText(walker, anchor, 1);
  const block = blockAncestorOf(anchor, content);
  const hasTextBeforeInBlock = Boolean(
    before && block && block !== content && block.contains(before.node),
  );

  const measureFromBefore = () => {
    if (!before) {
      return null;
    }
    range.setStart(before.node, before.index);
    range.setEndAfter(anchor);
    const rect = pick(range.getClientRects());
    return rect ? {top: rect.top - originTop, height: rect.height} : null;
  };

  const measureFromAfter = () => {
    if (!after) {
      return null;
    }
    range.setStartBefore(anchor);
    range.setEnd(after.node, after.index + 1);
    const rect = pick(range.getClientRects());
    return rect ? {top: rect.top - originTop, height: rect.height} : null;
  };

  // 先按规则选，选不出结果再退回另一侧，最后退回锚点所在的父元素
  const preferred = hasTextBeforeInBlock ? measureFromBefore() : measureFromAfter();
  const fallback = hasTextBeforeInBlock ? measureFromAfter() : measureFromBefore();
  const picked = preferred ?? fallback;
  if (picked) {
    return picked;
  }

  const host = anchor.parentElement;
  if (host) {
    const rect = host.getBoundingClientRect();
    if (rect.height >= 1) {
      return {top: rect.top - originTop, height: rect.height};
    }
  }

  return null;
}

/**
 * 量出这一页要画的东西。
 *
 * 排序规则：先按**实测的上沿**，再按正文里的先后。
 * 之所以按实测位置排序而不是按文档顺序，是因为作者可能把锚点写在行内元素的
 * 内部、或写在浮动/多列内容里，文档顺序未必等于视觉顺序；而边码是给眼睛看的，
 * 必须与眼睛看到的行序一致。同一行时用文档顺序兜底，保证结果稳定可复现。
 */
function buildView(wrap, content, config) {
  const anchors = [];
  for (const element of content.querySelectorAll(ANCHOR_SELECTOR)) {
    // 嵌套的 <Bianma> 自己管自己的段落，别把内层的锚点算到外层头上
    if (element.closest(`[${ROOT_ATTR}]`) !== wrap) {
      continue;
    }
    const text = anchorText(element);
    if (text) {
      anchors.push({element, text, order: anchors.length});
    }
  }

  if (anchors.length === 0) {
    return EMPTY_VIEW;
  }

  const originTop = wrap.getBoundingClientRect().top;
  const placed = [];
  for (const anchor of anchors) {
    const line = lineRectOf(anchor.element, content, originTop);
    if (line) {
      placed.push({text: anchor.text, order: anchor.order, top: line.top, height: line.height});
    }
  }

  if (placed.length === 0) {
    return EMPTY_VIEW;
  }

  placed.sort((a, b) => a.top - b.top || a.order - b.order);

  // 落点：行盒中心（CSS 里用 translateY(-50%) 抵消，与文字视觉齐平）；
  // 同一行里挤了两个页码就往下让开，避免叠成一团。
  const marks = [];
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const item of placed) {
    const half = item.height / 2;
    let center = item.top + half;
    const pushed = center - half < previousBottom + MIN_MARK_GAP;
    if (pushed) {
      center = previousBottom + MIN_MARK_GAP + half;
    }
    previousBottom = center + half;
    marks.push({text: item.text, y: center, pushed});
  }

  // 细线：从本页页码画到下一个页码，最后一段一直画到版心底部
  // （最后那一页在正文结束后仍在继续，所以线不该提前断掉）
  const contentBottom = content.getBoundingClientRect().bottom - originTop;
  const bottom = Math.max(contentBottom, marks[marks.length - 1].y);
  const rules = [];
  if (config.rule) {
    for (let i = 0; i < marks.length; i += 1) {
      const top = marks[i].y;
      const end = i + 1 < marks.length ? marks[i + 1].y - RULE_GAP : bottom;
      if (end - top > 0.5) {
        rules.push({top, height: end - top});
      }
    }
  }

  return {marks, rules, bottom};
}

/** 两次测量结果是否等价；等价就不 setState，避免无意义的重渲染 */
const isSameView = (a, b) =>
  a.marks.length === b.marks.length &&
  a.rules.length === b.rules.length &&
  a.marks.every(
    (mark, i) =>
      mark.text === b.marks[i].text &&
      mark.pushed === b.marks[i].pushed &&
      Math.abs(mark.y - b.marks[i].y) < 0.5,
  ) &&
  a.rules.every(
    (rule, i) =>
      Math.abs(rule.top - b.rules[i].top) < 0.5 &&
      Math.abs(rule.height - b.rules[i].height) < 0.5,
  );

export default function Bianma({children, side, gutter, rule, className}) {
  const wrapRef = useRef(null);
  const contentRef = useRef(null);
  const [view, setView] = useState(EMPTY_VIEW);

  // props 与默认值合并；已归一化过的对象再传进来也安全（幂等）
  const config = useMemo(() => {
    const merged = {...BIANMA_DEFAULTS};
    if (side !== undefined) {
      merged.side = side === 'right' ? 'right' : 'left';
    }
    if (gutter !== undefined) {
      merged.gutter = toPositiveInt(gutter, merged.gutter);
    }
    if (rule !== undefined) {
      merged.rule = rule !== false && rule !== 'false';
    }
    return merged;
  }, [side, gutter, rule]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const content = contentRef.current;
    if (!wrap || !content) {
      return;
    }
    const next = buildView(wrap, content, config);
    setView((prev) => (isSameView(prev, next) ? prev : next));
  }, [config]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const wrap = wrapRef.current;
    const content = contentRef.current;
    if (!wrap || !content) {
      return undefined;
    }

    // 所有触发源统一走 rAF 去抖，一帧只量一次
    let frame = 0;
    const schedule = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    schedule();

    const disposers = [];

    // 容器尺寸变化：视口缩放、侧边栏折叠、图片把版面撑高、分栏切换……
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(wrap);
      resizeObserver.observe(content);
      disposers.push(() => resizeObserver.disconnect());
    }

    // 内容变化：切换标签页、展开 details、SPA 换页换上来的新正文……
    // 只观察 content，不观察包着白边的 wrap —— 否则渲染数字本身会触发观察器。
    if (typeof MutationObserver !== 'undefined') {
      const mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(content, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open'],
      });
      disposers.push(() => mutationObserver.disconnect());
    }

    window.addEventListener('resize', schedule);
    disposers.push(() => window.removeEventListener('resize', schedule));

    // 图片（含懒加载与异步解码）加载完会把后面的行往下推
    content.addEventListener('load', schedule, true);
    disposers.push(() => content.removeEventListener('load', schedule, true));

    // 明暗主题切换会换配色，也可能换字体设置
    if (typeof MutationObserver !== 'undefined') {
      const themeObserver = new MutationObserver(schedule);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      disposers.push(() => themeObserver.disconnect());
    }

    // 中文字体（尤其中文字体子集）常在首屏之后才落地，行宽会变
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(schedule).catch(() => {});
    }

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      disposers.forEach((dispose) => dispose());
    };
  }, [measure]);

  return (
    <div
      ref={wrapRef}
      className={clsx(
        styles.bianma,
        config.side === 'right' && styles.sideRight,
        className,
      )}
      style={{'--bianma-gutter': `${config.gutter}px`}}
      data-bianma-root=""
      data-bianma-side={config.side}
      data-bianma-rule={config.rule ? 'on' : 'off'}>
      {/* 白边是纯视觉辅助，对读屏软件隐藏（页码在正文里另有不可见的锚点，不影响阅读） */}
      <div className={styles.gutter} aria-hidden="true" data-bianma-gutter="">
        {view.rules.map((item, i) => (
          <span
            key={`rule-${i}`}
            className={styles.rule}
            style={{top: `${item.top}px`, height: `${item.height}px`}}
          />
        ))}
        {view.marks.map((item, i) => (
          <span
            key={`mark-${i}`}
            className={styles.mark}
            style={{top: `${item.y}px`}}
            data-bianma-pushed={item.pushed ? '' : undefined}>
            {item.text}
          </span>
        ))}
      </div>
      <div ref={contentRef} className={styles.content}>
        {children}
      </div>
    </div>
  );
}
