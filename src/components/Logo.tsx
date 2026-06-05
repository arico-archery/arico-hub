// ARICO ARCHERY GROUP 로고 — 회전 핀휠 아이콘 + 워드마크 (SVG 재현)
// color 로 아이콘/글자 색을 함께 지정 (다크 헤더에서는 흰색 등)

type Props = {
  size?: number          // 아이콘 px
  withText?: boolean     // ARICO 워드마크 표시
  subtitle?: boolean     // ARCHERY GROUP 부제 표시
  color?: string         // 브랜드 색 (기본 ARICO 그린)
  className?: string
}

export const ARICO_GREEN = '#2f7d55'

export function AricoMark({ size = 28, color = ARICO_GREEN, className = '' }: { size?: number; color?: string; className?: string }) {
  // 중심(50,50) 기준 3개 블레이드를 120°씩 회전 → 회전 핀휠(중앙 열림)
  // 베이스가 중심에서 약간 떨어져(≈8px) 중앙에 빈 공간을 남기고, 한쪽으로 휘어 회전감
  const blade = 'M50 42 C35 39 35 18 52 8 C63 21 60 37 50 42 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label="ARICO" role="img">
      <g fill={color}>
        <path d={blade} transform="rotate(0 50 50)" />
        <path d={blade} transform="rotate(120 50 50)" />
        <path d={blade} transform="rotate(240 50 50)" />
      </g>
    </svg>
  )
}

export default function Logo({ size = 28, withText = true, subtitle = true, color = ARICO_GREEN, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <AricoMark size={size} color={color} />
      {withText && (
        <div className="leading-none">
          <div
            className="font-extrabold tracking-tight"
            style={{ color, fontSize: size * 0.62, lineHeight: 1 }}
          >ARICO</div>
          {subtitle && (
            <div
              className="font-semibold"
              style={{ color, fontSize: size * 0.2, letterSpacing: '0.22em', marginTop: size * 0.07 }}
            >ARCHERY GROUP</div>
          )}
        </div>
      )}
    </div>
  )
}
