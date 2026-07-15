import { LandingNav } from '@/components/landing/LandingNav';
import { buildMetadata } from '@/lib/metadata';
import type { Metadata } from 'next';

const channels = [
  {
    id: 'qq',
    color: '#EB1923',
    href: 'https://qm.qq.com/cgi-bin/qm/qr?k=&group_code=1087880322',
    icon: <img src="/icons/community/qq.png" alt="QQ" width={24} height={24} />,
  },
  {
    id: 'wechat',
    color: '#07C160',
    href: 'https://docs.qq.com/doc/DVVhMY0h1ekJqc0tz',
    icon: (
      <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66l-.7 2.1 2.46-1.23c.87.27 1.8.42 2.78.42.24 0 .48-.01.71-.03A5.93 5.93 0 0110 14c0-3.31 3.13-6 7-6 .34 0 .67.03 1 .07C17.27 5.56 13.72 4 9.5 4zm-3 4.5a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2zM22 14c0-2.76-2.69-5-6-5s-6 2.24-6 5 2.69 5 6 5c.73 0 1.43-.11 2.09-.3l1.72.86-.49-1.46C20.94 17.07 22 15.64 22 14zm-7.5-.5a.75.75 0 110-1.5.75.75 0 010 1.5zm4 0a.75.75 0 110-1.5.75.75 0 010 1.5z" />
      </svg>
    ),
  },
  {
    id: 'discord',
    color: '#5865F2',
    href: 'https://discord.gg/W7NyVDRt6a',
    icon: (
      <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
];

const i18n = {
  en: {
    title: 'Community',
    desc: 'Join the DBX community — ask questions, share feedback, and connect with other users.',
    discord: { name: 'Discord', desc: 'Real-time chat, Q&A, and feature discussions.' },
    qq: { name: 'QQ Group', desc: 'Group number: 1087880322' },
    wechat: { name: 'WeChat Group', desc: 'Join via Tencent Docs invite link.' },
  },
  cn: {
    title: '交流群',
    desc: '加入 DBX 社区 — 提问、反馈、与其他用户交流。',
    discord: { name: 'Discord', desc: '实时聊天、问答和功能讨论。' },
    qq: { name: 'QQ 群', desc: '群号：1087880322' },
    wechat: { name: '微信群', desc: '通过腾讯文档链接加入。' },
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const l = lang === 'cn' ? 'cn' : 'en';
  const t = i18n[l];

  return buildMetadata({
    title: t.title,
    description: t.desc,
    path: `/${l}/community`,
    lang: l,
  });
}

export default async function CommunityPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const l = lang === 'cn' ? 'cn' : 'en';
  const t = i18n[l];

  return (
    <div className="min-h-screen bg-[#0b1120] text-landing-ink">
      <LandingNav lang={l} active="community" />

      <div className="max-w-[860px] mx-auto px-6 pt-32 pb-4">
        <h1 className="text-4xl font-[820] tracking-tight">{t.title}</h1>
        <p className="mt-3 text-landing-muted text-lg">{t.desc}</p>
      </div>

      <div className="max-w-[860px] mx-auto px-6 pb-24">
        <div className="grid gap-4 mt-8">
          {channels.map((ch) => {
            const meta = t[ch.id as keyof typeof t] as { name: string; desc: string };
            return (
              <a
                key={ch.id}
                href={ch.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-5 rounded-xl border border-landing-line bg-landing-panel px-6 py-5 transition-colors hover:border-[rgba(155,176,205,0.32)]"
              >
                <span
                  className="grid place-items-center w-11 h-11 rounded-lg shrink-0"
                  style={{ backgroundColor: `${ch.color}18`, color: ch.color }}
                >
                  {ch.icon}
                </span>
                <span className="grid gap-0.5 min-w-0">
                  <strong className="text-[15px] font-[700] leading-snug">{meta.name}</strong>
                  <span className="text-landing-muted text-[13px] leading-relaxed">{meta.desc}</span>
                </span>
                <svg
                  className="ml-auto shrink-0 text-landing-muted opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
