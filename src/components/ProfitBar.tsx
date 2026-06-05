import { cn } from '@/lib/utils'

interface Props {
  margin: number
  showLabel?: boolean
}

export default function ProfitBar({ margin, showLabel = true }: Props) {
  const clamped = Math.max(0, Math.min(100, margin))
  const color = margin >= 40 ? 'bg-green-500' : margin >= 25 ? 'bg-yellow-500' : 'bg-red-500'
  const text = margin >= 40 ? 'text-green-700 dark:text-green-400' : margin >= 25 ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${clamped}%` }} />
      </div>
      {showLabel && <span className={cn('text-xs font-semibold w-10 text-right tabular-nums', text)}>{margin.toFixed(1)}%</span>}
    </div>
  )
}
