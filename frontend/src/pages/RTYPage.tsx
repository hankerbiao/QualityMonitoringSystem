import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ListFilter, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import type { RTYData, RTYFilterParams } from '../types';
import { useSettings } from '../context/SettingsContext';
import DefectModal from '../components/DefectModal';
import AlertConfigModal from '../components/AlertConfigModal';
import { ExcludedOrdersModal, FilterPanel } from '../components/rty';
import { buildTemplateWorkbook } from '../components/rty/templateExport';
import { SortIcon } from '../components/shared/SortIcon';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';

const DEFAULT_FILTERS: RTYFilterParams = {
  dateRange: { from: undefined, to: undefined },
  productModel: 'all',
  customer: '',
  base: 'all',
  salesOrder: '',
  productionOrder: '',
  serialNumber: '',
  orderScope: 'normal',
};

type SortField = 'time' | 'defectCount' | 'inputCount' | 'rtyRate';

export default function RTYPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 支持从告警报表链接 /rty?base=...&productModel=... 深链预填筛选条件
  const initialFilters = useMemo<RTYFilterParams>(() => {
    const df: RTYFilterParams = { ...DEFAULT_FILTERS };
    if (searchParams.get('base')) df.base = searchParams.get('base')!;
    if (searchParams.get('productModel')) df.productModel = searchParams.get('productModel')!;
    if (searchParams.get('customer')) df.customer = searchParams.get('customer')!;
    if (searchParams.get('salesOrder')) df.salesOrder = searchParams.get('salesOrder')!;
    if (searchParams.get('productionOrder')) df.productionOrder = searchParams.get('productionOrder')!;
    if (searchParams.get('serialNumber')) df.serialNumber = searchParams.get('serialNumber')!;
    if (searchParams.get('orderScope') === 'l6') df.orderScope = 'l6';
    const from = searchParams.get('dateFrom');
    const to = searchParams.get('dateTo');
    if (from) df.dateRange = { ...df.dateRange, from: new Date(from) };
    if (to) df.dateRange = { ...df.dateRange, to: new Date(to) };
    return df;
  }, [searchParams]);

  const [filters, setFilters] = useState<RTYFilterParams>(initialFilters);
  const [cycleExportContainer, setCycleExportContainer] = useState<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportInProgress = useRef(false);
  const [data, setData] = useState<RTYData[]>([]);
  const [exportFilters, setExportFilters] = useState<RTYFilterParams | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [defectModalData, setDefectModalData] = useState<{ filters: RTYFilterParams; label: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSearched, setDetailSearched] = useState(false);
  const [excludedOrdersOpen, setExcludedOrdersOpen] = useState(false);

  // 订单列表弹窗状态
  const [orderListOpen, setOrderListOpen] = useState(false);
  const [orderListData, setOrderListData] = useState<{ title: string; orders: string[]; filterKey: 'salesOrder' | 'productionOrder' }>({ title: '', orders: [], filterKey: 'salesOrder' });

  const { settings: { modelTargets } } = useSettings();

  // 获取数据
  const fetchData = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const result = await rtyApi.getRTYData(filters, targetPage, pageSize);
      setData(result.items);
      setExportFilters({ ...filters, dateRange: { ...filters.dateRange } });
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    const handler = () => {
      if (detailOpen && detailSearched) fetchData();
    };
    window.addEventListener('settings-saved', handler);
    return () => window.removeEventListener('settings-saved', handler);
  }, [detailOpen, detailSearched, fetchData]);

  const hasDetailQueryConditions = (params: RTYFilterParams) => Boolean(
    params.dateRange.from
    || params.dateRange.to
    || params.productModel !== 'all'
    || params.customer
    || params.base !== 'all'
    || params.salesOrder
    || params.productionOrder
    || params.serialNumber,
  );

  const openDetails = () => {
    setData([]);
    setExportFilters(null);
    setTotal(0);
    setPage(1);
    setDetailSearched(false);
    setDetailOpen(true);
  };

  const searchDetails = () => {
    if (!hasDetailQueryConditions(filters)) {
      setData([]);
      setTotal(0);
      setPage(1);
      setDetailSearched(false);
      return;
    }
    setDetailSearched(true);
    fetchData(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleExport = async () => {
    if (exportInProgress.current || loading || !sortedData.length || !exportFilters) return;
    exportInProgress.current = true;
    setExporting(true);
    setExportError('');
    try {
      const exportData = await rtyApi.getTemplateExport(exportFilters);
      const workbook = buildTemplateWorkbook(exportData);
      const date = new Date();
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      XLSX.writeFile(workbook, `RTY数据导出_${stamp}.xlsx`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'RTY 导出失败，请重试');
    } finally {
      exportInProgress.current = false;
      setExporting(false);
    }
  };

  const sortedData = useMemo(() => {
    if (!sortField) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDirection]);

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-10">
        <div className="flex min-w-0 items-center gap-3">
          <button 
            onClick={() => navigate('/')}
            className="shrink-0 p-1.5 hover:bg-slate-100 rounded-sm transition-colors text-slate-500"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="truncate text-base font-semibold text-slate-800 sm:text-lg"><span className="hidden lg:inline">QualiBoard 品质看板 — </span>RTY 整机综合直通率</h1>
          <span className="hidden shrink-0 rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 xl:inline-flex">2026 · 销售订单 WMENG 入库数量</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <DashboardSwitcher />
          <div ref={setCycleExportContainer} className="flex shrink-0 items-center" />
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-[1800px] mx-auto w-full overflow-auto">
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-600">
            RTY 统计已排除订单状态 DLID、RELEASED 及订单类型 C001；L6 订单单独统计，不与普通订单合并。
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setExcludedOrdersOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
            >
              <ListFilter className="h-3.5 w-3.5" />
              已过滤订单
            </button>
            <div className="inline-flex overflow-hidden rounded-sm border border-slate-300 text-xs font-medium">
              <button
                type="button"
                onClick={() => setFilters(current => ({ ...current, orderScope: 'normal' }))}
                className={`px-3 py-1.5 transition-colors ${filters.orderScope === 'normal' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                普通订单
              </button>
              <button
                type="button"
                onClick={() => setFilters(current => ({ ...current, orderScope: 'l6' }))}
                className={`border-l border-slate-300 px-3 py-1.5 transition-colors ${filters.orderScope === 'l6' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                L6 订单
              </button>
            </div>
          </div>
        </section>

        <AlertConfigModal
          embedded
          modelTargets={modelTargets}
          onDetailOpen={openDetails}
          orderScope={filters.orderScope}
          exportContainer={cycleExportContainer}
        />

        {detailOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex h-[90vh] w-full max-w-[1800px] flex-col overflow-hidden rounded-md border border-slate-200 bg-slate-50 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
                <h2 className="text-base font-semibold text-slate-800">表单数据</h2>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100"
                  title="关闭详情"
                  aria-label="关闭详情"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                <FilterPanel
                  initialFilters={filters}
                  onFiltersChange={setFilters}
                  onSearch={searchDetails}
                  onAlertModalOpen={() => setDetailOpen(false)}
                  onExportConfirm={handleExport}
                  exporting={exporting}
                  exportDisabled={loading || data.length === 0}
                />
                {exportError && <p role="alert" className="mb-3 text-sm text-red-700">{exportError}</p>}

                {/* 数据表格 */}
                <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                  <div className="h-full overflow-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs">
                <tr>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('time')}
                  >
                    <span className="inline-flex items-center gap-1">
                      时间
                      <SortIcon field="time" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">生产机型</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">客户 ID</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">基地</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">销售订单</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">生产订单</th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('defectCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      故障机器数
                      <SortIcon field="defectCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('inputCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      产量（WMENG）
                      <SortIcon field="inputCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('rtyRate')}
                  >
                    <span className="inline-flex items-center gap-1">
                      直通率 (RTY)
                      <SortIcon field="rtyRate" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">直通率指标</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none text-center">达成状况</th>
                </tr>
              </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                        {!detailSearched ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-slate-500">
                      请输入至少一个查询条件后点击查询
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-slate-400">正在加载数据...</span>
                      </div>
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-slate-500">
                      暂无符合条件的数据
                    </td>
                  </tr>
                ) : (
                  sortedData.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2">{row.time}</td>
                      <td className="px-3 py-2">{row.productModel}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate" title={row.customer}>{row.customer || '-'}</td>
                      <td className="px-3 py-2">{row.base}</td>
                      <td className="px-3 py-2">
                        {row.salesOrders.length === 1 ? (
                          <span className="text-slate-600 font-mono text-xs">{row.salesOrders[0]}</span>
                        ) : row.salesOrders.length > 1 ? (
                          <button
                            onClick={() => {
                              setOrderListData({ title: '销售订单列表', orders: row.salesOrders, filterKey: 'salesOrder' });
                              setOrderListOpen(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold"
                          >
                            {row.salesOrders.length} 个销售订单
                          </button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.productionOrders.length === 1 ? (
                          <span className="text-slate-600 font-mono text-xs">{row.productionOrders[0]}</span>
                        ) : row.productionOrders.length > 1 ? (
                          <button
                            onClick={() => {
                              setOrderListData({ title: '生产订单列表', orders: row.productionOrders, filterKey: 'productionOrder' });
                              setOrderListOpen(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold"
                          >
                            {row.productionOrders.length} 个生产订单
                          </button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => {
                            if (row.defectCount > 0) {
                              const label = [row.salesOrder || '', row.productModel, row.base].filter(Boolean).join(' · ');
                              // A grouped row can contain more than one order. The primary
                              // fields contain only the first order, which can omit the one
                              // carrying the repair record.
                              const so = row.salesOrders.join(',') || row.salesOrder;
                              const po = row.productionOrders.join(',') || row.productionOrder;
                              const defectFilters: RTYFilterParams = {
                                dateRange: { from: undefined, to: undefined },
                                productModel: row.productModel || 'all',
                                customer: row.customer || '',
                                base: row.base || 'all',
                                salesOrder: so || '',
                                productionOrder: po || '',
                                serialNumber: '',
                                orderScope: filters.orderScope,
                                calculationMethod: row.model === '复合机型' ? 'composite' : 'normal',
                              };
                              setDefectModalData({ filters: defectFilters, label });
                            }
                          }}
                          className={`font-semibold focus:outline-none ${row.defectCount > 0 ? 'text-[#dc2626] hover:text-[#b91c1c] hover:underline cursor-pointer' : 'text-slate-400 cursor-default'}`}
                        >
                          {row.defectCount}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-semibold" title="销售订单入库数量（WMENG）">{row.inputCount}</td>
                      <td className="px-3 py-2 font-medium">
                        {row.rtyRate}%
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {modelTargets[row.productModel] || row.targetRate}%
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.rtyRate >= (modelTargets[row.productModel] || row.targetRate) ? (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[2px] bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium leading-tight">
                            达成
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[2px] bg-red-50 text-red-700 border border-red-200 text-[10px] font-medium leading-tight">
                            未达标
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 分页 */}
                {data.length > 0 && (
                  <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-2 shadow-sm">
            <span className="text-xs text-slate-500">
              共 {total} 条记录，第 {page}/{totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchData(1)}
                disabled={page === 1}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                首页
              </button>
              <button
                onClick={() => fetchData(page - 1)}
                disabled={page <= 1}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
              >
                <ChevronLeft className="w-3 h-3" />
                上一页
              </button>
              <div className="flex items-center gap-1 mx-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = startPage + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => fetchData(p)}
                      className={`min-w-[28px] px-1.5 py-1 text-xs rounded transition-colors ${
                        p === page
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => fetchData(page + 1)}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
              >
                下一页
                <ChevronRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => fetchData(totalPages)}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                末页
              </button>
            </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 故障明细 */}
      {defectModalData && (
        <DefectModal
          filters={defectModalData.filters}
          filterLabel={defectModalData.label}
          onClose={() => setDefectModalData(null)}
        />
      )}

      {excludedOrdersOpen && (
        <ExcludedOrdersModal filters={filters} onClose={() => setExcludedOrdersOpen(false)} />
      )}

      {/* 订单列表弹窗 */}
      {orderListOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[580px] max-h-[65vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">{orderListData.title}</h3>
              <button onClick={() => setOrderListOpen(false)} className="p-1 hover:bg-slate-100 rounded transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-3 gap-2">
                {orderListData.orders.map((order, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 bg-slate-50 rounded text-sm text-slate-700 font-mono cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    onClick={() => {
                      if (orderListData.title.includes('故障明细')) {
                        const detailFilters: RTYFilterParams = {
                          dateRange: { from: undefined, to: undefined },
                          productModel: 'all',
                          customer: '',
                          base: 'all',
                          salesOrder: '',
                          productionOrder: order,
                          serialNumber: '',
                          orderScope: filters.orderScope,
                        };
                        setDefectModalData({ filters: detailFilters, label: order });
                      } else {
                        setFilters({ ...filters, [orderListData.filterKey]: order });
                        fetchData();
                      }
                      setOrderListOpen(false);
                    }}
                    title={orderListData.title.includes('故障明细') ? '点击查看故障明细' : '点击筛选此订单'}
                  >
                    {order}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 text-center">
              共 {orderListData.orders.length} 个订单，点击可筛选
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
