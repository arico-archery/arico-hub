import { SUPPLIER_COLORS } from '@/lib/utils'

interface Props {
  code: string
  name?: string
}

export default function SupplierBadge({ code, name }: Props) {
  const color = SUPPLIER_COLORS[code] ?? '#64748b'
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {name ?? code}
    </span>
  )
}
