/**
 * 弹窗副本的共用件 —— 脚注弹窗与词典弹窗都用这一份
 * ===========================================================================
 * 两套弹窗共用同一个 DOM 契约（显隐与几何规则见 src/css/custom.css 的
 * 「弹出窗口式脚注」与「Dictionary 弹窗」两节）：
 *
 *   <span class="fnRef">                        ← 定位容器（position: relative）
 *     …引用（脚注是 <sup><a>，词典是正文 <a>）…
 *     <span class="fnPop" role="note">…副本…</span>
 *   </span>
 *
 * ⚠️ 类名沿用 `fn*` 前缀是**有意为之**，不是笔误：
 *   · 显隐、几何、以及定位算法（src/clientModules/footnotePopoverFit.js）全都按这套
 *     类名与属性工作；沿用它们意味着词典弹窗**不需要任何新的 CSS 规则**，也**不用改定位算法**。
 *   · `fn` 在这里读作"弹窗面板"（popover），不是"脚注专属"。
 *   若日后想清理命名，做一次机械重命名即可（CSS + 两个插件 + 三个客户端模块）。
 *
 * 本文件只提供两样东西：
 *   · BLOCK_CLASS  块级标签 → 副本里使用的类名（全部改写成 <span>，原因见下）
 *   · cloneContent 深度复制副本节点，并顺手做清理（删 id、去锚点类、扔返回箭头）
 * 以及它们内部用到的小工具 hasFlag。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么必须把块级标签改写成 <span>（两套弹窗共同的最大坑）
 *
 * 弹窗是**挂在正文段落 `<p>` 内部**的（否则没法精确对齐到那个引用）。
 * 而 HTML 解析器有一条硬规则：遇到 `<p>` `<ul>` `<div>` `<pre>` … 这类块级起始标签时，
 * 会**自动闭合**当前打开的 `<p>`。于是
 *   <p>正文<span class=fnPop><p>内容</p></span></p>
 * 被解析成三段并列，副本内容被甩出弹窗、变成页面上可见的文字 ——
 * **构建不会因此报错**（Docusaurus 最多给一行 SSG warning），但页面是真的坏了。
 *
 * 解决办法：副本里所有块级标签一律改写成行内安全的 `<span>` + 类名
 * （`<p>`→`.fnPopP`、`<ul>`→`.fnPopUl`、`<li>`→`.fnPopLi`、`<pre>`→`.fnPopPre` …），
 * 再由 CSS 把它们摆回块级版式。语义完整的结构仍保留在原文里，
 * 弹窗只是一份"预览副本"，所以牺牲副本的标签语义是划算的。
 *
 * 新增块级标签时：补进 BLOCK_CLASS，并去 custom.css 的 `.fnPopBlock` 一节补样式。
 * 漏了的话会出现 `HTML minifier diagnostic` 警告，页面版式也会不对。
 * ---------------------------------------------------------------------------
 */

/** 判定属性是否存在。⚠️ 必须判"键存在"而不是判真值：mdast-util-to-hast 给的
 *  dataFootnoteBackref 是**空字符串**，用 Boolean() 判会漏掉返回箭头。 */
export const hasFlag = (properties, keys) =>
  keys.some((key) => properties?.[key] !== undefined);

/** 脚注的"返回箭头"（↩）不属于注解正文；mdast 产出驼峰、序列化后是短横线，两种都认。
 *  词典内容里没有这个标记，等于空操作。 */
const BACKREF_KEYS = ['dataFootnoteBackref', 'data-footnote-backref'];

/** theme-common 给锚点目标加的 CSS Module 类（哈希后缀会变），副本里没有意义 */
const ANCHOR_CLASS_PREFIX = 'anchorTarget';

/** 块级标签 → 副本里使用的类名（全部改写成 span，原因见文件头） */
export const BLOCK_CLASS = new Map([
  ['p', 'fnPopP'],
  ['ul', 'fnPopUl'],
  ['ol', 'fnPopOl'],
  ['li', 'fnPopLi'],
  ['dl', 'fnPopDl'],
  ['dt', 'fnPopDt'],
  ['dd', 'fnPopDd'],
  ['blockquote', 'fnPopQuote'],
  ['pre', 'fnPopPre'],
  ['hr', 'fnPopHr'],
  ['h1', 'fnPopH'],
  ['h2', 'fnPopH'],
  ['h3', 'fnPopH'],
  ['h4', 'fnPopH'],
  ['h5', 'fnPopH'],
  ['h6', 'fnPopH'],
  ['table', 'fnPopTable'],
  ['thead', 'fnPopTbody'],
  ['tbody', 'fnPopTbody'],
  ['tfoot', 'fnPopTbody'],
  ['tr', 'fnPopTr'],
  ['td', 'fnPopTd'],
  ['th', 'fnPopTd'],
  // 其余少见块级元素统一收进一个兜底类
  ['div', 'fnPopDiv'],
  ['section', 'fnPopDiv'],
  ['article', 'fnPopDiv'],
  ['aside', 'fnPopDiv'],
  ['nav', 'fnPopDiv'],
  ['header', 'fnPopDiv'],
  ['footer', 'fnPopDiv'],
  ['main', 'fnPopDiv'],
  ['figure', 'fnPopDiv'],
  ['figcaption', 'fnPopDiv'],
  ['details', 'fnPopDiv'],
  ['summary', 'fnPopDiv'],
  ['fieldset', 'fnPopDiv'],
  ['form', 'fnPopDiv'],
  ['address', 'fnPopDiv'],
]);

/**
 * 深度复制副本节点，并顺手做四件清理：
 *   1) 丢掉脚注的返回箭头（↩）；
 *   2) 删掉 id —— 副本是"第二份内容"，重复 id 会破坏页面锚点定位；
 *   3) 去掉 theme-common 的 anchorTarget* 类（哈希后缀会变，副本里没有意义）；
 *   4) 块级标签改写成 <span> + 类名（原因见文件头）。
 */
export function cloneContent(node) {
  if (node.type === 'text' || node.type === 'raw') {
    return {type: 'text', value: node.value};
  }
  if (node.type !== 'element') {
    return {...node};
  }
  // 返回箭头（↩）不属于注解正文
  if (hasFlag(node.properties, BACKREF_KEYS)) {
    return null;
  }

  const properties = {...node.properties};
  delete properties.id;
  if (Array.isArray(properties.className)) {
    const kept = properties.className.filter(
      (name) => !String(name).startsWith(ANCHOR_CLASS_PREFIX),
    );
    if (kept.length > 0) {
      properties.className = kept;
    } else {
      delete properties.className;
    }
  }

  const children = [];
  for (const child of node.children ?? []) {
    const cloned = cloneContent(child);
    if (cloned) {
      children.push(cloned);
    }
  }

  // 块级标签改写成行内安全的 span
  const blockClass = BLOCK_CLASS.get(node.tagName);
  if (!blockClass) {
    return {...node, properties, children};
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      ...properties,
      className: ['fnPopBlock', blockClass],
    },
    children,
  };
}
