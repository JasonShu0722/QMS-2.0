import { useLayoutEffect, useRef, type ReactNode } from 'react';

function measureChapterTop(element: HTMLDivElement) {
  const top = element.getBoundingClientRect().top + window.scrollY;
  const value = `${top}px`;
  if (element.style.getPropertyValue('--eight-d-chapter-top') !== value) {
    element.style.setProperty('--eight-d-chapter-top', value);
  }
}

export function EightDChapterViewport({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (viewport.current) measureChapterTop(viewport.current);
  });

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => measureChapterTop(element);
    window.addEventListener('resize', measure);
    const workspace = element.closest('[data-eight-d-workspace]');
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    workspace?.querySelectorAll(':scope > header, .ant-tabs-nav').forEach(item => observer?.observe(item));
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return <div ref={viewport} data-eight-d-chapter-viewport>{children}</div>;
}
