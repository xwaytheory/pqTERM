import type { CSSProperties } from 'react'
import { letterFromName, markForEngine } from '../lib/engineMarkLetter'

export { letterFromName, markForEngine }

export type EngineMarkProps = {
  name: string
  color: string
  /** Engine id — used for two-letter collision marks (Cl/Cx/…). */
  id?: string
  /** Optional asset URL (EngineSpec.logo / icon). Prefer abstract monograms, not vendor wordmarks. */
  logo?: string | null
  icon?: string | null
  /** Override monogram from EngineSpec.mark. */
  mark?: string | null
  size?: number
  title?: string
  className?: string
}

/**
 * Letter-mark chip: uses logo/icon URL when set, else tinted monogram from name + color.
 * Colliding engines get two-letter marks (Cl/Cx/Cr/Co, Gr/Ge, Om/Oc).
 * Intentionally avoids shipping vendor wordmarks (trademark).
 */
export default function EngineMark({
  name,
  color,
  id,
  logo,
  icon,
  mark,
  size = 16,
  title,
  className
}: EngineMarkProps) {
  const src = (logo || icon || '').trim()
  const letter = id ? markForEngine(id, name, mark) : mark && mark.trim() ? mark.trim().slice(0, 2) : letterFromName(name)
  const two = letter.length > 1
  const style: CSSProperties = {
    width: two ? Math.max(size, Math.round(size * 1.25)) : size,
    height: size,
    minWidth: two ? Math.max(size, Math.round(size * 1.25)) : size,
    fontSize: Math.max(8, Math.round(size * (two ? 0.48 : 0.62))),
    color,
    borderColor: color,
    background: hexToRgba(color, 0.18)
  }

  if (src) {
    return (
      <span
        className={`engine-mark has-img${className ? ` ${className}` : ''}`}
        style={{ ...style, background: 'transparent', borderColor: color }}
        title={title ?? name}
      >
        <img src={src} alt="" draggable={false} />
      </span>
    )
  }

  return (
    <span
      className={`engine-mark letter${className ? ` ${className}` : ''}`}
      style={style}
      title={title ?? name}
      aria-hidden
    >
      {letter}
    </span>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 3 && h.length !== 6) return `rgba(78, 88, 104, ${alpha})`
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return `rgba(78, 88, 104, ${alpha})`
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
