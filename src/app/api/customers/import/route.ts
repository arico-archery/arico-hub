import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export const maxDuration = 60   // Pro면 60초까지(Hobby는 10초 상한). 대량은 클라이언트가 청크로 분할 호출.

type Row = Record<string, string>

// 헤더에서 메이크샵 주석 제거: "お名前  必須入力" → "お名前" (2칸 이상 공백 뒤는 주석)
function cleanHeader(h: string): string {
  return h.replace(/^﻿/, '').replace(/"/g, '').split(/\s{2,}/)[0].trim()
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  out.push(cur.trim()); return out
}
function parseCSV(text: string): Row[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(cleanHeader)
  return lines.slice(1).map(l => { const v = parseCsvLine(l); return Object.fromEntries(headers.map((h, i) => [h, v[i] ?? ''])) })
}
function parseExcel(buf: ArrayBuffer): Row[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  return raw.map(r => { const e: Row = {}; for (const [k, v] of Object.entries(r)) e[cleanHeader(String(k))] = String(v ?? '').trim(); return e })
}

// CSV 인코딩 자동 판별: UTF-8 시도 → 깨지면(치환문자) Shift-JIS (메이크샵 회원 내보내기)
function decodeCsv(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  if (!utf8.includes('�')) return utf8
  try { return new TextDecoder('shift-jis').decode(buf) } catch { return utf8 }
}

// 컬럼명 후보(한/일/영) 매칭
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()（）]/g, '')
function pick(row: Row, keys: string[]): string {
  for (const k of keys) { const hit = Object.keys(row).find(rk => norm(rk) === norm(k)); if (hit && row[hit]) return String(row[hit]).trim() }
  return ''
}
// 주소 조각 결합(都道府県 + 市区町村 + それ以降). 중복 접두는 제거.
function joinAddr(parts: string[]): string {
  const acc: string[] = []
  for (const raw of parts) {
    const p = (raw || '').trim()
    if (!p) continue
    if (acc.length) {
      if (acc.join(' ').includes(p)) continue                 // 이미 포함된 조각 스킵
      if (p.startsWith(acc[acc.length - 1])) { acc[acc.length - 1] = p; continue } // 직전 조각을 포함하면 교체
    }
    acc.push(p)
  }
  return acc.join(' ')
}
function mapType(v: string): string {
  const s = norm(v)
  if (['기업', '법인', 'corporation', 'corp', '会社', '法人'].some(x => norm(x) === s)) return 'corporation'
  if (['기관', 'institution', '機関', '団体', '학교'].some(x => norm(x) === s)) return 'institution'
  return 'individual'
}

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const buf = await file.arrayBuffer()
  const rows = /\.xlsx?$/.test(file.name.toLowerCase()) ? parseExcel(buf) : parseCSV(decodeCsv(buf))
  if (rows.length === 0) return NextResponse.json({ error: 'no data' }, { status: 400 })

  // 대량 파일은 클라이언트가 offset/limit로 나눠 호출 → 각 요청은 slice만 처리(타임아웃 회피)
  const url = new URL(req.url)
  const total = rows.length
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || total))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const slice = rows.slice(offset, offset + limit)

  // 기존 거래처: 会員ID(externalMemberId) / 이메일 / 전화로 매칭 → 있으면 갱신, 없으면 생성
  const existing = await prisma.customer.findMany({ select: { id: true, email: true, phone: true, externalMemberId: true } })
  const byExt = new Map(existing.filter(c => c.externalMemberId).map(c => [c.externalMemberId, c.id]))
  const byEmail = new Map(existing.filter(c => c.email).map(c => [c.email, c.id]))
  const byPhone = new Map(existing.filter(c => c.phone).map(c => [c.phone, c.id]))

  const last = await prisma.customer.findFirst({ where: { code: { startsWith: 'C' } }, orderBy: { code: 'desc' }, select: { code: true } })
  let seq = last ? (parseInt(last.code.slice(1), 10) || 0) : 0

  let skipped = 0
  const errors: string[] = []
  // 왕복 최소화: 생성은 createMany 일괄, 갱신은 병렬 처리(크로스리전 지연 완화)
  const creates: Record<string, unknown>[] = []
  const updates: { id: number; data: Record<string, unknown> }[] = []
  const resEmail = new Set<string>(), resPhone = new Set<string>(), resExt = new Set<string>()  // 청크 내 중복 예약

  for (const row of slice) {
    const name = pick(row, ['이름', 'name', '名前', '氏名', '고객명', '顧客名', 'お名前', '会員名'])
    if (!name) { skipped++; continue }
    const nameKana = pick(row, ['카타카나', '후리가나', 'namekana', 'kana', 'furigana', 'フリガナ', 'ふりがな', 'カナ', 'お名前（フリガナ）', '会員名（フリガナ）'])
    const email = pick(row, ['이메일', 'email', 'メール', 'e-mail', 'メールアドレス'])
    const phone = pick(row, ['전화', '전화번호', 'phone', 'tel', '電話', '電話番号'])
    const postalCode = pick(row, ['우편번호', 'postalcode', 'zip', '郵便番号'])
    // 주소: 都道府県 + 市区町村 + それ以降の住所 결합(상세주소 포함). 없으면 단일 주소 컬럼.
    const prefecture = pick(row, ['都道府県', '도도부현'])
    const city = pick(row, ['市区町村', '시구정촌'])
    const rest = pick(row, ['それ以降の住所', '以降の住所', '상세주소', '번지'])
    let address = joinAddr([prefecture, city, rest])
    if (!address) address = pick(row, ['주소', 'address', '住所'])
    const company = pick(row, ['회사', '회사/단체', 'company', '会社', '団体', '소속', '所属先', '所属'])
    const memo = pick(row, ['메모', 'memo', 'note', '備考', '会員情報メモ', '会員メモ'])
    const extId = pick(row, ['会員ID', 'memberid', '회원id', '회원번호'])
    const typeRaw = pick(row, ['구분', 'type', '区分'])
    const taxRegNo = pick(row, ['등록번호', 'taxregno', 'regno', '登録番号', '사업자번호', '法人番号'])
    const legalName = pick(row, ['정식상호', 'legalname', '正式名称'])
    const billingAddress = pick(row, ['청구지', '청구지주소', 'billingaddress', '請求先住所'])
    const contactPerson = pick(row, ['담당자', 'contact', 'contactperson', '担当', '担当者'])

    // 값이 있는 필드만 반영(빈 값으로 기존 데이터 덮어쓰지 않음)
    const data: Record<string, unknown> = { name }
    if (nameKana) data.nameKana = nameKana
    if (email) data.email = email
    if (phone) data.phone = phone
    if (postalCode) data.postalCode = postalCode
    if (address) data.address = address
    if (company) data.company = company
    if (memo) data.memo = memo
    if (extId) data.externalMemberId = extId
    if (typeRaw) data.customerType = mapType(typeRaw)
    if (taxRegNo) data.taxRegNo = taxRegNo
    if (legalName) data.legalName = legalName
    if (billingAddress) data.billingAddress = billingAddress
    if (contactPerson) data.contactPerson = contactPerson

    const existId = (extId && byExt.get(extId)) || (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || null
    if (existId) {
      updates.push({ id: existId, data })
    } else if ((extId && resExt.has(extId)) || (email && resEmail.has(email)) || (phone && resPhone.has(phone))) {
      skipped++   // 같은 파일 내 중복(이미 생성 예약됨) → 스킵
    } else {
      seq += 1
      // createMany는 균일한 키 셋이 안전 → 전체 컬럼을 기본값과 함께 채운다
      creates.push({
        code: `C${String(seq).padStart(3, '0')}`, name,
        nameKana: nameKana || '', company: company || '', email: email || '', phone: phone || '',
        address: address || '', postalCode: postalCode || '', memo: memo || '',
        customerType: typeRaw ? mapType(typeRaw) : 'individual',
        taxRegNo: taxRegNo || '', legalName: legalName || '', billingAddress: billingAddress || '',
        contactPerson: contactPerson || '', externalMemberId: extId || '',
      })
      if (extId) resExt.add(extId)
      if (email) resEmail.add(email)
      if (phone) resPhone.add(phone)
    }
  }

  let imported = 0, updated = 0
  try {
    if (creates.length) {
      await prisma.customer.createMany({ data: creates as NonNullable<Parameters<typeof prisma.customer.createMany>[0]>['data'] })
      imported = creates.length
    }
    // 갱신은 10개씩 병렬
    const CONC = 10
    for (let i = 0; i < updates.length; i += CONC) {
      const batch = updates.slice(i, i + CONC)
      const res = await Promise.allSettled(batch.map(u => prisma.customer.update({ where: { id: u.id }, data: u.data as Parameters<typeof prisma.customer.update>[0]['data'] })))
      for (const r of res) { if (r.status === 'fulfilled') updated++; else errors.push(String(r.reason)) }
    }
  } catch (e) {
    return NextResponse.json({ error: 'db_error', detail: String(e), imported, updated, skipped }, { status: 500 })
  }

  const nextOffset = offset + slice.length
  return NextResponse.json({ imported, updated, skipped, errors: errors.length, total, nextOffset, done: nextOffset >= total, errorDetails: errors.slice(0, 5) })
}
