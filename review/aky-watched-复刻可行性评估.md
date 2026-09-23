# aky.moe/watched 实现方式分析 & Docusaurus 复刻可行性评估

- **评估时间**：2026-09-23
- **评估对象**：<https://aky.moe/watched/>（「赤城的部落格」的「我看过的」页面，个人观影/阅读记录墙）
- **评估方法**：抓取公开的 HTML / CSS / JS 产物做静态分析 + 无头 Chrome 实测（真实鼠标事件、1440→390px 多视口、
  明暗双主题、逐项点击）。**只读**：不写入对方站点、不注册、不做批量抓取。
- **一句话结论**：这个页面**本身就是 Docusaurus 做的**（Docusaurus v3.8.1 + React 19），
  所以"用 Docusaurus 复刻它"不存在技术可行性问题——真正的成本在**数据整理**和**三块自研代码**上。

---

## 0. 摘要（先看这三条）

1. **不是"像 Docusaurus"，就是 Docusaurus。** 产物里有 `<meta name="generator" content="Docusaurus v3.8.1">`、
   `<body class="plugin-pages plugin-id-default">`，源码路径可以直接从构建产物的分块表里读出来：
   **`src/pages/watched/index.tsx`**（pages 插件的独立页面，不是文档）。
   导航栏、页脚、暗色切换、移动端汉堡菜单、RSS/Atom/JSON Feed 全是 Docusaurus 原生能力。
2. **页面里最"贵"的三块都是自研的**：① 拼音/首字母/罗马音 + 错字容错的模糊搜索（Fuse.js + pinyin-pro + wanakana）；
   ② 卡片网格的视觉（手写 CSS，~15 条规则）；③ 搜索时"按分类分组展示"的结果视图。
   官方与社区的现成搜索方案（含本站导航栏用的那个本地搜索插件）**都覆盖不到这个页面的数据**。
3. **视觉/交互可以做到 1:1，代价是必须写 React。** 纯 Markdown/MDX 做不到这个页面——
   官方文档也明确独立页面"可以用 React 组件"、且"页面没有侧边栏"。反过来，如果你愿意写一个 `.tsx` 页面，
   布局、网格、标签页、暗色、响应式全都是常规工作量。

---

## 1. 页面实现原理分析

### 1.1 站点与页面框架（证据 → 结论）

| 观察到的证据 | 结论 |
| --- | --- |
| `<meta name=generator content="Docusaurus v3.8.1">`、`<body class="plugin-pages plugin-id-default">` | Docusaurus v3.8.1，该页由 `@docusaurus/plugin-content-pages` 渲染 |
| 主包分块表里有 `"@site/src/pages/watched/index.tsx"` 与 `{path:"/watched/", component: …}` | 源码就是 `src/pages/watched/index.tsx`，路由 `/watched/` 来自 pages 插件 |
| 产物版本串 `19.1.0`、DOM 里的 `<!-- -->` 文本分隔符 | React 19.1.0；页面是标准 React 组件 |
| 页面外层是 `<div class="theme-layout-main main-wrapper">`，上面有 navbar、下面有 footer | 页面用官方 `@theme/Layout`（`title`/`description` 属性）包住内容 |
| 首屏 HTML 里已经有 311 张卡片的完整 DOM | **构建期就渲染好了**（SSG），不是纯客户端渲染 |
| 产物是 webpack 风格（`self.webpackChunkmyblog`），路由级分块 + 按需加载 | 经典 webpack 打包；`/watched/` 的路由分块单独下载 |
| 站点根有 `/search-index.json`（8.6MB）、主包含 `easyops`/`search-local` | 导航栏搜索用的是社区本地搜索插件（`@easyops-cn/docusaurus-search-local`），**索引的是 docs/blog，不包含这个页面的 497 条记录** |
| 同站还有 `/video_watched`、`/projects`、`/catalog` 等 pages 路由 | 这套"卡片墙"是作者为自己多个页面复用的模式（CSS 类名共用） |

### 1.2 数据与内容模型

数据**没有走接口**，而是把一份 **TOML 文档当作字符串打包进 JS 分块**，在浏览器里解析后渲染。结构如下（示意）：

```toml
# 1) 两张"文案表"：状态名与分类名的中文显示文字也放在数据文件里
[status]
planned  = "想看"
watching = "在看"
watched  = "已看"
dropped  = "弃看"

[type]
anime    = "番剧"
movie    = "电影"
tv-play  = "电视剧"
document = "纪录片"
comic    = "漫画"
fiction  = "书籍"
game     = "游戏"

# 2) 每个分类一张数据表，数组里一条一条记录
[[anime]]
name    = "玉子市场"
status  = "planned"
url     = "http://bgm.tv/subject/55113"
cover   = "https://lain.bgm.tv/pic/cover/c/f8/7f/55113_TR5Is.jpg"
names   = [ "たまこまーけっと", "玉子市场" ]      # 别名（多为日文原名）

[[anime]]
name    = "-"        # ← 特殊记录：当"分组分隔符"用，把网格切段

[[anime]]
name    = "魔法少女与恶曾是敌人。"
status  = "watched"
watched = "2025/02/15"       # ← 与状态同名的字段，值是日期
```

**每条记录的字段**（从产物里逐字对照得出）：

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `name` | 标题 | 唯一必填；特殊值 `"-"` 表示"这里换一组" |
| `status` | 状态 | `planned` / `watching` / `watched` / `dropped`，显示成右上角的蓝标签 |
| `watched`（或同名于状态） | 日期 | 如 `2025/02/15`，卡片上显示成"已看 2/15/2025" |
| `url` | 外链 | 指向 bgm.tv 条目；支持 `bgm://12345` 简写，运行时展开成完整地址 |
| `cover` | 封面 | 不填则有三级兜底（见下） |
| `names` | 别名数组 | 搜索的重要来源（日文原名、别译名） |
| `note` | 备注 | 显示成卡片右下的小标签，实测内容如"厕纸" |

**三个值得学的实现细节**：

1. **`name = "-"` 当分组符**。产物里出现 15 次。它把同分类的卡片切成多段网格——
   这就是为什么"番剧"有 7 个网格（48+7+125+108+17+1+5 张），而"漫画"只有 1 个（30 张）。
   分组标题为空，纯粹靠视觉分段。
2. **封面三级兜底**：`cover` 没填时，先按 `./<分类>/<标题>.webp|jpg|png` 找仓库里的本地图片
   （webpack `require.context` 做存在性判断），再找同名 `.url` 纯文本文件里写的图片地址，
   最后 `console.warn("Missing cover for …")` 并留空。实测 497 条里 **只有 290 条有封面图**，
   其余显示为黑色方块——所以那个"黑块"不是设计，是数据缺失的正常表现。
3. **状态可以省略**：没写 `status` 时，代码会看这条记录里有没有 `watched = "2025/02/15"` 这类字段来反推状态。
   实测"游戏"分类 27 条全都没写 status，于是**整类卡片都没有状态标签**。

> 另外，生产包里留着作者的调试日志：`console.log("Raw TOML Data:", …)`、`console.log("Processing", …)`。
> 也就是说整份 TOML 会在控制台里被打印一遍——自己复刻时不建议照搬。

### 1.3 布局与样式

**网格**：不是 flex，也不是定死列数，而是

```css
.cardContainer { display: grid;
                 grid-template-columns: repeat(auto-fill, var(--card-width));
                 justify-content: center; justify-items: start; gap: .75rem; }
```

`--card-width` 在 `:root` 里是 **320px**（同一份样式表里另一个页面把它覆盖成 18rem）。
**全程没有任何媒体查询控制列数**，完全靠 `auto-fill` 自然换行。实测：

| 视口宽度 | 列数 | 卡片宽度 |
| --- | --- | --- |
| 1440px | 4 | 320px |
| 1280 / 1100px | 3 | 320px |
| 997 / 996 / 800px | 2 | 320px |
| 600 / 390px | 1 | 320px（**卡片不随屏幕变窄而收缩**） |

**卡片解剖**（实测 320×107px，`aspect-ratio: 3`，圆角 12px）：

- 左侧 **103×103 的方形封面**：`object-fit:cover`，底色 `#000`（这解释了无封面时的黑方块）；
  元素既写了内联 `background-image` 当占位，又套了一层 `<img>` 兜底，`referrerpolicy=no-referrer`。
- 右侧标题区：`margin-left: .5rem`，16px 字；**有链接的条目显示为链接色（青绿）**，
  没写 `url` 的条目是普通 `<div>`，标题是正文色、**也没有鼠标手型和悬停效果**。
- 右上角状态标签：绝对定位，蓝底 `#3b82f6` 白字 12px，`border-radius: 0 0 0 12px`（只圆左下角，贴着卡片右上角）。
- 右下角备注标签（`note`）同样绝对定位、同一种蓝。
- 悬停：`:is(a .card) :hover { border-color: #25c2a0 }` + 阴影，`transition: border-color .3s`。

> ⚠️ **一个复刻时很容易"颜色对不上"的坑**：上面那个悬停色 `#25c2a0`、以及标签页高亮色、搜索框聚焦环，
> 全是 **Docusaurus/Infima 的默认主色**——原站**没有**覆盖 `--ifm-color-primary`。
> 如果你在改过主色的站上复刻，这几处会跟着变，视觉就不一样了；要么显式写死，要么把主色改回默认。

**工具类不是 Tailwind**。页面里大量出现 `flex / flex-col / p-4 / ml-2 / mt-1 / gap-3 / h-full / text-sm /
text-decoration-none`，但整份 CSS 里 `--tw-` 出现 **0 次**，且只定义了用到的十来个——
也就是**作者手写了一小撮 Tailwind 风格的类名**，配合 Infima 自带的 `margin-top--md` 之类。
暗色适配只用了三条 `[data-theme='dark']` 规则（卡片边框、状态标签、备注标签）。

**样式归属**：实测全站只有 **1 个** `<link rel=stylesheet>`（`assets/css/styles.fac9e314.css`，89KB / gzip 18KB），
而 `card_X00l` 这些 **CSS Module 类名就在这张全局表里**（用 `document.styleSheets` 逐个 `cssRules` 查证）；
另外页面自己注入了一条 `<style>html{overflow-y: scroll}</style>` 防滚动条抖动。

### 1.4 交互

**① 分类切换 = Docusaurus 自带的标签页组件。**
DOM 就是 `ul.tabs[role=tablist]` + `li.tabs__item[role=tab]` + `div[role=tabpanel]`，还带 Infima 的 `margin-top--md`。
关键证据：**首屏 HTML 里只有 1 个 `tabpanel`**，其余 6 个分类是点开才渲染的——
这与官方文档对 `<Tabs lazy />` 的描述完全一致（见第 2 节）。

**② 搜索是自研的，而且是这个页面最核心的技术含量。**
搜索框 placeholder 直白写了能力范围："搜索标题 / 别名 / 拼音 / 首字母 / 罗马音…（错一两个字也能搜到）"。
底层配置（从路由分块里读到的原文）：

```js
new Fuse(items, {
  keys: [
    {name: 'title',     weight: 2},
    {name: 'names',     weight: 1.5},
    {name: '_py',       weight: 1},     // 拼音
    {name: '_romaji',   weight: 1},     // 罗马音
    {name: '_initials', weight: 0.6},   // 首字母
  ],
  threshold: 0.4,          // ← "错一两个字也能搜到"就是它
  ignoreLocation: true,    // ← 不必从头匹配
  minMatchCharLength: 1,
  includeScore: true,
});
```

三个派生字段在数据加载时算一遍（标题 + 全部别名一起算）：

- `_py`：拼音全拼（用 pinyin-pro 一类库，`toneType:'none'`，非中文字符剔除）
- `_initials`：拼音首字母（同一库的 `pattern:'first'`）
- `_romaji`：日文假名 → 罗马音（用 wanakana 一类库，过滤后只留 `[a-z0-9]`）

**实测行为**（无头 Chrome 真实输入）：

| 输入 | 命中 | 说明 |
| --- | --- | --- |
| `玉子` / `玉子市场` | 1 | 中文标题 |
| `yuzi` | 30 | 拼音前缀 |
| `yzsc` | 9 | 首字母 |
| `tamako` | 6 | 罗马音（来自别名「たまこまーけっと」） |
| `摇曳百和`（错字） | 1 | 模糊容错生效 |
| `玉子市玚`（错字） | 1 | 模糊容错生效 |
| `yaoyebaihe` | 3 | 全拼连写 |

**③ 搜索态会"顶掉"标签页。** 一旦有输入，代码走的是另一条渲染分支：
隐藏标签页，改成按分类分组的 `section`，标题形如「番剧 19」「漫画 1」（带计数），右上角出现「N 个结果 ×」清除按钮；
无匹配时显示「没有匹配「xxx」的结果」。实测搜"名侦探柯南"时结果跨了两个分类（番剧 19 + 漫画 1）。

**④ 搜索作用于全部分类**，不只是当前标签页——因为索引对 497 条全量数据建过一次（`useMemo` 缓存）。

### 1.5 体积与性能实测

| 资源 | 原始 | gzip | brotli | 备注 |
| --- | --- | --- | --- | --- |
| `/watched/` 的 HTML | 161KB | 19KB | 14KB | 已含 311 张卡片 + 300 多条图片 preload |
| 全局样式 `styles.css` | 89KB | 18KB | 16KB | 含该页的 CSS Module 样式 |
| 主包 `main.js` | 689KB | 197KB | 157KB | 主题、路由表、所有 docs 条目元数据 |
| `runtime~main.js` | 22KB | 10KB | 7KB | 分块映射 |
| `/watched/` 路由分块 | **1000KB** | 655KB | **637KB** | 页面组件 + **整份 TOML 数据** |
| Fuse + pinyin + wanakana 分块 | 487KB | 155KB | 125KB | 三个第三方库 |
| 站内搜索索引 `search-index.json` | 8.6MB | — | — | 导航栏搜索用，与本页无关但同站存在 |

首屏 JS 大致 **0.9MB（brotli）**。作者还额外给每张封面塞了 `<link rel="preload" as="image">`
（首屏 300+ 条），`<img>` 本身**没有** `loading="lazy"`——对个人站可接受，但不是可盲目照抄的部分。

---

## 2. 对照 Docusaurus 官方文档：可以直接复刻的部分

> 引用均来自 docusaurus.io 官方文档（当前版本 3.10.2；原站用的 3.8.1）。

| # | 原页面的实现 | Docusaurus 官方对应能力 | 复刻结论 |
| --- | --- | --- | --- |
| 1 | `src/pages/watched/index.tsx` 独立页，无侧边栏 | **Creating Pages**：`@docusaurus/plugin-content-pages`「empowers you to create one-off standalone pages」，`/src/pages/foo/index.js → [baseUrl]/foo/`，支持 `.tsx`；「You can use React components, or Markdown」；「Pages do not have sidebars, only docs do」 | ✅ 原样照做即可，模型完全一致 |
| 2 | 卡片/网格/标签/暗色的全部样式 | **Styling and Layout**：`theme.customCss` 全局样式、`*.module.css` CSS Modules、Infima 变量覆盖（「You can override Infima CSS variables globally」）、`[data-theme='dark']` 暗色、「Docusaurus uses `996px` as the cutoff between mobile screen width and desktop」 | ✅ 手写十来条 CSS 规则即可；原站的做法（CSS Module + 手写工具类）完全是官方推荐路径 |
| 3 | 7 个分类标签页、点开才渲染 | **Tabs**：`<Tabs>` / `<TabItem>`，DOM 就是 `role=tablist/tab/tabpanel` + `tabs__item`；官方明确「By default, all tabs are rendered eagerly during the build… It is possible to only render the default tab with `<Tabs lazy />`」 | ✅ 与原站实测行为一致，`<Tabs lazy>` 即可 |
| 4 | 页面标题/描述、「最后更新：2026-06-29」 | `<Layout title description>`；更新日期存在 `siteConfig.customFields`（配置项）里，页面直接读 | ✅ 官方配置项，零成本 |
| 5 | 导航栏、页脚、暗色切换、移动端菜单、RSS/Atom/JSON Feed、sitemap | 主题与 preset 开箱能力 | ✅ 白送 |
| 6 | 数据打包进 JS（TOML/JSON/TS 常量 import） | pages 与 MDX 都能 import 任意资源，走 webpack 处理 | ✅ 但要注意体积（见第 3 节） |
| 7 | 外链 `target=_blank` + `rel="noopener noreferrer"`、`referrerpolicy=no-referrer` | 纯 JSX 属性 | ✅ |
| 8 | 长文档站风格（`/catalog` 笔记、docs、blog） | 官方 docs/blog 插件 | ✅ 顺带白送 |

**小结**：这个页面的**骨架、样式体系、标签页、布局壳、部署形态**，100% 落在官方文档覆盖的范围内，
而且原站就是用这些搭出来的——所以"能不能复刻"的答案是没有悬念的。

---

## 3. 需要自研 / 难以原样照搬的部分

这里没有"框架限制"，只有"官方不提供、得自己写"的东西。按工作量从大到小：

### 3.1 模糊搜索（最大的一块）

- **官方/社区搜索方案都替不了它。** Algolia DocSearch 和社区本地搜索插件（就是本站导航栏那个，
  以及本项目也在用的那个）索引的是**文档/博客的正文内容**，按"页/段落"检索；
  而这个页面的 497 条是**结构化数据**（标题/别名/状态/日期/封面），一条也不在那个索引里
  （实测该站 `search-index.json` 8.6MB，但仍需另写一套）。
- 复刻必须自己做三件事：① 把标题 + 全部别名拼成检索文本；② 预计算拼音 / 首字母 / 罗马音三套派生字段；
  ③ 给 5 个字段配权重与阈值（可直接沿用原站那组数值作为起点）。
- 依赖：`fuse.js` + 一个拼音库 + 一个假名罗马音库。**这三者在 Docusaurus 官方文档里没有任何指引**，
  属于纯前端工程问题。
- 中文检索有个隐含前提：罗马音只对**日文别名**有效。原站 497 条几乎都带日文原名，所以"tamako"能命中；
  如果你的数据没有日文别名，这一路索引就是空的。

### 3.2 搜索态与标签页的切换逻辑

搜索时隐藏标签页、改成分组列表（带分类计数、清除按钮、空状态文案）——这是页面自己的渲染分支，
不是"配置开关"。要自己写：查询状态、结果按分类分桶、两套视图互斥渲染、计数、清除按钮、无结果文案。

### 3.3 卡片视觉（量不大，但一条都不会白得）

`auto-fill` 网格、固定 320px 卡宽、`aspect-ratio: 3`、103px 方形封面 + 黑底、右上状态标签的
`border-radius: 0 0 0 12px`、右下备注标签、悬停变色与过渡、明暗两套边框色——大约 **15 条 CSS 规则**，
官方不提供任何现成组件。好消息是：写出来就是几十行，难度低。

### 3.4 数据整理（真正的隐性成本）

- 体量：实测 **497 条**（番剧 311 / 电影 101 / 漫画 30 / 游戏 27 / 电视剧 13 / 纪录片 11 / 书籍 4），
  状态分布 想看 49 / 在看 18 / 已看 397（含重复计次）/ 弃看 5。
- 每条要维护：标题、状态、日期、别名数组、外链、封面、备注。
  实测覆盖率并不高：**497 条里只有 290 条有封面**、**223 条有外链**、**27 条（游戏整类）没有状态**
  ——这一半是"作者没填"，一半说明这类页面注定是"持续补录"的活。
- 封面还得处理**三级兜底**（本地文件 → `.url` 文本 → 空）；若要 1:1，这套逻辑也得自己写。

### 3.5 局限清单（会影响"能不能一模一样"）

| # | 局限 | 影响程度 | 说明 / 规避 |
| --- | --- | --- | --- |
| 1 | **纯 Markdown/MDX 做不到** | 高 | 卡片网格、Tabs+搜索联动、按状态分组都必须写 React。官方文档也把页面定位为"React 组件" |
| 2 | 官方/社区搜索插件**不能**替代自研搜索 | 高 | 除非放弃"拼音/首字母/罗马音 + 跨分类分组结果 + 错字容错"，否则必须自研 |
| 3 | 数据内联导致首屏 JS 偏大 | 中 | 实测 0.9MB（brotli）。数据涨到几千条时应改成"构建期产出 JSON 分片 + 运行时按需取"，这已属自研 |
| 4 | CSS Module 的类名**不能依赖** | 中 | 官方明确「CSS module class names … are considered implementation details and you should almost always avoid targeting them」。复刻时别照抄 `card_X00l` 这种选择器 |
| 5 | 主色差异会让"看着不像" | 中 | 悬停色 / Tab 高亮 / 搜索框聚焦环全是 Infima 默认青绿 `#25c2a0`。你站上改过主色的话，这几处会自己变色 |
| 6 | 第三方图床不可控 | 中 | 封面来自 `lain.bgm.tv`、`patchwiki.biligame.com` 等外链（原站靠 `referrerpolicy=no-referrer` 绕防盗链）。想稳就本地化 |
| 7 | 版本差异 | 低 | 原站 3.8.1，官方文档 3.10.2；Tabs/pages 行为一致，升级后需回归 |
| 8 | 部署平台特性 | 低 | 原站在 Vercel（含 `/_vercel/speed-insights`、Vercel 缓存头）；换托管就少了这块 |
| 9 | 移动端本来就不精致 | 低 | 实测 390px 下：卡片仍是 320px 不收缩、标签文字折成两行、搜索框轻微溢出。想"还原"就等于还原这些毛病，想"更好"则要额外做响应式 |
| 10 | 原站自身的瑕疵 | 低 | 生产包含调试 `console.log`（会把整份数据打到控制台）；页面里确有一条记录显示 `已看 Invalid Date`（日期解析未兜底）；游戏整类无状态标签 |

---

## 4. 整体复刻可行性结论

### 4.1 结论

| 维度 | 可行性 | 说明 |
| --- | --- | --- |
| **框架/技术选型** | ★★★★★ | 原站就是 Docusaurus v3.8.1 + React 19，同栈复刻，没有适配风险 |
| **布局还原度** | ★★★★★ | 网格、卡片比例、标签位置全部是常规 CSS，可精确到 px |
| **交互还原度** | ★★★★★ | 分类切换直接复用官方 `<Tabs lazy>`；其余是普通 React 状态 |
| **视觉还原度** | ★★★★☆ | 可 1:1，唯一要留意的是"主色/悬停色"这类继承自 Infima 的颜色（见局限 5） |
| **搜索功能还原度** | ★★★☆☆ | 必须自研 + 引 3 个库；能力矩阵（拼音/首字母/罗马音/容错）依赖数据里有没有日文别名与拼音可用性 |
| **数据侧成本** | ★★☆☆☆ | 497 条记录的整理与持续补录，是整件事里最花时间的部分，且无法靠技术手段消灭 |
| **总体** | **★★★★☆** | 技术与视觉几乎无风险；成本集中"自研搜索"与"数据整理"两项 |

### 4.2 按目标分级的成本

| 目标 | 需要做的事 | 用到的能力 |
| --- | --- | --- |
| **A. 只要视觉 + 分类切换**（不做搜索） | 一个 `.tsx` 页面 + 一份数据文件 + 十几条 CSS + `<Tabs lazy>` | **几乎只用官方能力**，成本最低 |
| **B. A + 模糊搜索** | 再加 Fuse.js + 拼音库 + 罗马音库，预计算 3 个派生字段 | 官方无指引，纯前端工程；这是"看起来最像"的关键一步 |
| **C. B + 搜索态分组视图 / 封面兜底 / 状态推断** | 再写结果分桶渲染、`name:"-"` 分组、封面三级兜底 | 这几条是作者的个人巧思，需自行实现 |

### 4.3 如果要做，建议的落地顺序

1. 先定**数据文件格式**：沿用"TOML/JSON + 分类表 + 状态/分类文案表 + `-` 分组符"这套设计是可行的，
   好处是**文案与分类顺序都留在数据里**，改分类不用动组件。
2. 写 `src/pages/watched/index.tsx`：`<Layout>` 包住「说明文字 + 最后更新 + 搜索框 + 内容区」。
3. 写卡片与网格的 CSS（先做静态视觉，对着 320×107 / 103px 封面 / 角落标签调）。
4. 接入 `<Tabs lazy>`，按分类渲染网格，验证"首屏 HTML 只出现当前分类"。
5. **最后**接搜索：Fuse 配置直接抄那 5 个字段与权重作为起点，再按自己的数据调 `threshold`。
6. 收尾检查：明暗两套颜色、390px 下的表现、外链图片的可达性、以及**别把调试日志带进生产包**。

---

## 附：证据留存与复核方式

- 抓取/实测时间：2026-09-23（HTML `Last-Modified: Wed, 23 Sep 2026 06:48:09 GMT`，站点由 Vercel 提供）
- 复核途径（都是公开产物，无需登录）：
  - 页面 HTML：`https://aky.moe/watched/`（含 `meta generator`、`plugin-pages`、SSR 卡片）
  - 全局样式：`https://aky.moe/assets/css/styles.fac9e314.css`（搜 `card_X00l`、`cardContainer_bDLv`）
  - 页面脚本：`https://aky.moe/assets/js/2198a8ea.5c898e48.js`（源码路径、TOML 字符串、Fuse 配置、渲染逻辑）
  - 依赖脚本：`https://aky.moe/assets/js/6451.513af9e8.js`（Fuse.js + 拼音 + 罗马音）
  - 站内搜索索引：`https://aky.moe/search-index.json`（8.6MB，可见与本页数据无关）
- 实测脚本：无头 Chrome + DevTools Protocol，用**真实鼠标事件**点击标签页、用原生 setter + `input` 事件驱动搜索框，
  逐个视口读 `getComputedStyle` 与 `getBoundingClientRect`；另存两张参考截图：
  `aky-watched-桌面.png`（1280×900）、`aky-watched-移动.png`（390×844）。
- 说明：本报告只做**公开产物的只读分析**，未复制对方源码、未下载其数据文件用于再发布；
  报告中的数值均为本次实测值，会随对方站点更新而变化。
