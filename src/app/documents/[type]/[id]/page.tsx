import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { formatJpy } from '@/lib/utils'
import { DOC_TEXT, DOC_LANGS, DocLang, DocType, fmtDocDate } from '@/lib/documents'
import DocToolbar from './DocToolbar'
import { AricoMark } from '@/components/Logo'

async function getSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.setting.findMany({ select: { key: true, value: true } })
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

type Row = { name: string; sub: string; qty: number; unitPrice: number; amount: number }
type TotalRow = { label: string; value: number; bold?: boolean; minus?: boolean }
type DateRow = { label: string; value: string }

export default async function DocumentPage({
  params, searchParams,
}: {
  params: Promise<{ type: string; id: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { type, id } = await params
  const sp = await searchParams
  const docType = type as DocType
  if (!['invoice', 'quote', 'po'].includes(docType)) notFound()
  const lang: DocLang = DOC_LANGS.includes(sp.lang as DocLang) ? (sp.lang as DocLang) : 'ja'
  const T = DOC_TEXT[lang]
  const settings = await getSettings()

  // 발행처(ARICO) 정보 — 설정값 우선, 없으면 기본값
  const seller = {
    name: settings.company_name || 'ARICO',
    regNo: settings.company_regno || '',
    address: settings.company_address || '',
    tel: settings.company_tel || '',
    email: settings.company_email || 'sbs@arico.co.jp',
    web: settings.company_web || 'arico-archery.com',
  }

  // ── 데이터 정규화 ────────────────────────────────────
  let docNoVal = ''
  let recipientName = ''
  let recipientLines: string[] = []
  let recipientHonorific = T.honorific
  let dateRows: DateRow[] = []
  let rows: Row[] = []
  let totals: TotalRow[] = []
  let notes = ''
  let showBank = false
  let paymentBadge: { label: string; cls: string } | null = null
  let backHref = '/orders'

  if (docType === 'po') {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: Number(id) },
      include: { supplier: true, items: { include: { product: true } } },
    })
    if (!po) notFound()
    backHref = `/purchase-orders/${po.id}`
    docNoVal = po.poNo
    recipientName = po.supplier.name
    recipientLines = [po.supplierCode].filter(Boolean)
    dateRows = [
      { label: T.issueDate, value: fmtDocDate(po.orderDate, lang) },
      ...(po.expectedDate ? [{ label: T.expectedDate, value: fmtDocDate(po.expectedDate, lang) }] : []),
    ]
    rows = po.items.map(it => ({
      name: it.product.name,
      sub: [it.product.productCode, [it.product.optionSize, it.product.optionColor].filter(Boolean).join(' / '), it.memo].filter(Boolean).join(' · '),
      qty: it.quantity,
      unitPrice: it.unitCostJpy,
      amount: it.unitCostJpy * it.quantity,
    }))
    totals = [
      { label: T.subtotal, value: po.totalCostJpy },
      { label: T.total, value: po.totalCostJpy, bold: true },
    ]
    notes = po.memo
  } else {
    const order = await prisma.order.findUnique({
      where: { id: Number(id) },
      include: { customer: true, items: { include: { product: true } } },
    })
    if (!order) notFound()
    backHref = '/orders'
    docNoVal = order.orderNo
    {
      const c = order.customer
      const isOrg = c.customerType === 'institution' || c.customerType === 'corporation'
      recipientName = isOrg ? (c.legalName || c.company || c.name) : c.name
      recipientHonorific = c.honorific || (isOrg ? T.honorific : T.honorificPerson)
      recipientLines = [
        c.postalCode ? `〒${c.postalCode}` : '',
        c.billingAddress || c.address,
        isOrg && c.contactPerson ? `${T.contactLabel}: ${c.contactPerson} ${T.honorificPerson}` : '',
        c.taxRegNo ? `${T.regNo}: ${c.taxRegNo}` : '',
        c.email, c.phone,
      ].filter(Boolean)
    }
    rows = order.items.map(it => ({
      name: it.product.name,
      sub: [it.product.brand, it.product.productCode, it.optionMemo].filter(Boolean).join(' · '),
      qty: it.quantity,
      unitPrice: it.salePriceJpy,
      amount: it.salePriceJpy * it.quantity,
    }))

    if (docType === 'invoice') {
      dateRows = [
        { label: T.issueDate, value: fmtDocDate(order.orderDate, lang) },
        { label: T.dueDate, value: fmtDocDate(order.dueDate, lang) },
      ]
      totals = [{ label: T.subtotal, value: order.totalAmountJpy }]
      if (order.paidAmountJpy > 0) totals.push({ label: T.paidAmount, value: order.paidAmountJpy, minus: true })
      totals.push({ label: T.balanceDue, value: order.totalAmountJpy - order.paidAmountJpy, bold: true })
      showBank = true
      paymentBadge = order.paymentStatus === 'paid'
        ? { label: T.statusPaid, cls: 'text-green-600' }
        : order.paymentStatus === 'partial'
        ? { label: T.statusPartial, cls: 'text-yellow-600' }
        : { label: T.statusUnpaid, cls: 'text-red-600' }
    } else {
      // 견적서: 유효기한 = dueDate 또는 발행일 +30일
      const valid = order.dueDate ?? new Date(new Date(order.orderDate).getTime() + 30 * 86400000)
      dateRows = [
        { label: T.issueDate, value: fmtDocDate(order.orderDate, lang) },
        { label: T.validUntil, value: fmtDocDate(valid, lang) },
      ]
      totals = [
        { label: T.subtotal, value: order.totalAmountJpy },
        { label: T.total, value: order.totalAmountJpy, bold: true },
      ]
    }
    notes = order.memo
  }

  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const bank = {
    name: settings.bank_name, branch: settings.bank_branch, type: settings.bank_account_type,
    no: settings.bank_account_no, holder: settings.bank_account_holder, note: settings.bank_note,
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 p-8 print:bg-white print:p-0">
      <DocToolbar type={docType} id={id} lang={lang} backHref={backHref} />

      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-xl overflow-hidden print:shadow-none print:rounded-none" id="document">
        {/* Header */}
        <div className="bg-slate-900 text-white px-8 py-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <AricoMark size={28} color="#ffffff" />
              <span className="font-bold text-lg tracking-wide">{seller.name}</span>
            </div>
            <p className="text-slate-400 text-xs">{seller.web}</p>
            <p className="text-slate-400 text-xs mt-0.5">{seller.email}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">{T.title[docType]}</p>
            <p className="text-slate-300 text-sm mt-1">{T.docNo[docType]}: {docNoVal}</p>
          </div>
        </div>

        {/* Recipient + From + dates */}
        <div className="px-8 py-5 grid grid-cols-2 gap-6 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">{T.to}</p>
            <p className="text-lg font-bold text-gray-900">{recipientName} {recipientHonorific}</p>
            {recipientLines.map((l, i) => (
              <p key={i} className="text-gray-500 text-xs mt-0.5">{l}</p>
            ))}
          </div>
          <div className="text-sm">
            {dateRows.map((d, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-gray-500">{d.label}</span>
                <span className="font-medium text-gray-800">{d.value}</span>
              </div>
            ))}
            {paymentBadge && (
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">{T.paymentStatus}</span>
                <span className={`font-semibold ${paymentBadge.cls}`}>{paymentBadge.label}</span>
              </div>
            )}
            {/* 발행처 */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">{T.from}</p>
              <p className="font-bold text-gray-900 text-sm">{seller.name}</p>
              {seller.regNo && <p className="text-gray-500 text-xs">{T.regNo}: {seller.regNo}</p>}
              {seller.address && <p className="text-gray-500 text-xs">{seller.address}</p>}
              {seller.tel && <p className="text-gray-500 text-xs">TEL: {seller.tel}</p>}
            </div>
          </div>
        </div>

        {/* Intro line */}
        <div className="px-8 pt-4">
          <p className="text-sm text-gray-600">{T.intro[docType]}</p>
        </div>

        {/* Items table */}
        <div className="px-8 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 font-semibold text-gray-600 w-8">{T.no}</th>
                <th className="text-left py-2 font-semibold text-gray-600">{T.itemName}</th>
                <th className="text-center py-2 font-semibold text-gray-600 w-16">{T.qty}</th>
                <th className="text-right py-2 font-semibold text-gray-600 w-28">{T.unitPrice}</th>
                <th className="text-right py-2 font-semibold text-gray-600 w-28">{T.amount}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-b border-gray-50">
                  <td className="py-3 text-gray-400">{idx + 1}</td>
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.sub && <p className="text-xs text-gray-400">{r.sub}</p>}
                  </td>
                  <td className="py-3 text-center text-gray-700">{r.qty}</td>
                  <td className="py-3 text-right text-gray-700 tabular-nums">{formatJpy(r.unitPrice)}</td>
                  <td className="py-3 text-right font-medium text-gray-900 tabular-nums">{formatJpy(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="px-8 pb-5">
          <div className="ml-auto w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-400 text-xs">
              <span>{T.totalQty}</span>
              <span className="tabular-nums">{totalQty}</span>
            </div>
            {totals.map((row, i) => (
              <div
                key={i}
                className={`flex justify-between ${
                  row.bold
                    ? 'font-bold text-base pt-2 border-t-2 border-gray-900 text-gray-900'
                    : row.minus ? 'text-green-600' : 'text-gray-500'
                }`}
              >
                <span>{row.label}</span>
                <span className="tabular-nums">{row.minus ? '- ' : ''}{formatJpy(row.value)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">{T.taxNote}</p>
        </div>

        {/* Notes */}
        {notes && (
          <div className="px-8 pb-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1 mt-4">{T.notes}</p>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        {/* Bank (invoice only) */}
        {showBank && bank.name && (
          <div className="px-8 pb-6 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-4">{T.bankTitle}</p>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {bank.name && <span><span className="text-gray-500 text-xs">{T.bankName}</span> <span className="font-medium text-gray-800 ml-1">{bank.name}</span></span>}
                {bank.branch && <span><span className="text-gray-500 text-xs">{T.bankBranch}</span> <span className="font-medium text-gray-800 ml-1">{bank.branch}</span></span>}
                {bank.type && <span><span className="text-gray-500 text-xs">{T.bankAccountType}</span> <span className="font-medium text-gray-800 ml-1">{bank.type}</span></span>}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {bank.no && <span><span className="text-gray-500 text-xs">{T.bankAccountNo}</span> <span className="font-medium text-gray-800 ml-1 tabular-nums">{bank.no}</span></span>}
                {bank.holder && <span><span className="text-gray-500 text-xs">{T.bankAccountHolder}</span> <span className="font-medium text-gray-800 ml-1">{bank.holder}</span></span>}
              </div>
              {bank.note && <p className="text-xs text-gray-400 pt-1">{bank.note}</p>}
            </div>
          </div>
        )}

        {/* Seal area */}
        <div className="px-8 pb-8 flex justify-end">
          <div className="text-center">
            <div className="w-20 h-20 border border-dashed border-gray-300 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}
