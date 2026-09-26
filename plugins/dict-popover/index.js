/**
 * Dictionary 弹窗 —— 构建期 rehype 插件
 * ===========================================================================
 * 作用：把「另一篇文档里手写的概括」复制到引用它的链接旁边，包成一个**与脚注弹窗
 * 完全同构**的小窗。于是运行期不需要任何新 JS —— 显隐靠 CSS，定位靠
 * src/clientModules/footnotePopoverFit.js（与脚注共用同一套类名契约，
 * 见 plugins/lib/popover-shared.js 的文件头说明）。
 *
 * 挂载方式（docusaurus.config.js）：
 *   docs:  rehypePlugins: [footnotePopover, bianmaMark, dictPopover]
 *   blog:  rehypePlugins: [dictPopover]      ← 公告栏要单独挂一次，否则 blog 里没弹窗
 *
 * ---------------------------------------------------------------------------
 * 输入输出
 *
 * 词条（docs/dictionary/eluosi.mdx）：
 *     ## 概括
 *     俄罗斯帝国（1721–1917）的通称。参见 [罗曼诺夫王朝](../dictionary/romanov)。
 *     ## 详细说明        ← 这个标题之后的内容**不会**进弹窗
 *
 * 正文引用（普通 Markdown 链接，无新语法）：
 *     ……（见 [帝俄](../dictionary/eluosi)）……
 *
 * 产出：
 *     <span class="fnRef" data-dict-entry="eluosi">
 *       <a href="/docs/dictionary/eluosi" data-dict-ref>帝俄</a>
 *       <span class="fnPop" role="note">
 *         …概括副本（块级标签已改写成 <span class="fnPopBlock fnPopXxx">）…
 *         <a class="fnPopMore" href="/docs/dictionary/eluosi">查看全文 →</a>
 *       </span>
 *     </span>
 *
 * ---------------------------------------------------------------------------
 * 四条设计上的取舍（都写在这里，免得后来人重新踩）
 *
 * 1) 「概括」用**标记标题**承载，而不是 front matter / 自定义容器 / 围栏代码块。
 *    对比过：front matter 里写不了富文本；`:::` 归 Docusaurus 的 admonition 插件管，
 *    自定义名不保证被保留；围栏代码块里 markdown 不解析（只能纯文本）；
 *    而这是 **MDX**，`{}` `<>` 都有特殊含义，自定义行内语法风险大。
 *    标题方案零语法风险，且这一节在词条页面上本身就是"概括"，语义自洽。
 *
 * 2) **直接读磁盘**，不走 Docusaurus 的 loadContent/contentLoaded 钩子。
 *    rehype 插件是逐文件在 MDX 编译期跑的，而"别的文件的内容"只能自己取。
 *    读盘 + 模块级缓存（按 mtime 失效）对框架内部时序零假设，比注册插件 + 依赖
 *    "contentLoaded 早于 MDX 编译"的时序稳。
 *    ⚠️ 代价：**改了词条概括后，dev 里已经编译过的引用页不会自动重编译**。
 *    改完重启 dev，或随手改一下引用页触发重编译即可。
 *
 * 3) **不递归**：弹窗副本内部的链接不再注入弹窗（概况里可以放词条链接，但不会套娃）；
 *    同理，已经存在的脚注弹窗（.fnPop）内部也跳过 —— 这样插件的挂载顺序不影响结果。
 *
 * 4) 词条的 URL 约定是 `/docs/dictionary/<文件名>`（注意：在块注释里别把斜杠紧跟星号写出来，
 *    那会提前闭合注释），所以词条文件
 *    **不要用 `NN-` 前缀、不要写 slug**（这两种都会让 URL 与文件名对不上）。
 *    真对不上时的表现只是"没有弹窗"，不会报错、不会中断构建。
 * ===========================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import yaml from 'js-yaml';
import {cloneContent} from '../lib/popover-shared.js';

/* ------------------------------- 可调常量 -------------------------------- */

/** 词条目录（相对仓库根） */
const DICT_DIR = 'docs/dictionary';
/** 词条 URL 前缀（与 Docusaurus 的 docs 路由默认值一致） */
const DICT_URL_BASE = '/docs/dictionary';
/** 承载"手写概括"的标题文字与层级 */
const SUMMARY_HEADING = '概括';
const HEADING_LEVEL = 2;
/** 引用 <a> 上挂的标记：客户端（触屏两段式点击）靠它识别"这是个弹窗引用" */
const DICT_ATTR = 'data-dict-ref';
/** 弹窗容器上挂的标识，便于调试与将来做样式区分 */
const ENTRY_ATTR = 'data-dict-entry';
/** 弹窗底部的"查看全文"出口（触屏两段式：第一下只弹窗，所以必须给个明确的去路） */
const MORE_CLASS = 'fnPopMore';
const MORE_LABEL = '查看全文 →';

/* ------------------------------- 内部工具 -------------------------------- */

const SUMMARY_RE = new RegExp(`^#{${HEADING_LEVEL}}\\s+${SUMMARY_HEADING}\\s*$`);
const ANY_HEADING_RE = /^#{1,2}\s+/;

/** 取 front matter 里的某个字段（只在词条没写「## 概括」时当兜底用） */
function frontMatterField(raw, field) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return null;
  try {
    const data = yaml.load(m[1]);
    const v = data?.[field];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** 从词条源码里切出「## 概括」一节的 markdown 原文；没有就返回 null */
function summaryMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  let inFront = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === 0 && line === '---') { inFront = true; continue; }
    if (inFront) { if (line === '---') inFront = false; continue; }
    if (SUMMARY_RE.test(line)) { start = i; break; }
  }
  if (start < 0) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i])) break;   // 下一个同级/更高级标题 → 收工
    body.push(lines[i]);
  }
  const md = body.join('\n').trim();
  return md || null;
}

/** markdown 片段 → hast 的 root 节点（复用仓库里已有的 unified 依赖，不新增任何包） */
function markdownToHast(md) {
  const proc = unified()
    .use(remarkParse)
    .use(remarkRehype, {allowDangerousHtml: true})
    .use(rehypeRaw);
  return proc.runSync(proc.parse(md));
}

/**
 * 把概括里"指向文档"的**相对链接**解析成绝对路径。
 *
 * ⚠️ 这一步不能省。本插件是**独立**跑 markdown→hast 的，不经过 Docusaurus 的链接解析，
 * 所以 `./romanov.mdx` 会原样留在节点里。而这份副本会被注入到**别的页面**上，
 * 那时相对路径就指向了错的位置 —— 实测：词条里的 `./romanov.mdx` 被注入到
 * `/docs/completed/dictionary-demo` 之后，浏览器会去请求
 * `/docs/completed/romanov.mdx`，被 `onBrokenLinks: 'throw'` 判为坏链、整个构建失败。
 *
 * 解析基准是**词条自己的目录**（即 /docs/dictionary/），因为链接是作者在词条文件里写的。
 * 只改写以 .md/.mdx 结尾的链接（文档间互链）；图片等其它相对资源保持原样，
 * 免得把 static/ 资源也改坏。
 */
function resolveDocLinks(node, base = `${DICT_URL_BASE}/`) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'element') {
    const href = node.tagName === 'a' ? node.properties?.href : null;
    if (typeof href === 'string') {
      const [pathPart, ...hash] = href.split('#');
      if (/\.mdx?$/i.test(pathPart)) {
        const resolved = /^\.\.?\//.test(pathPart)
          ? new URL(pathPart, `http://dict.local${base}`).pathname
          : pathPart;
        const clean = resolved.replace(/\.mdx?$/i, '');
        node.properties.href = hash.length ? `${clean}#${hash.join('#')}` : clean;
      }
    }
  }
  for (const child of node.children ?? []) resolveDocLinks(child, base);
}

/** 词条索引缓存：按文件 mtime 做签名，dev 里改了词条会自动重读 */
let cache = null;

/** 建立 词条 URL → 概括节点数组 的映射 */
function dictIndex() {
  const dir = path.resolve(process.cwd(), DICT_DIR);
  if (!fs.existsSync(dir)) return new Map();

  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f) && !/^index\./.test(f))
    .sort();

  const sig = files
    .map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`)
    .join('|');
  if (cache && cache.sig === sig) return cache.map;

  const map = new Map();
  for (const f of files) {
    const slug = f.replace(/\.mdx?$/, '');
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    let md = summaryMarkdown(raw);
    if (!md) {
      const desc = frontMatterField(raw, 'description');
      if (desc) {
        md = desc;
      } else {
        console.warn(
          `[dict-popover] ${DICT_DIR}/${f} 里没有「## ${SUMMARY_HEADING}」小节，` +
            `引用它时不会有弹窗（链接照常可点）。`,
        );
        continue;
      }
    }
    const root = markdownToHast(md);
    // 相对链接必须在这里就解析成绝对路径，否则副本落到别的页面会变成坏链（见该函数注释）
    resolveDocLinks(root);
    const children = (root.children ?? []).filter(
      (n) => !(n.type === 'text' && /^\s*$/.test(String(n.value ?? ''))),
    );
    if (children.length === 0) continue;
    map.set(`${DICT_URL_BASE}/${slug}`, {slug, children});
  }

  cache = {sig, map};
  return map;
}

/** 把 href 归一化成"可比较的路径"：去掉 #锚点、?query、扩展名与结尾斜杠 */
function normalizeHref(href) {
  let h = String(href ?? '').trim();
  if (!h) return null;
  h = h.split('#')[0].split('?')[0];
  h = h.replace(/\.mdx?$/i, '');
  try {
    h = decodeURIComponent(h);
  } catch {
    /* 编码坏了就按原样比 */
  }
  if (h.length > 1) h = h.replace(/\/+$/, '');
  return h;
}

/** 在索引里找 href 对应的词条：先精确匹配，再退回"以 /dictionary/<slug> 结尾" */
function lookup(href, index) {
  const h = normalizeHref(href);
  if (!h) return null;
  if (index.has(h)) return {url: h, ...index.get(h)};
  for (const [url, entry] of index) {
    if (h === `/${entry.slug}` || h.endsWith(`/${entry.slug}`)) return {url, ...entry};
  }
  return null;
}

const hasClass = (node, name) => {
  const c = node?.properties?.className;
  return Array.isArray(c) && c.includes(name);
};

const el = (tagName, properties, children) => ({type: 'element', tagName, properties, children});

/** 把命中词条的 <a> 包成 .fnRef + .fnPop；不是词条引用就返回 null */
function wrapDictRef(a, index) {
  const hit = lookup(a.properties?.href, index);
  if (!hit) return null;

  const anchor = {
    ...a,
    properties: {...a.properties, [DICT_ATTR]: ''},   // 供触屏模块识别
  };
  const panel = el(
    'span',
    {className: ['fnPop'], role: 'note'},
    [
      // 概括内容：走与脚注同一套清理（删 id、去锚点类、块级标签改写成 <span>+类名）
      ...hit.children.map(cloneContent).filter(Boolean),
      // 出口：触屏是第一下弹窗、第二下才跳转，没有它读者会以为"点不动"
      el('a', {className: [MORE_CLASS], href: hit.url}, [{type: 'text', value: MORE_LABEL}]),
    ],
  );
  return el('span', {className: ['fnRef'], [ENTRY_ATTR]: hit.slug}, [anchor, panel]);
}

/* --------------------------------- 插件 ---------------------------------- */

export default function dictPopover() {
  return (tree) => {
    const index = dictIndex();
    if (index.size === 0) return;   // 没有词条：整棵树原样返回，DOM 与从前完全一致

    const visit = (parent) => {
      const children = parent.children;
      if (!children) return;
      parent.children = children.map((child) => {
        if (child.type !== 'element') return child;
        // 已经有弹窗的容器（脚注插件的 .fnPop、本插件刚生成的副本）内部不再注入 → 不套娃
        if (hasClass(child, 'fnPop') || hasClass(child, 'fnRef')) return child;
        if (child.tagName === 'a') {
          const wrapped = wrapDictRef(child, index);
          if (wrapped) return wrapped;   // 替换后立即返回：不进入新生成的副本
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}
