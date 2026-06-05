import { prisma } from '@/lib/prisma'
import { formatJpy, calcProfitRate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import PrintButton from './PrintButton'
import { AricoMark } from '@/components/Logo'

async function getSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`SELECT key, value FROM Setting`
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

async function getOrder(id: number) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { product: { include: { supplier: true } } } },
    },
  })
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [order, settings] = await Promise.all([getOrder(Number(id)), getSettings()])
  if (!order) notFound()

  const { margin } = calcProfitRate(order.totalAmountJpy, order.totalCostJpy)
  const issueDate = new Date(order.orderDate).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  const dueDate = order.dueDate
    ? new Date(order.dueDate).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—'

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 p-8 print:bg-white print:p-0">
      {/* Print controls — hidden on print */}
      <div className="max-w-3xl mx-auto mb-4 flex items-center gap-3 print:hidden">
        <a href={`/orders`} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">← 주문 목록</a>
        <PrintButton />
      </div>

      {/* Invoice body */}
      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-xl overflow-hidden print:shadow-none print:rounded-none" id="invoice">
        {/* Header */}
        <div className="bg-slate-900 text-white px-8 py-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <AricoMark size={28} color="#ffffff" />
              <span className="font-bold text-lg tracking-wide">ARICO</span>
            </div>
            <p className="text-slate-400 text-xs">arico-archery.com</p>
            <p className="text-slate-400 text-xs mt-0.5">sbs@arico.co.jp</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">견적서</p>
            <p className="text-slate-300 text-sm mt-1">{order.orderNo}</p>
            <p className="text-slate-400 text-xs mt-0.5">발행: {issueDate}</p>
          </div>
        </div>

        {/* Customer + Summary */}
        <div className="px-8 py-5 grid grid-cols-2 gap-6 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">수신</p>
            <p className="text-lg font-bold text-gray-900">{order.customer.name} 귀중</p>
            {order.customer.company && <p className="text-gray-500 text-sm">{order.customer.company}</p>}
            {order.customer.address && <p className="text-gray-400 text-xs mt-1">{order.customer.address}</p>}
            {order.customer.email && <p className="text-gray-400 text-xs mt-0.5">{order.customer.email}</p>}
            {order.customer.phone && <p className="text-gray-400 text-xs">{order.customer.phone}</p>}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">발행일</span>
              <span className="font-medium text-gray-800">{issueDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">결제 만기</span>
              <span className="font-medium text-gray-800">{dueDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">입금 상태</span>
              <span className={`font-semibold ${order.paymentStatus === 'paid' ? 'text-green-600' : order.paymentStatus === 'partial' ? 'text-yellow-600' : 'text-red-600'}`}>
                {order.paymentStatus === 'paid' ? '입금 완료' : order.paymentStatus === 'partial' ? '부분 입금' : '미입금'}
              </span>
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="px-8 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 font-semibold text-gray-600 w-8">#</th>
                <th className="text-left py-2 font-semibold text-gray-600">상품명</th>
                <th className="text-center py-2 font-semibold text-gray-600 w-16">수량</th>
                <th className="text-right py-2 font-semibold text-gray-600 w-28">단가</th>
                <th className="text-right py-2 font-semibold text-gray-600 w-28">금액</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, idx) => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="py-3 text-gray-400">{idx + 1}</td>
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{item.product.name}</p>
                    <p className="text-xs text-gray-400">{item.product.brand} · {item.product.productCode}</p>
                  </td>
                  <td className="py-3 text-center text-gray-700">{item.quantity}</td>
                  <td className="py-3 text-right text-gray-700 tabular-nums">{formatJpy(item.salePriceJpy)}</td>
                  <td className="py-3 text-right font-medium text-gray-900 tabular-nums">{formatJpy(item.salePriceJpy * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total */}
        <div className="px-8 pb-6">
          <div className="ml-auto w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>소계</span>
              <span className="tabular-nums">{formatJpy(order.totalAmountJpy)}</span>
            </div>
            {order.paidAmountJpy > 0 && (
              <div className="flex justify-between text-green-600">
                <span>입금액</span>
                <span className="tabular-nums">- {formatJpy(order.paidAmountJpy)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-2 border-t-2 border-gray-900">
              <span>청구 금액</span>
              <span className="tabular-nums text-gray-900">{formatJpy(order.totalAmountJpy - order.paidAmountJpy)}</span>
            </div>
          </div>
        </div>

        {/* Memo */}
        {order.memo && (
          <div className="px-8 pb-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1 mt-4">메모</p>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{order.memo}</p>
          </div>
        )}

        {/* Bank account info */}
        {settings.bank_name && (
          <div className="px-8 pb-6 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-4">お振込先</p>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <div className="flex gap-6">
                {settings.bank_name && (
                  <span><span className="text-gray-500 text-xs">銀行名</span> <span className="font-medium text-gray-800 ml-1">{settings.bank_name}</span></span>
                )}
                {settings.bank_branch && (
                  <span><span className="text-gray-500 text-xs">支店名</span> <span className="font-medium text-gray-800 ml-1">{settings.bank_branch}</span></span>
                )}
                {settings.bank_account_type && (
                  <span><span className="text-gray-500 text-xs">種別</span> <span className="font-medium text-gray-800 ml-1">{settings.bank_account_type}</span></span>
                )}
              </div>
              <div className="flex gap-6">
                {settings.bank_account_no && (
                  <span><span className="text-gray-500 text-xs">口座番号</span> <span className="font-medium text-gray-800 ml-1 tabular-nums">{settings.bank_account_no}</span></span>
                )}
                {settings.bank_account_holder && (
                  <span><span className="text-gray-500 text-xs">口座名義</span> <span className="font-medium text-gray-800 ml-1">{settings.bank_account_holder}</span></span>
                )}
              </div>
              {settings.bank_note && (
                <p className="text-xs text-gray-400 pt-1">{settings.bank_note}</p>
              )}
            </div>
          </div>
        )}

        {/* Footer — internal only, hidden on print unless admin wants it */}
        <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 print:hidden">
          <div className="flex gap-6 text-xs text-gray-400">
            <span>원가: {formatJpy(order.totalCostJpy)}</span>
            <span>이익: {formatJpy(order.totalAmountJpy - order.totalCostJpy)}</span>
            <span>마진율: {margin.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
