/**
 * 包一层 @theme/DocItem/Content —— 让 front matter 能一键整页启用「边码」
 * ===========================================================================
 * 为什么包在这里：这个主题组件恰好包着「合成的 h1 标题 + 整篇 MDX 正文」，
 * 也就是文档的**全部版心内容**，是唯一合适的包裹点。
 *
 * 注意 front matter 只负责"给这一页开出一条版心外白边"，
 * 白边里画什么由正文里的 ^^页码^^ 锚点决定（见 plugins/bianma-mark）。
 * 两者是分开的：开了白边却没写锚点，得到的是一条空白边。
 *
 * 为什么外面再包一层不会弄坏原有版式：
 *   官方组件自己会渲染 <div class="theme-doc-markdown markdown">，
 *   我们的容器是它的**父级**，所以 Infima 那些直接子代选择器
 *   （.markdown > h2、.markdown > *:last-child 等）依旧命中原来的元素。
 *
 * 参考：https://docusaurus.io/docs/swizzling#wrapping
 *
 * ⚠️ 与官方 wrapping 示例的区别：官方示例是"包装后无条件改变渲染结果"，
 * 这里多了一层判断——只有 front matter 真的开了边码才包，
 * 没开的页面返回的 DOM 与装这个功能之前一模一样（不会多出一层 div）。
 */

import React from 'react';
import OriginalDocItemContent from '@theme-original/DocItem/Content';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Bianma, {normalizeBianmaOptions} from '@site/src/components/Bianma';

export default function DocItemContent(props) {
  const {frontMatter} = useDoc();
  // front matter 允许自定义键（DocFrontMatterSchema 带 .unknown()），
  // 所以 `bianma:` 会原样出现在这里，不会被校验丢掉。
  const options = normalizeBianmaOptions(frontMatter?.bianma);

  if (!options) {
    return <OriginalDocItemContent {...props} />;
  }

  return (
    <Bianma {...options}>
      <OriginalDocItemContent {...props} />
    </Bianma>
  );
}
