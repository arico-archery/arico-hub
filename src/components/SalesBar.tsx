// 매출 막대 — 길이 = 매출, 그 안에서 회색 = 원가 / 초록 = 순이익.
//
// 왜 이렇게 하나: 예전에는 막대가 매출만 나타내고 이익·마진율은 옆에 글자로만 있었다.
// 게다가 화면마다 막대의 뜻이 달랐다(월별=매출, 공급사별=마진율). 그래서 무엇을 뜻하는지
// 읽히지 않았다. 이제 막대 하나로 세 가지가 한눈에 보인다.
//   · 다른 줄과 길이를 비교 → 매출 크기
//   · 초록 부분의 길이      → 순이익 크기
//   · 초록이 차지하는 비율  → 마진율
interface Props {
  sales: number
  cost: number
  max: number      // 같은 그룹에서 가장 큰 매출 (막대 길이의 기준)
  height?: string  // tailwind h-* (기본 h-5)
}

export default function SalesBar({ sales, cost, max, height = 'h-5' }: Props) {
  const width = max > 0 ? Math.max(0, (sales / max) * 100) : 0
  const profit = Math.max(0, sales - cost)
  const profitPct = sales > 0 ? Math.min(100, (profit / sales) * 100) : 0

  return (
    <div className={`${height} w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden`}>
      <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${width}%` }}>
        {/* 원가 */}
        <div className="h-full bg-slate-300 dark:bg-slate-500 transition-all" style={{ width: `${100 - profitPct}%` }} />
        {/* 순이익 */}
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${profitPct}%` }} />
      </div>
    </div>
  )
}

// 막대가 무엇을 뜻하는지 알려주는 범례 — 그래프마다 한 줄씩 둔다.
export function SalesBarLegend({ costLabel, profitLabel }: { costLabel: string; profitLabel: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 dark:bg-slate-500" />{costLabel}
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />{profitLabel}
      </span>
    </div>
  )
}
