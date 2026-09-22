export interface UserProfile {
  itcode: string;
  username?: string;
  role?: 'admin' | 'user';
  isActive?: boolean;
  dashboardPermissions?: string[];
  name?: string;
  姓名?: string;
  真实姓名?: string;
  部门?: string;
  department?: string;
  邮件?: string;
  email?: string;
}

export interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isAuthLoaded: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}
