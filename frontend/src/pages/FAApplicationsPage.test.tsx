// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { faApplicationsApi } from '../api/faApplicationsApi';
import type { FAPreview, FARepairFault, FADOAChange } from '../types/faApplications';
import FAApplicationsPage from './FAApplicationsPage';

vi.mock('../api/faApplicationsApi', () => ({
  faApplicationsApi: { list: vi.fn(), listEmployees: vi.fn(), preview: vi.fn(), submit: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('previews the selected fault records alongside the editable email body', async () => {
  const repair = (sourceId: string, sn: string): FARepairFault => ({
    sourceId, sn, base: '', productionOrder: '', model: '', station: '', ngTime: '',
    faultDimension3: '', faultDimension2: '', repairDimension3: '', materialNumber: '',
    nonCriticalMaterialNumber: '', materialDescription: '', serialNumber: 'PART-1', originalFactoryCode: '',
  });
  const doa: FADOAChange = { sourceId: 'd1', pn: 'PN-1', sn: 'DOA-SN', spareName: '', originalCode: 'ORIGINAL-1', reportedDevice: '', operationTime: '' };
  const preview: FAPreview = {
    pn: 'PN-1', materialDescription: '电源 <模块>',
    repair: { issuedQuantity: 2, faultCount: 2, faultRate: 100 },
    doa: { issuedQuantity: 1, faultCount: 1, faultRate: 100 },
    repairFaults: [repair('r1', 'SELECTED-SN'), repair('r2', 'UNSELECTED-SN')],
    doaChanges: [doa],
  };
  vi.mocked(faApplicationsApi.list).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  vi.mocked(faApplicationsApi.listEmployees).mockResolvedValue({ items: [] });
  vi.mocked(faApplicationsApi.preview).mockResolvedValue(preview);
  render(<MemoryRouter><FAApplicationsPage /></MemoryRouter>);

  fireEvent.change(screen.getByPlaceholderText('输入物料号'), { target: { value: 'PN-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查询并继续' }));
  await screen.findByLabelText('选择 r2');
  fireEvent.click(screen.getByLabelText('选择 r2'));
  fireEvent.click(screen.getByRole('button', { name: '确认明细并继续' }));
  fireEvent.change(screen.getByPlaceholderText('输入邮件正文，可使用换行分段'), { target: { value: '正文 <测试>' } });

  await waitFor(() => {
    const html = (screen.getByTitle('FA 邮件效果预览') as HTMLIFrameElement).srcdoc;
    expect(html).toContain('正文 &lt;测试&gt;');
    expect(html).toContain('电源 &lt;模块&gt;');
    expect(html).toContain('SELECTED-SN');
    expect(html).toContain('PART-1');
    expect(html).toContain('DOA-SN');
    expect(html).toContain('ORIGINAL-1');
    expect(html).not.toContain('UNSELECTED-SN');
  });
});
