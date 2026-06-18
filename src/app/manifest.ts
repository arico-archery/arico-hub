import type { MetadataRoute } from 'next'

// PWA 매니페스트 — 폰/태블릿 "홈 화면에 추가" 시 앱처럼 사용. 카메라는 HTTPS(Vercel) 필요.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ARICO Distribution Hub',
    short_name: 'ARICO Hub',
    description: 'ARICO 양궁장비 유통 통합 관리',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#2f7d55',
    icons: [
      { src: '/arico-mark.png', sizes: '202x202', type: 'image/png', purpose: 'any' },
      { src: '/arico-mark.png', sizes: '202x202', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
