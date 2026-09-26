/**
 * 弹出窗口式脚注（EPUB 风格）—— 构建期 rehype 插件
 *
 * 这是一个 MDX 的 rehype 插件（不是 Docusaurus 插件），在 docusaurus.config.js 里
 * 通过 `docs.rehypePlugins: [footnotePopover]` 挂载。
 *
 * 输入：Docusaurus / GFM 脚注的默认产物
 *   正文引用：<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref>1</a></sup>
 *   文末定义：<section data-footnotes><ol><li id="user-content-fn-1">…注解内容…</li></ol></section>
 *
 * 输出：把文末注解的内容**复制**一份到引用旁边，并包一层可定位的容器
 *   <span class="fnRef">
 *     <sup>…原引用，保持不变…</sup>
 *     <span class="fnPop" role="note">…注解副本…</span>
 *   </span>
 *
 * 显隐完全由 CSS 控制（见 src/css/custom.css 的 .fnRef / .fnPop 规则），
 * 所以本插件不产生任何客户端 JS、不依赖 hydration，SPA 跳页也天然生效。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 副本里的块级标签必须改写成 `<span>`（否则会被 HTML 解析器甩出正文 `<p>` 之外、
 *    变成页面上可见的乱码，而**构建不报错**）。这条规则连同改写表都搬到了
 *    `plugins/lib/popover-shared.js` —— 与词典弹窗共用，以后改那一处即可。
 * ---------------------------------------------------------------------------
 */

import {cloneContent, hasFlag} from '../lib/popover-shared.js';

/** 判定“脚注引用”/“返回箭头”：mdast-util-to-hast 产出驼峰属性名，经 rehype-raw 序列化后是短横线形式，两种都认 */
const REF_KEYS = ['dataFootnoteRef', 'data-footnote-ref'];

const FN_ID_PREFIX = 'user-content-fn-';


/** 只含空白的文本节点：脚注条目首尾的换行符，判空与拆平时都要先滤掉 */
const isBlankText = (node) =>
  node.type === 'text' && /^\s*$/.test(String(node.value ?? ''));

/** 前序遍历整棵树 */
function walk(node, fn) {
  fn(node);
  for (const child of node.children ?? []) {
    walk(child, fn);
  }
}


/** 取出一条注解条目的可用内容 */
function noteContentOf(li) {
  const nodes = [];
  for (const child of li.children ?? []) {
    if (isBlankText(child)) {
      continue;
    }
    const cloned = cloneContent(child);
    if (cloned) {
      nodes.push(cloned);
    }
  }
  // 单段注解：把唯一那个 .fnPopP 拆平，弹窗里更紧凑（也避免首行多出缩进感）
  if (nodes.length === 1 && (nodes[0].properties?.className ?? []).includes('fnPopP')) {
    return nodes[0].children;
  }
  return nodes;
}

/** 把“引用所在的 <sup>”换成 .fnRef 容器 + .fnPop 弹窗；不是脚注引用就返回 null */
function wrapFootnoteRef(sup, notes) {
  if (sup?.type !== 'element' || sup.tagName !== 'sup') {
    return null;
  }
  const link = (sup.children ?? []).find(
    (child) =>
      child.type === 'element' &&
      child.tagName === 'a' &&
      hasFlag(child.properties, REF_KEYS),
  );
  if (!link) {
    return null;
  }
  const href = String(link.properties?.href ?? '');
  const content = href.startsWith('#') ? notes.get(href.slice(1)) : undefined;
  if (!content || content.length === 0) {
    return null;
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: {className: ['fnRef']},
    children: [
      sup,
      {
        type: 'element',
        tagName: 'span',
        properties: {className: ['fnPop'], role: 'note'},
        children: content,
      },
    ],
  };
}

export default function footnotePopover() {
  return (tree) => {
    // 1) 先收集文末所有脚注条目：id -> 清理后的内容
    const notes = new Map();
    walk(tree, (node) => {
      const id = node.properties?.id;
      if (
        node.type === 'element' &&
        node.tagName === 'li' &&
        typeof id === 'string' &&
        id.startsWith(FN_ID_PREFIX)
      ) {
        notes.set(id, noteContentOf(node));
      }
    });

    // 本页没有脚注，直接跳过（站内大多数文档都属于这种情况）
    if (notes.size === 0) {
      return;
    }

    // 2) 再遍历一遍，把引用包起来（必须在收集完成之后做，因为引用出现在定义之前）
    const visitChildren = (parent) => {
      const children = parent.children;
      if (!children) {
        return;
      }
      parent.children = children.map((child) => {
        const wrapped = wrapFootnoteRef(child, notes);
        if (wrapped) {
          return wrapped;
        }
        visitChildren(child);
        return child;
      });
    };
    visitChildren(tree);
  };
}
