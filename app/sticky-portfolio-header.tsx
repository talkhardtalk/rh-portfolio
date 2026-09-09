'use client';

import { useEffect } from 'react';

const SITE_HEADER_HEIGHT = 74;

export function StickyPortfolioHeader() {
  useEffect(() => {
    const table = document.querySelector<HTMLTableElement>('.portfolio-table');
    const originalHeader = table?.tHead;
    const scrollContainer = table?.closest<HTMLElement>(
      '[data-slot="table-container"]',
    );

    if (!table || !originalHeader || !scrollContainer) return;

    const layer = document.createElement('div');
    layer.className = 'floating-table-header';
    layer.setAttribute('aria-hidden', 'true');

    const clonedTable = table.cloneNode(false) as HTMLTableElement;
    clonedTable.removeAttribute('data-slot');
    clonedTable.className = 'floating-portfolio-table';
    const clonedHeader = originalHeader.cloneNode(true) as HTMLTableSectionElement;
    clonedTable.appendChild(clonedHeader);
    layer.appendChild(clonedTable);
    document.body.appendChild(layer);

    const originalCells = Array.from(originalHeader.querySelectorAll('th'));
    const clonedCells = Array.from(clonedHeader.querySelectorAll('th'));
    let frame: number | null = null;

    const update = () => {
      frame = null;
      const tableRect = table.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const headerHeight = originalHeader.getBoundingClientRect().height;
      const left = Math.max(0, containerRect.left);
      const right = Math.min(window.innerWidth, containerRect.right);
      const isVisible =
        tableRect.top < SITE_HEADER_HEIGHT &&
        tableRect.bottom > SITE_HEADER_HEIGHT + headerHeight &&
        right > left;

      layer.classList.toggle('is-visible', isVisible);
      layer.style.left = `${left}px`;
      layer.style.width = `${Math.max(0, right - left)}px`;
      clonedTable.style.width = `${table.getBoundingClientRect().width}px`;
      clonedTable.style.transform = `translateX(${-scrollContainer.scrollLeft}px)`;

      originalCells.forEach((cell, index) => {
        const width = cell.getBoundingClientRect().width;
        const clonedCell = clonedCells[index];
        if (!clonedCell) return;
        clonedCell.style.width = `${width}px`;
        clonedCell.style.minWidth = `${width}px`;
        clonedCell.style.maxWidth = `${width}px`;
      });
    };

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(table);
    resizeObserver.observe(scrollContainer);
    update();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      scrollContainer.removeEventListener('scroll', scheduleUpdate);
      resizeObserver.disconnect();
      layer.remove();
    };
  }, []);

  return null;
}
