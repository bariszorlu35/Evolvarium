'use client'

import { useEffect, useRef } from 'react'
import { BorderBeam } from '@/components/ui/border-beam'
import NumberTicker from '@/components/ui/number-ticker'
import { useEvolvarium } from '@/hooks/use-evolvarium'
import { PopulationPlot, DietPlot } from '@/components/site/plots'
import { cn } from '@/lib/utils'
import { useLive } from '@/components/site/live-context'

function Module({
  title,
  note,
  children,
  className,
}: {
  title: string
  note?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-t border-border px-4 py-4 first:border-t-0', className)}>
      <h3 className="mb-3 flex items-baseline gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-dim">
        {title}
        {note && <span className="tracking-[0.08em] normal-case text-white/25">{note}</span>}
      </h3>
      {children}
    </section>
  )
}

function KV({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">{k}</span>
      <b className="font-mono text-[13px] font-semibold tabular-nums" style={color ? { color } : undefined}>
        {v}
      </b>
    </div>
  )
}

const BTN =
  'inline-flex min-h-9 items-center justify-center gap-1.5 border border-border-strong px-3 font-mono text-[11.5px] uppercase tracking-[0.07em] text-foreground transition-colors hover:border-white/30 hover:bg-accent disabled:opacity-40'

export function Lab() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sim = useEvolvarium(canvasRef)
  const { census, best, selection } = sim
  const { setLive } = useLive()

  useEffect(() => {
    setLive(sim.running)
  }, [sim.running, setLive])

  return (
    <section id="lab" aria-label="Live simulation" className="mx-auto w-[min(1320px,100%-2rem)] scroll-mt-20 py-8">
      <div className="grid gap-px border border-border bg-border lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        {/* ── the world ─────────────────────────────────────────────────── */}
        <div className="relative bg-void">
          <div className="lg:sticky lg:top-14">
          <div className="relative">
            <canvas
              ref={canvasRef}
              onClick={(e) => sim.inspectAt(e.clientX, e.clientY)}
              className="block w-full cursor-crosshair"
              aria-label="The live world. Cyan creatures are herbivores, orange are carnivores, green dots are plants."
            />
            {/* a pulse tracking the frame while the world runs */}
            {sim.running && (
              <BorderBeam size={220} duration={9} borderWidth={1.5} className="rounded-none" />
            )}

            <div className="pointer-events-none absolute left-3 top-3 flex gap-4 bg-background/70 px-3 py-1.5 font-mono text-[11px] tabular-nums backdrop-blur-md">
              <span className="text-dim">
                tick <b className="font-semibold text-foreground">{census.tick.toLocaleString('en-US')}</b>
              </span>
              <span className="text-dim">
                pop <b className="font-semibold text-foreground">{census.pop}/{census.maxAgents}</b>
              </span>
              <span className="text-dim">
                gen <b className="font-semibold text-foreground">{census.generation}</b>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-3 font-mono text-[11px] text-muted-foreground">
            {[
              ['var(--herb)', 'herbivore'],
              ['var(--carn)', 'carnivore'],
              ['var(--plant)', 'plant'],
              ['var(--poison)', 'poison'],
              ['var(--super)', 'superfood'],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-2">
                <i className="size-2.5 shrink-0" style={{ background: c }} aria-hidden="true" />
                {l}
              </span>
            ))}
          </div>
          </div>
        </div>

        {/* ── the console ───────────────────────────────────────────────── */}
        <div className="bg-card">
          <Module title="Controls">
            <div className="grid grid-cols-2 gap-2">
              <button className={cn(BTN, 'col-span-2 bg-primary/10 text-primary')} onClick={() => sim.setRunning(!sim.running)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  {sim.running ? (
                    <path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" />
                  ) : (
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                  )}
                </svg>
                {sim.running ? 'Pause' : 'Play'}
              </button>
              <button className={BTN} onClick={sim.step} disabled={sim.running}>
                Step
              </button>
              <button className={BTN} onClick={sim.addPlants}>
                Add plants
              </button>
              <button className={BTN} onClick={sim.inspectRandom}>
                Inspect
              </button>
              <button className={BTN} onClick={sim.hardReset}>
                Reset
              </button>
              <button
                className={cn(BTN, 'col-span-2', sim.neuro ? 'border-fit/50 text-fit' : 'text-muted-foreground')}
                onClick={sim.toggleBrain}
                aria-pressed={sim.neuro}
              >
                Brain: {sim.neuro ? 'Neural net' : 'Instinct only'}
              </button>
            </div>

            <label className="mt-4 block">
              <span className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                Speed <b className="text-foreground">{sim.speed}/s</b>
              </span>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={sim.speed}
                onChange={(e) => sim.setSpeed(+e.target.value)}
                className="mt-1.5 w-full accent-[var(--herb)]"
              />
            </label>

            <label className="mt-3 block">
              <span className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                Mutation <b className="text-foreground">{sim.mutation.toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.01}
                value={sim.mutation}
                onChange={(e) => sim.changeMutation(+e.target.value)}
                className="mt-1.5 w-full accent-[var(--herb)]"
              />
            </label>
          </Module>

          <Module title="Census">
            {/* live counters */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <NumberTicker
                value={census.herbivores}
                label="herbivores"
                pulseColor="var(--herb)"
                pulse={sim.running}
                className="font-mono text-[20px] font-semibold tabular-nums text-herb"
              />
              <NumberTicker
                value={census.carnivores}
                label="carnivores"
                pulseColor="var(--carn)"
                pulse={sim.running}
                className="font-mono text-[20px] font-semibold tabular-nums text-carn"
              />
            </div>
            <div className="mt-3">
              <KV k="Population" v={`${census.pop} / ${census.maxAgents}`} />
              <KV k="Generation" v={census.generation} />
              <KV k="Avg fitness" v={census.avgFitness} />
              <KV k="Avg age" v={census.avgAge} />
              <KV k="Births / deaths" v={`${census.births.toLocaleString('en-US')} / ${census.deaths.toLocaleString('en-US')}`} />
              <KV k="Arrivals" v={census.arrivals.toLocaleString('en-US')} />
            </div>
          </Module>

          <Module title="Populations" note="last 240 ticks">
            <PopulationPlot herb={sim.history.herb} carn={sim.history.carn} />
          </Module>

          <Module title="Diet spectrum">
            <DietPlot diet={sim.history.diet} />
            <p className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              <span>plants</span>
              <span>meat</span>
            </p>
          </Module>

          <Module title="Inspector">
            {selection ? (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <i className="size-3 shrink-0" style={{ background: selection.color }} aria-hidden="true" />
                  <b className="font-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: selection.color }}>
                    {selection.carn ? 'Carnivore' : 'Herbivore'} #{selection.uid}
                  </b>
                </div>
                <KV k="Diet" v={selection.diet.toFixed(2)} />
                <KV k="Health" v={`${selection.health} / ${selection.maxHealth}`} />
                <KV k="Age" v={selection.age} />
                <KV k="Generation" v={selection.generation} />
                <KV k="Offspring" v={selection.offspring} />
                <KV k="Eaten · kills" v={`${selection.eaten} · ${selection.kills}`} />
                <KV k="Mutation rate" v={selection.mrate.toFixed(2)} />
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Click any creature in the world to inspect it, or press{' '}
                <b className="text-foreground">Inspect</b> to pick one at random.
              </p>
            )}
          </Module>

          <Module title="Best life so far">
            {best ? (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <i className="size-3 shrink-0" style={{ background: best.color }} aria-hidden="true" />
                  <b className="font-mono text-[12px] uppercase tracking-[0.1em]" style={{ color: best.color }}>
                    {best.carn ? 'Carnivore' : 'Herbivore'} · score {best.score}
                  </b>
                </div>
                <KV k="Age reached" v={best.age} />
                <KV k="Generation" v={best.generation} />
                <KV k="Offspring" v={best.offspring} />
                <KV k="Eaten · kills" v={`${best.eaten} · ${best.kills}`} />
                <KV k="Diet" v={best.diet.toFixed(2)} />
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                No creature has completed a full life cycle yet. When one does, its story is
                recorded here.
              </p>
            )}
          </Module>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {sim.running ? 'The simulation is actively evolving.' : 'The simulation is paused.'}
      </p>
    </section>
  )
}
