export type InstallLang = 'en' | 'cn';

export type InstallOption = {
  id: string;
  label: string;
  href: string;
};

type DownloadArtifact = {
  id: string;
  labels: Record<InstallLang, string>;
  suffix: string;
};

const DOWNLOAD_BASE_URL = 'https://github.com/wynn5a/dbx/releases/download';

const downloadArtifacts: DownloadArtifact[] = [
  {
    id: 'macos-arm',
    labels: { en: 'For macOS (Apple Silicon)', cn: '适用于 macOS (Apple Silicon)' },
    suffix: 'aarch64.dmg',
  },
  {
    id: 'macos-intel',
    labels: { en: 'For macOS (Intel)', cn: '适用于 macOS (Intel)' },
    suffix: 'x64.dmg',
  },
  {
    id: 'windows',
    labels: { en: 'For Windows', cn: '适用于 Windows' },
    suffix: 'x64-setup.exe',
  },
  {
    id: 'linux',
    labels: { en: 'For Linux x64', cn: '适用于 Linux x64' },
    suffix: 'amd64.AppImage',
  },
];

export function createInstallOptions(lang: InstallLang, version: string): InstallOption[] {
  return downloadArtifacts.map((artifact) => ({
    id: artifact.id,
    label: artifact.labels[lang],
    href: `${DOWNLOAD_BASE_URL}/v${version}/DBX_${version}_${artifact.suffix}`,
  }));
}
