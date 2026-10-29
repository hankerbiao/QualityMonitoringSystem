import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/authApi';
import { API_BASE_URL } from '../../constants';

export interface IncomingPhoto { path: string; accessToken: string }

export function IncomingMaterialImage({ photo, alt, large = false }: { photo: IncomingPhoto; alt: string; large?: boolean }) {
  const [visible, setVisible] = useState(large);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const target = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (large || !target.current || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [large, photo.path, photo.accessToken]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setUrl(null); setFailed(false);
    const params = new URLSearchParams({ path: photo.path, accessToken: photo.accessToken });
    void apiFetch(`${API_BASE_URL}/incoming-materials/image?${params}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('图片加载失败'); return response.blob(); })
      .then(blob => {
        const next = URL.createObjectURL(blob);
        if (!active) { URL.revokeObjectURL(next); return; }
        objectUrl = next; setUrl(next);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.path, photo.accessToken, visible]);
  if (failed) return <span className="flex h-14 w-20 items-center justify-center rounded border border-rose-100 bg-rose-50 px-1 text-center text-xs text-rose-700" role="img" aria-label={`${alt}加载失败`}>加载失败<br />请刷新</span>;
  if (!url) return <span ref={target} className="flex h-14 w-20 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs text-slate-400" role="img" aria-label={`${alt}加载中`}>加载中</span>;
  return <img src={url} alt={alt} onError={() => setFailed(true)} className={large ? 'max-h-[75vh] max-w-full object-contain' : 'h-14 w-20 rounded border border-slate-200 object-cover'} />;
}
