import DetailModal from './DetailModal';
import type { DetailColumn } from './DetailModal';
import { InputDetail } from '../types';
import { rtyApi } from '../api/rtyApi';

interface InputModalProps {
  recordId: string;
  onClose: () => void;
}

const columns: DetailColumn<InputDetail>[] = [
  { key: 'workOrder', label: '工单号', render: (item) => <span className="font-mono text-xs">{item.workOrder}</span> },
  { key: 'productLine', label: '产线', render: (item) => item.productLine },
  { key: 'count', label: '数量', render: (item) => <span className="text-right font-medium text-[#2563eb]">{item.count}</span> },
];

export default function InputModal({ recordId, onClose }: InputModalProps) {
  return (
    <DetailModal
      title="投入数量明细"
      recordId={recordId}
      columns={columns}
      fetchData={(id) => rtyApi.getInputDetails(id)}
      onClose={onClose}
    />
  );
}
