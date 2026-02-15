export default function EmptyState({
  icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-5xl mb-4 opacity-60">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-300 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-xs mb-4">{description}</p>
      {action && onAction && (
        <button
          onClick={onAction}
          className="px-4 py-2 bg-accent/20 text-accent hover:bg-accent/30 rounded-lg text-sm font-medium transition-all hover:scale-105 active:scale-95"
        >
          {action}
        </button>
      )}
    </div>
  );
}
