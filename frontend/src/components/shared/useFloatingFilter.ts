import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export function useFloatingFilter(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, width: number): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!anchor.current || !panel.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const panelWidth = Math.min(Math.max(width, rect.width), window.innerWidth - 16);
      const panelHeight = Math.min(panel.current.offsetHeight, window.innerHeight - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const top = below >= panelHeight || below >= rect.top
        ? Math.min(rect.bottom + 4, window.innerHeight - panelHeight - 8)
        : Math.max(8, rect.top - panelHeight - 4);
      setPosition({ position: 'fixed', left: Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)), top: Math.max(8, top), width: panelWidth, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [open, anchor, panel, width]);

  return position;
}
