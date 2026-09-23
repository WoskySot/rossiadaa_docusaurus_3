import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: '本站简介',
    Svg: require('@site/static/img/pithcher1.svg').default,
    description: (
      <>
        <code>帝俄行政部</code>是不存在的<code>假想部门</code>。在这里，
        被神选中的人们将被授予“键之盘”，导引研究之力。站长将扮演一位名为“发言人”
        的神秘角色，在<code>翻译</code>的旅行中邂逅内容各异，论点独特的著作们，
        和它们一起探求新知——同时，逐步发掘“帝俄”的真相。
      </>
    ),
  },
  {
    title: '提示',
    Svg: require('@site/static/img/mailbox.svg').default,
    description: (
      <>
        本网站旨在服务个人学习，内容主要是个人学习笔记和翻译，对学习过程中所见所读进行整理和分享，所有内容均为个人理解，可能存在错误和不准确之处。请读者自行判断和参考。若有任何问题，请通过<code>邮箱</code>联系我。
      </>
    ),
  },
  {
    title: '公告栏',
    Svg: require('@site/static/img/typing.svg').default,
    description: (
      <>
        公告栏会定时发布一些关于本站的更新计划和通知，欢迎大家关注。
      </>
    ),
  },
];

function Feature({Svg, title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
