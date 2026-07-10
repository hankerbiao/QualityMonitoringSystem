interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-4 h-4 border',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-2',
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`${sizeMap[size]} border-blue-600 border-t-transparent rounded-full animate-spin ${className}`} />
  );
}

export function LoadingPage() {
  return (
    <div className="flex justify-center items-center py-20">
      <LoadingSpinner size="lg" />
    </div>
  );
}