'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { colorFor } from '@/lib/sim'

const HISTORY = 240

function usePlot(
  height: number,
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const paintRef = useRef(paint)
  useEffect(() => {
    paintRef.current = paint
  })

  useEffect(() => {
    const c = ref.current
    if (!c) return
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const w = Math.max(120, c.clientWidth)
      const d = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== Math.round(w * d) || c.height !== Math.round(height * d)) {
        c.width = Math.round(w * d)
        c.height = Math.round(height * d)
      }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(d, 0, 0, d, 0, 0)
      g.clearRect(0, 0, w, height)
      paintRef.current(g, w, height)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [height])

  return ref
}

/** Predator–prey lines, hand-drawn: no chart library, no CDN. */
export function PopulationPlot({
  herb,
  carn,
}: {
  herb: RefObject<number[]>
  carn: RefObject<number[]>
}) {
  const ref = usePlot(92, (g, w, h) => {
    const H = herb.current ?? []
    const C = carn.current ?? []
    const n = Math.max(2, H.length)
    let top = 8
    for (let i = 0; i < n; i++) top = Math.max(top, H[i] || 0, C[i] || 0)
    top = Math.ceil((top * 1.15) / 10) * 10

    g.strokeStyle = 'rgba(255,255,255,.06)'
    g.lineWidth = 1
    for (let k = 1; k < 4; k++) {
      const y = Math.round((h * k) / 4) + 0.5
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(w, y)
      g.stroke()
    }

    const px = (i: number) => (i / Math.max(1, HISTORY - 1)) * w
    const py = (v: number) => h - (v / top) * (h - 4) - 2

    const series = (data: number[], stroke: string, fill: string) => {
      if (data.length < 2) return
      g.beginPath()
      g.moveTo(px(0), py(data[0]))
      for (let i = 1; i < data.length; i++) g.lineTo(px(i), py(data[i]))
      g.strokeStyle = stroke
      g.lineWidth = 1.8
      g.lineJoin = 'round'
      g.stroke()
      g.lineTo(px(data.length - 1), h)
      g.lineTo(px(0), h)
      g.closePath()
      g.fillStyle = fill
      g.fill()
    }
    series(H, '#39c6ff', 'rgba(57,198,255,.14)')
    series(C, '#ff6a4d', 'rgba(255,106,77,.14)')

    g.fillStyle = '#6b7c90'
    g.font = '500 10px JetBrains Mono, monospace'
    g.fillText(String(top), 4, 12)
  })

  return <canvas ref={ref} className="block h-[92px] w-full" role="img" aria-label="Herbivore and carnivore population over the last 240 ticks" />
}

/** Where the population sits on the plant-to-meat axis, in ten bins. */
export function DietPlot({ diet }: { diet: RefObject<number[]> }) {
  const ref = usePlot(88, (g, w, h) => {
    const d = diet.current ?? new Array(10).fill(0)
    const top = Math.max(4, ...d)
    const gap = 4
    const bw = (w - gap * 9) / 10
    for (let i = 0; i < 10; i++) {
      const v = d[i] || 0
      const bh = Math.max(v ? 3 : 0, (v / top) * (h - 14))
      const x = i * (bw + gap)
      g.fillStyle = 'rgba(255,255,255,.045)'
      g.fillRect(x, 0, bw, h - 12)
      g.fillStyle = colorFor({ diet: (i + 0.5) / 10 } as never)
      g.globalAlpha = v ? 1 : 0.25
      g.fillRect(x, h - 12 - bh, bw, bh)
      g.globalAlpha = 1
      if (v) {
        g.fillStyle = '#8fa1b6'
        g.font = '500 9px JetBrains Mono, monospace'
        g.textAlign = 'center'
        g.fillText(String(v), x + bw / 2, h - 2)
        g.textAlign = 'left'
      }
    }
  })

  return <canvas ref={ref} className="block h-[88px] w-full" role="img" aria-label="Distribution of the population across ten diet bins, from pure grazer to pure predator" />
}
