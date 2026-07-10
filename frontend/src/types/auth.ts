export interface UserProfile {
  itcode: string;
  [key: string]: string | undefined;
}

export interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isAuthLoaded: boolean;
  logout: () => void;
}