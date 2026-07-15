import { requestJson } from '@/lib/httpJson';
import { browserCacheBuster, createUncachedUrl, releaseMetadataRequestInit } from '@/lib/releaseMetadataRequest';

export type LatestReleaseInfo = {
  version: string;
  notes?: string;
  pub_date?: string;
};

type GitHubLatestRelease = {
  tag_name: string;
  body: string | null;
  published_at: string | null;
};

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/wynn5a/dbx/releases/latest';

function normalizeVersion(version: string) {
  return version.replace(/^v/, '');
}

export async function fetchLatestReleaseInfo(): Promise<LatestReleaseInfo | null> {
  return fetchGitHubLatestReleaseInfo();
}

export async function fetchGitHubLatestReleaseInfo(): Promise<LatestReleaseInfo | null> {
  try {
    const release = await requestJson<GitHubLatestRelease>(
      createUncachedUrl(GITHUB_LATEST_RELEASE_URL, browserCacheBuster()),
      releaseMetadataRequestInit({ headers: { Accept: 'application/vnd.github+json' } }),
    );

    return {
      version: normalizeVersion(release.tag_name),
      notes: release.body || undefined,
      pub_date: release.published_at || undefined,
    };
  } catch {
    return null;
  }
}
