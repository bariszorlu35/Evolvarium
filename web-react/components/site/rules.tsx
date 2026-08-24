'use client'

import { SpotlightCard } from '@/components/ui/spotlight-card'
import { MaskedTextReveal } from '@/components/ui/text-reveal'
import { Reveal, RevealGroup, RevealItem } from '@/components/ui/reveal'
import { cn } from '@/lib/utils'

const LEDGER = [
  ['Metabolism', '−10', 'var(--carn)'],
  ['Plant eaten', '+50', 'var(--plant)'],
  ['Kill made', '+170', 'var(--plant)'],
  ['Poison', '−40', 'var(--poison)'],
  ['Giving birth', '−50', 'var(--carn)'],
] as const

function Ledger() {
  return (
    <dl className="mt-5 grid gap-px border border-border bg-border font-mono text-[11.5px]">
      {LEDGER.map(([k, v, c]) => (
        <div key={k} className="flex items-baseline justify-between bg-card px-3 py-1.5">
          <dt className="uppercase tracking-[0.1em] text-dim">{k}</dt>
          <dd className="font-semibold tabular-nums" style={{ color: c }}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Inheritance() {
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em]">
      {['parent', 'mate', 'crossover', 'mutate'].map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          {i > 0 && <span className="text-white/20">→</span>}
          <span
            className={cn(
              'border px-2 py-1',
              i < 2 ? 'border-border text-muted-foreground' : 'border-fit/40 text-fit',
            )}
          >
            {s}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Cycle() {
  return (
    <div className="mt-5 flex items-center gap-2 border border-border bg-card px-3 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em]">
      <span className="text-herb">prey peak</span>
      <span className="text-white/20">→</span>
      <span className="text-carn">predator peak</span>
      <span className="text-white/20">→</span>
      <span className="text-dim">crash</span>
    </div>
  )
}

function DietSplit() {
  return (
    <div className="mt-5">
      <div className="flex h-2 overflow-hidden">
        {Array.from({ length: 24 }).map((_, i) => {
          const d = i / 23
          // the middle of the axis is the worst of both, so it thins out
          const mid = 1 - Math.abs(d - 0.5) * 2
          return (
            <span
              key={i}
              className="flex-1"
              style={{
                background: d < 0.5 ? 'var(--herb)' : 'var(--carn)',
                opacity: 0.25 + (1 - mid) * 0.75,
              }}
            />
          )
        })}
      </div>
      <p className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
        <span>pure grazer · 50</span>
        <span>pure predator · 170</span>
      </p>
    </div>
  )
}

const RULES = [
  {
    n: '01',
    title: 'Two ways to make a living',
    body: 'Nutrition depends on diet. A plant is worth 50 health to a pure grazer but almost nothing to a specialist predator; a kill is worth 170 to the predator and almost nothing to the grazer. A diet stuck halfway is the worst of both — so the population splits, and colour tells you which side a lineage picked.',
    glow: 'rgba(57,198,255,0.16)',
    extra: <DietSplit />,
  },
  {
    n: '02',
    title: 'Reproduction is earned',
    body: 'Breeding needs health above half and costs 50 of it, and a creature burns 10 health every tick just existing. Only creatures that actually feed themselves leave offspring. That single constraint is the entire selection pressure — there is no fitness function anywhere in the loop.',
    glow: 'rgba(57,209,122,0.14)',
    extra: <Ledger />,
  },
  {
    n: '03',
    title: 'Real inheritance',
    body: "Offspring take their actual parent's network weights, usually recombined with a nearby mate by uniform crossover, then mutated. Diet, aggression, vision and even the mutation rate itself are heritable — so lineages evolve how fast they evolve. Weights decay slightly toward zero and are clipped, which keeps an old lineage competent instead of letting drift swamp it.",
    glow: 'rgba(142,168,255,0.16)',
    extra: <Inheritance />,
  },
  {
    n: '04',
    title: 'A world with a carrying capacity',
    body: 'Plants regrow toward a fixed density, so grazing genuinely depletes a patch and creatures have to keep moving. Predators boom, crash the prey, then crash themselves — the population chart draws that cycle on its own. If a whole way of life is lost to bad luck, founders eventually arrive from elsewhere, and the census counts them.',
    glow: 'rgba(255,106,77,0.14)',
    extra: <Cycle />,
  },
]

export function Rules() {
  return (
    <section id="rules" className="mx-auto w-[min(1320px,100%-2rem)] scroll-mt-20 py-20 sm:py-28">
      <Reveal as="p" className="eyebrow mb-5 max-w-[520px]" from="none">
        What you are watching
      </Reveal>
      <MaskedTextReveal
        as="h2"
        splitBy="words"
        className="max-w-[22ch] text-[clamp(25px,4.2vw,42px)] font-semibold leading-[1.15] tracking-[-0.02em]"
      >
        Four rules, and everything else is a consequence
      </MaskedTextReveal>
      <Reveal
        as="p"
        delay={0.08}
        className="mt-5 max-w-[64ch] text-[17px] leading-[1.75] text-muted-foreground"
      >
        The world has no goals, no score and no training loop. It has a food chain, a cost of
        living and inheritance. Every pattern on the canvas above falls out of those.
      </Reveal>

      <RevealGroup className="mt-12 grid gap-4 md:grid-cols-2" stagger={0.1}>
        {RULES.map((r) => (
          /* spotlight card */
          <RevealItem key={r.n}>
            <SpotlightCard spotlightColor={r.glow} className="h-full p-6 sm:p-7">
              <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-dim">
                {r.n}
              </span>
              <h3 className="mt-2 text-[19px] font-semibold leading-snug tracking-[-0.01em]">
                {r.title}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.7] text-muted-foreground">{r.body}</p>
              {r.extra}
            </SpotlightCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  )
}
