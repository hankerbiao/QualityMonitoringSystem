export type OperationsDays = 7 | 30 | 90;

export interface OperationsSummary {
  activeUsers: number;
  currentOnline: number;
  totalUsers: number;
  visits: number;
  pageViews: number;
  apiRequests: number;
  successRate: number;
  avgResponseMs: number;
  changes: {
    activeUsers: number | null;
    visits: number | null;
    pageViews: number | null;
    successRate: number | null;
  };
}

export interface OperationsTrendItem {
  date: string;
  label: string;
  activeUsers: number;
  visits: number;
  pageViews: number;
  apiRequests: number;
}

export interface OperationsModuleItem {
  key: string;
  name: string;
  pageViews: number;
  apiRequests: number;
  activeUsers: number;
  share: number;
}

export interface OperationsActivityItem {
  id: string;
  itcode: string;
  displayName: string;
  action: string;
  module: string;
  timestamp: string;
  status: 'success';
}

export interface OperationsSyncDataSource {
  key: string;
  name: string;
  collection: string;
  lastSyncedAt: string | null;
  latestDataAt: string | null;
}

export interface OperationsDashboard {
  period: {
    days: number;
    start: string;
    end: string;
    generatedAt: string;
  };
  summary: OperationsSummary;
  trend: OperationsTrendItem[];
  modules: OperationsModuleItem[];
  health: {
    status: 'healthy' | 'degraded';
    database: 'healthy' | 'degraded';
    errorRequests: number;
    lastEventAt: string | null;
  };
  syncDataSources: OperationsSyncDataSource[];
  recentActivity: OperationsActivityItem[];
  activityTotal: number;
}
