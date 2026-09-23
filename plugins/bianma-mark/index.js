/**
 * 边码锚点语法 —— 构建期 rehype 插件
 * ===========================================================================
 * 语法：^^文本^^
 * 产物：<span class="bianmaAnchor" data-bianma-mark="文本">文本</span>
 *
 * 这一个插件只做一件事：把作者写下的行内语法，变成正文里一个**可被测量的锚点**。
 * 它不画数字、不排版——落点必须由浏览器实测（见 src/components/Bianma/index.js）。
 *
 * ---------------------------------------------------------------------------
 * 为什么不在这里顺手把页码渲染出来
 *
 * 边码要表达的是**译文与原文页码的对应**："原文第 42 页从这句话开始"。
 * 页码是原文书上的固定事实，只有作者知道，算不出来；而"这个锚点该画在第几行"
 * 又取决于视口宽度、字号、字体加载情况，构建期量不出来。
 * 于是只能这样分工：作者给页码（本插件），浏览器给落点（组件）。
 * ---------------------------------------------------------------------------
 *
 * 为什么锚点里还留着文本子节点（而不是只写进属性）：
 *   锚点靠 CSS 压成零宽不可见（src/components/Bianma/styles.module.css 里的
 *   `.content :global(.bianmaAnchor)`）。万一那份样式没加载，正文里会原样看见
 *   "42"——比彻底丢掉对应关系好，是刻意的降级。文本同时写进 data-bianma-mark，
 *   组件优先读属性、读不到再退回子节点。
 *
 * 为什么跳过 pre / code：
 *   这套语法本身要在文档里被演示（写在代码块或行内代码里）。不跳过的话，
 *   讲解语法的那个页面会把示例一起吃掉，示例就消失了。
 *
 * 写法边界：
 *   · 必须成对；落单的 ^^ 原样保留（不报错、不吞字）。
 *   · 文本为纯文本，长度上限 64 字符，不能换行、不能包含 ^。
 *     想在锚点文本里写加粗/链接是不支持的——这里只该写页码之类的短标记。
 */

/** 行内语法：^^文本^^  */
const MARK_PATTERN = /\^\^([^^\n]{1,64}?)\^\^/g;

/** 这些标签内部不做转换（见文件头"为什么跳过 pre / code"） */
const SKIP_TAGS = new Set(['pre', 'code', 'script', 'style', 'textarea']);

/** 锚点用的全局类名（插件产出的是纯 HTML，拿不到 CSS Module 的哈希类名） */
export const ANCHOR_CLASS = 'bianmaAnchor';

/** 组件读取边码文本所用的属性名；camelCase 经 rehype 序列化后是 data-bianma-mark */
export const ANCHOR_ATTR = 'data-bianma-mark';

const makeAnchor = (text) => ({
  type: 'element',
  tagName: 'span',
  properties: {className: [ANCHOR_CLASS], dataBianmaMark: text},
  children: [{type: 'text', value: text}],
});

/**
 * 把一个文本节点按语法拆成 [文本, 锚点, 文本, 锚点, …]。
 * 没有可用匹配时返回 null，表示"原样保留"（不要为了无匹配的节点制造无谓的改动）。
 */
function splitText(value) {
  MARK_PATTERN.lastIndex = 0;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = MARK_PATTERN.exec(value)) !== null) {
    const text = (match[1] ?? '').trim();
    const end = match.index + match[0].length;

    if (text === '') {
      // 形如 "^^ ^^"：内容全是空白，当普通文字处理（但必须把游标推过去，否则会吞字）
      parts.push({type: 'text', value: value.slice(cursor, end)});
      cursor = end;
      continue;
    }

    if (match.index > cursor) {
      parts.push({type: 'text', value: value.slice(cursor, match.index)});
    }
    parts.push(makeAnchor(text));
    cursor = end;
  }

  if (parts.length === 0) {
    return null;
  }
  if (cursor < value.length) {
    parts.push({type: 'text', value: value.slice(cursor)});
  }
  return parts;
}

/** 递归整棵 mdast / hast 树，就地替换带语法的文本节点 */
function transform(parent) {
  const children = parent.children;
  if (!Array.isArray(children) || children.length === 0) {
    return;
  }

  const next = [];
  for (const child of children) {
    if (child.type === 'text') {
      const parts = splitText(String(child.value ?? ''));
      if (parts) {
        next.push(...parts);
        continue;
      }
      next.push(child);
      continue;
    }

    // 跳过不转换的子树（命中即整棵不动）
    if (child.type === 'element' && SKIP_TAGS.has(child.tagName)) {
      next.push(child);
      continue;
    }

    if (child.children) {
      transform(child);
    }
    next.push(child);
  }

  parent.children = next;
}

export default function bianmaMark() {
  return (tree) => {
    transform(tree);
  };
}
