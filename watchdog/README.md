# RH Portfolio cloud watchdog

Cloudflare Worker каждые 15 минут вызывает `workflow_dispatch` для
`.github/workflows/pages.yml`. Расчёт портфеля, сборка и публикация по-прежнему
выполняются в GitHub Actions.

## Первичная настройка

1. Авторизоваться: `pnpm exec wrangler login`.
2. Создать fine-grained GitHub token только для репозитория
   `talkhardtalk/rh-portfolio` с разрешением `Actions: Read and write`.
3. Добавить токен, не сохраняя его в файлах:
   `pnpm exec wrangler secret put GITHUB_ACTIONS_TOKEN --config watchdog/wrangler.jsonc`.
4. Развернуть Worker:
   `pnpm exec wrangler deploy --config watchdog/wrangler.jsonc`.

Секрет хранится в Cloudflare и не попадает в Git, сборочный артефакт или логи.
