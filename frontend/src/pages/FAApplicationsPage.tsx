import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ClipboardCheck, Download, Inbox, Info, Mail, RefreshCw, RotateCcw, Search, Send, X } from 'lucide-react';
import { faApplicationsApi, type FACreateRequest } from '../api/faApplicationsApi';
import type { FAApplication, FADOAChange, FARepairFault, FAStage, FAPreviewRequest } from '../types/faApplications';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { dateRangePresets } from '../utils/dateRange';
import { emailPreviewHtml } from '../utils/faEmailPreview';

const today = new Date().toISOString().slice(0, 10);

const initialForm: FAPreviewRequest = {
  pn: '',
  vendor: '',
  faultDescription: '',
  stages: [],
  repairDateFrom: today,
  repairDateTo: today,
  doaDateFrom: today,
  doaDateTo: today,
};

function show(value: unknown) {
  return value == null || value === '' ? '—' : String(value);
}

function rate(value: number | null) {
  return value == null ? '—' : `${value.toFixed(2)}%`;
}

function MultiEmailInput({
  label,
  values,
  onChange,
  employees,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  employees: Awaited<ReturnType<typeof faApplicationsApi.listEmployees>>['items'];
}) {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const keyword = input.trim().toLocaleLowerCase();
  const suggestions = keyword.length >= 2 && !keyword.includes('@')
    ? employees.filter(employee => [employee.itcode, employee.realname, employee.internalName, employee.email, employee.department, employee.position, employee.company, employee.directBoss]
      .some(value => value.toLocaleLowerCase().includes(keyword)))
      .slice(0, 20)
    : [];
  const add = (raw: string) => {
    const emails = raw.split(/[;,，；\s]+/).map(email => email.trim()).filter(Boolean);
    const next = [...values];
    for (const email of emails) {
      if (!next.some(value => value.toLowerCase() === email.toLowerCase())) next.push(email);
    }
    onChange(next);
    setInput('');
  };
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      <p className="mb-1 text-[11px] text-slate-400">输入姓名、ITCode、部门或邮箱关键词选择员工；也可手动输入邮箱后按回车添加</p>
      <div className="relative rounded-md border border-slate-300 bg-white p-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <div className="flex flex-wrap gap-1">
          {values.map(value => <span key={value} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{value}<button type="button" onClick={() => onChange(values.filter(item => item !== value))} aria-label={`移除 ${value}`}><X className="size-3" /></button></span>)}
          <input value={input} onFocus={() => setIsFocused(true)} onBlur={() => window.setTimeout(() => setIsFocused(false), 120)} onChange={event => setInput(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter') {
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (suggestions.length > 0) add(suggestions[0].email);
              else add(input);
              return;
            }
            if (event.key === ',' || event.key === ';') {
              event.preventDefault();
              add(input);
            }
          }} placeholder="输入员工关键词或邮箱" className="min-w-[220px] flex-1 px-1 py-1 text-sm outline-none" />
        </div>
        {isFocused && input.trim().length >= 2 && !input.includes('@') && <div role="listbox" aria-label={`${label}员工搜索结果`} className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {suggestions.map(employee => <button key={`${employee.itcode}-${employee.email}`} type="button" role="option" aria-selected="false" onMouseDown={event => event.preventDefault()} onClick={() => add(employee.email)} className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-blue-50">
            <span className="text-sm font-medium text-slate-800">{employee.realname || employee.internalName || employee.itcode} <span className="text-xs font-normal text-slate-500">{employee.itcode}</span></span>
            <span className="text-xs text-blue-700">{employee.email}</span>
            {employee.department && <span className="text-[11px] text-slate-500">{employee.department}</span>}
          </button>)}
          {suggestions.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">没有找到匹配员工</p>}
        </div>}
      </div>
    </div>
  );
}

function matchesFilter(row: Record<string, unknown>, keyword: string) {
  return Object.values(row).some(value => value != null && String(value).toLocaleLowerCase().includes(keyword));
}

function makeSetMany(setter: (update: (prev: Set<string>) => Set<string>) => void) {
  return (ids: string[], select: boolean) => setter(current => {
    const next = new Set(current);
    for (const id of ids) {
      if (select) next.add(id);
      else next.delete(id);
    }
    return next;
  });
}

function TableToolbar({ filter, onFilter, placeholder, selectedCount, totalCount, filteredCount, allSelected, onSelectAll, disabled }: {
  filter: string;
  onFilter: (value: string) => void;
  placeholder: string;
  selectedCount: number;
  totalCount: number;
  filteredCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  disabled?: boolean;
}) {
  const keyword = filter.trim().length > 0;
  return <div className="flex flex-wrap items-center gap-2">
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      <input value={filter} onChange={event => onFilter(event.target.value)} placeholder={placeholder}
        className="h-8 w-64 rounded-md border border-slate-300 pl-7 pr-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
    </div>
    <span className="text-xs text-slate-500">已选 {selectedCount}/{totalCount} 条{keyword ? ` · 匹配 ${filteredCount} 条` : ''}</span>
    <button type="button" disabled={disabled || filteredCount === 0} onClick={onSelectAll}
      className="ml-auto text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400">
      {allSelected ? '取消全选' : '全选'}{keyword ? '（匹配结果）' : ''}
    </button>
  </div>;
}

function RepairTable({ rows, selected, onToggle, onSetMany, disabled = false }: { rows: FARepairFault[]; selected: Set<string>; onToggle: (id: string) => void; onSetMany: (ids: string[], select: boolean) => void; disabled?: boolean }) {
  const [filter, setFilter] = useState('');
  const keyword = filter.trim().toLocaleLowerCase();
  const filtered = keyword ? rows.filter(row => matchesFilter(row as unknown as Record<string, unknown>, keyword)) : rows;
  const allSelected = filtered.length > 0 && filtered.every(row => selected.has(row.sourceId));
  const selectFiltered = () => onSetMany(filtered.map(row => row.sourceId), !allSelected);
  return <div className="space-y-2">
    <TableToolbar filter={filter} onFilter={setFilter} placeholder="过滤 SN / 基地 / 工站 / 机型 / 物料号"
      selectedCount={selected.size} totalCount={rows.length} filteredCount={filtered.length}
      allSelected={allSelected} onSelectAll={selectFiltered} disabled={disabled} />
    <div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[1450px] w-full text-xs"><thead className="sticky top-0 z-20 bg-slate-50 text-left text-slate-500"><tr><th className="sticky left-0 z-10 w-9 bg-slate-50 px-2 py-2"><input type="checkbox" disabled={disabled} checked={allSelected} onChange={selectFiltered} aria-label="全选产测故障" /></th><th className="sticky left-9 z-10 bg-slate-50 px-2 py-2">SN</th>{['基地', '生产订单', '机型', '工站', 'NG时间', '不良维度3', '不良维度2', '维修维度3', '物料号', '物料描述', '序列号', '替换前原厂码'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={row.sourceId} className="group border-t border-slate-100 hover:bg-blue-50"><td className="sticky left-0 z-10 bg-white px-2 py-2 group-hover:bg-blue-50"><input type="checkbox" disabled={disabled} checked={selected.has(row.sourceId)} onChange={() => onToggle(row.sourceId)} aria-label={`选择 ${row.sourceId}`} /></td><td className="sticky left-9 z-10 whitespace-nowrap bg-white px-2 py-2 font-medium text-slate-700 group-hover:bg-blue-50">{show(row.sn)}</td><td className="px-2 py-2">{show(row.base)}</td><td className="px-2 py-2">{show(row.productionOrder)}</td><td className="px-2 py-2">{show(row.model)}</td><td className="px-2 py-2">{show(row.station)}</td><td className="px-2 py-2">{show(row.ngTime)}</td><td className="px-2 py-2">{show(row.faultDimension3)}</td><td className="px-2 py-2">{show(row.faultDimension2)}</td><td className="px-2 py-2">{show(row.repairDimension3)}</td><td className="px-2 py-2">{show(row.materialNumber)}{row.nonCriticalMaterialNumber && <div className="text-[10px] text-amber-700">非关键：{row.nonCriticalMaterialNumber}</div>}</td><td className="px-2 py-2">{show(row.materialDescription)}</td><td className="px-2 py-2">{show(row.serialNumber)}</td><td className="px-2 py-2">{show(row.originalFactoryCode)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-xs text-slate-400">暂无产测故障明细</p>}{rows.length > 0 && filtered.length === 0 && <p className="p-6 text-center text-xs text-slate-400">没有匹配「{filter.trim()}」的记录</p>}</div>
  </div>;
}

function DoaTable({ rows, selected, onToggle, onSetMany, disabled = false }: { rows: FADOAChange[]; selected: Set<string>; onToggle: (id: string) => void; onSetMany: (ids: string[], select: boolean) => void; disabled?: boolean }) {
  const [filter, setFilter] = useState('');
  const keyword = filter.trim().toLocaleLowerCase();
  const filtered = keyword ? rows.filter(row => matchesFilter(row as unknown as Record<string, unknown>, keyword)) : rows;
  const allSelected = filtered.length > 0 && filtered.every(row => selected.has(row.sourceId));
  const selectFiltered = () => onSetMany(filtered.map(row => row.sourceId), !allSelected);
  return <div className="space-y-2">
    <TableToolbar filter={filter} onFilter={setFilter} placeholder="过滤 SN / PN / 备件名称 / 报修设备"
      selectedCount={selected.size} totalCount={rows.length} filteredCount={filtered.length}
      allSelected={allSelected} onSelectAll={selectFiltered} disabled={disabled} />
    <div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[900px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-2"><input type="checkbox" disabled={disabled} checked={allSelected} onChange={selectFiltered} aria-label="全选 DOA 明细" /></th>{['PN', 'SN', '备件名称', '原厂原码', '报修设备', '操作时间'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={row.sourceId} className="border-t border-slate-100 hover:bg-blue-50"><td className="px-2 py-2"><input type="checkbox" disabled={disabled} checked={selected.has(row.sourceId)} onChange={() => onToggle(row.sourceId)} aria-label={`选择 ${row.sourceId}`} /></td><td className="px-2 py-2">{show(row.pn)}</td><td className="px-2 py-2">{show(row.sn)}</td><td className="px-2 py-2">{show(row.spareName)}</td><td className="px-2 py-2">{show(row.originalCode)}</td><td className="px-2 py-2">{show(row.reportedDevice)}</td><td className="px-2 py-2">{show(row.operationTime)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-xs text-slate-400">暂无 DOA 换下明细</p>}{rows.length > 0 && filtered.length === 0 && <p className="p-6 text-center text-xs text-slate-400">没有匹配「{filter.trim()}」的记录</p>}</div>
  </div>;
}

function ApplicationDetailsDialog({ application, onClose }: { application: FAApplication; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const emailStatus = application.email.status === 'sent' ? '已发送' : application.email.status === 'failed' ? '发送失败' : '待发送';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 md:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="fa-application-details-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 md:px-5"><div><h2 id="fa-application-details-title" className="text-base font-semibold text-slate-900">申请单 {application.applicationId}</h2><p className="mt-1 text-xs text-slate-500">{application.pn} · {application.vendor || '未填写厂商'} · {application.stages.join('、')}</p></div><button type="button" onClick={onClose} aria-label="关闭申请单详情" className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button></header>
      <div className="space-y-5 overflow-auto p-4 md:p-5">
        <section><h3 className="mb-2 text-sm font-semibold text-slate-800">申请信息</h3><dl className="grid gap-x-6 gap-y-2 border-t border-slate-200 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs text-slate-500">物料描述</dt><dd className="mt-0.5 break-words">{show(application.materialDescription)}</dd></div><div><dt className="text-xs text-slate-500">故障现象</dt><dd className="mt-0.5 break-words">{show(application.faultDescription)}</dd></div><div><dt className="text-xs text-slate-500">创建人</dt><dd className="mt-0.5">{show(application.createdByName || application.createdBy)}</dd></div><div><dt className="text-xs text-slate-500">创建时间</dt><dd className="mt-0.5">{show(application.createdAt)}</dd></div><div><dt className="text-xs text-slate-500">产测计划开始时间</dt><dd className="mt-0.5">{application.stages.includes('产测') ? `${show(application.repairDateFrom)} 至 ${show(application.repairDateTo)}` : '—'}</dd></div><div><dt className="text-xs text-slate-500">DOA 操作时间</dt><dd className="mt-0.5">{application.stages.includes('DOA') ? `${show(application.doaDateFrom)} 至 ${show(application.doaDateTo)}` : '—'}</dd></div></dl></section>
        <section><h3 className="mb-2 text-sm font-semibold text-slate-800">邮件发送信息</h3><dl className="grid gap-x-6 gap-y-3 border-t border-slate-200 pt-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">发送状态</dt><dd className="mt-0.5">{emailStatus}</dd></div><div><dt className="text-xs text-slate-500">发送时间</dt><dd className="mt-0.5">{show(application.email.sentAt)}</dd></div><div><dt className="text-xs text-slate-500">收件人</dt><dd className="mt-0.5 break-all">{application.email.to.length ? application.email.to.join('、') : '—'}</dd></div><div><dt className="text-xs text-slate-500">抄送人</dt><dd className="mt-0.5 break-all">{application.email.cc.length ? application.email.cc.join('、') : '—'}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">邮件主题</dt><dd className="mt-0.5 break-words">{show(application.email.subject)}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">邮件正文</dt><dd className="mt-1 min-h-10 whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3">{show(application.email.content)}</dd></div>{application.email.error && <div className="sm:col-span-2"><dt className="text-xs text-red-600">发送错误</dt><dd className="mt-0.5 break-words text-red-700">{application.email.error}</dd></div>}</dl></section>
        {application.repairFaults.length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-slate-800">产测故障明细 <span className="font-normal text-slate-500">{application.repairFaults.length} 条</span></h3><div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[1050px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['基地', '生产订单', '机型', 'SN', '工站', '计划开始时间', '物料号', '序列号', '替换前原厂码'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{application.repairFaults.map(row => <tr key={row.sourceId} className="border-t border-slate-100"><td className="px-2 py-2">{show(row.base)}</td><td className="px-2 py-2">{show(row.productionOrder)}</td><td className="px-2 py-2">{show(row.model)}</td><td className="px-2 py-2">{show(row.sn)}</td><td className="px-2 py-2">{show(row.station)}</td><td className="px-2 py-2">{show(row.ngTime)}</td><td className="px-2 py-2">{show(row.materialNumber)}</td><td className="px-2 py-2">{show(row.serialNumber)}</td><td className="px-2 py-2">{show(row.originalFactoryCode)}</td></tr>)}</tbody></table></div></section>}
        {application.doaChanges.length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-slate-800">DOA 换下明细 <span className="font-normal text-slate-500">{application.doaChanges.length} 条</span></h3><div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[750px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['PN', 'SN', '备件名称', '原厂原码', '报修设备', '操作时间'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{application.doaChanges.map(row => <tr key={row.sourceId} className="border-t border-slate-100"><td className="px-2 py-2">{show(row.pn)}</td><td className="px-2 py-2">{show(row.sn)}</td><td className="px-2 py-2">{show(row.spareName)}</td><td className="px-2 py-2">{show(row.originalCode)}</td><td className="px-2 py-2">{show(row.reportedDevice)}</td><td className="px-2 py-2">{show(row.operationTime)}</td></tr>)}</tbody></table></div></section>}
      </div>
    </section>
  </div>;
}

const PAGE_SIZE = 20;
const RECENT_PN_KEY = 'fa-recent-pn-v1';
const QUICK_PRESETS = ['今天', '近 7 天', '近 30 天'];

function loadRecentPn(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_PN_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecentPn(pn: string): string[] {
  const key = pn.trim();
  if (!key) return loadRecentPn();
  const next = [key, ...loadRecentPn().filter(item => item !== key)].slice(0, 8);
  try { localStorage.setItem(RECENT_PN_KEY, JSON.stringify(next)); } catch { /* 存储不可用时不影响查询 */ }
  return next;
}

function statusMeta(value: FAApplication['email']['status']) {
  if (value === 'sent') return { label: '已发送', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' };
  if (value === 'failed') return { label: '发送失败', dot: 'bg-red-500', badge: 'bg-red-50 text-red-700' };
  return { label: '待发送', dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600' };
}

export default function FAApplicationsPage() {
  const [form, setForm] = useState<FAPreviewRequest>(initialForm);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof faApplicationsApi.preview>> | null>(null);
  const [applications, setApplications] = useState<FAApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listUpdatedAt, setListUpdatedAt] = useState('');
  const [employees, setEmployees] = useState<Awaited<ReturnType<typeof faApplicationsApi.listEmployees>>['items']>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState('');
  const [detailsApplication, setDetailsApplication] = useState<FAApplication | null>(null);
  const [selectedRepair, setSelectedRepair] = useState<Set<string>>(new Set());
  const [selectedDoa, setSelectedDoa] = useState<Set<string>>(new Set());
  const [emailTo, setEmailTo] = useState<string[]>([]);
  const [emailCc, setEmailCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [tab, setTab] = useState<'create' | 'history'>('create');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pnError, setPnError] = useState('');
  const [vendorError, setVendorError] = useState('');
  const [vendorLookup, setVendorLookup] = useState<{ pn: string; vendor: string | null } | null>(null);
  const [vendorLookupError, setVendorLookupError] = useState('');
  const [vendorLookupLoading, setVendorLookupLoading] = useState(false);
  const vendorLookupRequestId = useRef(0);
  const vendorInputRef = useRef<HTMLInputElement>(null);
  const [stageError, setStageError] = useState('');
  const [vendorAutoFilled, setVendorAutoFilled] = useState(false);
  const [listPn, setListPn] = useState('');
  const [listCreator, setListCreator] = useState('');
  const [listStatus, setListStatus] = useState('');
  const [listDateFrom, setListDateFrom] = useState('');
  const [listDateTo, setListDateTo] = useState('');
  const [recentPn, setRecentPn] = useState<string[]>(loadRecentPn);
  const listRequestId = useRef(0);

  useEffect(() => {
    const pn = form.pn.trim();
    const requestId = ++vendorLookupRequestId.current;
    setVendorLookup(null);
    setVendorLookupError('');
    if (!pn) {
      setVendorLookupLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setVendorLookupLoading(true);
      try {
        const result = await faApplicationsApi.lookupVendor(pn);
        if (requestId === vendorLookupRequestId.current) setVendorLookup({ pn, vendor: result.vendor });
      } catch (reason) {
        if (requestId === vendorLookupRequestId.current) {
          setVendorLookupError(reason instanceof Error ? reason.message : '厂商查询失败');
        }
      } finally {
        if (requestId === vendorLookupRequestId.current) setVendorLookupLoading(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [form.pn]);

  const filtersKey = [listPn.trim(), listCreator.trim(), listStatus, listDateFrom, listDateTo].join('|');
  const hasListFilter = Boolean(listPn.trim() || listCreator.trim() || listStatus || listDateFrom || listDateTo);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadList = async (targetPage: number) => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    try {
      const result = await faApplicationsApi.list({
        page: targetPage,
        pageSize: PAGE_SIZE,
        pn: listPn.trim() || undefined,
        creator: listCreator.trim() || undefined,
        emailStatus: listStatus || undefined,
        dateFrom: listDateFrom || undefined,
        dateTo: listDateTo || undefined,
      });
      if (requestId !== listRequestId.current) return;
      setApplications(result.items);
      setTotal(result.total);
      setPage(result.page);
      setListUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (reason) {
      if (requestId === listRequestId.current) setError(reason instanceof Error ? reason.message : '申请列表加载失败');
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  };

  // 条件变化回到第一页；翻页与条件变化统一由下面的防抖请求覆盖。
  useEffect(() => { setPage(1); }, [filtersKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(page); }, 250);
    return () => window.clearTimeout(timer);
  }, [page, filtersKey]);

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    setEmployeesError('');
    try {
      const result = await faApplicationsApi.listEmployees();
      setEmployees(result.items);
    } catch (reason) {
      setEmployeesError(reason instanceof Error ? reason.message : '员工通讯录加载失败');
    } finally {
      setEmployeesLoading(false);
    }
  }, []);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const selectedCount = selectedRepair.size + selectedDoa.size;
  const stages = form.stages;
  const mutateForm = (patch: Partial<FAPreviewRequest>) => {
    setForm(current => ({ ...current, ...patch }));
    setPreview(null);
    setSelectedRepair(new Set());
    setSelectedDoa(new Set());
  };
  const toggleStage = (stage: FAStage) => {
    mutateForm({ stages: stages.includes(stage) ? stages.filter(item => item !== stage) : [...stages, stage] });
    setStageError('');
  };
  const updatePn = (pn: string) => {
    mutateForm({ pn, vendor: '' });
    setVendorAutoFilled(false);
    if (pn.trim()) setPnError('');
  };
  const updateVendor = (vendor: string) => {
    mutateForm({ vendor });
    if (vendor.trim()) setVendorError('');
    setVendorAutoFilled(false);
  };
  useEffect(() => {
    if (
      vendorLookup?.pn === form.pn.trim()
      && vendorLookup.vendor
      && !form.vendor.trim()
      && vendorInputRef.current === document.activeElement
    ) {
      updateVendor(vendorLookup.vendor);
      setVendorAutoFilled(true);
    }
  }, [vendorLookup, form.pn, form.vendor]);
  const resetForm = () => {
    setForm({ ...initialForm });
    setPreview(null);
    setSelectedRepair(new Set());
    setSelectedDoa(new Set());
    setPnError(''); setStageError(''); setVendorError(''); setVendorAutoFilled(false);
    setStep(1); setNotice(''); setError('');
  };
  const applyQuickRange = (from: string, to: string) => {
    const patch: Partial<FAPreviewRequest> = {};
    if (stages.includes('产测')) { patch.repairDateFrom = from; patch.repairDateTo = to; }
    if (stages.includes('DOA')) { patch.doaDateFrom = from; patch.doaDateTo = to; }
    if (Object.keys(patch).length) mutateForm(patch);
  };
  const runPreview = async () => {
    setLoading(true); setError(''); setNotice('');
    setPreview(null); setSelectedRepair(new Set()); setSelectedDoa(new Set());
    try {
      const result = await faApplicationsApi.preview(form);
      setPreview(result);
      setSelectedRepair(new Set(result.repairFaults.map(row => row.sourceId)));
      setSelectedDoa(new Set(result.doaChanges.map(row => row.sourceId)));
      setRecentPn(pushRecentPn(form.pn));
      setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败'); } finally { setLoading(false); }
  };
  const runQuery = () => {
    const pnMissing = !form.pn.trim();
    const stageMissing = stages.length === 0;
    const vendorMissing = !form.vendor.trim();
    setPnError(pnMissing ? '请输入物料号 PN 后再查询' : '');
    setStageError(stageMissing ? '请至少选择一个发生环节' : '');
    setVendorError(vendorMissing ? '请输入厂商' : '');
    if (pnMissing || stageMissing || vendorMissing || loading) return;
    void runPreview();
  };
  const toggle = (set: Set<string>, id: string, setter: (value: Set<string>) => void) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); setter(next); };
  const setManyRepair = makeSetMany(setSelectedRepair);
  const setManyDoa = makeSetMany(setSelectedDoa);
  const create = async () => {
    if (!preview || !selectedCount) return;
    setStep(3);
    setNotice('请确认收件人和邮件内容，点击发送后才会保存申请单');
  };
  const send = async () => {
    if (!preview || !emailTo.length) return;
    setLoading(true); setError('');
    const request: FACreateRequest = { ...form, selectedRepairIds: [...selectedRepair], selectedDoaIds: [...selectedDoa] };
    try {
      const result = await faApplicationsApi.submit({ application: request, email: { to: emailTo, cc: emailCc, subject, content } });
      setNotice(`申请单 ${result.applicationId} 邮件已发送，并已记录到申请单记录`);
      setEmailTo([]); setEmailCc([]); setSubject(''); setContent('');
      setStep(1); setPreview(null); setSelectedRepair(new Set()); setSelectedDoa(new Set());
      setTab('history');
      void loadList(1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '邮件发送失败，申请单未保存'); } finally { setLoading(false); }
  };
  const summary = useMemo(() => preview ? [{ label: '物料描述', value: preview.materialDescription || '—' }, { label: '产测故障率', value: rate(preview.repair.faultRate) }, { label: 'DOA 故障率', value: rate(preview.doa.faultRate) }, { label: '已选明细', value: selectedCount.toLocaleString() }] : [], [preview, selectedCount]);
  const activeRange = stages.includes('产测')
    ? { from: form.repairDateFrom || '', to: form.repairDateTo || '' }
    : stages.includes('DOA') ? { from: form.doaDateFrom || '', to: form.doaDateTo || '' } : { from: '', to: '' };
  const rangeLabel = dateRangePresets().find(item => item.from === activeRange.from && item.to === activeRange.to)?.label;
  const querySummary = `${form.pn.trim() || '未填 PN'} · ${stages.length ? stages.join(' / ') : '未选环节'} · ${rangeLabel || (activeRange.from && `${activeRange.from} ~ ${activeRange.to}`) || '未设日期'}`;

  const resetFilters = () => {
    setListPn(''); setListCreator(''); setListStatus(''); setListDateFrom(''); setListDateTo('');
    setPage(1);
  };
  const exportCsv = () => {
    const rows = [
      ['申请单号', 'PN', '厂商', '故障现象', '物料描述', '发生环节', '明细数', '创建人', '创建时间', '邮件状态'],
      ...applications.map(item => [
        item.applicationId, item.pn, item.vendor, item.faultDescription, item.materialDescription,
        item.stages.join('、'), String(item.repairFaults.length + item.doaChanges.length),
        item.createdByName || item.createdBy, item.createdAt, statusMeta(item.email.status).label,
      ]),
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `FA申请单_${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const steps = [
    { number: 1, title: '查询数据', description: '填写 PN 和时间范围' },
    { number: 2, title: '选择明细', description: '核对并勾选故障记录' },
    { number: 3, title: '确认发送', description: '添加收件人并发送' },
  ] as const;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 md:p-6">
      <div className="mx-auto max-w-[1280px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link to="/" aria-label="返回首页" className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700"><ArrowLeft className="size-4" />返回首页</Link>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-600 p-2 text-white"><ClipboardCheck className="size-5" /></div>
              <div><h1 className="text-xl font-semibold text-slate-900">FA看板</h1><p className="text-xs text-slate-500">申请单提交</p></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">按 PN 查询故障明细 → 核对勾选 → 发送申请单</p>
        </header>

        <div role="tablist" aria-label="FA看板视图" className="flex items-center gap-1 border-b border-slate-200">
          <button type="button" role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')} className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === 'create' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>发起申请单</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => { setTab('history'); void loadList(page); }} className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === 'history' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            申请单记录 <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{total}</span>
          </button>
        </div>

        {(error || notice) && <div role="alert" className={`rounded-md border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}

        {tab === 'create' && <>
          <nav aria-label="申请单步骤" className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            {steps.map((item, index) => {
              const clickable = item.number < step;
              return <Fragment key={item.number}>
                {index > 0 && <div aria-hidden="true" className={`mx-1 h-px min-w-4 flex-1 ${step > index ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
                <button type="button" disabled={!clickable} onClick={() => setStep(item.number)} aria-current={step === item.number ? 'step' : undefined} title={clickable ? `返回「${item.title}」` : undefined}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-left ${clickable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'}`}>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step === item.number ? 'bg-blue-600 text-white' : step > item.number ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{step > item.number ? <Check className="size-3.5" /> : item.number}</span>
                  <span className={`text-sm font-semibold ${step === item.number ? 'text-blue-700' : 'text-slate-700'}`}>{item.title}</span>
                  <span className="hidden text-[11px] font-normal text-slate-400 lg:inline">{item.description}</span>
                </button>
              </Fragment>;
            })}
          </nav>

          {step === 1 && <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-base font-semibold text-slate-900">设置查询条件</h2><p className="mt-1 text-xs text-slate-500">填写物料 PN 与查询范围，下一步核对故障明细。</p></div>
              <button type="button" onClick={resetForm} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><RotateCcw className="size-3.5" />重置条件</button>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold tracking-wide text-blue-700">物料与故障</h3>
              <div className="mt-2 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2 xl:grid-cols-4">
                <label>
                  <span className="mb-1 block text-xs font-semibold text-slate-600">物料号 PN <span className="text-red-600">*</span></span>
                  <input autoFocus list="fa-recent-pn" value={form.pn} onChange={event => updatePn(event.target.value)} placeholder="输入物料号" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  <datalist id="fa-recent-pn">{recentPn.map(item => <option key={item} value={item} />)}</datalist>
                  {pnError && <p className="mt-1 text-xs text-red-600">{pnError}</p>}
                </label>
                <label>
                  <span className="mb-1 block text-xs font-semibold text-slate-600">厂商 <span className="text-red-600">*</span></span>
                  <div className="relative">
                    <input ref={vendorInputRef} value={form.vendor} onFocus={() => { if (!form.vendor.trim() && vendorLookup?.pn === form.pn.trim() && vendorLookup.vendor) { updateVendor(vendorLookup.vendor); setVendorAutoFilled(true); } }} onBlur={() => { if (form.pn.trim() && form.vendor.trim()) void faApplicationsApi.rememberVendor(form.pn.trim(), form.vendor.trim()).catch(() => undefined); }} onChange={event => updateVendor(event.target.value)} placeholder="查询后点击此处填入厂商" className="h-10 w-full rounded-md border border-slate-300 px-3 pr-16 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                    {vendorAutoFilled && form.vendor && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700" title="已自动填充上次输入的厂商，可直接修改">已记忆</span>}
                  </div>
                  {vendorError && <p className="mt-1 text-xs text-red-600">{vendorError}</p>}
                  {vendorLookupLoading && <p className="mt-1 text-xs text-slate-500">正在查询物料厂商…</p>}
                  {!vendorLookupLoading && vendorLookup?.pn === form.pn.trim() && vendorLookup.vendor && !form.vendor.trim() && <p className="mt-1 text-xs text-blue-700">已查到厂商：{vendorLookup.vendor}，点击输入框自动填入</p>}
                  {vendorLookupError && <p className="mt-1 text-xs text-red-600">{vendorLookupError}</p>}
                </label>
                <label className="xl:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">故障现象 <span className="font-normal text-slate-400">（选填）</span></span>
                  <input value={form.faultDescription} onChange={event => mutateForm({ faultDescription: event.target.value })} placeholder="一句话描述故障现象（邮件主题）" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold tracking-wide text-blue-700">查询范围</h3>
              <div className="mt-2 space-y-3 border-t border-slate-100 pt-3">
                <fieldset>
                  <legend className="mb-1.5 block text-xs font-semibold text-slate-600">发生环节 <span className="text-red-600">*</span></legend>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['产测', 'DOA'] as FAStage[]).map(stage => {
                      const active = stages.includes(stage);
                      return <button key={stage} type="button" aria-pressed={active} onClick={() => toggleStage(stage)} className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium transition-colors ${active ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700' : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700'}`}>{active && <Check className="size-3.5" />}{stage}</button>;
                    })}
                  </div>
                  {stageError && <p className="mt-1 text-xs text-red-600">{stageError}</p>}
                </fieldset>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">快捷日期</span>
                  {dateRangePresets().filter(item => QUICK_PRESETS.includes(item.label)).map(item => <button key={item.label} type="button" onClick={() => applyQuickRange(item.from, item.to)} aria-pressed={item.from === activeRange.from && item.to === activeRange.to} className={`h-8 rounded-md border px-3 text-xs transition-colors ${item.from === activeRange.from && item.to === activeRange.to ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'}`}>{item.label}</button>)}
                  <span className="text-[11px] text-slate-400">同时应用到已选环节</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(260px,300px))]">
                  {stages.includes('产测') && <DateRangePicker accent="blue" label="产测计划开始时间" from={form.repairDateFrom || ''} to={form.repairDateTo || ''} onChange={(repairDateFrom, repairDateTo) => mutateForm({ repairDateFrom, repairDateTo })} />}
                  {stages.includes('DOA') && <DateRangePicker accent="blue" label="DOA 操作时间" from={form.doaDateFrom || ''} to={form.doaDateTo || ''} onChange={(doaDateFrom, doaDateTo) => mutateForm({ doaDateFrom, doaDateTo })} />}
                </div>
                {stages.length === 0 && <p className="text-xs text-slate-400">请先选择发生环节，再设置对应日期范围。</p>}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="flex min-w-0 items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-600"><Info className="size-3.5 shrink-0 text-blue-600" /><span className="truncate">将查询 {querySummary}</span></div>
              <button type="button" disabled={loading} onClick={runQuery} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Search className="size-4" />{loading ? '正在查询…' : '查询并继续'}</button>
            </div>
          </section>}

          {step === 2 && preview && <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div><h2 className="text-base font-semibold text-slate-900">核对并选择故障明细</h2><p className="mt-1 text-sm text-slate-500">{form.pn} · {form.vendor || '未填写厂商'} · {stages.join('、')}</p></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{summary.map(item => <div key={item.label} className="rounded-md border-l-2 border-blue-500 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{item.label}</p><p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p></div>)}</div>
            {stages.includes('产测') && <div className="space-y-2"><h3 className="text-sm font-semibold text-slate-800">产测故障</h3><RepairTable rows={preview.repairFaults} selected={selectedRepair} onToggle={id => toggle(selectedRepair, id, setSelectedRepair)} onSetMany={setManyRepair} /></div>}
            {stages.includes('DOA') && <div className="space-y-2"><h3 className="text-sm font-semibold text-slate-800">DOA 换下明细</h3><DoaTable rows={preview.doaChanges} selected={selectedDoa} onToggle={id => toggle(selectedDoa, id, setSelectedDoa)} onSetMany={setManyDoa} /></div>}
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t border-slate-200 bg-white py-3">
              <button type="button" onClick={() => setStep(1)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">上一步</button>
              <button type="button" disabled={!selectedCount || loading} onClick={create} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Check className="size-4" />{selectedCount ? `确认明细并继续（已选 ${selectedCount} 条）` : '确认明细并继续'}</button>
            </div>
          </section>}

          {step === 3 && <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div><div className="flex items-center gap-2"><Mail className="size-5 text-blue-600" /><h2 className="text-base font-semibold text-slate-900">确认邮件并发送</h2></div><p className="mt-1 text-sm text-slate-500">邮件发送成功后才保存申请单 · 当前明细 {selectedCount} 条</p></div>
            {!employeesLoading && employeesError && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">员工通讯录加载失败，仍可手动输入邮箱。{employeesError} <button type="button" onClick={() => void loadEmployees()} className="underline">重试</button></p>}
            <div className="grid gap-4 md:grid-cols-2"><MultiEmailInput label="收件人" values={emailTo} onChange={setEmailTo} employees={employees} /><MultiEmailInput label="抄送人" values={emailCc} onChange={setEmailCc} employees={employees} /></div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">邮件主题</span><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="选填" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">邮件正文</span><textarea value={content} onChange={event => setContent(event.target.value)} rows={14} placeholder="输入邮件正文，可使用换行分段" className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
                <p className="text-xs text-slate-500">正文会按纯文本放入邮件模板，支持换行；模板样式由系统统一排版。</p>
              </div>
              <div className="min-w-0"><div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">邮件效果预览</span><span className="text-[11px] text-slate-400">模板自动适配邮件客户端</span></div><iframe title="FA 邮件效果预览" sandbox="" srcDoc={emailPreviewHtml(subject, content, form, preview?.materialDescription || '', preview?.repairFaults.filter(row => selectedRepair.has(row.sourceId)) || [], preview?.doaChanges.filter(row => selectedDoa.has(row.sourceId)) || [])} className="h-[560px] w-full rounded-md border border-slate-200 bg-slate-50" /></div>
            </div>
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t border-slate-200 bg-white py-3">
              <button type="button" onClick={() => setStep(2)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">上一步</button>
              <button type="button" disabled={!emailTo.length || loading} onClick={send} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="size-4" />{loading ? '发送中…' : `发送给 ${emailTo.length} 位收件人`}</button>
            </div>
          </section>}
        </>}

        {tab === 'history' && <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div><h2 className="text-sm font-semibold text-slate-900">已发申请单 <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">{total}</span></h2><p className="mt-1 text-xs text-slate-500">点击申请单号查看明细与邮件发送内容</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400">{listUpdatedAt && `更新于 ${listUpdatedAt}`}</span>
              <button type="button" onClick={exportCsv} title="导出当前页数据" disabled={!applications.length} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Download className="size-3.5" />导出当前页</button>
              <button type="button" onClick={() => void loadList(page)} disabled={listLoading} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`size-3.5 ${listLoading ? 'animate-spin' : ''}`} />刷新</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
            <input value={listPn} onChange={event => setListPn(event.target.value)} placeholder="按 PN 筛选" className="h-8 w-36 rounded-md border border-slate-300 px-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            <input value={listCreator} onChange={event => setListCreator(event.target.value)} placeholder="按创建人筛选" className="h-8 w-36 rounded-md border border-slate-300 px-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            <input type="date" value={listDateFrom} max={listDateTo || undefined} onChange={event => setListDateFrom(event.target.value)} aria-label="创建时间起始日期" title="创建时间起始日期" className="h-8 w-36 rounded-md border border-slate-300 px-2 text-xs text-slate-700 outline-none focus:border-blue-500" />
            <span className="text-xs text-slate-400">至</span>
            <input type="date" value={listDateTo} min={listDateFrom || undefined} onChange={event => setListDateTo(event.target.value)} aria-label="创建时间结束日期" title="创建时间结束日期" className="h-8 w-36 rounded-md border border-slate-300 px-2 text-xs text-slate-700 outline-none focus:border-blue-500" />
            <select value={listStatus} onChange={event => setListStatus(event.target.value)} aria-label="按邮件状态筛选" className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500"><option value="">已发送</option><option value="all">全部状态</option><option value="failed">发送失败</option><option value="pending">待发送</option></select>
            {hasListFilter && <button type="button" onClick={resetFilters} className="text-xs text-blue-700 underline-offset-2 hover:underline">清除筛选</button>}
            <span className="ml-auto text-xs text-slate-500">共 {total} 条{listLoading ? ' · 加载中…' : ''}</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] table-fixed text-xs">
              <colgroup><col className="w-[20%]" /><col className="w-[13%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[13%]" /><col className="w-[18%]" /></colgroup>
              <thead className="bg-slate-50 text-left text-slate-500"><tr>{['申请单号', '邮件状态', 'PN', '发生环节', '明细数', '创建人', '创建时间'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>{applications.map(item => {
                const meta = statusMeta(item.email.status);
                return <tr key={item.applicationId} className="group border-t border-slate-100 hover:bg-blue-50/60">
                  <td className="px-3 py-2"><button type="button" onClick={() => setDetailsApplication(item)} title="点击查看申请单明细" className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900">{item.applicationId}</button></td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${meta.badge}`}><span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} />{meta.label}</span></td>
                  <td className="truncate px-3 py-2 text-slate-700" title={item.pn}>{show(item.pn)}</td>
                  <td className="truncate px-3 py-2" title={item.stages.join('、')}>{item.stages.join('、')}</td>
                  <td className="px-3 py-2 tabular-nums">{item.repairFaults.length + item.doaChanges.length}</td>
                  <td className="truncate px-3 py-2" title={item.createdByName || item.createdBy}>{show(item.createdByName || item.createdBy)}</td>
                  <td className="truncate px-3 py-2 text-slate-500" title={item.createdAt}>{show(item.createdAt)}</td>
                </tr>;
              })}</tbody>
            </table>
            {applications.length === 0 && <div className="flex flex-col items-center justify-center gap-2 py-10">
              <Inbox className="size-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">{hasListFilter ? '没有符合条件的申请单' : '还没有申请单'}</p>
              <p className="text-xs text-slate-400">{hasListFilter ? '调整筛选条件或清除筛选后重试' : '在「发起申请单」中提交后，记录会出现在这里'}</p>
              {hasListFilter ? <button type="button" onClick={resetFilters} className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">清除筛选</button> : <button type="button" onClick={() => setTab('create')} className="mt-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">去发起申请单</button>}
            </div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2">
            <span className="text-xs text-slate-500">每页 {PAGE_SIZE} 条 · 共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage(value => Math.max(1, value - 1))} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft className="size-3.5" />上一页</button>
              <span className="text-xs text-slate-600">第 {page} / {totalPages} 页</span>
              <button type="button" disabled={page >= totalPages || listLoading} onClick={() => setPage(value => value + 1)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">下一页<ChevronRight className="size-3.5" /></button>
            </div>
          </div>
        </section>}
        {detailsApplication && <ApplicationDetailsDialog application={detailsApplication} onClose={() => setDetailsApplication(null)} />}
      </div>
    </main>
  );
}
