import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'rh-portfolio';
const assetPrefix = isGitHubPages ? `/${repository}` : '';

const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix,
  images: { unoptimized: true },
};

export default nextConfig;
