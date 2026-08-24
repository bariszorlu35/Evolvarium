'use client'

import { MaskedTextReveal } from '@/components/ui/text-reveal'
import { SpotlightCard } from '@/components/ui/spotlight-card'
import { Reveal, RevealGroup, RevealItem } from '@/components/ui/reveal'
import { cn } from '@/lib/utils'

const PIPELINE = [
  { head: '153 seen', sub: '3 × 7×7 + 6', tone: 'dim' },
  { head: '26 feats', sub: '+ last action', tone: 'dim' },
  { head: 'instinct (fixed)', sub: 'chase · flee · bite', tone: 'plant' },
  { head: 'evolved net', sub: '26 → 20 → 8 · tanh', tone: 'fit' },
  { head: 'softmax → act', sub: '4 moves + 4 bites', tone: 'herb' },
] as const

const TONE: Record<string, string> = {
  dim: 'border-border text-muted-foreground',
  plant: 'border-plant/35 text-plant',
  fit: 'border-fit/40 text-fit',
  herb: 'border-herb/40 text-herb',
}

const NOTES = [
  {
    k: 'A',
    title: 'Why a residual',
    body: 'A network starting from noise would spend thousands of generations rediscovering "walk toward food". Bolting a bounded correction onto a working instinct means every mutation is spent on the part that is actually still open.',
  },
  {
    k: 'B',
    title: 'Why sampling',
    body: 'Actions are drawn from a softmax rather than taken greedily. Identical twins in identical situations still diverge, so a lineage explores instead of locking into one deterministic groove.',
  },
  {
    k: 'C',
    title: 'Memory, such as it is',
    body: 'The only thing a creature remembers is its own previous action, fed back as a one-hot input. It is a single tick of short-term memory — enough to keep a direction, not enough to plan.',
  },
]

export function Brain() {
  return (
    <section id="brain" className="scroll-mt-20 border-y border-border bg-card/40">
      <div className="mx-auto w-[min(1320px,100%-2rem)] py-20 sm:py-28">
        <Reveal as="p" className="eyebrow mb-5 max-w-[520px]" from="none">
          Inside a creature
        </Reveal>
        <MaskedTextReveal
          as="h2"
          splitBy="words"
          className="max-w-[24ch] text-[clamp(25px,4.2vw,42px)] font-semibold leading-[1.15] tracking-[-0.02em]"
        >
          Instinct, plus whatever evolution can add to it
        </MaskedTextReveal>
        <Reveal
          as="p"
          delay={0.08}
          className="mt-5 max-w-[68ch] text-[17px] leading-[1.75] text-muted-foreground"
        >
          Each creature sees three 7×7 wrap-around views around itself — plants, health, kinship —
          plus six scalars. That is compressed into 26 features and fed to a hand-written survival
          drive. The evolved network never replaces that drive; it adds a bounded correction on
          top, which is exactly what the <b className="text-foreground">Neural net ↔ Instinct</b>{' '}
          button lets you switch off.
        </Reveal>

        {/* the signal path, drawn as a rail rather than a diagram image */}
        <RevealGroup as="ol" className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" stagger={0.09}>
          {PIPELINE.map((s, i) => (
            <RevealItem as="li" key={s.head} className="relative">
              <div className={cn('h-full border bg-background px-4 py-4', TONE[s.tone])}>
                <span className="block font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em]">
                  {s.head}
                </span>
                <span className="mt-1 block font-mono text-[10.5px] tracking-[0.06em] text-dim">
                  {s.sub}
                </span>
              </div>
              {i < PIPELINE.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 font-mono text-white/25 lg:block"
                >
                  →
                </span>
              )}
            </RevealItem>
          ))}
        </RevealGroup>
        <Reveal
          as="p"
          from="none"
          className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim"
        >
          instinct + evolved net are summed, then sampled — not argmax
        </Reveal>

        <RevealGroup className="mt-12 grid gap-4 md:grid-cols-3" stagger={0.1}>
          {NOTES.map((n) => (
            <RevealItem key={n.k}>
            <SpotlightCard spotlightColor="rgba(142,168,255,0.13)" className="h-full p-6">
              <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-fit">
                {n.k}
              </span>
              <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.01em]">
                {n.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-[1.7] text-muted-foreground">{n.body}</p>
            </SpotlightCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
