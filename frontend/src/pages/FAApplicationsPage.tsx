import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, ClipboardCheck, Mail, RefreshCw, Search, Send, X } from 'lucide-react';
import { faApplicationsApi, type FACreateRequest } from '../api/faApplicationsApi';
import type { FAApplication, FADOAChange, FARepairFault, FAStage, FAPreviewRequest } from '../types/faApplications';
import { DateRangePicker } from '../components/shared/DateRangePicker';

const today = new Date().toISOString().slice(0, 10);
const VENDOR_STORAGE_KEY = 'fa-vendor-by-pn-v1';

function savedVendor(pn: string): string {
  try {
    const vendors: unknown = JSON.parse(localStorage.getItem(VENDOR_STORAGE_KEY) || '{}');
    return vendors && typeof vendors === 'object' && !Array.isArray(vendors)
      ? String((vendors as Record<string, unknown>)[pn.trim()] ?? '')
      : '';
  } catch {
    return '';
  }
}

function saveVendor(pn: string, vendor: string) {
  const key = pn.trim();
  if (!key) return;
  try {
    const current = JSON.parse(localStorage.getItem(VENDOR_STORAGE_KEY) || '{}');
    const vendors = current && typeof current === 'object' && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {};
    if (vendor.trim()) vendors[key] = vendor.trim();
    else delete vendors[key];
    localStorage.setItem(VENDOR_STORAGE_KEY, JSON.stringify(vendors));
  } catch {
    // Keep the form usable when browser storage is unavailable.
  }
}

const initialForm: FAPreviewRequest = {
  pn: '',
  vendor: '',
  faultDescription: '',
  stages: ['产测', 'DOA'],
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

function emailPreviewHtml(subject: string, content: string) {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
  const safeSubject = escapeHtml(subject.trim() || 'FA 质量反馈通知');
  const safeContent = escapeHtml(content).replace(/\r\n|\r|\n/g, '<br>') || '<span style="color:#94a3b8;">（未填写正文）</span>';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef3f8;padding:20px 10px;"><tr><td align="center"><table role="presentation" width="800" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:800px;background:#fff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden;"><tr><td style="height:5px;background:#2563eb;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:22px 28px 18px;border-bottom:1px solid #e8eef5;"><p style="margin:0 0 7px;color:#2563eb;font-size:11px;font-weight:700;letter-spacing:1px;">QUALIBOARD · FA</p><h1 style="margin:0;font-size:21px;line-height:1.45;color:#0f172a;font-weight:700;">${safeSubject}</h1><p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.6;">FA 质量反馈与申请信息</p></td></tr><tr><td style="padding:24px 28px 26px;"><p style="margin:0 0 12px;color:#475569;font-size:13px;font-weight:600;">邮件正文</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #3b82f6;border-radius:6px;"><tr><td style="padding:18px 20px;color:#334155;font-size:14px;line-height:1.85;word-break:break-word;">${safeContent}</td></tr></table></td></tr><tr><td style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.6;">本邮件由 QualiBoard FA 看板发送，请勿直接回复系统邮箱。</td></tr></table></td></tr></table></body></html>`;
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

function RepairTable({ rows, selected, toggle, toggleAll, disabled = false }: { rows: FARepairFault[]; selected: Set<string>; toggle: (id: string) => void; toggleAll: () => void; disabled?: boolean }) {
  return <div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[1450px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="sticky left-0 bg-slate-50 px-2 py-2"><input type="checkbox" disabled={disabled} checked={rows.length > 0 && rows.every(row => selected.has(row.sourceId))} onChange={toggleAll} aria-label="全选产测故障" /></th>{['基地', '生产订单', '机型', 'SN', '工站', 'NG时间', '不良维度3', '不良维度2', '维修维度3', '物料号', '物料描述', '序列号', '替换前原厂码'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.sourceId} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="sticky left-0 bg-white px-2 py-2"><input type="checkbox" disabled={disabled} checked={selected.has(row.sourceId)} onChange={() => toggle(row.sourceId)} aria-label={`选择 ${row.sourceId}`} /></td><td className="px-2 py-2">{show(row.base)}</td><td className="px-2 py-2">{show(row.productionOrder)}</td><td className="px-2 py-2">{show(row.model)}</td><td className="px-2 py-2">{show(row.sn)}</td><td className="px-2 py-2">{show(row.station)}</td><td className="px-2 py-2">{show(row.ngTime)}</td><td className="px-2 py-2">{show(row.faultDimension3)}</td><td className="px-2 py-2">{show(row.faultDimension2)}</td><td className="px-2 py-2">{show(row.repairDimension3)}</td><td className="px-2 py-2">{show(row.materialNumber)}{row.nonCriticalMaterialNumber && <div className="text-[10px] text-amber-700">非关键：{row.nonCriticalMaterialNumber}</div>}</td><td className="px-2 py-2">{show(row.materialDescription)}</td><td className="px-2 py-2">{show(row.serialNumber)}</td><td className="px-2 py-2">{show(row.originalFactoryCode)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-xs text-slate-400">暂无产测故障明细</p>}</div>;
}

function DoaTable({ rows, selected, toggle, toggleAll, disabled = false }: { rows: FADOAChange[]; selected: Set<string>; toggle: (id: string) => void; toggleAll: () => void; disabled?: boolean }) {
  return <div className="overflow-auto rounded-md border border-slate-200"><table className="min-w-[900px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-2"><input type="checkbox" disabled={disabled} checked={rows.length > 0 && rows.every(row => selected.has(row.sourceId))} onChange={toggleAll} aria-label="全选 DOA 明细" /></th>{['PN', 'SN', '备件名称', '原厂原码', '报修设备', '操作时间'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.sourceId} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="px-2 py-2"><input type="checkbox" disabled={disabled} checked={selected.has(row.sourceId)} onChange={() => toggle(row.sourceId)} aria-label={`选择 ${row.sourceId}`} /></td><td className="px-2 py-2">{show(row.pn)}</td><td className="px-2 py-2">{show(row.sn)}</td><td className="px-2 py-2">{show(row.spareName)}</td><td className="px-2 py-2">{show(row.originalCode)}</td><td className="px-2 py-2">{show(row.reportedDevice)}</td><td className="px-2 py-2">{show(row.operationTime)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-xs text-slate-400">暂无 DOA 换下明细</p>}</div>;
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

export default function FAApplicationsPage() {
  const [form, setForm] = useState<FAPreviewRequest>(initialForm);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof faApplicationsApi.preview>> | null>(null);
  const [applications, setApplications] = useState<FAApplication[]>([]);
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
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadList = () => void faApplicationsApi.list().then(result => setApplications(result.items)).catch(reason => setError(reason instanceof Error ? reason.message : '申请列表加载失败'));
  useEffect(() => { loadList(); }, []);
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
  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);
  const selectedCount = selectedRepair.size + selectedDoa.size;
  const stages = form.stages;
  const valid = Boolean(form.pn.trim() && stages.length && (!stages.includes('产测') || (form.repairDateFrom && form.repairDateTo)) && (!stages.includes('DOA') || (form.doaDateFrom && form.doaDateTo)));
  const mutateForm = (patch: Partial<FAPreviewRequest>) => {
    setForm(current => ({ ...current, ...patch }));
    setPreview(null);
    setSelectedRepair(new Set());
    setSelectedDoa(new Set());
  };
  const toggleStage = (stage: FAStage) => mutateForm({ stages: stages.includes(stage) ? stages.filter(item => item !== stage) : [...stages, stage] });
  const updatePn = (pn: string) => mutateForm({ pn, vendor: savedVendor(pn) });
  const updateVendor = (vendor: string) => {
    mutateForm({ vendor });
    saveVendor(form.pn, vendor);
  };
  const runPreview = async () => {
    if (!valid) return;
    setLoading(true); setError(''); setNotice('');
    setPreview(null); setSelectedRepair(new Set()); setSelectedDoa(new Set());
    try {
      const result = await faApplicationsApi.preview(form);
      setPreview(result);
      setSelectedRepair(new Set(result.repairFaults.map(row => row.sourceId)));
      setSelectedDoa(new Set(result.doaChanges.map(row => row.sourceId)));
      setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败'); } finally { setLoading(false); }
  };
  const toggle = (set: Set<string>, id: string, setter: (value: Set<string>) => void) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); setter(next); };
  const selectAll = (rows: Array<{ sourceId: string }>, selected: Set<string>, setter: (value: Set<string>) => void) => setter(rows.every(row => selected.has(row.sourceId)) ? new Set() : new Set(rows.map(row => row.sourceId)));
  const create = async () => {
    if (!preview || !selectedCount) return;
    setStep(3);
    setNotice('请确认收件人和邮件内容，点击发送后才会保存申请单');
  };
  const send = async () => {
    if (!preview || !emailTo.length) return;
    setLoading(true); setError('');
    const request: FACreateRequest = { ...form, selectedRepairIds: [...selectedRepair], selectedDoaIds: [...selectedDoa] };
    try { const result = await faApplicationsApi.submit({ application: request, email: { to: emailTo, cc: emailCc, subject, content } }); setNotice(`申请单 ${result.applicationId} 邮件已发送，并已记录到已发申请单`); setEmailTo([]); setEmailCc([]); setSubject(''); setContent(''); setStep(1); setPreview(null); setSelectedRepair(new Set()); setSelectedDoa(new Set()); loadList(); } catch (reason) { setError(reason instanceof Error ? reason.message : '邮件发送失败，申请单未保存'); } finally { setLoading(false); }
  };
  const summary = useMemo(() => preview ? [{ label: '物料描述', value: preview.materialDescription || '—' }, { label: '产测故障率', value: rate(preview.repair.faultRate) }, { label: 'DOA 故障率', value: rate(preview.doa.faultRate) }, { label: '已选明细', value: selectedCount.toLocaleString() }] : [], [preview, selectedCount]);
  const steps = [
    { number: 1, title: '查询数据', description: '填写 PN 和时间范围' },
    { number: 2, title: '选择明细', description: '核对并勾选故障记录' },
    { number: 3, title: '确认发送', description: '添加收件人并发送' },
  ] as const;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-800 md:p-6"><div className="mx-auto max-w-[1600px] space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><Link to="/" aria-label="返回首页" className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700"><ArrowLeft className="size-4" />返回首页</Link><div><div className="flex items-center gap-2"><div className="rounded-lg bg-blue-600 p-2 text-white"><ClipboardCheck className="size-5" /></div><div><h1 className="text-xl font-semibold text-slate-900">FA看板</h1><p className="text-xs text-slate-500">申请单提交</p></div></div></div></div><button type="button" onClick={loadList} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"><RefreshCw className="size-4" />刷新申请单</button></header>
    {(error || notice) && <div role="alert" className={`rounded-md border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}
    <section aria-label="申请单步骤" className="grid grid-cols-3 border-b border-slate-200 bg-white">
      {steps.map(item => <div key={item.number} aria-current={step === item.number ? 'step' : undefined} className={`border-b-2 px-3 py-3 md:px-5 ${step === item.number ? 'border-blue-600' : step > item.number ? 'border-emerald-500' : 'border-transparent'}`}>
        <div className="flex items-center gap-2"><span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step === item.number ? 'bg-blue-600 text-white' : step > item.number ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{step > item.number ? <Check className="size-3.5" /> : item.number}</span><span className={`text-sm font-semibold ${step === item.number ? 'text-blue-700' : 'text-slate-700'}`}>{item.title}</span></div>
        <p className="mt-1 hidden pl-8 text-xs text-slate-500 sm:block">{item.description}</p>
      </div>)}
    </section>
    {step === 1 && <section className="space-y-4 border-b border-slate-200 bg-white p-4 md:p-5">
      <div><h2 className="text-base font-semibold text-slate-900">设置查询条件</h2><p className="mt-1 text-sm text-slate-500">输入物料 PN 并选择需要查询的故障环节和时间范围。</p>{!employeesLoading && (employeesError ? <p role="status" className="mt-1 text-xs text-amber-700">员工邮箱目录加载失败，可继续填写查询条件，邮件步骤也可手动输入邮箱。{employeesError} <button type="button" onClick={() => void loadEmployees()} className="underline">重试</button></p> : <p role="status" className="mt-1 text-xs text-slate-500">5000 公司员工邮箱目录已加载，邮件收件人和抄送人将使用本地搜索。</p>)}</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-1 block text-xs font-semibold text-slate-600">物料号 PN <span className="text-red-600">*</span></span><input autoFocus value={form.pn} onChange={event => updatePn(event.target.value)} placeholder="输入物料号" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" /></label>
        <label><span className="mb-1 block text-xs font-semibold text-slate-600">厂商</span><input value={form.vendor} onChange={event => updateVendor(event.target.value)} placeholder="输入厂商" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" /></label>
        <fieldset><legend className="mb-1 block text-xs font-semibold text-slate-600">发生环节 <span className="text-red-600">*</span></legend><div className="flex h-10 items-center gap-5 rounded-md border border-slate-300 px-3 text-sm">{(['产测', 'DOA'] as FAStage[]).map(stage => <label key={stage} className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={stages.includes(stage)} onChange={() => toggleStage(stage)} />{stage}</label>)}</div></fieldset>
        <label className="xl:col-span-1"><span className="mb-1 block text-xs font-semibold text-slate-600">故障现象</span><input value={form.faultDescription} onChange={event => mutateForm({ faultDescription: event.target.value })} placeholder="选填" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" /></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {stages.includes('产测') && <DateRangePicker label="产测计划开始时间" from={form.repairDateFrom || ''} to={form.repairDateTo || ''} onChange={(repairDateFrom, repairDateTo) => mutateForm({ repairDateFrom, repairDateTo })} />}
        {stages.includes('DOA') && <DateRangePicker label="DOA 操作时间" from={form.doaDateFrom || ''} to={form.doaDateTo || ''} onChange={(doaDateFrom, doaDateTo) => mutateForm({ doaDateFrom, doaDateTo })} />}
      </div>
      <div className="flex justify-end border-t border-slate-200 pt-3"><button type="button" disabled={!valid || loading} onClick={runPreview} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Search className="size-4" />{loading ? '正在查询…' : '查询并继续'}</button></div>
    </section>}
    {step === 2 && preview && <section className="space-y-4 border-b border-slate-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-base font-semibold text-slate-900">核对并选择故障明细</h2><p className="mt-1 text-sm text-slate-500">{form.pn} · {form.vendor || '未填写厂商'} · {stages.join('、')}</p></div><button type="button" onClick={() => setStep(1)} className="rounded-md px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">修改查询条件</button></div>
      
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{summary.map(item => <div key={item.label} className="border-l-2 border-blue-500 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{item.label}</p><p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p></div>)}</div>
      {stages.includes('产测') && <div className="space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">产测故障 <span className="font-normal text-slate-500">{selectedRepair.size}/{preview.repairFaults.length} 条已选</span></h3><button type="button" onClick={() => selectAll(preview.repairFaults, selectedRepair, setSelectedRepair)} className="text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400">{preview.repairFaults.every(row => selectedRepair.has(row.sourceId)) ? '取消全选' : '全选'}</button></div><RepairTable rows={preview.repairFaults} selected={selectedRepair} toggle={id => toggle(selectedRepair, id, setSelectedRepair)} toggleAll={() => selectAll(preview.repairFaults, selectedRepair, setSelectedRepair)} /></div>}
      {stages.includes('DOA') && <div className="space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">DOA 换下明细 <span className="font-normal text-slate-500">{selectedDoa.size}/{preview.doaChanges.length} 条已选</span></h3><button type="button" onClick={() => selectAll(preview.doaChanges, selectedDoa, setSelectedDoa)} className="text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400">{preview.doaChanges.every(row => selectedDoa.has(row.sourceId)) ? '取消全选' : '全选'}</button></div><DoaTable rows={preview.doaChanges} selected={selectedDoa} toggle={id => toggle(selectedDoa, id, setSelectedDoa)} toggleAll={() => selectAll(preview.doaChanges, selectedDoa, setSelectedDoa)} /></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setStep(1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">上一步</button><button type="button" disabled={!selectedCount || loading} onClick={create} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Check className="size-4" />确认明细并继续</button></div>
    </section>}
    {step === 3 && <section className="space-y-4 border-b border-slate-200 bg-white p-4 md:p-5">
      <div><div className="flex items-center gap-2"><Mail className="size-5 text-blue-600" /><h2 className="text-base font-semibold text-slate-900">确认邮件并发送</h2></div><p className="mt-1 text-sm text-slate-500">邮件发送成功后才保存申请单 · 当前明细 {selectedCount} 条</p></div>
      <div className="grid gap-4 md:grid-cols-2"><MultiEmailInput label="收件人" values={emailTo} onChange={setEmailTo} employees={employees} /><MultiEmailInput label="抄送人" values={emailCc} onChange={setEmailCc} employees={employees} /></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">邮件主题</span><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="选填" className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">邮件正文</span><textarea value={content} onChange={event => setContent(event.target.value)} rows={14} placeholder="输入邮件正文，可使用换行分段" className="w-full resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
          <p className="text-xs text-slate-500">正文会按纯文本放入邮件模板，支持换行；模板样式由系统统一排版。</p>
        </div>
        <div className="min-w-0"><div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">邮件效果预览</span><span className="text-[11px] text-slate-400">模板自动适配邮件客户端</span></div><iframe title="FA 邮件效果预览" sandbox="" srcDoc={emailPreviewHtml(subject, content)} className="h-[560px] w-full rounded-md border border-slate-200 bg-slate-50" /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setStep(2)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">上一步</button><button type="button" disabled={!emailTo.length || loading} onClick={send} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="size-4" />{loading ? '发送中…' : `发送给 ${emailTo.length} 位收件人`}</button></div>
    </section>}
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">已发申请单</h2><p className="mt-1 text-xs text-slate-500">点击唯一 ID 查看申请明细和邮件发送内容</p></div><div className="overflow-auto"><table className="min-w-[1200px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['唯一 ID', 'PN', '厂商', '故障现象', '物料描述', '发生环节', '明细数', '创建人', '创建时间', '邮件状态'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr></thead><tbody>{applications.map(item => <tr key={item.applicationId} className="border-t border-slate-100"><td className="px-3 py-2"><button type="button" onClick={() => setDetailsApplication(item)} className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900">{item.applicationId}</button></td><td className="px-3 py-2">{show(item.pn)}</td><td className="px-3 py-2">{show(item.vendor)}</td><td className="max-w-xs truncate px-3 py-2" title={item.faultDescription}>{show(item.faultDescription)}</td><td className="px-3 py-2">{show(item.materialDescription)}</td><td className="px-3 py-2">{item.stages.join('、')}</td><td className="px-3 py-2">{item.repairFaults.length + item.doaChanges.length}</td><td className="px-3 py-2">{show(item.createdByName || item.createdBy)}</td><td className="px-3 py-2">{show(item.createdAt)}</td><td className="px-3 py-2"><span className={`rounded px-2 py-1 ${item.email.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : item.email.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{item.email.status === 'sent' ? '已发送' : item.email.status === 'failed' ? '发送失败' : '待发送'}</span></td></tr>)}</tbody></table>{applications.length === 0 && <p className="p-6 text-center text-xs text-slate-400">暂无申请单</p>}</div></section>
    {detailsApplication && <ApplicationDetailsDialog application={detailsApplication} onClose={() => setDetailsApplication(null)} />}
  </div></main>;
}
