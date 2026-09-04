'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const REFRESH_ENDPOINT =
  'https://rh-portfolio-watchdog.emaksimkin.workers.dev/refresh';

type Phase = 'idle' | 'requesting' | 'waiting' | 'fresh' | 'error';

type RefreshResponse = {
  state?: 'queued' | 'running' | 'recent';
  message?: string;
  retryAfterSeconds?: number;
};

const labels: Record<Phase, string> = {
  idle: 'Обновить данные',
  requesting: 'Запускаю…',
  waiting: 'Обновляется…',
  fresh: 'Данные свежие',
  error: 'Не удалось',
};

function reloadWithFreshCache() {
  const url = new URL(window.location.href);
  url.searchParams.set('refresh', Date.now().toString());
  window.location.replace(url);
}

export function PortfolioRefreshButton() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('Запустить обновление портфеля');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function requestRefresh() {
    setPhase('requesting');
    setMessage('Проверяем состояние обновления');

    try {
      const response = await fetch(REFRESH_ENDPOINT, {
        method: 'POST',
        cache: 'no-store',
      });
      const result = (await response.json()) as RefreshResponse;

      if (!response.ok)
        throw new Error(result.message || 'Не удалось запустить обновление');

      if (result.state === 'recent') {
        setPhase('fresh');
        setMessage(result.message || 'Последние данные уже опубликованы');
        timer.current = window.setTimeout(reloadWithFreshCache, 2500);
        return;
      }

      setPhase('waiting');
      setMessage(result.message || 'GitHub обновляет данные и публикует сайт');
      const waitSeconds = Math.min(
        Math.max(result.retryAfterSeconds ?? 75, 45),
        120,
      );
      timer.current = window.setTimeout(
        reloadWithFreshCache,
        waitSeconds * 1000,
      );
    } catch (error) {
      setPhase('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось запустить обновление',
      );
      timer.current = window.setTimeout(() => {
        setPhase('idle');
        setMessage('Запустить обновление портфеля');
      }, 6000);
    }
  }

  const busy = phase === 'requesting' || phase === 'waiting';

  return (
    <div className="refresh-control" title={message}>
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={busy || phase === 'fresh'}
        onClick={requestRefresh}
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
        {labels[phase]}
      </Button>
      <output className="sr-only" aria-live="polite">
        {message}
      </output>
    </div>
  );
}
