// 채번(번호 생성) 동시성·삭제 안전 헬퍼.
// count()+1 방식은 ①동시 요청 시 같은 번호 ②삭제 후 count 감소로 기존 번호와 충돌.
// → 번호 생성 후 create를 시도하고, unique 충돌(Prisma P2002) 시 번호를 다시 만들어 재시도한다.
// genNumber(attempt)는 보통 "현존 최대 일련번호 + 1 + attempt" 로 만들어 삭제·동시성 양쪽에 견고하게 한다.

import { prisma } from './prisma'

// 발주번호(PO-YYYYMMDD-NNNN): 현존 최대 일련번호 + 1 (+재시도 오프셋). 삭제·동시성 안전.
// createWithSeqRetry의 genNumber로 사용. create-po·purchase-orders 양쪽에서 공유.
export async function nextPoNo(dateStr: string, attempt: number): Promise<string> {
  const last = await prisma.purchaseOrder.findFirst({ orderBy: { id: 'desc' }, select: { poNo: true } })
  const lastSeq = last ? (parseInt(last.poNo.split('-').pop() || '0', 10) || 0) : 0
  return `PO-${dateStr}-${String(lastSeq + 1 + attempt).padStart(4, '0')}`
}

export async function createWithSeqRetry<T>(
  genNumber: (attempt: number) => Promise<string>,
  create: (no: string) => Promise<T>,
  tries = 8,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    const no = await genNumber(attempt)
    try {
      return await create(no)
    } catch (e: unknown) {
      lastErr = e
      if ((e as { code?: string })?.code === 'P2002') continue // unique 충돌 → 재시도
      throw e
    }
  }
  throw lastErr
}
