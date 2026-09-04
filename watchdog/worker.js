const DISPATCH_URL =
  'https://api.github.com/repos/talkhardtalk/rh-portfolio/actions/workflows/pages.yml/dispatches';

async function dispatchPortfolioUpdate(env) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw new Error('Cloudflare secret GITHUB_ACTIONS_TOKEN is not configured');
  }

  const response = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      'User-Agent': 'rh-portfolio-cloud-watchdog',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(
      `GitHub workflow dispatch failed: ${response.status} ${details}`,
    );
  }

  console.log(
    JSON.stringify({
      event: 'github_workflow_dispatched',
      workflow: 'pages.yml',
      ref: 'main',
      status: response.status,
      at: new Date().toISOString(),
    }),
  );
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchPortfolioUpdate(env));
  },
};
