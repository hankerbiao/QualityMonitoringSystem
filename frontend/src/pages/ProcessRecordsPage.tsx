import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { apiFetch } from '../api/authApi';
import { processRecordsApi } from '../api/processRecordsApi';
import type {
  ProcessRecordItem,
  ProcessRecordFilterOptions,
  ProcessRecordRealtimeData,
  ProcessRecordSource,
} from '../types';

const PAGE_SIZE = 30;

const SOURCE_OPTIONS: { key: ProcessRecordSource; label: string }[] = [
  { key: 'all', label: '综合最新' },
  { key: 'system1', label: '工序扫码拍照' },
  { key: 'system2', label: '装配关键工位' },
];

const EMPTY_FILTER_OPTIONS: ProcessRecordFilterOptions = {
  bases: [],
  system1Processes: [],
};

function display(value: string): string {
  return value || '-';
}

function formatTime(value: string): string {
  if (!value) return '-';
  const parsed = new Date(value.includes(' ') ? value.replace(' ', 'T') : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false });
}

function formatRawValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function AuthenticatedImage({
  source,
  path,
  alt,
  className,
  loading,
}: {
  source: 'system1' | 'system2';
  path: string;
  alt: string;
  className: string;
  loading?: 'eager' | 'lazy';
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [visibleRequestKey, setVisibleRequestKey] = useState<string | null>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const requestKey = `${source}:${path}`;
  const shouldLoad = loading === 'eager' || visibleRequestKey === requestKey;

  useEffect(() => {
    if (loading === 'eager') {
      setVisibleRequestKey(requestKey);
      return;
    }

    const target = targetRef.current;
    if (!target || !('IntersectionObserver' in window)) {
      setVisibleRequestKey(requestKey);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleRequestKey(requestKey);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loading, requestKey]);

  useEffect(() => {
    if (!shouldLoad) {
      setImageUrl(null);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await apiFetch(processRecordsApi.imageUrl(source, path), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`图片请求失败 (${response.status})`);
        const blob = await response.blob();
        const nextObjectUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setImageUrl(nextObjectUrl);
      } catch {
        if (active) setImageUrl(null);
      }
    };

    setImageUrl(null);
    void load();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, shouldLoad, source]);

  if (!imageUrl || !shouldLoad) {
    return <span ref={targetRef} className={`${className} flex items-center justify-center`} aria-label={`${alt}加载中`}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></span>;
  }

  return <img src={imageUrl} alt={alt} className={className} loading={loading} />;
}

export default function ProcessRecordsPage() {
  const navigate = useNavigate();
  const [source, setSource] = useState<ProcessRecordSource>('all');
  const [snInput, setSnInput] = useState('');
  const [sn, setSn] = useState('');
  const [baseInput, setBaseInput] = useState('');
  const [base, setBase] = useState('');
  const [stationInput, setStationInput] = useState('');
  const [station, setStation] = useState('');
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ProcessRecordRealtimeData | null>(null);
  const [detail, setDetail] = useState<ProcessRecordItem | null>(null);
  const [preview, setPreview] = useState<{ source: 'system1' | 'system2'; path: string } | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await processRecordsApi.getRealtime({
        source,
        sn,
        base,
        station,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(result);
    } catch (fetchError) {
      setData(null);
      setError(fetchError instanceof Error ? fetchError.message : '实时数据查询失败');
    } finally {
      setLoading(false);
    }
  }, [base, page, sn, source, station, refreshToken]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    void processRecordsApi.getFilterOptions().then(setFilterOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => setRefreshToken((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)),
    [data?.total],
  );

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextSn = snInput.trim();
    const nextBase = baseInput.trim();
    const nextStation = stationInput.trim();
    setPage(1);
    if (nextSn === sn && nextBase === base && nextStation === station) {
      setRefreshToken((value) => value + 1);
      return;
    }
    setSn(nextSn);
    setBase(nextBase);
    setStation(nextStation);
  };

  const changeSource = (nextSource: ProcessRecordSource) => {
    const selectedBase = filterOptions.bases.find((option) => option.name === baseInput);
    if (nextSource !== 'all' && selectedBase && !selectedBase.sources.includes(nextSource)) {
      setBaseInput('');
      setBase('');
    }
    setSource(nextSource);
    setPage(1);
    setDetail(null);
  };

  const clearFilters = () => {
    const hadAppliedFilters = Boolean(sn || base || station);
    setSnInput('');
    setSn('');
    setBaseInput('');
    setBase('');
    setStationInput('');
    setStation('');
    setPage(1);
    if (!hadAppliedFilters) setRefreshToken((value) => value + 1);
  };

  const downloadRowPhotos = async (row: ProcessRecordItem) => {
    if (!row.photos.length || downloadingKey) return;
    setDownloadingKey(row.key);
    try {
      for (let index = 0; index < row.photos.length; index += 1) {
        const photo = row.photos[index];
        const response = await apiFetch(processRecordsApi.imageUrl(row.source, photo.path));
        if (!response.ok) throw new Error(`图片请求失败 (${response.status})`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        anchor.download = `${row.recordId || row.sn || 'record'}_${index + 1}.${extension}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }
    } catch (downloadError) {
      console.error('Failed to download process record photos', downloadError);
      setError('图片下载失败，请重试');
    } finally {
      setDownloadingKey(null);
    }
  };

  const availableBases = filterOptions.bases.filter(
    (option) => source === 'all' || option.sources.includes(source),
  );
  const stationPlaceholder = source === 'system1'
    ? '工序，例如 TJM-OP320'
    : source === 'system2'
      ? '工位，例如 封箱检查'
      : '工位/工序名称';
  const failedSources = Object.entries(data?.sources ?? {}).filter(
    ([, result]) => result && !result.online,
  );
  const queryFailed = Boolean(error || failedSources.length);

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden text-slate-800">
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            title="返回首页"
            onClick={() => navigate('/')}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-sm"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 bg-cyan-50 border border-cyan-100 rounded flex items-center justify-center">
            <Camera className="w-4 h-4 text-cyan-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">关键工位影像追溯</h1>
            <p className="text-xs text-slate-400 truncate">实时查询工序扫码拍照与装配关键工位记录</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-2 text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="accent-cyan-700"
            />
            30 秒自动刷新
          </label>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-[1900px] w-full mx-auto p-4 flex flex-col gap-3">
        <section className="bg-white border border-slate-200 rounded-md px-3 py-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex border border-slate-200 rounded-sm overflow-hidden shrink-0">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => changeSource(option.key)}
                className={`px-3 py-2 text-xs font-medium border-r last:border-r-0 border-slate-200 ${source === option.key ? 'bg-cyan-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <form onSubmit={runSearch} className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
            <select
              aria-label="基地"
              value={baseInput}
              onChange={(event) => setBaseInput(event.target.value)}
              className="h-9 w-32 px-2 border border-slate-300 bg-white rounded-sm text-sm outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
            >
              <option value="">全部基地</option>
              {availableBases.map((option) => (
                <option key={option.name} value={option.name}>{option.name}</option>
              ))}
            </select>
            <input
              aria-label="工位或工序"
              list={source === 'system2' ? undefined : 'system1-process-options'}
              value={stationInput}
              onChange={(event) => setStationInput(event.target.value)}
              placeholder={stationPlaceholder}
              className="h-9 w-52 px-3 border border-slate-300 rounded-sm text-sm outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
            />
            <datalist id="system1-process-options">
              {filterOptions.system1Processes.map((process) => (
                <option key={process} value={process} />
              ))}
            </datalist>
            <div className="relative flex-1 min-w-[240px] max-w-lg">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={snInput}
                onChange={(event) => setSnInput(event.target.value)}
                placeholder="输入 SN/条码，例如 6102286104479338"
                className="w-full h-9 pl-9 pr-3 border border-slate-300 rounded-sm text-sm outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
              />
            </div>
            <button className="h-9 px-4 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-sm">
              查询
            </button>
            {(snInput || baseInput || stationInput || sn || base || station) && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 px-3 text-sm text-slate-500 hover:bg-slate-100 rounded-sm"
              >
                清除
              </button>
            )}
          </form>

          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {data && Object.entries(data.sources).map(([key, result]) => result && (
              <span key={key} title={result.error || ''} className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${result.online ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {key === 'system1' ? '扫码拍照' : '装配工位'}
                <span className="text-slate-400">{result.online ? result.total.toLocaleString() : '异常'}</span>
              </span>
            ))}
          </div>
        </section>

        {source === 'all' && (
          <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
            <Clock3 className="w-3.5 h-3.5" />
            综合视图实时合并两个系统各自最新 {PAGE_SIZE} 条；精确翻页请切换到具体数据源。
          </div>
        )}

        {queryFailed && (
          <div role="alert" className="shrink-0 flex flex-wrap items-start gap-3 border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm rounded-sm">
            <div className="min-w-0 flex-1 space-y-1 break-words">
              {error && <p>{error}</p>}
              {failedSources.map(([key, result]) => (
                <p key={key}>
                  <span className="font-medium">{key === 'system1' ? '工序扫码拍照' : '装配关键工位'}：</span>
                  {result?.error || '数据源查询失败'}
                </p>
              ))}
              {Boolean(data?.rows.length) && <p className="text-xs">当前仅显示查询成功的数据源记录。</p>}
            </div>
            <button
              type="button"
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={loading}
              className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-sm border border-red-300 px-2.5 text-xs font-medium hover:bg-red-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              重新查询
            </button>
          </div>
        )}

        <section className="flex-1 min-h-0 bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[1300px] text-left text-xs whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">数据来源</th>
                  <th className="px-3 py-2.5 font-semibold">记录 ID</th>
                  <th className="px-3 py-2.5 font-semibold">SN / 条码</th>
                  <th className="px-3 py-2.5 font-semibold">基地</th>
                  <th className="px-3 py-2.5 font-semibold">工位 / 工序</th>
                  <th className="px-3 py-2.5 font-semibold">提交时间</th>
                  <th className="px-3 py-2.5 font-semibold">现场图片</th>
                  <th className="px-3 py-2.5 font-semibold">文件</th>
                  <th className="px-3 py-2.5 font-semibold">订单</th>
                  <th className="px-3 py-2.5 font-semibold">备注</th>
                  <th className="px-3 py-2.5 font-semibold text-center">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr><td colSpan={11} className="h-48 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />实时查询中...</td></tr>
                ) : !data?.rows.length ? (
                  <tr><td colSpan={11} className="h-48 text-center text-slate-400">{queryFailed ? '数据源查询失败，暂时无法获取记录' : '没有查询到记录'}</td></tr>
                ) : data.rows.map((row) => (
                  <tr key={row.key} onClick={() => setDetail(row)} className="hover:bg-cyan-50/40 cursor-pointer">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-2 py-1 rounded-sm font-medium ${row.source === 'system1' ? 'bg-cyan-50 text-cyan-700' : 'bg-emerald-50 text-emerald-700'}`}>{row.sourceName}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{display(row.recordId)}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-800">{display(row.sn)}</td>
                    <td className="px-3 py-2.5">{display(row.base)}</td>
                    <td className="px-3 py-2.5 max-w-[220px] truncate" title={row.station}>{display(row.station)}</td>
                    <td className="px-3 py-2.5">{formatTime(row.submittedAt)}</td>
                    <td className="px-3 py-2">
                      {row.photos.length ? (
                        <div className="flex items-center gap-1.5">
                          {row.photos.slice(0, 3).map((photo, index) => (
                            <button
                              key={`${photo.path}-${index}`}
                              title="查看原图"
                              onClick={(event) => { event.stopPropagation(); setPreview({ source: row.source, path: photo.path }); }}
                              className="w-10 h-10 border border-slate-200 rounded-sm overflow-hidden bg-slate-100"
                            >
                              <AuthenticatedImage source={row.source} path={photo.path} alt="工位现场" className="w-full h-full object-cover" loading="lazy" />
                            </button>
                          ))}
                          <span className="text-slate-400">{row.photos.length} 张</span>
                          <button
                            type="button"
                            title="下载此行全部图片"
                            aria-label="下载此行全部图片"
                            disabled={downloadingKey !== null}
                            onClick={(event) => { event.stopPropagation(); void downloadRowPhotos(row); }}
                            className="inline-flex size-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-wait disabled:opacity-50"
                          >
                            <Download className={`w-3.5 h-3.5 ${downloadingKey === row.key ? 'animate-pulse' : ''}`} />
                          </button>
                        </div>
                      ) : <span className="text-slate-300">无</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={row.files}>{display(row.files)}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={row.order}>{display(row.order)}</td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" title={row.remarks}>{display(row.remarks)}</td>
                    <td className="px-3 py-2.5 text-center"><ExternalLink className="w-4 h-4 text-slate-400 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="h-11 shrink-0 border-t border-slate-200 px-3 flex items-center justify-between text-xs text-slate-500 bg-slate-50">
            <span>
              当前展示 {data?.rows.length ?? 0} 条
              {data && ` · 上游共 ${data.total.toLocaleString()} 条`}
              {data?.queriedAt && ` · 查询于 ${formatTime(data.queriedAt)}`}
            </span>
            {source !== 'all' && (
              <div className="flex items-center gap-2">
                <button title="上一页" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="p-1 border border-slate-200 rounded-sm disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <span>第 {page} / {pageCount} 页</span>
                <button title="下一页" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)} className="p-1 border border-slate-200 rounded-sm disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </footer>
        </section>
      </main>

      {detail && (
        <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={() => setDetail(null)}>
          <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white border-l border-slate-200 shadow-xl flex flex-col" onClick={(event) => event.stopPropagation()}>
            <header className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <div><h2 className="text-sm font-semibold">记录详情</h2><p className="text-xs text-slate-400 mt-0.5">{detail.sourceName} · {detail.recordId}</p></div>
              <button title="关闭" onClick={() => setDetail(null)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-sm"><X className="w-4 h-4" /></button>
            </header>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {detail.photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {detail.photos.map((photo, index) => (
                    <button key={`${photo.path}-${index}`} onClick={() => setPreview({ source: detail.source, path: photo.path })} className="aspect-square border border-slate-200 rounded-sm overflow-hidden bg-slate-100">
                      <AuthenticatedImage source={detail.source} path={photo.path} alt={`现场图片 ${index + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              <div className="border border-slate-200 rounded-sm divide-y divide-slate-100">
                {Object.entries(detail.raw).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[140px_1fr] text-xs">
                    <div className="px-3 py-2 bg-slate-50 text-slate-500 font-medium break-all">{key}</div>
                    <pre className="px-3 py-2 text-slate-700 whitespace-pre-wrap break-all font-sans">{formatRawValue(value)}</pre>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <button title="关闭图片" onClick={() => setPreview(null)} className="absolute top-4 right-4 p-2 text-white/80 hover:text-white"><X className="w-6 h-6" /></button>
          <AuthenticatedImage source={preview.source} path={preview.path} alt="关键工位原图" className="max-w-full max-h-full object-contain" loading="eager" />
        </div>
      )}
    </div>
  );
}
