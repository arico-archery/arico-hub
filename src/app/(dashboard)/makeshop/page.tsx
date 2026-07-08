'use client'

import { useState } from 'react'
import { RefreshCw, Download, CheckCircle, AlertTriangle, Copy } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import SupplierBadge from '@/components/SupplierBadge'
import { formatJpy } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type PreviewItem = { productCode: string; productName: string; amount: number; price: number; matched: boolean; supplierCode: string | null; catalogName: string | null }
type Row = {
  externalOrderNo: string; displayOrderNumber: string; orderDate: string; memberId: string; customerName: string
  sumPrice: number; shipping: number; itemsSubtotal: number; payment: 'paid' | 'unpaid'
  orderStatus: 'pending' | 'delivered' | 'cancelled'; trackingNo: string; shipDate: string | null
  dup: boolean; allMatched: boolean; items: PreviewItem[]
}
type Summary = { total: number; dup: number; importable: number; hasUnmatched: number }

export default function MakeshopPage() {
  const { lang } = useI18n()
  const L = (ko: string, ja: string) => (lang === 'ja' ? ja : ko)
  const [days, setDays] = useState(90)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const loadPreview = async () => {
    setLoading(true); setErr(null); setResult(null); setRows(null); setSummary(null)
    try {
      const res = await fetch(`/api/makeshop/import-orders?days=${days}`)
      const d = await res.json()
      if (!res.ok || !d.ok) {
        setErr(d.error === 'not_configured' ? L('MakeShop 연결이 설정되지 않았습니다.', 'MakeShop連携が未設定です。') : `${d.error}${d.detail ? ' — ' + JSON.stringify(d.detail).slice(0, 300) : ''}`)
        return
      }
      setRows(d.rows); setSummary(d.summary)
    } catch (e) { setErr(String(e)) } finally { setLoading(false) }
  }

  const runImport = async () => {
    setImporting(true); setResult(null); setErr(null)
    try {
      const res = await fetch(`/api/makeshop/import-orders?days=${days}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok || !d.ok) { setErr(`${d.error}${d.detail ? ' — ' + JSON.stringify(d.detail).slice(0, 300) : ''}`); return }
      setResult(L(`✅ 주문 ${d.created}건 생성 · 거래처 신규 ${d.custCreated}·갱신 ${d.custUpdated} · 중복제외 ${d.dup} · 일부미매칭 ${d.partial} · ETC상품 ${d.etcCreated}`, `✅ 受注 ${d.created}件作成 · 取引先 新規 ${d.custCreated}·更新 ${d.custUpdated} · 重複除外 ${d.dup} · 一部未マッチ ${d.partial} · ETC商品 ${d.etcCreated}`))
      loadPreview()
    } catch (e) { setErr(String(e)) } finally { setImporting(false) }
  }

  const badge = (r: Row) => r.dup
    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{L('중복', '重複')}</span>
    : r.allMatched
      ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{L('가져오기', '取込可')}</span>
      : <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" title={L('미매칭 품목은 ETC 상품으로 생성 후 주문관리에서 수정', '未マッチ品はETC商品として作成し受注管理で修正')}>{L('일부 미매칭', '一部未マッチ')}</span>

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Download className="w-6 h-6 text-indigo-600" />{L('MakeShop 주문 수신', 'MakeShop受注取込')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{L('아리코숍 주문을 가져와 검수 후 주문을 생성합니다.', 'アリコショップの受注を取込み、確認後に受注を作成します。')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="px-2 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            <option value={30}>{L('최근 30일', '直近30日')}</option>
            <option value={90}>{L('최근 90일', '直近90日')}</option>
            <option value={180}>{L('최근 180일', '直近180日')}</option>
          </select>
          <button onClick={loadPreview} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{L('주문 불러오기', '受注を読込')}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="break-all">{err}</span>
        </div>
      )}
      {result && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300">{result}</div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: L('전체', '全体'), value: summary.total, cls: 'text-gray-900 dark:text-white' },
            { label: L('가져올 수 있음', '取込可'), value: summary.importable, cls: 'text-green-600' },
            { label: L('일부 미매칭', '一部未マッチ'), value: summary.hasUnmatched, cls: 'text-amber-600' },
            { label: L('이미 수신', '取込済み'), value: summary.dup, cls: 'text-gray-400' },
          ].map(c => (
            <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
              <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {summary && summary.importable > 0 && (
        <div className="mb-4">
          <button onClick={() => setConfirmOpen(true)} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            <Copy className="w-4 h-4" />{L(`${summary.importable}건 가져오기`, `${summary.importable}件を取込`)}
          </button>
        </div>
      )}

      {rows && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                <th className="text-left px-4 py-3 font-semibold w-24">{L('상태', 'ステータス')}</th>
                <th className="text-left px-4 py-3 font-semibold">{L('주문 · 거래처', '受注 · 取引先')}</th>
                <th className="text-left px-4 py-3 font-semibold">{L('품목', '品目')}</th>
                <th className="text-right px-4 py-3 font-semibold w-28">{L('금액', '金額')}</th>
                <th className="text-center px-4 py-3 font-semibold w-20">{L('입금', '入金')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-16 text-gray-400">{L('주문이 없습니다', '受注がありません')}</td></tr>
              ) : rows.map(r => (
                <tr key={r.externalOrderNo} className={`align-top ${r.dup ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">{badge(r)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{r.displayOrderNumber}</p>
                      {r.orderStatus === 'delivered' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{L('배송완료', '配送完了')}</span>}
                      {r.orderStatus === 'cancelled' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">{L('취소', 'キャンセル')}</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.orderDate} · {r.customerName}{r.trackingNo ? ` · ${L('송장', '伝票')} ${r.trackingNo}` : ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {r.items.map((it, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          {it.matched
                            ? <span className="text-green-600"><CheckCircle className="w-3 h-3 inline" /></span>
                            : <span className="text-red-500"><AlertTriangle className="w-3 h-3 inline" /></span>}
                          {it.supplierCode && <SupplierBadge code={it.supplierCode} />}
                          <span className={`${it.matched ? 'text-gray-700 dark:text-gray-200' : 'text-red-500'} truncate max-w-[280px]`}>{it.productName}</span>
                          <span className="text-gray-400">×{it.amount}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{formatJpy(r.itemsSubtotal)}</p>
                    {r.shipping > 0 && <p className="text-xs text-gray-400">{L('배송', '送料')} {formatJpy(r.shipping)}</p>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.payment === 'paid'
                      ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{L('입금완료', '入金済')}</span>
                      : <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{L('미입금', '未入金')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={L('MakeShop 주문 가져오기', 'MakeShop受注取込')}
        message={L(`${summary?.importable ?? 0}건의 주문을 생성합니다. (중복만 제외 · 미매칭 품목은 ETC 상품으로 생성 → 주문관리에서 수정)\n거래처도 자동 연동됩니다. 진행할까요?`, `${summary?.importable ?? 0}件の受注を作成します。(重複のみ除外 · 未マッチ品はETC商品として作成 → 受注管理で修正)\n取引先も自動連携。進めますか？`)}
        confirmText={L('가져오기', '取込')}
        cancelText={L('취소', 'キャンセル')}
        onConfirm={() => { setConfirmOpen(false); runImport() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
