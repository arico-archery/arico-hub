import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

type CsvRow = Record<string, string>

// ── CSV 파서 ──────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim()); cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur.trim())
  return result
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0].replace(/^﻿/, '')).map(h => h.replace(/"/g, '').trim())
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
}

// ── Excel(XLSX) 파서 ─────────────────────────────────────────
function parseExcel(buffer: ArrayBuffer): CsvRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  return raw.map(row => {
    const entry: CsvRow = {}
    for (const [k, v] of Object.entries(row)) {
      entry[String(k).trim()] = String(v ?? '').trim()
    }
    return entry
  })
}

// ── FIVICS 전용 컬럼 매핑 ─────────────────────────────────────
// FIVICS Excel 구조: 제품코드 | 제품명 | PREMIUM(원가) | MSRP | 카테고리 | 브랜드 ...
function mapFivicsRow(row: CsvRow): CsvRow {
  // 가능한 컬럼명 후보 (대소문자 무관하게 매칭)
  const find = (keys: string[]): string => {
    for (const k of keys) {
      const hit = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, ''))
      if (hit) return row[hit] || ''
    }
    return ''
  }

  return {
    ...row,
    product_code: find(['product_code', 'productcode', 'item_code', 'itemcode', 'code', '제품코드', 'コード']),
    name:         find(['name', 'product_name', 'productname', 'item_name', '제품명', '商品名']),
    cost_price:   find(['premium', 'cost_price', 'cost', 'price_usd', 'usd']),
    msrp:         find(['msrp', 'msrp_usd', 'retail', 'list_price']),
    category:     find(['category', 'cat', '카테고리', 'カテゴリ']),
    brand:        find(['brand', 'brand_name', '브랜드', 'ブランド']),
    unit:         find(['unit', '단위', '単位']),
  }
}

// ── 공급사별 Row 정규화 ───────────────────────────────────────
function normalizeRow(row: CsvRow, supplierCode: string): CsvRow {
  if (supplierCode === 'FIVICS') {
    return mapFivicsRow(row)
  }
  return row
}

// ── 금액 파싱 (통화 기호·콤마 제거) ─────────────────────────
function parsePrice(val: string): number {
  if (!val) return 0
  const cleaned = val.replace(/[^0-9.]/g, '')
  return parseFloat(cleaned) || 0
}

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const supplierCode = formData.get('supplierCode') as string

  if (!file || !supplierCode) {
    return NextResponse.json({ error: 'file and supplierCode required' }, { status: 400 })
  }

  const supplier = await prisma.supplier.findUnique({ where: { code: supplierCode } })
  if (!supplier) {
    return NextResponse.json({ error: `Supplier ${supplierCode} not found` }, { status: 404 })
  }

  // ── 파일 파싱 (CSV vs Excel 자동 판별) ───────────────────
  const fileName = file.name.toLowerCase()
  let rows: CsvRow[]

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    rows = parseExcel(buffer)
  } else {
    const text = await file.text()
    rows = parseCSV(text)
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data found in file' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  const errorDetails: string[] = []

  for (const rawRow of rows) {
    try {
      const row = normalizeRow(rawRow, supplierCode)

      const productCode = (
        row.product_code || row.code || row.item_code || row.productCode || ''
      ).trim()

      const name = (
        row.name || row.product_name || row.item_name || row.productName || ''
      ).trim()

      const costPrice = parsePrice(
        row.cost_price || row.price_usd || row.price_jpy || row.price || row.premium || ''
      )

      if (!productCode || !name) { skipped++; continue }
      // 원가 0이면 MSRP도 없는 불완전 행 → 스킵
      const msrpVal = parsePrice(row.msrp || row.msrp_usd || row.msrp_jpy || '')
      if (costPrice === 0 && msrpVal === 0) { skipped++; continue }

      const now = new Date()
      const scrapedAt = row.scraped_at ? new Date(row.scraped_at) : now

      const productData = {
        name,
        brand:        (row.brand || '').trim(),
        category:     (row.category || '').trim(),
        costPrice:    costPrice || msrpVal,   // 원가 없으면 MSRP를 원가로
        msrp:         msrpVal,
        unit:         (row.unit || '1').trim(),
        availability: row.availability || 'in_stock',
        url:          (row.url || '').trim(),
        imageUrl1:    (row.image_url_1 || row.imageUrl1 || '').trim(),
        imageUrl2:    (row.image_url_2 || row.imageUrl2 || '').trim(),
        imageUrl3:    (row.image_url_3 || row.imageUrl3 || '').trim(),
        scrapedAt,
      }

      await prisma.product.upsert({
        where: { supplierCode_productCode: { supplierCode, productCode } },
        update: productData,
        create: { supplierCode, productCode, ...productData },
      })
      imported++
    } catch (e) {
      errorDetails.push(String(e))
    }
  }

  return NextResponse.json({
    imported,
    skipped,
    errors: errorDetails.length,
    total: rows.length,
    errorDetails: errorDetails.slice(0, 5),
  })
}
