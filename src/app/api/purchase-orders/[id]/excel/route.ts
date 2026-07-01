import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { DOC_TEXT, DOC_LANGS, type DocLang, fmtDocDate } from '@/lib/documents'

// GET /api/purchase-orders/[id]/excel?lang=ja  — 발주서 Excel(.xlsx) 다운로드 (이메일용)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lp = new URL(req.url).searchParams.get('lang')
  const lang: DocLang = DOC_LANGS.includes(lp as DocLang) ? (lp as DocLang) : 'ja'
  const T = DOC_TEXT[lang]
  const optLabel = lang === 'ja' ? 'オプション' : lang === 'ko' ? '옵션' : 'Option'
  const codeLabel = lang === 'ja' ? 'コード' : lang === 'ko' ? '코드' : 'Code'

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: Number(id) },
    include: { supplier: true, items: { include: { product: true } } },
  })
  if (!po) return new Response('Not found', { status: 404 })

  const settings = Object.fromEntries(
    (await prisma.setting.findMany({ select: { key: true, value: true } })).map(r => [r.key, r.value]),
  )
  const sellerName = settings.company_name || 'ARICO'
  const sellerContact = settings.company_contact || ''
  const contactLbl = lang === 'ja' ? '担当者' : lang === 'ko' ? '담당자' : 'Contact'

  const r = (n: number) => Math.round(n)
  const itemRows = po.items.map((it, i) => {
    const opt = [it.product.optionSize, it.product.optionColor, it.memo].filter(Boolean).join(' / ')
    return [i + 1, it.product.name, it.product.productCode, opt, it.quantity, r(it.unitCostJpy), r(it.unitCostJpy * it.quantity)]
  })
  const totalQty = po.items.reduce((s, it) => s + it.quantity, 0)

  const aoa: (string | number)[][] = [
    [T.title.po],
    [`${T.docNo.po}: ${po.poNo}`],
    [`${T.to}: ${po.supplier.name} (${po.supplierCode})`],
    [`${T.from}: ${sellerName}${sellerContact ? `  (${contactLbl}: ${sellerContact})` : ''}`],
    [`${T.issueDate}: ${fmtDocDate(po.orderDate, lang)}`],
    ...(po.expectedDate ? [[`${T.expectedDate}: ${fmtDocDate(po.expectedDate, lang)}`]] : []),
    [],
    [T.no, T.itemName, codeLabel, optLabel, T.qty, T.unitPrice, T.amount],
    ...itemRows,
    [],
    [T.total, '', '', '', totalQty, '', r(po.totalCostJpy)],
  ]
  if (po.memo) { aoa.push([]); aoa.push([T.notes, po.memo]) }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 5 }, { wch: 44 }, { wch: 16 }, { wch: 22 }, { wch: 7 }, { wch: 12 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'PO')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="PO_${po.poNo}.xlsx"`,
    },
  })
}
