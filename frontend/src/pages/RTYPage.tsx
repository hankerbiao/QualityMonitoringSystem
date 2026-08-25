import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import type { RTYData, RTYFilterParams } from '../types';
import { useModelTargets } from '../context/ModelTargetsContext';
import DefectModal from '../components/DefectModal';
import AlertConfigModal from '../components/AlertConfigModal';
import { AIChatPanel } from '../components/AIChatWindow';
import { FilterPanel } from '../components/rty';
import { SortIcon } from '../components/shared/SortIcon';

const DEFAULT_FILTERS: RTYFilterParams = {
  statMethod: '整体直通率',
  dateRange: { from: undefined, to: undefined },
  model: '普通机型',
  productModel: 'all',
  customer: '',
  base: 'all',
  salesOrder: '',
  productionOrder: '',
  serialNumber: ''
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
    const from = searchParams.get('dateFrom');
    const to = searchParams.get('dateTo');
    if (from) df.dateRange = { ...df.dateRange, from: new Date(from) };
    if (to) df.dateRange = { ...df.dateRange, to: new Date(to) };
    return df;
  }, [searchParams]);

  const [filters, setFilters] = useState<RTYFilterParams>(initialFilters);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RTYData[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [defectModalData, setDefectModalData] = useState<{ filters: RTYFilterParams; label: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);

  // 机器SN弹窗状态
  const [snModalOpen, setSnModalOpen] = useState(false);
  const [snModalData, setSnModalData] = useState<{ title: string; sns: string[] }>({ title: '', sns: [] });
  const [snPage, setSnPage] = useState(1);
  const SN_PAGE_SIZE = 100;

  // 订单列表弹窗状态
  const [orderListOpen, setOrderListOpen] = useState(false);
  const [orderListData, setOrderListData] = useState<{ title: string; orders: string[]; filterKey: 'salesOrder' | 'productionOrder' }>({ title: '', orders: [], filterKey: 'salesOrder' });

  const snTotalPages = Math.ceil(snModalData.sns.length / SN_PAGE_SIZE);
  const snPaginatedData = snModalData.sns.slice((snPage - 1) * SN_PAGE_SIZE, snPage * SN_PAGE_SIZE);

  const { modelTargets } = useModelTargets();

  // 获取数据
  const fetchData = async (targetPage = page) => {
    setLoading(true);
    try {
      const result = await rtyApi.getRTYData(filters, targetPage, pageSize);
      setData(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!detailOpen) return;

    const load = async () => {
      setLoading(true);
      try {
        const result = await rtyApi.getRTYData(filters, 1, pageSize);
        setData(result.items);
        setTotal(result.total);
        setPage(1);
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [detailOpen]);

  useEffect(() => {
    const handler = () => {
      if (detailOpen) fetchData();
    };
    window.addEventListener('settings-saved', handler);
    return () => window.removeEventListener('settings-saved', handler);
  }, [detailOpen, fetchData]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleExport = (selectedColumns: Record<string, boolean>) => {
    const exportColumnsMap: Record<string, string> = {
      time: '时间',
      productModel: '生产机型',
      customer: '客户',
      base: '基地',
      defectCount: '故障数量',
      inputCount: '投入数量',
      rtyRate: '直通率(%)',
      targetRate: '直通率指标(%)',
      status: '达成状况',
      salesOrder: '销售订单',
      productionOrder: '生产订单',
      serialNumbers: '机器SN',
      productLine: '产线',
      orderType: '订单类型',
      planStartDate: '计划开始日期',
      planEndDate: '计划结束时间',
    };
    const selectedKeys = Object.entries(selectedColumns).filter(([, v]) => v).map(([k]) => k);
    const exportData = sortedData.map(row => {
      const item: Record<string, unknown> = {};
      selectedKeys.forEach(key => {
        if (key === 'status') {
          item[exportColumnsMap[key]] = row.rtyRate >= (modelTargets[row.productModel] || row.targetRate) ? '达成' : '未达标';
        } else if (key === 'serialNumbers') {
          item[exportColumnsMap[key]] = Array.isArray(row.serialNumbers) ? row.serialNumbers.join(', ') : row.serialNumbers;
        } else {
          item[exportColumnsMap[key]] = row[key as keyof RTYData];
        }
      });
      return item;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RTY数据');
    XLSX.writeFile(wb, `RTY数据导出_${new Date().toISOString().split('T')[0]}.xlsx`);
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
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/')}
            className="p-1.5 hover:bg-slate-100 rounded-sm transition-colors text-slate-500"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">QualiBoard 品质看板 — RTY 整机综合直通率</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">快速切换看板:</span>
          <div className="flex items-center gap-1">
            <button
              disabled
              className="px-2 py-1 bg-blue-600 text-white rounded-sm font-medium"
            >
              RTY
            </button>
            <button
              onClick={() => navigate('/lrr')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              LRR <span className="text-slate-400">故障率</span>
            </button>
            <button
              onClick={() => navigate('/doa')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              DOA <span className="text-slate-400">换件率</span>
            </button>
            <button
              onClick={() => navigate('/mfr')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              MFR <span className="text-slate-400">月化</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-[1800px] mx-auto w-full overflow-auto">
        <AlertConfigModal
          embedded
          modelTargets={modelTargets}
          onDetailOpen={() => setDetailOpen(true)}
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
                  onSearch={() => fetchData(1)}
                  onAlertModalOpen={() => setDetailOpen(false)}
                  onAiChatOpen={() => setAiChatOpen(true)}
                  onExportConfirm={handleExport}
                />

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
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">客户</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">基地</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">销售订单</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">生产订单</th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('defectCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      故障数量
                      <SortIcon field="defectCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('inputCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      投入数量
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
                        {loading ? (
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
                      <td className="px-3 py-2">{row.customer}</td>
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
                              const so = row.salesOrder || row.salesOrders.join(',');
                              const po = row.productionOrder || row.productionOrders.join(',');
                              const defectFilters: RTYFilterParams = {
                                statMethod: '整体直通率',
                                dateRange: { from: undefined, to: undefined },
                                model: '普通机型',
                                productModel: row.productModel || 'all',
                                customer: row.customer || '',
                                base: row.base || 'all',
                                salesOrder: so || '',
                                productionOrder: po || '',
                                serialNumber: ''
                              };
                              setDefectModalData({ filters: defectFilters, label });
                            }
                          }}
                          className={`font-semibold focus:outline-none ${row.defectCount > 0 ? 'text-[#dc2626] hover:text-[#b91c1c] hover:underline cursor-pointer' : 'text-slate-400 cursor-default'}`}
                        >
                          {row.defectCount}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => {
                            setSnModalData({ title: row.productionOrder || row.salesOrder || '机器SN列表', sns: row.serialNumbers || [] });
                            setSnModalOpen(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-semibold focus:outline-none"
                        >
                          {row.inputCount}
                        </button>
                      </td>
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

      {aiChatOpen && <AIChatPanel rtyData={data} onClose={() => setAiChatOpen(false)} />}

      {/* 故障明细 */}
      {defectModalData && (
        <DefectModal
          filters={defectModalData.filters}
          filterLabel={defectModalData.label}
          onClose={() => setDefectModalData(null)}
        />
      )}

      {/* 机器SN列表 */}
      {snModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">机器SN列表 - {snModalData.title}</h3>
              <button onClick={() => { setSnModalOpen(false); setSnPage(1); }} className="p-1 hover:bg-slate-100 rounded transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {snModalData.sns.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {snPaginatedData.map((sn, idx) => (
                      <div key={idx} className="px-2 py-1.5 bg-slate-50 rounded text-xs text-slate-600 font-mono truncate" title={sn}>
                        {sn}
                      </div>
                    ))}
                  </div>
                  {snTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-slate-100">
                      <button
                        onClick={() => setSnPage(p => Math.max(1, p - 1))}
                        disabled={snPage === 1}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                      >
                        上一页
                      </button>
                      <span className="text-xs text-slate-500">
                        第 {snPage}/{snTotalPages} 页，共 {snModalData.sns.length} 条
                      </span>
                      <button
                        onClick={() => setSnPage(p => Math.min(snTotalPages, p + 1))}
                        disabled={snPage === snTotalPages}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-slate-400 py-8">暂无数据</div>
              )}
            </div>
          </div>
        </div>
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
                          statMethod: '整体直通率',
                          dateRange: { from: undefined, to: undefined },
                          model: '普通机型',
                          productModel: 'all',
                          customer: '',
                          base: 'all',
                          salesOrder: '',
                          productionOrder: order,
                          serialNumber: ''
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
