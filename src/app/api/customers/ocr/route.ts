import { NextResponse } from 'next/server'

// 명함 OCR — Claude 비전으로 명함 이미지에서 거래처 정보 구조화 추출.
// ⚠️ ANTHROPIC_API_KEY 환경변수 필요. 없으면 no_api_key 반환(UI에서 안내).
// 추출 후에는 반드시 사람이 확인 폼을 거쳐 저장한다(자동저장 금지).

const MODEL = 'claude-haiku-4-5-20251001' // OCR 추출에 충분·저렴. 정확도 필요 시 claude-sonnet-4-6

const PROMPT = `이 명함 이미지에서 정보를 추출해 JSON만 출력해. 설명·코드펜스 없이 순수 JSON object 하나만.
키: name(이름), company(회사/단체), customerType("individual"|"institution"|"corporation" — 회사명 있으면 corporation, 학교·협회·관공서면 institution, 개인이면 individual),
taxRegNo(적격청구서 등록번호 T+13자리 또는 法人番号, 없으면 ""), phone(전화/휴대폰), email, postalCode(우편번호 숫자), address(주소), contactPerson(담당자명, 보통 name과 동일), title(직책).
값이 없으면 빈 문자열. 일본어 명함이면 값은 원문 그대로 둘 것.`

type Extracted = {
  name: string; company: string; customerType: string; taxRegNo: string
  phone: string; email: string; postalCode: string; address: string; contactPerson: string; title: string
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_api_key' }, { status: 503 })

  const formData = await req.formData()
  const files = formData.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0) return NextResponse.json({ error: 'file required' }, { status: 400 })

  // 이미지 → base64 content 블록 (앞/뒤 여러 장 지원)
  const imageBlocks = await Promise.all(files.slice(0, 2).map(async (f) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: f.type || 'image/jpeg', data: Buffer.from(await f.arrayBuffer()).toString('base64') },
  })))

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: PROMPT }] }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const t = await res.text()
      return NextResponse.json({ error: 'ocr_failed', detail: t.slice(0, 200) }, { status: 502 })
    }
    const data = await res.json() as { content?: { type: string; text?: string }[] }
    const text = (data.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ error: 'parse_failed', raw: text.slice(0, 200) }, { status: 502 })
    const parsed = JSON.parse(m[0]) as Partial<Extracted>
    const out: Extracted = {
      name: parsed.name ?? '', company: parsed.company ?? '',
      customerType: ['individual', 'institution', 'corporation'].includes(parsed.customerType ?? '') ? parsed.customerType! : 'individual',
      taxRegNo: parsed.taxRegNo ?? '', phone: parsed.phone ?? '', email: parsed.email ?? '',
      postalCode: parsed.postalCode ?? '', address: parsed.address ?? '',
      contactPerson: parsed.contactPerson ?? '', title: parsed.title ?? '',
    }
    return NextResponse.json({ ok: true, fields: out })
  } catch (e) {
    return NextResponse.json({ error: 'ocr_error', detail: String(e) }, { status: 502 })
  }
}
