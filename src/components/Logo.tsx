// ARICO ARCHERY GROUP 로고 — 실제 자사몰 로고 이미지(PNG) 사용
//  - AricoMark: 마크(아이콘)만 — /arico-mark.png
//  - Logo: 마크 + ARICO 워드마크 전체 — /arico-logo.png
// color="#ffffff" 등 흰색이 필요한 곳(인쇄 문서 헤더)은 CSS 필터로 단색화한다.

export const ARICO_GREEN = '#2f7d55'

const LOGO_RATIO = 924 / 202 // 트림된 전체 로고 가로:세로 비율

function isWhite(c: string) {
  const v = c.trim().toLowerCase()
  return v === '#fff' || v === '#ffffff' || v === 'white'
}

type Props = {
  size?: number
  withText?: boolean
  subtitle?: boolean
  color?: string
  className?: string
}

export function AricoMark({ size = 28, color = ARICO_GREEN, className = '' }: { size?: number; color?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/arico-mark.png"
      alt="ARICO"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        ...(isWhite(color) ? { filter: 'brightness(0) invert(1)' } : {}),
      }}
    />
  )
}

export default function Logo({ size = 28, color = ARICO_GREEN, className = '' }: Props) {
  const h = size
  const w = Math.round(h * LOGO_RATIO)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/arico-logo.png"
      alt="ARICO ARCHERY GROUP"
      width={w}
      height={h}
      className={className}
      style={{
        height: h,
        width: 'auto',
        maxWidth: '100%',
        objectFit: 'contain',
        display: 'block',
        ...(isWhite(color) ? { filter: 'brightness(0) invert(1)' } : {}),
      }}
    />
  )
}
