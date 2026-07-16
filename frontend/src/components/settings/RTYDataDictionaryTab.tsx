import { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Database, Loader2, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { settingsApi } from '../../api/settingsApi';
import type { DataDictionaryField, RTYDataDictionary, DimensionValues, DimensionSummary, DataSummary } from '../../types';
import FaultListModal from '../FaultListModal';

// 字段类型 -> 徽章配色
const TYPE_BADGE: Record<string, string> = {
  string: 'bg-slate-100 text-slate-600',
  integer: 'bg-blue-100 text-blue-700',
  number: 'bg-blue-100 text-blue-700',
  datetime: 'bg-purple-100 text-purple-700',
  boolean: 'bg-emerald-100 text-emerald-700',
  object: 'bg-amber-100 text-amber-700',
  array: 'bg-amber-100 text-amber-700',
  other: 'bg-slate-100 text-slate-500',
};

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_BADGE[type] ?? TYPE_BADGE.other;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{type}</span>
  );
}

function SummaryCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`flex-1 min-w-[120px] border border-slate-200 rounded-md px-4 py-3 ${onClick ? 'cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all text-left bg-white' : 'bg-slate-50'}`}
    >
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </Comp>
  );
}

function FieldRow({ field }: { field: DataDictionaryField }) {
  const isKey = Boolean(field.rtyField || field.description);
  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isKey ? 'bg-blue-50/40' : ''}`}>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-1.5">
          <code className="text-sm font-medium text-slate-800">{field.name}</code>
          {isKey && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">关键</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 align-top">
        <TypeBadge type={field.type} />
      </td>
      <td className="px-4 py-2.5 align-top">
        {field.rtyField ? (
          <code className="text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{field.rtyField}</code>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 align-top text-sm text-slate-600 max-w-[260px]">
        {field.description || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${Math.round(field.fillRate * 100)}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{Math.round(field.fillRate * 100)}%</span>
        </div>
      </td>
      <td className="px-4 py-2.5 align-top text-sm text-slate-600 tabular-nums">
        {field.distinctCount.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 align-top">
        <code className="text-xs text-slate-500 break-all block max-w-[200px]">
          {field.sampleValue || <span className="text-slate-300">（空）</span>}
        </code>
      </td>
    </tr>
  );
}

// ============== 维度下钻明细弹窗 ==============

function DimensionDrillDown({
  dimension,
  onClose,
}: {
  dimension: DimensionSummary;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DimensionValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const load = (key: string, kw: string, pg: number) => {
    setLoading(true);
    setError(null);
    settingsApi
      .getRTYDimensionValues(key, kw, pg, PAGE_SIZE)
      .then(setData)
      .catch((e) => setError(e?.message || '加载失败'))
      .finally(() => setLoading(false));
  };

  // 打开 / 切换维度 / 翻页时加载
  useEffect(() => {
    load(dimension.key, '', 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension.key]);

  // 搜索关键字防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load(dimension.key, search, 1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = data ? Math.max(1, Math.ceil(data.filteredTotal / PAGE_SIZE)) : 1;
  const maxCount = data?.values[0]?.count ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[82vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              {dimension.label} · 取值明细
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              字段 <code className="text-slate-500">{dimension.key}</code> · 共{' '}
              {data ? data.total.toLocaleString() : '—'} 个取值
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`搜索 ${dimension.label} 取值…`}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
        </div>

        {/* 列表主体 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中…
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              加载失败：{error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {data.values.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-sm">
                  没有匹配的取值
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.values.map((v) => {
                    const pct = maxCount ? Math.round((v.count / maxCount) * 100) : 0;
                    return (
                      <li key={v.value} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                        <div
                          className="flex-1 min-w-0 truncate text-sm text-slate-700 font-mono"
                          title={v.value}
                        >
                          {v.value}
                        </div>
                        <div className="w-28 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-14 text-right text-sm tabular-nums text-slate-600">
                          {v.count.toLocaleString()}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        {/* 分页 */}
        {!loading && data && data.filteredTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-200 text-xs text-slate-500">
            <button
              onClick={() => {
                const np = Math.max(1, page - 1);
                setPage(np);
                load(dimension.key, search, np);
              }}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              上一页
            </button>
            <span>
              第 {page} / {totalPages} 页 · 共 {data.filteredTotal.toLocaleString()} 条
            </span>
            <button
              onClick={() => {
                const np = Math.min(totalPages, page + 1);
                setPage(np);
                load(dimension.key, search, np);
              }}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              下一页
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RTYDataDictionaryTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dict, setDict] = useState<RTYDataDictionary | null>(null);
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [activeDim, setActiveDim] = useState<DimensionSummary | null>(null);
  const [showFaults, setShowFaults] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      settingsApi.getRTYDataDictionary(),
      settingsApi.getDataSummary(),
    ])
      .then(([dictData, summaryData]) => {
        if (mounted) {
          setDict(dictData);
          setSummary(summaryData);
        }
      })
      .catch((err) => {
        if (mounted) setError(err?.message || '加载失败');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const dimensions = dict?.dimensions ?? [];

  return (
    <div className="space-y-5 h-full flex flex-col">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-500" />
          RTY 数据字典 · 机器信息表
        </h3>
        <p className="text-sm text-slate-500">
          展示底层数据源 <code className="text-slate-600">machine_info</code> 集合的字段结构与概要统计，用于理解 RTY 看板的数据来源。
        </p>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在分析机器信息表...
        </div>
      )}

      {error && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4" />
            加载失败：{error}
          </div>
        </div>
      )}

      {dict && !loading && (
        <>
          <div className="flex flex-wrap gap-3">
            <SummaryCard label="总记录数" value={dict.totalCount.toLocaleString()} sub={`集合 ${dict.collection}`} />
            {summary && (
              <>
                <SummaryCard label="故障数量" value={summary.totalFaults.toLocaleString()} sub="fault_info 集合" onClick={() => setShowFaults(true)} />
                <SummaryCard label="故障物料数量" value={summary.totalFaultMaterials.toLocaleString()} sub="有故障的物料种类" />
              </>
            )}
          </div>

          {/* 业务维度看板 */}
          {dimensions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700">业务维度看板</h4>
                <span className="text-[11px] text-slate-400">点击卡片查看该维度的全部取值明细</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {dimensions.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setActiveDim(d)}
                    className="group text-left bg-white border border-slate-200 hover:border-blue-400 hover:shadow-sm rounded-md px-4 py-3 transition-all"
                  >
                    <div className="text-xs text-slate-500">{d.label}</div>
                    <div className="text-2xl font-bold text-slate-800 mt-0.5 tabular-nums">
                      {d.total.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 truncate" title={d.topValues[0]?.value}>
                      Top：{d.topValues[0]?.value ?? '—'} · {d.topValues[0]?.count.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                      查看详情 →
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-slate-400 mb-1">
            关键字段（带「关键」标记）的去重数为<strong>全集统计</strong>，其余字段去重数为采样估计。
          </div>

          <div className="flex-1 border border-slate-200 rounded-md overflow-hidden overflow-y-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2.5">字段名</th>
                  <th className="px-4 py-2.5">类型</th>
                  <th className="px-4 py-2.5">对应 RTY 字段</th>
                  <th className="px-4 py-2.5">业务含义</th>
                  <th className="px-4 py-2.5">非空率</th>
                  <th className="px-4 py-2.5">去重数</th>
                  <th className="px-4 py-2.5">样例值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {dict.fields.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-50" />
                      当前机器信息表暂无数据
                    </td>
                  </tr>
                ) : (
                  dict.fields.map((f) => <FieldRow key={f.name} field={f} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeDim && (
        <DimensionDrillDown dimension={activeDim} onClose={() => setActiveDim(null)} />
      )}
      {showFaults && <FaultListModal onClose={() => setShowFaults(false)} />}
    </div>
  );
}
