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
  // 자사몰 로고 재현: 콤마(머리는 둥글고 꼬리는 중심으로) 블레이드 4개 90° 스월
  const blade = 'M50 28 C 64 24 80 30 80 46 C 80 56 72 60 63 58 C 60 46 58 36 50 28 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label="ARICO" role="img">
      <g fill={color}>
        <path d={blade} transform="rotate(0 50 50)" />
        <path d={blade} transform="rotate(90 50 50)" />
        <path d={blade} transform="rotate(180 50 50)" />
        <path d={blade} transform="rotate(270 50 50)" />
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
