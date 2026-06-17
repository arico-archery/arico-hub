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
  // 자사몰 로고 재현: 두툼한 둥근 호 3개가 120°씩 휘감겨 원형 핀휠을 이룸(중앙 작은 구멍)
  const arc = 'M52.44 22.11 A28 28 0 0 1 74.25 36.00'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label="ARICO" role="img">
      <g fill="none" stroke={color} strokeWidth={22} strokeLinecap="round">
        <path d={arc} transform="rotate(0 50 50)" />
        <path d={arc} transform="rotate(120 50 50)" />
        <path d={arc} transform="rotate(240 50 50)" />
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
