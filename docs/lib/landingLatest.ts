import type { ChangelogRelease } from '@/lib/changelog';
import type { LatestReleaseInfo } from '@/lib/latestRelease';

type LandingLatestUpdates = {
  version: string;
  title: string;
  desc: string;
  link: string;
  items: string[];
};

const text = {
  en: {
    title: 'Latest updates',
    desc: 'Mirrored from the latest GitHub release notes.',
    link: 'Read the changelog',
    fallbackItems: [
      'Desktop release assets for macOS, Windows, and Linux',
      'Database workflow improvements',
      'Bug fixes and reliability updates',
      'Documentation and packaging updates',
    ],
  },
  cn: {
    title: '最近更新',
    desc: '同步 GitHub 最新 Release Notes。',
    link: '查看更新日志',
    fallbackItems: [
      '面向 macOS、Windows 和 Linux 的桌面版发布资产',
      '数据库工作流改进',
      '问题修复与稳定性更新',
      '文档与打包流程更新',
    ],
  },
};

function releaseItems(release: ChangelogRelease, lang: 'en' | 'cn') {
  const separator = lang === 'cn' ? '，' : ': ';

  return release.sections
    .flatMap((section) => section.items)
    .map((item) => (item.desc ? `${item.title}${separator}${item.desc}` : item.title))
    .slice(0, 4);
}

export function buildLandingLatestUpdates(
  lang: 'en' | 'cn',
  release: ChangelogRelease | undefined,
  appVersion: string,
  latestRelease?: LatestReleaseInfo | null,
): LandingLatestUpdates {
  const t = text[lang];
  const items = release ? releaseItems(release, lang) : [];
  const version = latestRelease?.version ? `v${latestRelease.version}` : release?.tag ?? `v${appVersion}`;

  return {
    version,
    title: t.title,
    desc: t.desc,
    link: t.link,
    items: items.length > 0 ? items : t.fallbackItems,
  };
}
