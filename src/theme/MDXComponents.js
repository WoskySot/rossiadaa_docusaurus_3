/**
 * 全局 MDX 组件作用域（官方推荐的 wrapping swizzle 写法）
 *
 * 作用：注册进这个表里的组件，在**任何** .mdx 文件里都能直接用，不需要写 import。
 * 参考：https://docusaurus.io/docs/markdown-features/react#mdx-component-scope
 *
 * ⚠️ 组件名必须是大写开头的标签（<Bianma>，不能写 <bianma>）：
 * MDX v3 起，小写标签一律按原生 HTML 元素处理，不会走这张映射表。
 *
 * 这里用的是 wrapping 而不是 eject —— ...MDXComponents 把官方原有的映射
 * （a / pre / code / img / admonition / mermaid…）全部继承下来，
 * 官方以后增删条目也不用我们跟着维护。
 */

import React from 'react';
// 原来的映射表
import MDXComponents from '@theme-original/MDXComponents';
import Bianma from '@site/src/components/Bianma';

export default {
  // 先铺开官方映射
  ...MDXComponents,
  // 再挂上自己加的：<Bianma>…</Bianma>
  Bianma,
};
