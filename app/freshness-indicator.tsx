'use client';

import { useEffect, useState } from 'react';

const STALE_AFTER_MS = 30 * 60 * 1000;

export function FreshnessIndicator({ asOf, label }: { asOf: string; label: string }) {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const updateFreshness = () => setIsStale(Date.now() - Date.parse(asOf) > STALE_AFTER_MS);
    updateFreshness();
    const interval = window.setInterval(updateFreshness, 60_000);
    return () => window.clearInterval(interval);
  }, [asOf]);

  return (
    <div
      className={`freshness${isStale ? ' freshness-stale' : ''}`}
      title={isStale ? 'Автоматическое обновление не выполнялось более 30 минут' : undefined}
      aria-live="polite"
    >
      <span className="live-dot" />
      {isStale ? 'Данные устарели · обновлено' : 'Обновлено'} {label} МСК
    </div>
  );
}
