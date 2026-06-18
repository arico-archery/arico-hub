// 발급 문서(청구서/견적서/발주서) 다국어 양식 — 일본어/한국어/영어
// 같은 데이터(주문 또는 발주)를 3개 언어 양식으로 출력한다.

export type DocType = 'invoice' | 'quote' | 'po'  // 청구서 | 견적서 | 발주서
export type DocLang = 'ja' | 'ko' | 'en'

export const DOC_TYPES: DocType[] = ['invoice', 'quote', 'po']
export const DOC_LANGS: DocLang[] = ['ja', 'ko', 'en']
export const DOC_LANG_LABEL: Record<DocLang, string> = { ja: '日本語', ko: '한국어', en: 'English' }

const LOCALE: Record<DocLang, string> = { ja: 'ja-JP', ko: 'ko-KR', en: 'en-US' }

export function fmtDocDate(d: Date | string | null | undefined, lang: DocLang): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(LOCALE[lang], { year: 'numeric', month: 'long', day: 'numeric' })
}

export type DocText = {
  title: Record<DocType, string>
  docNo: Record<DocType, string>
  intro: Record<DocType, string>
  to: string                 // 수신 블록 라벨
  from: string               // 발행처 블록 라벨
  honorific: string          // 御中 / 귀중 / '' (기관·기업 수신자명 뒤)
  honorificPerson: string    // 様 / 님 / '' (개인 수신자명 뒤)
  contactLabel: string       // 担当 / 담당 / Attn (수신 담당자)
  issueDate: string
  dueDate: string
  validUntil: string
  expectedDate: string
  no: string
  itemName: string
  remarks: string
  qty: string
  unitPrice: string
  amount: string
  subtotal: string
  total: string
  paidAmount: string
  balanceDue: string
  totalQty: string
  paymentStatus: string
  statusPaid: string
  statusPartial: string
  statusUnpaid: string
  bankTitle: string
  bankName: string
  bankBranch: string
  bankAccountType: string
  bankAccountNo: string
  bankAccountHolder: string
  notes: string
  regNo: string
  taxNote: string            // 소비세 안내 (税込 등)
}

export const DOC_TEXT: Record<DocLang, DocText> = {
  ja: {
    title:  { invoice: '請求書', quote: '見積書', po: '発注書' },
    docNo:  { invoice: '請求番号', quote: '見積番号', po: '発注番号' },
    intro:  {
      invoice: '下記の通りご請求申し上げます。',
      quote:   '下記の通りお見積り申し上げます。',
      po:      '下記の通り発注いたします。',
    },
    to: '宛先', from: '発行元', honorific: '御中', honorificPerson: '様', contactLabel: '担当',
    issueDate: '発行日', dueDate: 'お支払期限', validUntil: '有効期限', expectedDate: '納品予定日',
    no: 'No.', itemName: '品名', remarks: '備考', qty: '数量', unitPrice: '単価', amount: '金額',
    subtotal: '小計', total: '合計', paidAmount: '入金額', balanceDue: 'ご請求額', totalQty: '合計数量',
    paymentStatus: 'お支払状況', statusPaid: '入金済', statusPartial: '一部入金', statusUnpaid: '未入金',
    bankTitle: 'お振込先', bankName: '銀行名', bankBranch: '支店名', bankAccountType: '種別',
    bankAccountNo: '口座番号', bankAccountHolder: '口座名義',
    notes: '備考', regNo: '登録番号', taxNote: '※金額は消費税込みです。',
  },
  ko: {
    title:  { invoice: '청구서', quote: '견적서', po: '발주서' },
    docNo:  { invoice: '청구번호', quote: '견적번호', po: '발주번호' },
    intro:  {
      invoice: '아래와 같이 청구합니다.',
      quote:   '아래와 같이 견적합니다.',
      po:      '아래와 같이 발주합니다.',
    },
    to: '수신', from: '발행처', honorific: '귀중', honorificPerson: '님', contactLabel: '담당',
    issueDate: '발행일', dueDate: '결제 기한', validUntil: '유효 기한', expectedDate: '입고 예정일',
    no: 'No.', itemName: '품명', remarks: '비고', qty: '수량', unitPrice: '단가', amount: '금액',
    subtotal: '소계', total: '합계', paidAmount: '입금액', balanceDue: '청구 금액', totalQty: '총 수량',
    paymentStatus: '입금 상태', statusPaid: '입금 완료', statusPartial: '부분 입금', statusUnpaid: '미입금',
    bankTitle: '입금 계좌', bankName: '은행명', bankBranch: '지점', bankAccountType: '예금 종류',
    bankAccountNo: '계좌번호', bankAccountHolder: '예금주',
    notes: '비고', regNo: '사업자번호', taxNote: '※ 금액은 소비세(부가세) 포함 금액입니다.',
  },
  en: {
    title:  { invoice: 'INVOICE', quote: 'QUOTATION', po: 'PURCHASE ORDER' },
    docNo:  { invoice: 'Invoice No.', quote: 'Quote No.', po: 'PO No.' },
    intro:  {
      invoice: 'Please find our invoice below.',
      quote:   'We are pleased to provide the following quotation.',
      po:      'We hereby place the following order.',
    },
    to: 'To', from: 'From', honorific: '', honorificPerson: '', contactLabel: 'Attn',
    issueDate: 'Issue Date', dueDate: 'Due Date', validUntil: 'Valid Until', expectedDate: 'Expected Delivery',
    no: 'No.', itemName: 'Description', remarks: 'Remarks', qty: 'Qty', unitPrice: 'Unit Price', amount: 'Amount',
    subtotal: 'Subtotal', total: 'Total', paidAmount: 'Paid', balanceDue: 'Balance Due', totalQty: 'Total Qty',
    paymentStatus: 'Payment Status', statusPaid: 'Paid', statusPartial: 'Partially Paid', statusUnpaid: 'Unpaid',
    bankTitle: 'Bank Details', bankName: 'Bank', bankBranch: 'Branch', bankAccountType: 'Account Type',
    bankAccountNo: 'Account No.', bankAccountHolder: 'Account Holder',
    notes: 'Notes', regNo: 'Business Reg. No.', taxNote: '* All amounts are tax inclusive (JPY).',
  },
}
