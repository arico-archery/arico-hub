import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { formatJpy } from '@/lib/utils'
import { DOC_TEXT, DOC_LANGS, DocLang, DocType, fmtDocDate, fmtDocDateShort, fmtDocDatePadded, inclusiveTax, cleanDocText, cleanDocOption } from '@/lib/documents'
import DocToolbar from './DocToolbar'

async function getSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.setting.findMany({ select: { key: true, value: true } })
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

type Row = { date: string; name: string; opt: string; txId: string; code: string; taxRate: number; unit: string; qty: number; unitPrice: number; amount: number }
type DateRow = { label: string; value: string }

export default async function DocumentPage({
  params, searchParams,
}: {
  params: Promise<{ type: string; id: string }>
  searchParams: Promise<{ lang?: string; issuer?: string; bank?: string }>
}) {
  const { type, id } = await params
  const sp = await searchParams
  const docType = type as DocType
  if (!['invoice', 'quote', 'po'].includes(docType)) notFound()
  const lang: DocLang = DOC_LANGS.includes(sp.lang as DocLang) ? (sp.lang as DocLang) : 'ja'
  const T = DOC_TEXT[lang]
  const yen = lang === 'ja' ? '円' : ''
  const totalInclLabel = lang === 'ja' ? '合計金額（税込）' : lang === 'ko' ? '합계금액(세込)' : 'Total (incl.)'
  const settings = await getSettings()

  // 발행처·계좌 프로필 (여러 개 중 ?issuer=N / ?bank=M 로 선택). 없으면 레거시 단일키 fallback.
  const parseProfiles = (s: string | undefined): Record<string, string>[] => {
    try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
  }
  const companyProfiles = parseProfiles(settings.company_profiles)
  const bankProfiles = parseProfiles(settings.bank_profiles)
  const issuerIdx = Math.min(Math.max(0, Number(sp.issuer) || 0), Math.max(0, companyProfiles.length - 1))
  const bankIdx = Math.min(Math.max(0, Number(sp.bank) || 0), Math.max(0, bankProfiles.length - 1))
  const cp = companyProfiles[issuerIdx] || {}

  const seller = {
    name: cp.company_name || settings.company_name || 'ARICO',
    regNo: cp.company_regno || settings.company_regno || '',
    ceo: cp.company_ceo || settings.company_ceo || '',
    contact: cp.company_contact || settings.company_contact || '',
    address: cp.company_address || settings.company_address || '',
    tel: cp.company_tel || settings.company_tel || '',
  }

  // ── 데이터 정규화 ────────────────────────────────────
  let docNoVal = ''
  let recipientName = ''
  let recipientOrg = ''          // 거래처명 위에 작게 쓰는 회사·단체명
  let recipientLines: string[] = []
  let recipientHonorific = T.honorific
  let dateRows: DateRow[] = []
  let rows: Row[] = []
  let subject = ''
  let grandTotalIncl = 0
  let discountValue = 0
  let paidAmount = 0
  let notes = ''
  let showBank = false
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
      date: fmtDocDateShort(po.orderDate),
      name: it.product.name,
      opt: [it.product.optionSize, it.product.optionColor].filter(Boolean).join(' / ') || it.memo || '',
      txId: po.poNo,
      code: it.product.productCode,
      taxRate: 10,
      unit: it.product.unit || T.unitDefault,
      qty: it.quantity,
      unitPrice: it.unitCostJpy,
      amount: it.unitCostJpy * it.quantity,
    }))
    grandTotalIncl = po.totalCostJpy
    subject = `${fmtDocDatePadded(po.orderDate, lang)}${T.subjectSuffix}`
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
      // 회사·단체명이 있으면 이름 위에 작게 (예: 上智大学 / 山﨑海光 様). 이름과 같으면 생략.
      recipientOrg = c.company && c.company !== recipientName ? c.company : ''
      recipientHonorific = c.honorific || (isOrg ? T.honorific : T.honorificPerson)
      recipientLines = [
        c.postalCode ? `〒${c.postalCode}` : '',
        c.billingAddress || c.address,
        isOrg && c.contactPerson ? `${T.contactLabel}: ${c.contactPerson} ${T.honorificPerson}` : '',
        c.taxRegNo ? `${T.regNo}: ${c.taxRegNo}` : '',
        c.phone ? `TEL: ${c.phone}` : '',
      ].filter(Boolean)
    }
    rows = order.items.map(it => ({
      date: fmtDocDateShort(order.orderDate),
      // 고객용 문서(청구서·견적서)는 자사몰(ARICO 카탈로그) 상품명으로 — 【取り寄せ商品】 태그 제거.
      // 자사몰명이 없으면(수동 주문 등) 공급사 상품명으로 폴백. 옵션도 같은 태그 제거.
      name: cleanDocText(it.shopProductName) || it.product.name,
      opt: cleanDocOption(it.optionLabel || it.optionMemo || ''),
      txId: String(order.id),
      code: it.product.productCode,
      taxRate: 10,
      unit: it.product.unit || T.unitDefault,
      qty: it.quantity,
      unitPrice: it.salePriceJpy,
      amount: it.salePriceJpy * it.quantity,
    }))

    // 소계(할인 전) / 할인 / 합계(순액). 레거시 주문은 subtotalJpy=0 → 합계를 소계로 사용
    const subtotal = order.subtotalJpy > 0 ? order.subtotalJpy : order.totalAmountJpy
    discountValue = Math.max(0, subtotal - order.totalAmountJpy)
    grandTotalIncl = order.totalAmountJpy
    subject = `${fmtDocDatePadded(order.orderDate, lang)}${T.subjectSuffix}`

    if (docType === 'invoice') {
      dateRows = [
        { label: T.issueDate, value: fmtDocDate(order.orderDate, lang) },
        { label: T.dueDate, value: fmtDocDate(order.dueDate, lang) },
      ]
      paidAmount = order.paidAmountJpy
      showBank = true
    } else {
      const valid = order.dueDate ?? new Date(new Date(order.orderDate).getTime() + 30 * 86400000)
      dateRows = [
        { label: T.issueDate, value: fmtDocDate(order.orderDate, lang) },
        { label: T.validUntil, value: fmtDocDate(valid, lang) },
      ]
    }
    notes = order.memo
  }

  // ── 세율별 내부 소비세(税込 기준) — 할인 반영 배분 ──
  const grossByRate = new Map<number, number>()
  for (const r of rows) grossByRate.set(r.taxRate, (grossByRate.get(r.taxRate) || 0) + r.amount)
  const grossTotal = [...grossByRate.values()].reduce((a, b) => a + b, 0) || 1
  const effTotal = grandTotalIncl || grossTotal
  const taxGroups = [...grossByRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, gross]) => {
    const incl = Math.round(gross * effTotal / grossTotal)
    return { rate, amount: incl, tax: inclusiveTax(incl, rate) }
  })
  const inTaxTotal = taxGroups.reduce((s, g) => s + g.tax, 0)

  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const dueRow = dateRows[1] || null
  const bp = bankProfiles[bankIdx] || {}
  // 입금처는 값만 이어붙이면 「GMOあおぞらネット銀行 法人営業部 普通 1890883 カ）…」처럼
  // 어디까지가 지점이고 어디부터 계좌번호인지 읽히지 않는다 → 항목마다 라벨을 붙여 띄운다.
  const bankFields = [
    { label: T.bankName, value: bp.bank_name || settings.bank_name },
    { label: T.bankBranch, value: bp.bank_branch || settings.bank_branch },
    { label: T.bankAccountType, value: bp.bank_account_type || settings.bank_account_type },
    { label: T.bankAccountNo, value: bp.bank_account_no || settings.bank_account_no },
    { label: T.bankAccountHolder, value: bp.bank_account_holder || settings.bank_account_holder },
  ].filter(f => f.value)
  const bankNote = bp.bank_note || settings.bank_note || ''

  const cell = 'border border-gray-400 px-2 py-1.5'
  const th = `${cell} bg-gray-100 font-semibold`

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 p-6 print:bg-white print:p-0">
      <DocToolbar type={docType} id={id} lang={lang} backHref={backHref}
        issuers={companyProfiles.map((p, i) => p.label || `프로필 ${i + 1}`)} issuerIdx={issuerIdx}
        banks={docType === 'invoice' ? bankProfiles.map((p, i) => p.label || `계좌 ${i + 1}`) : []} bankIdx={bankIdx} />

      {/* print-page: 인쇄 시 문서 자체가 페이지 여백을 갖는다(@page margin:0 → 브라우저 머리글·바닥글 제거) */}
      <div className="print-page max-w-[820px] mx-auto bg-white text-gray-900 shadow-lg rounded-md print:shadow-none print:rounded-none p-8 print:p-6 text-[13px] leading-relaxed" id="document">
        {/* 제목 */}
        <h1 className="text-center text-2xl font-bold tracking-[0.4em] mb-6">{T.title[docType]}</h1>

        {/* 상단: 수신(좌) + 문서정보·발행처(우) */}
        <div className="flex justify-between gap-8 mb-4">
          <div className="flex-1 min-w-0 pt-1">
            {recipientOrg && <p className="text-[12px] text-gray-600 leading-tight">{recipientOrg}</p>}
            <p className="text-lg font-bold border-b-2 border-gray-800 pb-1 inline-block">{recipientName} {recipientHonorific}</p>
            <div className="mt-2 space-y-0.5 text-gray-700 text-[12px]">
              {recipientLines.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </div>
          <div className="w-[290px] shrink-0 text-[12px]">
            <div className="space-y-0.5 text-right">
              <p><span className="text-gray-500">No: </span>{docNoVal}</p>
              {dateRows[0] && <p><span className="text-gray-500">{dateRows[0].label}: </span>{dateRows[0].value}</p>}
            </div>
            <div className="relative mt-2 border border-gray-300 rounded p-2.5 space-y-0.5">
              <p className="font-bold text-[13px]">{seller.name}</p>
              {seller.regNo && <p className="text-gray-600">{T.regNo}: {seller.regNo}</p>}
              {seller.address && <p className="text-gray-600">{seller.address}</p>}
              {seller.tel && <p className="text-gray-600">TEL: {seller.tel}</p>}
              {seller.ceo && <p className="text-gray-600">{T.representative}: {seller.ceo}</p>}
              {seller.contact && <p className="text-gray-600">{T.contactLabel}: {seller.contact}</p>}
              {/* 社印 — 발행처 박스 우측 하단에 겹쳐 찍는다(일본 청구서 角印 관행). 인쇄 시에도 색 유지. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/arico-stamp.png" alt="" width={64} height={64} aria-hidden="true"
                className="pointer-events-none select-none absolute -right-2 -bottom-2 w-16 h-16 object-contain mix-blend-multiply [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" />
            </div>
          </div>
        </div>

        {/* intro */}
        <p className="mb-3">{T.intro[docType]}</p>

        {/* 요약 박스: 件名 / 支払期限 / 合計金額(税込) */}
        <table className="w-[64%] mb-5 border-collapse">
          <tbody>
            <tr>
              <th className={`${th} text-left w-28`}>{T.subject}</th>
              <td className={cell}>{subject}</td>
            </tr>
            {dueRow && (
              <tr>
                <th className={`${th} text-left`}>{dueRow.label}</th>
                <td className={cell}>{dueRow.value}</td>
              </tr>
            )}
            <tr>
              <th className={`${th} text-left`}>{totalInclLabel}</th>
              <td className={`${cell} text-right font-bold text-base`}>{formatJpy(grandTotalIncl)} {yen}</td>
            </tr>
          </tbody>
        </table>

        {/* 품목 테이블 — 발주서(po)는 품번(코드) 전용 컬럼, 청구/견적은 税込 양식 */}
        {docType === 'po' ? (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={`${th} w-36 text-left`}>{T.productCode}</th>
                <th className={`${th} text-left`}>{T.itemName}</th>
                <th className={`${th} w-14`}>{T.qty}</th>
                <th className={`${th} w-24 text-right`}>{T.unitPrice}</th>
                <th className={`${th} w-24 text-right`}>{T.amount}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={`${cell} align-top font-mono text-[11px] whitespace-nowrap`}>{r.code}</td>
                  <td className={`${cell} align-top`}>
                    <p className="font-medium">{r.name}</p>
                    {r.opt && <p className="text-[11px] text-amber-700">{r.opt}</p>}
                  </td>
                  <td className={`${cell} align-top text-center`}>{r.qty}</td>
                  <td className={`${cell} align-top text-right tabular-nums`}>{formatJpy(r.unitPrice)}</td>
                  <td className={`${cell} align-top text-right tabular-nums`}>{formatJpy(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={`${th} w-24`}>{T.txDate}</th>
              <th className={`${th} text-left`}>{T.itemName}</th>
              <th className={`${th} w-14`}>{T.taxRate}</th>
              <th className={`${th} w-14`}>{T.qty}</th>
              <th className={`${th} w-12`}>{T.unit}</th>
              <th className={`${th} w-24 text-right`}>{T.unitPriceIncl}</th>
              <th className={`${th} w-24 text-right`}>{T.amountIncl}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={`${cell} align-top text-center whitespace-nowrap`}>{r.date}</td>
                <td className={`${cell} align-top`}>
                  <p className="font-medium">{r.name}</p>
                  {r.opt && <p className="text-[11px] text-amber-700">{r.opt}</p>}
                </td>
                <td className={`${cell} align-top text-center`}>{r.taxRate}%</td>
                <td className={`${cell} align-top text-center`}>{r.qty}</td>
                <td className={`${cell} align-top text-center`}>{r.unit}</td>
                <td className={`${cell} align-top text-right tabular-nums`}>{formatJpy(r.unitPrice)}</td>
                <td className={`${cell} align-top text-right tabular-nums`}>{formatJpy(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}

        {/* 합계/세금 */}
        <div className="flex justify-between items-start mt-2 mb-5">
          <p className="text-[11px] text-gray-500 pt-1">{T.reducedNote}　　{T.totalQty}: {totalQty}</p>
          <div className="w-[320px] text-[12px]">
            <div className="flex justify-between border-y-2 border-gray-800 py-1.5">
              <span className="font-semibold">{T.total}</span>
              <span className="font-bold text-base tabular-nums">{formatJpy(grandTotalIncl)} {yen}</span>
            </div>
            {taxGroups.map((g, i) => (
              <p key={i} className="text-gray-600 text-[11px] mt-1.5 text-right">
                （{g.rate}%{T.taxTargetLabel} {formatJpy(g.amount)} {yen} {T.includedTaxLabel} {formatJpy(g.tax)}{yen}）
              </p>
            ))}
            <div className="flex justify-between py-1 mt-0.5 text-gray-700">
              <span>{T.inTax}</span>
              <span className="tabular-nums">（{formatJpy(inTaxTotal)}）</span>
            </div>
            {discountValue > 0 && (
              <div className="flex justify-between py-0.5 text-green-700">
                <span>{T.discount}</span>
                <span className="tabular-nums">- {formatJpy(discountValue)}</span>
              </div>
            )}
            {paidAmount > 0 && (
              <div className="flex justify-between py-0.5 text-gray-600">
                <span>{T.paidAmount}</span>
                <span className="tabular-nums">- {formatJpy(paidAmount)}</span>
              </div>
            )}
            {paidAmount > 0 && (
              <div className="flex justify-between py-1 border-t border-gray-300 font-bold">
                <span>{T.balanceDue}</span>
                <span className="tabular-nums">{formatJpy(grandTotalIncl - paidAmount)} {yen}</span>
              </div>
            )}
          </div>
        </div>

        {/* 振込先 (청구서만) */}
        {showBank && bankFields.length > 0 && (
          <div className="border border-gray-300 rounded p-3 mb-3 text-[12px]">
            <p className="font-semibold mb-1.5">
              {T.bankTitle}
              <span className="font-normal text-gray-500 ml-3">{T.transferFeeNote}</span>
            </p>
            {/* 항목별 라벨 + 값. 좁으면 줄바꿈되지만 라벨이 있어 어디까지가 무엇인지 읽힌다. */}
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {bankFields.map(f => (
                <span key={f.label} className="whitespace-nowrap">
                  <span className="text-gray-500 mr-1.5">{f.label}</span>
                  <span className="text-gray-900 font-medium">{f.value}</span>
                </span>
              ))}
            </div>
            {bankNote && <p className="text-gray-500 text-[11px] mt-1">{bankNote}</p>}
          </div>
        )}

        {/* 備考 */}
        {notes && (
          <div className="text-[12px] mt-3">
            <p className="font-semibold mb-0.5">{T.notes}</p>
            <p className="whitespace-pre-wrap text-gray-700">{notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
