import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/translate
// body: { text: string, from: string, to: string }
// from/to: 'ja' | 'ko' | 'en'
export async function POST(req: Request) {
  const { text, from, to } = await req.json() as { text: string; from: string; to: string }

  if (!text?.trim()) return NextResponse.json({ translated: '' })
  if (from === to) return NextResponse.json({ translated: text })

  const trimmed = text.trim()

  // 설정에서 API 키 조회
  let deeplKey = ''
  let papagoId = ''
  let papagoSecret = ''
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ['deepl_api_key', 'papago_client_id', 'papago_client_secret'] } },
      select: { key: true, value: true },
    })
    const settingMap = Object.fromEntries(settings.map(s => [s.key, s.value]))
    deeplKey = settingMap['deepl_api_key'] ?? ''
    papagoId = settingMap['papago_client_id'] ?? ''
    papagoSecret = settingMap['papago_client_secret'] ?? ''
  } catch { /* 무시 */ }

  // ── 1순위: DeepL ─────────────────────────────────────────────────────────
  if (deeplKey) {
    try {
      const langMap: Record<string, string> = { ja: 'JA', ko: 'KO', en: 'EN' }
      const res = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          auth_key: deeplKey,
          text: trimmed,
          source_lang: langMap[from] ?? from.toUpperCase(),
          target_lang: langMap[to] ?? to.toUpperCase(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json({ translated: data.translations?.[0]?.text ?? '', provider: 'DeepL' })
      }
    } catch { /* fallthrough */ }
  }

  // ── 2순위: Papago (Naver) - ja↔ko 특화 ──────────────────────────────────
  if (papagoId && papagoSecret && (from === 'ja' || to === 'ja') && (from === 'ko' || to === 'ko')) {
    try {
      const res = await fetch('https://openapi.naver.com/v1/papago/n2mt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Naver-Client-Id': papagoId,
          'X-Naver-Client-Secret': papagoSecret,
        },
        body: new URLSearchParams({ source: from, target: to, text: trimmed }),
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json({ translated: data.message?.result?.translatedText ?? '', provider: 'Papago' })
      }
    } catch { /* fallthrough */ }
  }

  // ── 3순위: MyMemory (무료, 키 불필요) ────────────────────────────────────
  try {
    const langpair = `${from}|${to}`
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${langpair}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = await res.json()
      if (data.responseStatus === 200) {
        return NextResponse.json({ translated: data.responseData.translatedText, provider: 'MyMemory' })
      }
    }
  } catch { /* fallthrough */ }

  return NextResponse.json({ error: '번역 서비스에 연결할 수 없습니다' }, { status: 503 })
}
