import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useAllDocsData, useDocById} from '@docusaurus/plugin-content-docs/client';

import styles from './styles.module.css';

/**
 * 两个分类栏位的定义。
 * - `dir`   必须与 docs/ 下的目录名一致（组件靠它筛选文档）
 * - `label` 请与 sidebars.js 中对应分类的 label 保持一致
 * - `tone`  对应 styles.module.css 里的配色类
 */
const CATEGORIES = [
  {
    dir: 'in-progress',
    label: '施工中',
    blurb: '正在翻译中……',
    tone: 'wip',
  },
  {
    dir: 'completed',
    label: '已完成',
    blurb: '翻译已完成，译文仅供学习交流使用，严禁用于商业用途。',
    tone: 'done',
  },
];

/** 单条文档：用 useDocById 取标题与摘要，拿不到就整条不渲染。 */
function DocEntry({id}) {
  const doc = useDocById(id);
  if (!doc) {
    return null;
  }
  return (
    <li className={styles.item}>
      <Link className={styles.link} to={doc.permalink}>
        <span className={styles.itemTitle}>{doc.title}</span>
        {doc.description ? (
          <span className={styles.itemDesc}>{doc.description}</span>
        ) : null}
      </Link>
    </li>
  );
}

function CategoryColumn({category, docIds}) {
  return (
    <section className={clsx(styles.column, styles[category.tone])}>
      <header className={styles.header}>
        <span className={styles.dot} aria-hidden="true" />
        <h2 className={styles.label}>{category.label}</h2>
        <span className={styles.count}>{docIds.length} 篇</span>
      </header>
      <p className={styles.blurb}>{category.blurb}</p>
      {docIds.length > 0 ? (
        <ul className={styles.list}>
          {docIds.map((id) => (
            <DocEntry key={id} id={id} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>该分类下暂时没有文档。</p>
      )}
    </section>
  );
}

export default function DocsOverview() {
  const allDocsData = useAllDocsData();
  const pluginData = Object.values(allDocsData)[0];
  const version =
    pluginData?.versions.find((item) => item.isLast) ?? pluginData?.versions[0];
  const allDocs = version?.docs ?? [];

  return (
    <div className={styles.grid}>
      {CATEGORIES.map((category) => {
        const prefix = `${category.dir}/`;
        const docIds = allDocs
          .filter((doc) => !doc.unlisted && doc.id.startsWith(prefix))
          .map((doc) => doc.id)
          .sort();

        return (
          <CategoryColumn
            key={category.dir}
            category={category}
            docIds={docIds}
          />
        );
      })}
    </div>
  );
}
