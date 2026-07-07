import DetailModal from './DetailModal';
import type { DetailColumn } from './DetailModal';
import { DefectDetail } from '../types';
import { rtyApi } from '../api/rtyApi';

interface DefectModalProps {
  recordId: string;
  onClose: () => void;
}

const columns: DetailColumn<DefectDetail>[] = [
  { key: 'defectCode', label: '故障代码', render: (item) => <span className="font-mono text-xs">{item.defectCode}</span> },
  { key: 'description', label: '故障描述', render: (item) => item.description },
  { key: 'count', label: '数量', render: (item) => <span className="text-right font-medium text-[#dc2626]">{item.count}</span> },
];

export default function DefectModal({ recordId, onClose }: DefectModalProps) {
  return (
    <DetailModal
      title="故障数量明细"
      recordId={recordId}
      columns={columns}
      fetchData={(id) => rtyApi.getDefectDetails(id)}
      onClose={onClose}
    />
  );
}
