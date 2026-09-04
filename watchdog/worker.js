const GITHUB_API =
  'https://api.github.com/repos/talkhardtalk/rh-portfolio/actions/workflows/pages.yml';
const DISPATCH_URL =
  'https://api.github.com/repos/talkhardtalk/rh-portfolio/actions/workflows/pages.yml/dispatches';
const RUNS_URL = `${GITHUB_API}/runs?per_page=5`;
const ALLOWED_ORIGIN = 'https://talkhardtalk.github.io';
const COOLDOWN_MS = 5 * 60 * 1000;
const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'waiting',
  'requested',
  'pending',
]);

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
    'User-Agent': 'rh-portfolio-cloud-watchdog',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: corsHeaders() });
}

function assertSecret(env) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw new Error('Cloudflare secret GITHUB_ACTIONS_TOKEN is not configured');
  }
}

async function getLatestWorkflowRun(env) {
  assertSecret(env);
  const response = await fetch(RUNS_URL, { headers: githubHeaders(env) });

  if (!response.ok) {
    throw new Error(`GitHub workflow status failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.workflow_runs)
    ? (data.workflow_runs[0] ?? null)
    : null;
}

async function dispatchPortfolioUpdate(env) {
  assertSecret(env);

  const response = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: githubHeaders(env),
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

async function requestPortfolioUpdate(env, source) {
  const latest = await getLatestWorkflowRun(env);

  if (latest && ACTIVE_STATUSES.has(latest.status)) {
    return {
      state: 'running',
      message: 'Обновление уже выполняется',
      retryAfterSeconds: 75,
    };
  }

  if (latest?.created_at) {
    const ageMs = Date.now() - Date.parse(latest.created_at);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < COOLDOWN_MS) {
      return {
        state: 'recent',
        message: 'Данные обновлялись менее пяти минут назад',
        retryAfterSeconds: Math.ceil((COOLDOWN_MS - ageMs) / 1000),
      };
    }
  }

  await dispatchPortfolioUpdate(env);
  console.log(JSON.stringify({ event: 'portfolio_refresh_requested', source }));
  return {
    state: 'queued',
    message: 'Обновление запущено, страница перезагрузится автоматически',
    retryAfterSeconds: 75,
  };
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(requestPortfolioUpdate(env, 'cron'));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname === '/refresh') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST' || url.pathname !== '/refresh') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('Origin') !== ALLOWED_ORIGIN) {
      return jsonResponse(
        { message: 'Запрос разрешён только с RH Portfolio' },
        403,
      );
    }

    try {
      return jsonResponse(await requestPortfolioUpdate(env, 'button'), 202);
    } catch (error) {
      console.error(error);
      return jsonResponse({ message: 'Не удалось запустить обновление' }, 502);
    }
  },
};
