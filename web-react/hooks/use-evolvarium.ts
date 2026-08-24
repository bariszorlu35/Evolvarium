'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  World,
  makeRng,
  genomeFromJSON,
  colorFor,
  isCarnivore,
  fitness,
  FOOD,
  POISON,
  SUPERFOOD,
  type Agent,
  type Genome,
} from '@/lib/sim'

const HISTORY = 240

export type Census = {
  pop: number
  maxAgents: number
  herbivores: number
  carnivores: number
  generation: number
  tick: number
  births: number
  deaths: number
  arrivals: number
  avgFitness: number
  avgAge: number
}

export type Selection = {
  uid: number
  diet: number
  carn: boolean
  color: string
  age: number
  health: number
  maxHealth: number
  generation: number
  offspring: number
  eaten: number
  kills: number
  poisoned: number
  mrate: number
} | null

export type Best = World['best']

const EMPTY_CENSUS: Census = {
  pop: 0,
  maxAgents: 140,
  herbivores: 0,
  carnivores: 0,
  generation: 0,
  tick: 0,
  births: 0,
  deaths: 0,
  arrivals: 0,
  avgFitness: 0,
  avgAge: 0,
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

type Pos = { i: number; j: number }

/**
 * Owns one live `World` and drives it from a single rAF loop.
 *
 * The world itself is deliberately kept out of React state — it mutates 10+
 * times a second and re-rendering the tree at that rate would be pointless.
 * Only the numbers a human reads are lifted into state, and they are throttled
 * to ~6 Hz; the canvas is painted directly from the loop.
 */
export function useEvolvarium(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [census, setCensus] = useState<Census>(EMPTY_CENSUS)
  const [best, setBest] = useState<Best>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(10)
  const [mutation, setMutation] = useState(0.08)
  const [neuro, setNeuro] = useState(true)

  // history for the charts — refs, read by the plot components each frame
  const histH = useRef<number[]>([])
  const histC = useRef<number[]>([])
  const histDiet = useRef<number[]>(new Array(10).fill(0))

  const worldRef = useRef<World | null>(null)
  const rngRef = useRef<ReturnType<typeof makeRng> | null>(null)
  const runningRef = useRef(running)
  const speedRef = useRef(speed)
  const selectedUid = useRef<number | null>(null)

  // interpolation model
  const prevPos = useRef<Map<number, Pos>>(new Map())
  const curPos = useRef<Map<number, Pos>>(new Map())
  const bornAt = useRef<Set<number>>(new Set())
  const byUid = useRef<Map<number, Agent>>(new Map())
  const dying = useRef<{ p: Pos; color: string; t0: number }[]>([])
  const plants = useRef<number[]>([])
  const poisons = useRef<number[]>([])
  const supers = useRef<number[]>([])
  const cellSize = useRef(18)

  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  const scanCells = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    plants.current.length = 0
    poisons.current.length = 0
    supers.current.length = 0
    const g = world.cell
    for (let k = 0; k < g.length; k++) {
      const c = g[k]
      if (c === FOOD) plants.current.push(k)
      else if (c === POISON) poisons.current.push(k)
      else if (c === SUPERFOOD) supers.current.push(k)
    }
  }, [])

  const snapshot = useCallback(
    (dead: Agent[]) => {
      const world = worldRef.current
      if (!world) return
      const np = new Map<number, Pos>()
      const nc = new Map<number, Pos>()
      const nb = new Set<number>()
      for (const a of world.agents) {
        const tgt = { i: a.i, j: a.j }
        let pv = curPos.current.get(a.uid) || tgt
        // A creature that stepped over the wrap-around seam would otherwise
        // slide across the whole board; snap those instead of interpolating.
        if (Math.abs(tgt.i - pv.i) > 1 || Math.abs(tgt.j - pv.j) > 1) pv = tgt
        np.set(a.uid, pv)
        nc.set(a.uid, tgt)
        if (!curPos.current.has(a.uid)) nb.add(a.uid)
      }
      const now = performance.now()
      for (const a of dead) {
        dying.current.push({
          p: curPos.current.get(a.uid) || { i: a.i, j: a.j },
          color: colorFor(a.genome),
          t0: now,
        })
      }
      if (dying.current.length > 60) dying.current.splice(0, dying.current.length - 60)
      prevPos.current = np
      curPos.current = nc
      bornAt.current = nb
      byUid.current = new Map(world.agents.map((a) => [a.uid, a]))
      scanCells()
    },
    [scanCells],
  )

  const readSelection = useCallback((): Selection => {
    const uid = selectedUid.current
    if (uid == null) return null
    const a = byUid.current.get(uid)
    if (!a) return null
    return {
      uid: a.uid,
      diet: +a.genome.diet.toFixed(2),
      carn: isCarnivore(a.genome),
      color: colorFor(a.genome),
      age: a.age,
      health: Math.round(a.health),
      maxHealth: Math.round(a.maxHealth),
      generation: a.generation,
      offspring: a.offspring,
      eaten: a.eaten,
      kills: a.kills,
      poisoned: a.poisoned,
      mrate: +a.genome.mrate.toFixed(2),
    }
  }, [])

  const publish = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const c = world.counts()
    const n = world.agents.length
    let fitSum = 0
    let ageSum = 0
    for (const a of world.agents) {
      fitSum += fitness(a)
      ageSum += a.age
    }
    setCensus({
      pop: n,
      maxAgents: world.maxAgents,
      herbivores: c.herbivores,
      carnivores: c.carnivores,
      generation: world.maxGeneration,
      tick: world.tick,
      births: world.births,
      deaths: world.deaths,
      arrivals: world.rescues + world.immigrations,
      avgFitness: n ? +(fitSum / n).toFixed(1) : 0,
      avgAge: n ? +(ageSum / n).toFixed(1) : 0,
    })
    setBest(world.best)
    setSelection(readSelection())
  }, [readSelection])

  /* ── controls ─────────────────────────────────────────────────────────── */
  const hardReset = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    world.reset()
    prevPos.current.clear()
    curPos.current.clear()
    bornAt.current.clear()
    byUid.current.clear()
    dying.current = []
    histH.current = []
    histC.current = []
    selectedUid.current = null
    setSelection(null)
    snapshot([])
    publish()
  }, [snapshot, publish])

  /* ── the world and its loop ───────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const rng = makeRng()
    rngRef.current = rng
    worldRef.current = new World({ width: 34, height: 34, maxAgents: 140, rng })
    snapshot([])

    // Champions ship with the site, so the world opens already competent.
    // Until the fetch lands the world still runs — it just starts from noise.
    let cancelled = false
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/seed_brains.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw: Record<string, unknown[]>) => {
        if (cancelled || !worldRef.current) return
        const pack = (role: string): Genome[] =>
          (raw[role] || []).map((d) => genomeFromJSON(d, rng))
        worldRef.current.champions = { herb: pack('herb'), carn: pack('carn') }
        if (worldRef.current.tick < 30) hardReset()
      })
      .catch(() => {
        /* no seeds is survivable; the world evolves from scratch */
      })

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let dpr = 1
    let acc = 0
    let lastT = performance.now()
    let lastPublish = 0
    let raf = 0
    let firstFrame = true

    const sizeCanvas = () => {
      const world = worldRef.current
      if (!world) return
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(240, canvas.clientWidth)
      cellSize.current = w / world.width
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(w * (world.height / world.width) * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(canvas)
    sizeCanvas()

    const rrect = (x: number, y: number, w: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + w, r)
      ctx.arcTo(x + w, y + w, x, y + w, r)
      ctx.arcTo(x, y + w, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }
    const disc = (i: number, j: number, color: string, scale: number) => {
      const cell = cellSize.current
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(j * cell + cell / 2, i * cell + cell / 2, cell * scale, 0, 6.2832)
      ctx.fill()
    }
    const creature = (
      pj: number,
      pi: number,
      color: string,
      scale: number,
      carn: boolean,
      killed: boolean,
      selected: boolean,
    ) => {
      const cell = cellSize.current
      const w = cell * 0.76 * scale
      const x = pj * cell + (cell - w) / 2
      const y = pi * cell + (cell - w) / 2
      if (carn) {
        ctx.shadowColor = 'rgba(255,90,60,.5)'
        ctx.shadowBlur = cell * 0.55
      }
      ctx.fillStyle = color
      rrect(x, y, w, w * 0.3)
      ctx.fill()
      ctx.shadowBlur = 0
      if (killed) {
        ctx.lineWidth = 1.6
        ctx.strokeStyle = '#fff'
        rrect(x, y, w, w * 0.3)
        ctx.stroke()
      }
      if (selected) {
        ctx.lineWidth = 2
        ctx.strokeStyle = '#fff'
        ctx.beginPath()
        ctx.arc(pj * cell + cell / 2, pi * cell + cell / 2, cell * 0.62, 0, 6.2832)
        ctx.stroke()
      }
      return { x, y, w }
    }

    const draw = (now: number) => {
      const world = worldRef.current
      if (!world) return
      const W = world.width
      const cell = cellSize.current
      ctx.fillStyle = '#04060a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (const k of plants.current) disc((k / W) | 0, k % W, '#39d17a', 0.21)
      for (const k of poisons.current) {
        ctx.fillStyle = '#b86bff'
        ctx.fillRect(
          (k % W) * cell + cell * 0.35,
          ((k / W) | 0) * cell + cell * 0.35,
          cell * 0.3,
          cell * 0.3,
        )
      }
      const pulse = reduced.matches ? 0.34 : 0.3 + 0.05 * Math.sin(now / 300)
      for (const k of supers.current) disc((k / W) | 0, k % W, '#ffd54a', pulse)

      const fade = 1000 / Math.max(2, speedRef.current)
      dying.current = dying.current.filter((d) => {
        const t = (now - d.t0) / fade
        if (t >= 1) return false
        ctx.globalAlpha = (1 - t) * 0.6
        creature(d.p.j, d.p.i, d.color, 1 - 0.35 * t, false, false, false)
        ctx.globalAlpha = 1
        return true
      })

      const t = runningRef.current && !reduced.matches ? ease(clamp(acc, 0, 1)) : 1
      for (const [uid, tgt] of curPos.current) {
        const a = byUid.current.get(uid)
        if (!a) continue
        const pv = prevPos.current.get(uid) || tgt
        const pi = lerp(pv.i, tgt.i, t)
        const pj = lerp(pv.j, tgt.j, t)
        const scale = bornAt.current.has(uid) ? 0.4 + 0.6 * t : 1
        const box = creature(
          pj,
          pi,
          colorFor(a.genome),
          scale,
          isCarnivore(a.genome),
          !!a.killed,
          uid === selectedUid.current,
        )
        if (cell >= 11) {
          const hp = clamp(a.health / a.maxHealth, 0, 1)
          ctx.fillStyle = 'rgba(0,0,0,.5)'
          ctx.fillRect(box.x, box.y - 3, box.w, 2)
          ctx.fillStyle = hp > 0.5 ? '#39d17a' : hp > 0.25 ? '#ffd54a' : '#ff4d4d'
          ctx.fillRect(box.x, box.y - 3, box.w * hp, 2)
        }
      }
    }

    const doStep = () => {
      const world = worldRef.current
      if (!world) return
      const dead = world.step()
      snapshot(dead)
      const c = world.counts()
      histH.current.push(c.herbivores)
      histC.current.push(c.carnivores)
      if (histH.current.length > HISTORY) {
        histH.current.shift()
        histC.current.shift()
      }
      histDiet.current = world.dietHistogram(10)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (firstFrame) {
        firstFrame = false
        // the static page opens paused behind a veil when motion is reduced;
        // here the world simply does not start until asked
        if (reduced.matches) setRunning(false)
      }
      const dt = Math.min(0.25, (now - lastT) / 1000)
      lastT = now
      if (runningRef.current) {
        acc += dt * speedRef.current
        let guard = 0
        while (acc >= 1 && guard++ < 4) {
          acc -= 1
          doStep()
        }
        // fell behind: drop the backlog, keep time
        if (acc > 1) acc = 1
      }
      // the numbers a human reads only need ~6 Hz
      if (now - lastPublish > 160) {
        lastPublish = now
        publish()
      }
      draw(now)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [canvasRef, snapshot, publish, hardReset])

  const step = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const dead = world.step()
    snapshot(dead)
    const c = world.counts()
    histH.current.push(c.herbivores)
    histC.current.push(c.carnivores)
    if (histH.current.length > HISTORY) {
      histH.current.shift()
      histC.current.shift()
    }
    histDiet.current = world.dietHistogram(10)
    publish()
  }, [snapshot, publish])

  const addPlants = useCallback(() => {
    worldRef.current?.scatter(FOOD, 60)
    scanCells()
    publish()
  }, [scanCells, publish])

  const toggleBrain = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const next = world.brainmode === 'neuro' ? 'instinct' : 'neuro'
    world.brainmode = next
    setNeuro(next === 'neuro')
  }, [])

  const changeMutation = useCallback((v: number) => {
    if (worldRef.current) worldRef.current.mutSigma = v
    setMutation(v)
  }, [])

  /** Pick the creature nearest a click in canvas-relative coordinates. */
  const inspectAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      const world = worldRef.current
      if (!canvas || !world) return
      const r = canvas.getBoundingClientRect()
      const j = Math.floor((clientX - r.left) / (r.width / world.width))
      const i = Math.floor((clientY - r.top) / (r.height / world.height))
      let hit: Agent | null = null
      let bestD = Infinity
      for (const a of world.agents) {
        const d = Math.abs(a.i - i) + Math.abs(a.j - j)
        if (d < bestD) {
          bestD = d
          hit = a
        }
      }
      if (hit && bestD <= 2) {
        selectedUid.current = hit.uid
        setSelection(readSelection())
      }
    },
    [canvasRef, readSelection],
  )

  const inspectRandom = useCallback(() => {
    const world = worldRef.current
    if (!world || !world.agents.length) return
    const a = world.agents[Math.floor(Math.random() * world.agents.length)]
    selectedUid.current = a.uid
    setSelection(readSelection())
  }, [readSelection])

  return {
    census,
    best,
    selection,
    running,
    speed,
    mutation,
    neuro,
    history: { herb: histH, carn: histC, diet: histDiet },
    setRunning,
    setSpeed,
    changeMutation,
    toggleBrain,
    step,
    addPlants,
    hardReset,
    inspectAt,
    inspectRandom,
  }
}
