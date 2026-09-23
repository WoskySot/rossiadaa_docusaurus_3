/**
 * 包一层 <Root> —— 全局客户端行为挂载点
 * ===========================================================================
 * Root 是应用最外层、不随路由重建的组件（@docusaurus/core/lib/client/App.js 里
 * `<Root>` 包着 ThemeProvider 和整个路由树），所以它正好用来挂"全局事件"：
 * 挂在这里的监听器在 SPA 换页时不会被销毁重建，也不需要任何 DOM 包裹。
 *
 * 本文件挂三个脚注相关的补丁，各管一半：
 *   1. src/clientModules/footnoteScrollCenter.js
 *      两个方向的"垂直居中落点"（正文编号 ⇄ 文末条目），点击后目标滚到视口正中并短暂高亮；
 *   2. src/clientModules/footnoteTouchPopover.js
 *      触屏上的两段式点击（第一下点编号就地弹窗、再点一下才跳转）。
 *      它挂在**捕获阶段**，先于上面那个模块看到点击，并靠 event.defaultPrevented
 *      把"第一下"消费掉 —— 所以两者谁先注册都不影响结果（详见两个文件各自的头注释）。
 *   3. src/clientModules/footnotePopoverHover.js
 *      指针设备上的弹窗定位（悬停/聚焦时把它塞进视口）。
 *   两个弹窗模块的门控查询互为反面（isFinePointer），同一时刻只有一个在工作：
 *   触屏管"什么时候显示"，指针设备沿用 CSS 的 :hover / :focus-within，
 *   但"显示在哪儿"两边共用 src/clientModules/footnotePopoverFit.js 的同一套算法。
 *
 * 注意：这里**不渲染任何额外 DOM**，返回值与官方兜底实现
 * （node_modules/@docusaurus/core/lib/client/theme-fallback/Root）完全一致，
 * 所以页面结构、样式、SSR 产物都与装这些补丁之前一模一样。
 *
 * 参考：https://docusaurus.io/docs/swizzling#wrapping
 * ===========================================================================
 */

import React, {useEffect} from 'react';
import {installFootnoteScrollCenter} from '@site/src/clientModules/footnoteScrollCenter';
import {installFootnoteTouchPopover} from '@site/src/clientModules/footnoteTouchPopover';
import {installFootnotePopoverHover} from '@site/src/clientModules/footnotePopoverHover';

export default function Root({children}) {
  // 依赖数组留空：委托监听挂一次就够，SPA 换页不会让它失效。
  // 返回的卸载函数交给 React，严格模式下重复挂载也不会重复绑定。
  useEffect(() => installFootnoteTouchPopover(), []);
  useEffect(() => installFootnotePopoverHover(), []);
  useEffect(() => installFootnoteScrollCenter(), []);

  return <>{children}</>;
}
