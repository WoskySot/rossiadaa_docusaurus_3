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
 * ⚠️ 为什么要把块级标签改写成 <span>（本插件最容易踩的坑）
 *
 * 弹窗是**挂在正文段落 `<p>` 内部**的（否则没法精确对齐到那个编号）。
 * 而 HTML 解析器有一条硬规则：遇到 `<p>` `<ul>` `<div>` `<pre>` … 这类块级起始标签时，
 * 会**自动闭合**当前打开的 `<p>`。于是 `<p>正文<span class=fnPop><p>注解</p></span></p>`
 * 会被解析成三段并列，注解内容被甩出弹窗、变成页面上可见的文字——
 * 构建不会因此报错（Docusaurus 只给一行 SSG warning），但页面是真的坏了。
 *
 * 解决办法：副本里所有块级标签一律改写成行内安全的 `<span>` + 类名
 * （`<p>`→`.fnPopP`、`<ul>`→`.fnPopUl`、`<li>`→`.fnPopLi`、`<pre>`→`.fnPopPre` …），
 * 再由 CSS 把它们摆回块级版式。语义上的完整结构仍保留在文末脚注区，
 * 弹窗只是一份"预览副本"，所以这里牺牲副本的标签语义是划算的。
 * ---------------------------------------------------------------------------
 */

/** 判定“脚注引用”/“返回箭头”：mdast-util-to-hast 产出驼峰属性名，经 rehype-raw 序列化后是短横线形式，两种都认 */
const REF_KEYS = ['dataFootnoteRef', 'data-footnote-ref'];
const BACKREF_KEYS = ['dataFootnoteBackref', 'data-footnote-backref'];

const FN_ID_PREFIX = 'user-content-fn-';
/** theme-common 给锚点目标加的 CSS Module 类（哈希后缀会变），副本里没有意义 */
const ANCHOR_CLASS_PREFIX = 'anchorTarget';

/** 块级标签 → 副本里使用的类名（全部改写成 span，原因见文件头） */
const BLOCK_CLASS = new Map([
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
 * 判定属性是否存在。
 * ⚠️ 必须判“键存在”而不是判真值：mdast-util-to-hast 给的 dataFootnoteBackref 是**空字符串**，
 * 用 Boolean() 判会漏掉返回箭头。
 */
const hasFlag = (properties, keys) =>
  keys.some((key) => properties?.[key] !== undefined);

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

/** 深度复制副本节点，并顺手做四件清理（见文件头说明） */
function cloneContent(node) {
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
