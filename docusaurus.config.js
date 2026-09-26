// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';
import footnotePopover from './plugins/footnote-popover/index.js';
import bianmaMark from './plugins/bianma-mark/index.js';
import dictPopover from './plugins/dict-popover/index.js';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: '帝俄行政部',
  tagline: '發佈本人非學術信息',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://console.cloud.tencent.com/', // Your website URL
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  // organizationName: 'WoskySot', // Usually your GitHub org/user name.
  // projectName: 'rossiadaa_docusaurus_3', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          // editUrl:
          //   'https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/',
          // // 弹出窗口式脚注：构建期把文末脚注内容复制到正文引用旁，
          // 显隐由 src/css/custom.css 的 .fnRef/.fnPop 控制（无客户端 JS）。
          // 想让公告栏（blog）也用上，把同一个插件加到 blog.rehypePlugins 即可。
          //
          // 边码锚点语法 ^^文本^^：构建期转成正文里的零宽锚点，
          // 落点由 src/components/Bianma 在浏览器里实测后画进版心外白边。
          //
          // Dictionary 词条弹窗：正文里链接到 docs/dictionary/<词条> 就自动挂弹窗，
          // 弹窗内容是词条里「## 概括」一节（作者手写）。与脚注共用同一套弹窗机制
          // （同样的 .fnRef / .fnPop 类名契约），详见 plugins/dict-popover/index.js。
          rehypePlugins: [footnotePopover, bianmaMark, dictPopover],
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          // editUrl:
          //   'https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
          // 公告栏里也要有词条弹窗 —— 必须**单独挂一次**，docs 那份不会自动生效。
          rehypePlugins: [dictPopover],
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: '帝俄行政部',
        logo: {
          alt: 'My Site Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'inProgressSidebar',
            position: 'left',
            label: '🛠施工中🛠',
          },
          {
            type: 'docSidebar',
            sidebarId: 'completedSidebar',
            position: 'left',
            label: '📕已完成📕',
          },
          {to: '/blog', label: '🗨公告栏🗨', position: 'left'},
          {
            href: 'https://github.com/WoskySot',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          // {
          //   title: 'Docs',
          //   items: [
          //     {
          //       label: 'Tutorial',
          //       to: '/docs/intro',
          //     },
          //   ],
          // },
          {
            title: '邮箱联络',
            
            items: [
              {
                label: 'WoskySot@outlook.com',
                href: 'mailto:woskysot@outlook.com',
              },
              // {
              //   label: 'X',
              //   href: 'https://x.com/docusaurus',
              // },
            ],
          },
          {
            title: '其他',
            items: [
              {
                label: '版权声明',
                to: '/blog/banquanshengming',
              },
              // {
              //   label: '更新计划',
              //   to: '/blog',
              // },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} RossiyaDAA, favicon from favicon.io and Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
  themes: [
    // ... Your other themes.
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      // ⚠️ 末尾那个 `& Record<string, unknown>` 不是装饰，别删：
      //    Docusaurus 的 `Config = DeepPartial<DocusaurusConfig>`，而 `PluginConfig` 的元组槽位是
      //    `[string, PluginOptions]`、`PluginOptions = {id?: string} & {[key: string]: unknown}`；
      //    经 `DeepPartial` 之后该槽位要求一个**字符串索引签名**。本插件 README 给的写法指向一个
      //    **interface**，而 TypeScript 里 interface **不会**获得隐式索引签名，于是 `@ts-check`
      //    会报 TS2322（"PluginOptions 中缺少类型"string"的索引签名"）。
      //    交叉上 `Record<string, unknown>` 即带上索引签名，同时保留插件选项的类型提示
      //    （`hashed` 的联合类型、拼写检查都还在）。
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions & Record<string, unknown>} */
      ({
        // ... Your options.
        // `hashed` is recommended as long-term-cache of index file is possible.
        hashed: true,

        // For Docs using Chinese, it is recomended to set:
        language: ["en", "zh"],

        // Customize the keyboard shortcut to focus search bar (default is "mod+k"):
        // searchBarShortcutKeymap: "s", // Use 'S' key
        // searchBarShortcutKeymap: "ctrl+shift+f", // Use Ctrl+Shift+F

        // ✅ 已启用 —— 对应「能搜到但不被 Google 收录」方案。
        //    插件默认遇到 <meta name="robots" content="noindex..."> 会**整页跳过**，而 Docusaurus 的
        //    front matter `unlisted: true` 正好会渲染出这条 meta。docs/dictionary/ 的词条是**刻意**
        //    保留 unlisted 的（⇒ 不进 sitemap、外部搜索引擎不收录），所以必须在这里打开这个开关，
        //    否则词条会「构建得出来、URL 能访问，却搜任何词都命中不了，且构建日志毫无异常」。
        //    ⇒ 词条的 `unlisted: true` 与这里的 `true` **必须同时存在**，只留一个就会坏。
        //    ⚠️ 这是**全局**开关：以后任何标了 unlisted / noIndex 的页面都会一起被索引进站内搜索
        //    ⇒ 不能再靠 unlisted 来"排除站内搜索"了（要排除站内搜索请改用 ignoreFiles）。
        //    开关全表与场景示例见 review/dictionary-搜索开关说明.md（场景 B）
        forceIgnoreNoIndex: true,

      }),
    ],
  ],
};

export default config;
