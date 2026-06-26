'use client'

// 경량 클라이언트 캐시 훅 (SWR 유사, 의존성 0).
// - 모듈 레벨 캐시로 페이지 재방문/뒤로가기 시 즉시 표시 + 백그라운드 갱신(stale-while-revalidate)
// - 같은 URL 동시 요청은 dedupe(in-flight 공유)
// - 서버에서 받은 초기값을 primeCache로 심으면 첫 렌더부터 데이터 보유(워터폴 제거)
import { useCallback, useEffect, useRef, useState } from 'react'

const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

// RSC/서버에서 받은 초기 데이터를 캐시에 심기 (첫 렌더 워터폴 제거용)
export function primeCache(url: string, data: unknown) {
  if (!cache.has(url)) cache.set(url, data)
}

async function fetchJson(url: string): Promise<unknown> {
  const existing = inflight.get(url)
  if (existing) return existing
  const p = fetch(url, { credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}

type Options = {
  // 창 포커스 복귀 시 재검증 (기본 true)
  revalidateOnFocus?: boolean
  // 이 ms 안에 같은 URL 재요청은 캐시만 사용(불필요한 재패칭 억제). 기본 2000
  dedupeMs?: number
}

const lastFetched = new Map<string, number>()

export function useApiCache<T = unknown>(url: string | null, opts: Options = {}) {
  const { revalidateOnFocus = true, dedupeMs = 2000 } = opts
  const [data, setData] = useState<T | undefined>(() => (url ? (cache.get(url) as T | undefined) : undefined))
  const [error, setError] = useState<unknown>(null)
  const [isLoading, setIsLoading] = useState<boolean>(() => !!url && !cache.has(url))
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(
    async (force = false) => {
      if (!url) return
      const cached = cache.get(url) as T | undefined
      if (cached !== undefined) {
        setData(cached)
        setIsLoading(false)
      }
      const last = lastFetched.get(url) ?? 0
      if (!force && cached !== undefined && Date.now() - last < dedupeMs) return
      try {
        const fresh = (await fetchJson(url)) as T
        cache.set(url, fresh)
        lastFetched.set(url, Date.now())
        if (mounted.current) {
          setData(fresh)
          setError(null)
        }
      } catch (e) {
        if (mounted.current) setError(e)
      } finally {
        if (mounted.current) setIsLoading(false)
      }
    },
    [url, dedupeMs],
  )

  useEffect(() => {
    setData(url ? (cache.get(url) as T | undefined) : undefined)
    setIsLoading(!!url && !cache.has(url))
    load()
  }, [url, load])

  useEffect(() => {
    if (!revalidateOnFocus || !url) return
    const h = () => load(true)
    window.addEventListener('focus', h)
    return () => window.removeEventListener('focus', h)
  }, [revalidateOnFocus, url, load])

  // 낙관적 갱신 / 무효화. next 주면 즉시 반영, 없으면 강제 재패칭.
  const mutate = useCallback(
    (next?: T) => {
      if (!url) return
      if (next !== undefined) {
        cache.set(url, next)
        if (mounted.current) setData(next)
      } else {
        cache.delete(url)
        load(true)
      }
    },
    [url, load],
  )

  return { data, error, isLoading, mutate, refresh: () => load(true) }
}
