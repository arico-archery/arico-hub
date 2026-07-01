'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, Trash2, ArrowLeft, ShoppingCart, Filter, Tag, Link2, RefreshCw, FileText, Image as ImageIcon, Clock } from 'lucide-react'
import { formatJpy, formatNumber, calcProfitRate, calcCostJpy, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import ProfitBar from '@/components/ProfitBar'
import DateInput from '@/components/DateInput'
import { useT } from '@/lib/i18n'
import { matchAxisValue } from '@/lib/optionDict'

type Supplier = { code: string; currency: string; taxRate: number; discount: number }
type Product = {
  id: number; name: string; brand: string; productCode: string; supplierCode: string
  costPrice: number; salePriceJpy: number; unit: string
  supplier: Supplier; optionSize: string; optionColor: string
}
type CatalogMatchedProduct = {
  id: number; name: string; brand: string; productCode: string; supplierCode: string
  costPrice: number; salePriceJpy: number; unit: string; optionSize: string; optionColor: string
  supplier: { currency: string; taxRate: number; discount: number }
}
// JVD 코드-접두부 변형 (옵션 축 파싱 포함)
type JvdVariant = CatalogMatchedProduct & { options: Record<string, string>; optionLabel: string }
type VariantAxis = { label: string; values: string[] }
type CatalogOption = { label: string; values: string[] }
type CatalogItem = {
  id: number; productCode: string; name: string; brand: string
  priceJpy: number; priceJpyNotax: number
  supplierProductId: number | null
  matchedProduct: CatalogMatchedProduct | null
  options?: string   // ARICO 자사몰 옵션 JSON: [{label, values:[...]}]
  imageUrl1?: string // ARICO 자사몰 대표 이미지
}
type Customer = { id: number; name: string; company: string; code: string; _count?: { orders: number } }
const RECENT_CUSTOMERS_KEY = 'arico_recent_customers'
type ExchangeRate = { currency: string; rateToJpy: number }
type OrderLine = {
  product: Product; quantity: number; salePriceJpy: number; costPriceJpy: number
  optionMemo: string; catalogName?: string; catalogId?: number
  catalogImage?: string                       // ARICO 자사몰 대표 이미지
  catalogOptions?: CatalogOption[]            // ARICO 자사몰 옵션 (축별 드롭다운)
  catalogOptionSel?: Record<string, string>   // 선택된 옵션 {label: value}
  variants?: CatalogMatchedProduct[]   // 같은 베이스 제품의 옵션 변형 (있으면 드롭다운 선택)
  variantAxes?: VariantAxis[]                  // JVD 옵션 축 (방향/파운드/길이/색상…)
  variantList?: JvdVariant[]                   // JVD 변형 전체 (축 선택 → 해결용)
  variantAxisSel?: Record<string, string>      // 선택된 축 {label: value}
}

// 카탈로그 상품 썸네일 (이미지 없거나 로딩 실패 시 플레이스홀더)
function Thumb({ src, size = 40, className = '' }: { src?: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false)
  const px = `${size}px`
  if (!src || err) {
    return (
      <div
        className={`flex-shrink-0 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-500 ${className}`}
        style={{ width: px, height: px }}
      >
        <ImageIcon className="w-1/2 h-1/2" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErr(true)}
      className={`flex-shrink-0 rounded-md object-cover bg-white border border-gray-100 dark:border-gray-700 ${className}`}
      style={{ width: px, height: px }}
    />
  )
}

// FIVICS/MK처럼 한 상품명에 옵션이 나열된 경우(예: "... LH ONLY / L, M, S (BK, BL, RD)")
// 이름에서 옵션 후보를 추출해 주문 시 빠른 선택 칩으로 제공한다.
// 표기가 불규칙해 완벽하진 않으나 자유입력 보조용.
function parseOptionChips(name: string): string[] {
  const chips = new Set<string>()
  const n = name || ''
  // 1) 괄호 안 항목들 (색상/사이즈 약어 목록: "(BK, BL, RD)")
  const parens = n.match(/[(（]([^)）]+)[)）]/g) || []
  for (const p of parens) {
    const inner = p.replace(/[(（)）]/g, '')
    for (const t of inner.split(/[,，/]/)) {
      const s = t.trim()
      if (s && s.length <= 12 && !/ONLY|込|税/i.test(s) && /[A-Za-z0-9]/.test(s)) chips.add(s)
    }
  }
  // 2) 색상 풀네임 (괄호 밖 나열도: "Black, Red, Blue …")
  const colorRe = /\b(BLACK|WHITE|RED|BLUE|GREEN|YELLOW|PINK|PURPLE|ORANGE|NAVY|SILVER|GOLD|GREY|GRAY|VIOLET|MINT|SKY ?BLUE)\b/gi
  let m: RegExpExecArray | null
  while ((m = colorRe.exec(n))) chips.add(m[1])
  // 3) 사이즈 (단독 토큰: XS/S/M/L/XL/2XL …)
  const sizeRe = /\b(XS|XXXL|3XL|XXL|2XL|XL|S|M|L)\b/g
  while ((m = sizeRe.exec(n))) chips.add(m[1])
  // 4) 방향 (괄호 밖에 있어도)
  if (/(^|[^A-Za-z])LH([^A-Za-z]|$)/.test(n)) chips.add('LH')
  if (/(^|[^A-Za-z])RH([^A-Za-z]|$)/.test(n)) chips.add('RH')
  return [...chips].slice(0, 16)
}

export default function NewOrderPage() {
  const router = useRouter()
  const t = useT()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [recentCustomerIds, setRecentCustomerIds] = useState<number[]>([])
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [lines, setLines] = useState<OrderLine[]>([])

  // 검색 모드: catalog(ARICO 카탈로그) | supplier(공급사 상품)
  const [searchMode, setSearchMode] = useState<'catalog' | 'supplier'>('catalog')
  const [productSearch, setProductSearch] = useState('')
  const [productSupplierFilter, setProductSupplierFilter] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([])
  // 미매칭 카탈로그에 연결할 공급사 상품을 고르는 중인 대상 (주문 시 매칭 반영)
  const [pendingCatalog, setPendingCatalog] = useState<CatalogItem | null>(null)

  const [dueDate, setDueDate] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)   // 편집 모드 대상 주문 id

  useEffect(() => {
    Promise.all([
      fetch('/api/customers').then(r => r.json()),
      fetch('/api/exchange-rates').then(r => r.json()),
    ]).then(([c, r]) => { setCustomers(c); setRates(r) })
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) || '[]')
      if (Array.isArray(raw)) setRecentCustomerIds(raw.filter((n: unknown) => typeof n === 'number'))
    } catch { /* ignore */ }
  }, [])

  // 거래처 선택 + 최근 이력 기록(localStorage). 반복 주문 시 퀵칩으로 빠르게 재선택.
  const pickCustomer = useCallback((c: Customer) => {
    setSelectedCustomer(c)
    setCustomerSearch('')
    setRecentCustomerIds(prev => {
      const next = [c.id, ...prev.filter(id => id !== c.id)].slice(0, 8)
      try { localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  // 편집 모드: ?edit=<id> 면 기존 주문을 불러와 폼에 채운다
  useEffect(() => {
    const ed = new URLSearchParams(window.location.search).get('edit')
    if (!ed) return
    setEditId(Number(ed))
    fetch(`/api/orders/${ed}`).then(r => r.json()).then((order) => {
      if (!order || order.error) return
      setSelectedCustomer({ id: order.customer.id, name: order.customer.name, company: order.customer.company, code: order.customer.code })
      setDueDate(order.dueDate ? String(order.dueDate).slice(0, 10) : '')
      setMemo(order.memo ?? '')
      type LoadedItem = { quantity: number; salePriceJpy: number; costPriceJpy: number; optionMemo: string; product: Product & { supplier: Supplier } }
      setLines((order.items as LoadedItem[]).map((it) => ({
        product: {
          id: it.product.id, name: it.product.name, brand: it.product.brand,
          productCode: it.product.productCode, supplierCode: it.product.supplierCode,
          costPrice: it.product.costPrice, salePriceJpy: it.product.salePriceJpy, unit: it.product.unit,
          supplier: { code: it.product.supplierCode, currency: it.product.supplier.currency, taxRate: it.product.supplier.taxRate, discount: it.product.supplier.discount },
          optionSize: it.product.optionSize, optionColor: it.product.optionColor,
        },
        quantity: it.quantity, salePriceJpy: it.salePriceJpy, costPriceJpy: it.costPriceJpy,
        optionMemo: it.optionMemo ?? '',
      })))
    })
  }, [])

  // 공급사 상품 검색
  const searchProducts = useCallback(async (q: string, supplierCode: string) => {
    if (q.length < 1 && !supplierCode) { setSearchResults([]); return }
    const params = new URLSearchParams({ limit: '12' })
    if (q) params.set('q', q)
    if (supplierCode) params.set('supplier', supplierCode)
    const res = await fetch(`/api/products?${params}`)
    const data = await res.json()
    setSearchResults(data.products)
  }, [])

  // ARICO 카탈로그 검색
  const searchCatalog = useCallback(async (q: string) => {
    if (q.length < 2) { setCatalogResults([]); return }
    const params = new URLSearchParams({ q, limit: '12' })
    const res = await fetch(`/api/arico-catalog?${params}`)
    const data = await res.json()
    setCatalogResults(data.rows as CatalogItem[])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchMode === 'catalog') {
        searchCatalog(productSearch)
      } else {
        searchProducts(productSearch, productSupplierFilter)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [productSearch, productSupplierFilter, searchMode, searchProducts, searchCatalog])

  // 같은 베이스 제품의 옵션 변형을 불러와 해당 라인에 부착 (옵션 드롭다운용)
  const loadVariantsFor = (productId: number) => {
    fetch(`/api/products/variants?productId=${productId}`)
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d.variants) || d.variants.length < 2) return
        // JVD: 옵션 축 드롭다운. 그 외(SIBUYA 등): 단일 변형 드롭다운.
        if (Array.isArray(d.axes) && d.axes.length > 0) {
          // 신규 추가 시 특정 색을 미리 선택하지 않는다(매칭 변형이 임의 색일 수 있음 — 예: ATF-DX가 LH/Burgandy Red로 매칭).
          // 값이 하나뿐인 축만 자동 선택하고, 여러 값인 축(방향/색상)은 사용자가 직접 고르게 한다.
          const preSel: Record<string, string> = {}
          for (const ax of d.axes as { label: string; values: string[] }[]) {
            if (ax.values.length === 1) preSel[ax.label] = ax.values[0]
          }
          setLines(prev => prev.map(l =>
            l.product.id === productId && !l.variantAxes
              ? { ...l, variantAxes: d.axes, variantList: d.variants, variantAxisSel: preSel }
              : l))
        } else {
          setLines(prev => prev.map(l =>
            l.product.id === productId && !l.variants ? { ...l, variants: d.variants } : l))
        }
      })
      .catch(() => {})
  }

  // JVD 옵션 축 선택 → 캐스케이드로 변형 해결. 유일 변형이면 그 변형으로 라인 교체.
  const changeVariantAxis = (idx: number, axisLabel: string, value: string) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx || !l.variantList) return l
      const sel = { ...(l.variantAxisSel || {}) }
      if (value) sel[axisLabel] = value; else delete sel[axisLabel]
      // 앞선 선택과 양립 안 되는 뒤축 값은 정리
      for (const ax of l.variantAxes || []) {
        if (ax.label === axisLabel) continue
        if (sel[ax.label] && !availableAxisValues(l.variantList, ax.label, sel).includes(sel[ax.label])) {
          delete sel[ax.label]
        }
      }
      const keys = Object.keys(sel).filter(k => sel[k])
      const matches = l.variantList.filter(v => keys.every(k => v.options[k] === sel[k]))
      // 모든 축을 지정하면 그 변형으로 라인 교체 (원본 중복 시 첫 변형 채택)
      if (matches.length >= 1 && keys.length >= (l.variantAxes?.length || 0)) {
        const v = matches[0]
        const newProduct: Product = {
          id: v.id, name: v.name, brand: v.brand, productCode: v.productCode,
          supplierCode: v.supplierCode, costPrice: v.costPrice, salePriceJpy: v.salePriceJpy, unit: v.unit,
          supplier: { code: v.supplierCode, currency: v.supplier.currency, taxRate: v.supplier.taxRate, discount: v.supplier.discount },
          optionSize: v.optionSize, optionColor: v.optionColor,
        }
        return { ...l, variantAxisSel: sel, product: newProduct, costPriceJpy: calcCostJpy(newProduct, rates), optionMemo: v.optionLabel }
      }
      return { ...l, variantAxisSel: sel }
    }))
  }

  // 캐스케이드: 앞선 축 선택과 양립 가능한 변형 중, 주어진 축에서 고를 수 있는 값들
  const availableAxisValues = (variants: JvdVariant[], axisLabel: string, sel: Record<string, string>): string[] => {
    const others = Object.keys(sel).filter(k => k !== axisLabel && sel[k])
    const out: string[] = []
    for (const v of variants) {
      if (!others.every(k => v.options[k] === sel[k])) continue
      const val = v.options[axisLabel]
      if (val && !out.includes(val)) out.push(val)
    }
    return out
  }

  // 옵션 변형 선택 → 그 변형 상품으로 라인 교체 (원가/옵션메모 갱신)
  const changeVariant = (idx: number, variantId: number) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx || !l.variants) return l
      const v = l.variants.find(x => x.id === variantId)
      if (!v) return l
      const newProduct: Product = {
        id: v.id, name: v.name, brand: v.brand, productCode: v.productCode,
        supplierCode: v.supplierCode, costPrice: v.costPrice, salePriceJpy: v.salePriceJpy, unit: v.unit,
        supplier: { code: v.supplierCode, currency: v.supplier.currency, taxRate: v.supplier.taxRate, discount: v.supplier.discount },
        optionSize: v.optionSize, optionColor: v.optionColor,
      }
      const costJpy = calcCostJpy(newProduct, rates)
      return {
        ...l, product: newProduct, costPriceJpy: costJpy,
        optionMemo: [v.optionSize, v.optionColor].filter(Boolean).join(' / '),
      }
    }))
  }

  // 카탈로그(ARICO 자사몰) 옵션 선택 → optionMemo 갱신
  const selectCatalogOption = (idx: number, label: string, value: string) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const sel = { ...(l.catalogOptionSel || {}) }
      if (value) sel[label] = value; else delete sel[label]
      const memo = Object.entries(sel).map(([k, v]) => k ? `${k}: ${v}` : v).join(' / ')
      let next = { ...l, catalogOptionSel: sel, optionMemo: memo }
      // 카탈로그 옵션(일본어 左右/カラー 등) 선택을 JVD 변형 축(방향/색상)에 매핑해 정확한 변형 SKU로 상품 교체.
      // 예: カラー=ターキーグリーン → 색상=Turkey Green → 119667-1132로 productId 교체 (대표변형 고정 문제 해결).
      if (l.variantList && l.variantAxes && l.variantAxes.length > 0) {
        const clean = (s: string) => s.replace(/【[^】]*】|\[[^\]]*\]/g, '').replace(/即納商品|取り?寄せ/g, '').trim()
        const tokens = Object.values(sel).flatMap(v => clean(String(v)).split(/[\s/]+/)).filter(Boolean)
        const axisSel: Record<string, string> = {}
        for (const ax of l.variantAxes) {
          for (const tok of tokens) {
            const hit = matchAxisValue(tok, ax.values)
            if (hit) { axisSel[ax.label] = hit; break }
          }
        }
        // 모든 축이 해결되면 그 변형으로 상품 교체 (해결 안 되면 메모만 — 기존 동작)
        if (l.variantAxes.every(ax => axisSel[ax.label])) {
          const v = l.variantList.find(vv => l.variantAxes!.every(ax => vv.options[ax.label] === axisSel[ax.label]))
          if (v) {
            const newProduct: Product = {
              id: v.id, name: v.name, brand: v.brand, productCode: v.productCode,
              supplierCode: v.supplierCode, costPrice: v.costPrice, salePriceJpy: v.salePriceJpy, unit: v.unit,
              supplier: { code: v.supplierCode, currency: v.supplier.currency, taxRate: v.supplier.taxRate, discount: v.supplier.discount },
              optionSize: v.optionSize, optionColor: v.optionColor,
            }
            next = { ...next, product: newProduct, costPriceJpy: calcCostJpy(newProduct, rates), variantAxisSel: axisSel }
          }
        }
      }
      return next
    }))
  }

  // 빠른 선택 칩 토글 → optionMemo에 추가/제거
  const appendChip = (idx: number, chip: string) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const parts = l.optionMemo ? l.optionMemo.split(' / ').filter(Boolean) : []
      const next = parts.includes(chip) ? parts.filter(p => p !== chip) : [...parts, chip]
      return { ...l, optionMemo: next.join(' / ') }
    }))
  }

  // 공급사 상품 직접 추가
  const addProduct = (p: Product) => {
    const costJpy = calcCostJpy(p, rates)
    const defaultMemo = [p.optionSize, p.optionColor].filter(Boolean).join(' / ')
    // 미매칭 카탈로그에 연결 중이면: 그 카탈로그 가격/이름/매칭정보를 함께 묶는다
    const linkCat = pendingCatalog
    const defaultSalePrice = linkCat && linkCat.priceJpy > 0
      ? linkCat.priceJpy
      : (p.salePriceJpy > 0 ? p.salePriceJpy : 0)
    const existing = lines.findIndex(l => l.product.id === p.id && !linkCat)
    if (existing >= 0) {
      setLines(prev => prev.map((l, i) => i === existing ? { ...l, quantity: l.quantity + 1 } : l))
    } else {
      setLines(prev => [...prev, {
        product: p, quantity: 1, salePriceJpy: defaultSalePrice,
        costPriceJpy: costJpy, optionMemo: defaultMemo,
        ...(linkCat ? { catalogId: linkCat.id, catalogName: linkCat.name } : {}),
      }])
    }
    setProductSearch('')
    setSearchResults([])
    // 카탈로그 연결 완료 → 다시 카탈로그 모드로 복귀
    if (linkCat) {
      setPendingCatalog(null)
      setSearchMode('catalog')
    }
    loadVariantsFor(p.id)
  }

  // 카탈로그에 연결할 공급사 상품을 고르는 모드로 전환
  // (미매칭 연결 + 이미 매칭된 상품의 공급사 변경 공용)
  const startLinkSupplier = (item: CatalogItem) => {
    setPendingCatalog(item)
    setSearchMode('supplier')
    setProductSearch(item.brand || item.name.split(' ')[0] || '')
    setCatalogResults([])
  }

  // ARICO 카탈로그 상품 추가
  const addCatalogItem = (item: CatalogItem) => {
    const mp = item.matchedProduct
    if (!mp) {
      // 미매칭 카탈로그: 공급사 상품을 직접 골라 연결 → 주문 시 카탈로그 매칭으로 반영
      startLinkSupplier(item)
      return
    }

    const productForCost = {
      costPrice: mp.costPrice, brand: mp.brand, supplierCode: mp.supplierCode,
      name: mp.name, supplier: mp.supplier,
    }
    const costJpy = calcCostJpy(productForCost, rates)

    // 카탈로그 가격 우선, 없으면 공급사 상품 기설정가
    const salePrice = item.priceJpy > 0 ? item.priceJpy : mp.salePriceJpy

    const product: Product = {
      id: mp.id, name: mp.name, brand: mp.brand, productCode: mp.productCode,
      supplierCode: mp.supplierCode, costPrice: mp.costPrice, salePriceJpy: mp.salePriceJpy,
      unit: mp.unit,
      supplier: { code: mp.supplierCode, currency: mp.supplier.currency, taxRate: mp.supplier.taxRate, discount: mp.supplier.discount },
      optionSize: mp.optionSize, optionColor: mp.optionColor,
    }

    const existing = lines.findIndex(l => l.product.id === product.id)
    if (existing >= 0) {
      setLines(prev => prev.map((l, i) => i === existing ? { ...l, quantity: l.quantity + 1 } : l))
    } else {
      let catOpts: CatalogOption[] = []
      try { if (item.options) catOpts = JSON.parse(item.options) } catch { catOpts = [] }
      setLines(prev => [...prev, {
        product, quantity: 1, salePriceJpy: salePrice, costPriceJpy: costJpy,
        optionMemo: [mp.optionSize, mp.optionColor].filter(Boolean).join(' / '),
        catalogName: item.name, catalogId: item.id, catalogImage: item.imageUrl1,
        ...(catOpts.length ? { catalogOptions: catOpts, catalogOptionSel: {} } : {}),
      }])
    }
    setProductSearch('')
    setCatalogResults([])
    loadVariantsFor(mp.id)
  }

  const switchMode = (mode: 'catalog' | 'supplier') => {
    setSearchMode(mode)
    setProductSearch('')
    setSearchResults([])
    setCatalogResults([])
  }

  const updateLine = (idx: number, field: 'quantity' | 'salePriceJpy', val: number) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }
  const updateMemo = (idx: number, val: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, optionMemo: val } : l))
  }
  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  const totalSale = lines.reduce((a, l) => a + l.salePriceJpy * l.quantity, 0)
  const totalCost = lines.reduce((a, l) => a + l.costPriceJpy * l.quantity, 0)
  const { margin } = calcProfitRate(totalSale, totalCost)

  // openInvoice=true 면 등록/저장 후 견적서를 새 탭으로 연다 (주문등록 ↔ 견적서열기 구분)
  const handleSubmit = async (openInvoice = false) => {
    if (!selectedCustomer || lines.length === 0) return
    const hasUnpricedItems = lines.some(l => l.salePriceJpy <= 0)
    if (hasUnpricedItems) {
      alert(t.orders.alertPriceRequired)
      return
    }
    // 변형(옵션) 미선택 가드 — 방향/색상 등 모든 축을 골라야 정확한 SKU로 발주된다.
    // 단, 카탈로그 옵션(자사몰 옵션)이 렌더되는 라인은 변형축 드롭다운이 숨겨지므로 제외한다
    // (렌더 우선순위: 카탈로그옵션 > 변형축). 안 그러면 카탈로그 옵션을 다 골라도 계속 막힘.
    const hasUnselectedVariant = lines.some(l =>
      !(l.catalogOptions && l.catalogOptions.length > 0) &&
      l.variantAxes && l.variantAxes.length > 0 &&
      l.variantAxes.some(ax => !(l.variantAxisSel || {})[ax.label]))
    if (hasUnselectedVariant) {
      alert(t.orders.alertOptionRequired)
      return
    }
    setSubmitting(true)
    const payload = {
      customerId: selectedCustomer.id,
      dueDate: dueDate || null,
      memo,
      items: lines.map(l => ({
        productId:    l.product.id,
        quantity:     l.quantity,
        salePriceJpy: l.salePriceJpy,
        costPriceJpy: l.costPriceJpy,
        optionMemo:   l.optionMemo,
        catalogId:    l.catalogId ?? null,
      })),
    }
    // 편집 모드면 PATCH(품목 교체), 신규면 POST
    const res = editId
      ? await fetch(`/api/orders/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const order = await res.json()
    setSubmitting(false)
    if (openInvoice) window.open(`/documents/quote/${order.id ?? editId}?lang=ja`, '_blank')
    router.push('/orders')
  }

  // 거래처 퀵칩: 최근 선택(localStorage) 우선, 부족분은 주문 많은 순(자주 쓰는 곳)으로 채움
  const recentCustomers = recentCustomerIds
    .map(id => customers.find(c => c.id === id))
    .filter((c): c is Customer => !!c)
  const frequentCustomers = [...customers]
    .filter(c => !recentCustomerIds.includes(c.id))
    .sort((a, b) => (b._count?.orders ?? 0) - (a._count?.orders ?? 0))
  const quickPickCustomers = [...recentCustomers, ...frequentCustomers].slice(0, 6)
  const cq = customerSearch.trim().toLowerCase()
  const customerResults = cq
    ? customers.filter(c => c.name.toLowerCase().includes(cq) || (c.company || '').toLowerCase().includes(cq)).slice(0, 8)
    : []

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{editId ? t.orders.editTitle : t.orders.newTitle}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{editId ? t.orders.editSubtitle : t.orders.newSubtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">

          {/* 거래처 선택 — 검색 콤보박스 + 최근/자주 거래처 퀵칩 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-3">{t.orders.newCustomerSection}</h2>

            {selectedCustomer ? (
              /* 선택 완료 — 한 줄 카드로 축약 */
              <div className="flex items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-900/20 px-3.5 py-2.5">
                <div className="w-9 h-9 shrink-0 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {selectedCustomer.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-blue-900 dark:text-blue-200 truncate">{selectedCustomer.name}</p>
                  {(selectedCustomer.company || selectedCustomer.code) && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                      {[selectedCustomer.company, selectedCustomer.code].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t.orders.newCustomerChange}
                </button>
              </div>
            ) : customers.length === 0 ? (
              <p className="text-sm text-gray-400">
                {t.orders.newNoCustomers} <a href="/customers" className="text-blue-500">{t.common.add}</a>
              </p>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    autoComplete="off"
                    className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t.orders.newCustomerSearch}
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                  />
                </div>

                {cq ? (
                  /* 검색 결과 드롭다운 */
                  <div className="mt-2 border border-gray-200 dark:border-gray-600 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                    {customerResults.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-gray-400">{t.orders.newCustomerNoResults}</p>
                    ) : customerResults.map(c => (
                      <button
                        key={c.id}
                        onClick={() => pickCustomer(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      >
                        <div className="w-7 h-7 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-300">
                          {c.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{c.name}</span>
                        {c.company && <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.company}</span>}
                        {c.code && <span className="ml-auto shrink-0 text-xs text-gray-400">{c.code}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* 최근/자주 거래처 퀵칩 */
                  quickPickCustomers.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.orders.newCustomerRecent}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {quickPickCustomers.map(c => (
                          <button
                            key={c.id}
                            onClick={() => pickCustomer(c)}
                            className="px-3 py-1.5 rounded-full text-sm border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* 상품 추가 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-3">{t.orders.newAddProduct}</h2>

            {/* 검색 모드 토글 */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 mb-3">
              <button
                onClick={() => switchMode('catalog')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  searchMode === 'catalog'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <Tag className="w-3 h-3" />
                {t.orders.newSearchModeCatalog}
              </button>
              <button
                onClick={() => switchMode('supplier')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  searchMode === 'supplier'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <Filter className="w-3 h-3" />
                {t.orders.newSearchModeSupplier}
              </button>
            </div>

            {/* 공급사 필터 (supplier 모드에서만) */}
            {searchMode === 'supplier' && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <button
                  onClick={() => setProductSupplierFilter('')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${productSupplierFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >{t.common.all}</button>
                {SUPPLIER_LIST.map(s => (
                  <button
                    key={s}
                    onClick={() => setProductSupplierFilter(productSupplierFilter === s ? '' : s)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${productSupplierFilter === s ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                    style={productSupplierFilter === s ? { backgroundColor: SUPPLIER_COLORS[s] } : {}}
                  >{s}</button>
                ))}
              </div>
            )}

            {/* 미매칭 카탈로그에 공급사 상품 연결 중 배너 */}
            {pendingCatalog && (
              <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-center gap-2 text-sm">
                <Link2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="flex-1 text-amber-700 dark:text-amber-300 truncate">
                  <span className="font-semibold">「{pendingCatalog.name}」</span> {t.orders.newLinkBanner}
                </span>
                <button
                  onClick={() => { setPendingCatalog(null); setSearchMode('catalog'); setProductSearch(''); setSearchResults([]) }}
                  className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium flex-shrink-0"
                >{t.common.cancel}</button>
              </div>
            )}

            {/* 검색 입력 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={searchMode === 'catalog' ? t.orders.newCatalogSearch : t.orders.newProductSearch}
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />

              {/* ARICO 카탈로그 검색 결과 */}
              {searchMode === 'catalog' && catalogResults.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-72 overflow-y-auto">
                  {catalogResults.map(item => {
                    const mp = item.matchedProduct
                    const color = mp ? (SUPPLIER_COLORS[mp.supplierCode] ?? '#6b7280') : '#9ca3af'
                    return (
                      <div
                        key={item.id}
                        className="flex items-stretch border-b border-gray-50 dark:border-gray-700 last:border-0 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <button
                          onClick={() => addCatalogItem(item)}
                          className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3"
                        >
                          <Thumb src={item.imageUrl1} size={44} />
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold text-white flex-shrink-0 w-14 justify-center"
                            style={{ backgroundColor: color }}
                          >{mp ? mp.supplierCode : '?'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
                            {mp ? (
                              <p className="text-xs text-gray-400 truncate">{mp.name} · {mp.productCode}</p>
                            ) : (
                              <p className="text-xs text-amber-500">{t.orders.newLinkSupplier}</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {item.priceJpy > 0 ? (
                              <>
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatJpy(item.priceJpy)}</p>
                                <p className="text-xs text-gray-400">{t.orders.newCatalogPriceLabel}</p>
                              </>
                            ) : (
                              <p className="text-xs text-gray-400">— {t.products.needInput}</p>
                            )}
                          </div>
                          {mp
                            ? <Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            : <Link2 className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                        </button>
                        {/* 이미 매칭된 카탈로그도 공급사 변경 가능 */}
                        {mp && (
                          <button
                            onClick={() => startLinkSupplier(item)}
                            title={t.orders.newChangeSupplier}
                            className="flex items-center gap-1 px-3 border-l border-gray-100 dark:border-gray-700 text-xs font-medium text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex-shrink-0"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {t.orders.newChangeSupplier}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 공급사 상품 검색 결과 */}
              {searchMode === 'supplier' && searchResults.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
                  {searchResults.map(p => {
                    const costJpy = calcCostJpy(p, rates)
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 border-b border-gray-50 dark:border-gray-700 last:border-0"
                      >
                        <SupplierBadge code={p.supplierCode} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs text-gray-400">{p.brand} · {p.productCode}</p>
                            {p.optionSize && <span className="text-xs px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium">{p.optionSize}</span>}
                            {p.optionColor && <span className="text-xs px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-medium">{p.optionColor}</span>}
                          </div>
                        </div>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatJpy(costJpy)} {t.orders.newCostLabel}</span>
                        <Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 주문 라인 테이블 */}
          {lines.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t.orders.newColProduct}</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-40">{t.common.remarks}</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-20">{t.orders.newColQty}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-32">{t.orders.newColCost}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-36">{t.orders.newColSale}</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-44">{t.orders.newColMargin}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {lines.map((line, idx) => {
                    const { margin } = calcProfitRate(line.salePriceJpy, line.costPriceJpy)
                    return (
                      <tr key={`${line.product.id}-${idx}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {line.catalogName && <Thumb src={line.catalogImage} size={40} />}
                            <SupplierBadge code={line.product.supplierCode} />
                            <div className="min-w-0">
                              {line.catalogName ? (
                                <>
                                  <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">{line.catalogName}</p>
                                  <p className="text-xs text-gray-400 truncate">{line.product.name}</p>
                                </>
                              ) : (
                                <>
                                  <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{line.product.name}</p>
                                  <p className="text-xs text-gray-400">{line.product.brand}</p>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {line.catalogOptions && line.catalogOptions.length > 0 ? (
                            <div className="space-y-1">
                              {line.catalogOptions.map(opt => (
                                <select
                                  key={opt.label}
                                  value={line.catalogOptionSel?.[opt.label] ?? ''}
                                  onChange={e => selectCatalogOption(idx, opt.label, e.target.value)}
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="">{opt.label || t.orders.newSelectOption}</option>
                                  {opt.values.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              ))}
                            </div>
                          ) : line.variantAxes && line.variantAxes.length > 0 && line.variantList ? (
                            <div className="space-y-1">
                              {line.variantAxes.map(ax => {
                                const vals = availableAxisValues(line.variantList!, ax.label, line.variantAxisSel || {})
                                return (
                                  <select
                                    key={ax.label}
                                    value={line.variantAxisSel?.[ax.label] ?? ''}
                                    onChange={e => changeVariantAxis(idx, ax.label, e.target.value)}
                                    className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  >
                                    <option value="">{ax.label}</option>
                                    {vals.map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                )
                              })}
                              <p className="text-[10px] text-gray-400 font-mono">{line.product.productCode}</p>
                            </div>
                          ) : line.variants && line.variants.length >= 2 ? (
                            <select
                              value={line.product.id}
                              onChange={e => changeVariant(idx, Number(e.target.value))}
                              className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              title={t.orders.newSelectOption}
                            >
                              {line.variants.map(v => (
                                <option key={v.id} value={v.id}>
                                  {[v.optionSize, v.optionColor].filter(Boolean).join(' / ') || v.productCode}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="space-y-1">
                              <input
                                type="text"
                                className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="LH / シルバー / 30# …"
                                value={line.optionMemo}
                                onChange={e => updateMemo(idx, e.target.value)}
                              />
                              {(() => {
                                const chips = parseOptionChips(line.product.name)
                                if (chips.length === 0) return null
                                const selected = line.optionMemo.split(' / ').filter(Boolean)
                                return (
                                  <div className="flex flex-wrap gap-1">
                                    {chips.map(c => {
                                      const on = selected.includes(c)
                                      return (
                                        <button
                                          key={c}
                                          type="button"
                                          onClick={() => appendChip(idx, c)}
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                            on
                                              ? 'bg-blue-600 text-white border-blue-600'
                                              : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400'
                                          }`}
                                        >{c}</button>
                                      )
                                    })}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            min="1"
                            className="w-16 text-center border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={line.quantity}
                            onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">{formatJpy(line.costPriceJpy)}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            className={`w-full text-right border rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums ${
                              line.salePriceJpy <= 0 ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20' : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700'
                            }`}
                            placeholder={t.orders.newSalePricePlaceholder}
                            value={line.salePriceJpy || ''}
                            onChange={e => updateLine(idx, 'salePriceJpy', Number(e.target.value))}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              {line.salePriceJpy > 0 ? <ProfitBar margin={margin} /> : <span className="text-gray-300 text-xs">—</span>}
                            </div>
                            <button onClick={() => removeLine(idx)} title={t.orders.deleteBtn}
                              className="shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {lines.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-10 text-center text-gray-400">
              <ShoppingCart className="w-10 h-10 mx-auto mb-2" />
              <p className="text-sm">{t.orders.newEmptyCart}</p>
            </div>
          )}
        </div>

        {/* 주문 요약 */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5 sticky top-6">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t.orders.newSummary}</h2>

            {selectedCustomer ? (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-4">
                <p className="font-medium text-blue-900 dark:text-blue-300">{selectedCustomer.name}</p>
                {selectedCustomer.company && <p className="text-blue-600 dark:text-blue-400 text-sm">{selectedCustomer.company}</p>}
              </div>
            ) : (
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-4 text-gray-400 text-sm text-center">
                {t.orders.newSelectCustomer}
              </div>
            )}

            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t.orders.newItemTypes}</span>
                <span className="font-medium dark:text-gray-100">{lines.length}{t.common.cases}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t.orders.newTotalCost}</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatJpy(totalCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t.orders.newTotalSale}</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">{formatJpy(totalSale)}</span>
              </div>
              {totalSale > 0 && (
                <div className="pt-2 border-t dark:border-gray-700">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-500 dark:text-gray-400">{t.orders.newExpectedMargin}</span>
                    <span className={`font-bold ${margin >= 40 ? 'text-green-600' : margin >= 25 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {margin.toFixed(1)}%
                    </span>
                  </div>
                  <ProfitBar margin={margin} showLabel={false} />
                </div>
              )}
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t.orders.newDueDate}</label>
                <DateInput
                  value={dueDate}
                  onChange={setDueDate}
                  className="py-0.5"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t.common.memo}</label>
                <textarea
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder={t.orders.newMemoPlaceholder}
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={() => handleSubmit(false)}
              disabled={!selectedCustomer || lines.length === 0 || submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? t.common.processing : editId ? t.orders.newSaveEdit : t.orders.newSubmit}
            </button>
            {/* 견적서 열기 분리: 등록/저장 + 견적서 새 탭 */}
            <button
              onClick={() => handleSubmit(true)}
              disabled={!selectedCustomer || lines.length === 0 || submitting}
              className="w-full mt-2 flex items-center justify-center gap-1.5 bg-slate-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FileText className="w-4 h-4" />
              {editId ? t.orders.newSaveAndInvoice : t.orders.newSubmitAndInvoice}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
