import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

type Row = Record<string, string>

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
  const headers = parseCsvLine(lines[0].replace(/^﻿/, '')).map(h => h.replace(/"/g, '').trim())
  return lines.slice(1).map(l => { const v = parseCsvLine(l); return Object.fromEntries(headers.map((h, i) => [h, v[i] ?? ''])) })
}
function parseExcel(buf: ArrayBuffer): Row[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  return raw.map(r => { const e: Row = {}; for (const [k, v] of Object.entries(r)) e[String(k).trim()] = String(v ?? '').trim(); return e })
}

// 컬럼명 후보(한/일/영) 매칭
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()]/g, '')
function pick(row: Row, keys: string[]): string {
  for (const k of keys) { const hit = Object.keys(row).find(rk => norm(rk) === norm(k)); if (hit && row[hit]) return String(row[hit]).trim() }
  return ''
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

  const rows = file.name.toLowerCase().match(/\.xlsx?$/)
    ? parseExcel(await file.arrayBuffer())
    : parseCSV(await file.text())
  if (rows.length === 0) return NextResponse.json({ error: 'no data' }, { status: 400 })

  // 중복 판정용 기존 이메일/전화
  const existing = await prisma.customer.findMany({ select: { email: true, phone: true } })
  const emails = new Set(existing.map(c => c.email).filter(Boolean))
  const phones = new Set(existing.map(c => c.phone).filter(Boolean))

  // 코드 채번 시작값
  const last = await prisma.customer.findFirst({ where: { code: { startsWith: 'C' } }, orderBy: { code: 'desc' }, select: { code: true } })
  let seq = last ? (parseInt(last.code.slice(1), 10) || 0) : 0

  let imported = 0, skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const name = pick(row, ['이름', 'name', '名前', '氏名', '고객명', '顧客名'])
      if (!name) { skipped++; continue }
      const email = pick(row, ['이메일', 'email', 'メール', 'e-mail'])
      const phone = pick(row, ['전화', '전화번호', 'phone', 'tel', '電話', '電話番号'])
      if ((email && emails.has(email)) || (phone && phones.has(phone))) { skipped++; continue }

      seq += 1
      await prisma.customer.create({
        data: {
          code: `C${String(seq).padStart(3, '0')}`,
          name,
          nameKana: pick(row, ['카타카나', '후리가나', 'namekana', 'kana', 'furigana', 'フリガナ', 'ふりがな', 'カナ', '名前カナ']),
          company: pick(row, ['회사', '회사/단체', 'company', '会社', '団体', '소속']),
          email, phone,
          address: pick(row, ['주소', 'address', '住所']),
          postalCode: pick(row, ['우편번호', 'postalcode', 'zip', '郵便番号']),
          customerType: mapType(pick(row, ['구분', 'type', '区分'])),
          taxRegNo: pick(row, ['등록번호', 'taxregno', 'regno', '登録番号', '사업자번호', '法人番号']),
          legalName: pick(row, ['정식상호', 'legalname', '正式名称']),
          billingAddress: pick(row, ['청구지', '청구지주소', 'billingaddress', '請求先住所']),
          contactPerson: pick(row, ['담당자', 'contact', 'contactperson', '担当', '担当者']),
          memo: pick(row, ['메모', 'memo', 'note', '備考']),
        },
      })
      if (email) emails.add(email)
      if (phone) phones.add(phone)
      imported++
    } catch (e) {
      errors.push(String(e))
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.length, total: rows.length, errorDetails: errors.slice(0, 5) })
}
