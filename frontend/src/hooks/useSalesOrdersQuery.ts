import { useCallback, useEffect, useState } from 'react';
import { salesOrdersApi } from '../api/salesOrdersApi';
import type { SalesOrderFilterParams, SalesOrdersQueryResponse } from '../types/salesOrders';

export function useSalesOrdersQuery(filters: SalesOrderFilterParams, page: number, pageSize: number) {
  const [data, setData] = useState<SalesOrdersQueryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await salesOrdersApi.query(filters, page, pageSize));
    } catch (err) {
      setError(err instanceof Error ? err.message : '销售订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void query();
  }, [query]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await salesOrdersApi.query(filters, page, pageSize));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  }, [filters, page, pageSize]);

  return { data, loading, refreshing, error, refresh };
}
