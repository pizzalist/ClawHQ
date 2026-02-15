export function SkeletonLine({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} rounded bg-gray-700/40 animate-pulse`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-surface rounded-lg p-3 border border-gray-700/30 space-y-2 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-700/40" />
        <div className="flex-1 space-y-1.5">
          <SkeletonLine w="w-24" />
          <SkeletonLine w="w-16" h="h-2" />
        </div>
        <div className="w-2.5 h-2.5 rounded-full bg-gray-700/40" />
      </div>
      <div className="flex justify-between">
        <SkeletonLine w="w-14" h="h-4" />
        <SkeletonLine w="w-20" h="h-2" />
      </div>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="p-2 space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="grid grid-cols-5 gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface rounded-xl p-4 border border-gray-700/30 space-y-3">
            <SkeletonLine w="w-20" h="h-2" />
            <SkeletonLine w="w-12" h="h-7" />
          </div>
        ))}
      </div>
      <div className="bg-surface rounded-xl p-4 border border-gray-700/30 space-y-4">
        <SkeletonLine w="w-32" h="h-4" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-gray-700/40" />
            <SkeletonLine w="w-24" />
            <div className="flex-1 h-5 rounded-full bg-gray-700/30" />
            <SkeletonLine w="w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
