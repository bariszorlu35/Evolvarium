'use client'

import { GridPattern } from '@/components/ui/grid-pattern'
import { MaskedTextReveal } from '@/components/ui/text-reveal'
import { Reveal, RevealGroup, RevealItem } from '@/components/ui/reveal'
import { cn } from '@/lib/utils'

const FACTS = [
  { n: '34 × 34', label: 'wrap-around grid' },
  { n: '708', label: 'weights per brain' },
  { n: '153', label: 'values seen per tick' },
  { n: '0', label: 'training steps' },
]

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* graph-paper chassis behind the fold */}
      <GridPattern
        width={84}
        height={84}
        className={cn(
          '[mask-image:radial-gradient(720px_circle_at_center,white,transparent)]',
          'inset-x-0 -top-24 h-[520px] skew-y-[-2deg]',
        )}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.14] blur-[110px]"
        style={{
          background:
            'radial-gradient(ellipse at 30% 50%, var(--herb), transparent 60%), radial-gradient(ellipse at 72% 55%, var(--carn), transparent 62%)',
        }}
      />

      <div className="relative mx-auto w-[min(1320px,100%-2rem)] pt-20 pb-16 sm:pt-28 sm:pb-24">
        <p className="eyebrow mb-5 max-w-[640px]">
          Open-ended artificial life · running live in this tab
        </p>

        <MaskedTextReveal
          as="h1"
          splitBy="words"
          immediate
          className="hero-headline max-w-[19ch] text-[clamp(30px,5.2vw,58px)] font-semibold leading-[1.06] tracking-[-0.025em]"
        >
          Evolution isn&rsquo;t a metaphor here. <strong>It runs while you watch.</strong>
        </MaskedTextReveal>

        <MaskedTextReveal
          as="p"
          splitBy="lines"
          immediate
          delay={0.15}
          className="mt-6 max-w-[62ch] text-[17px] leading-[1.75] text-muted-foreground"
        >
          Synthetic creatures forage, hunt and breed in a small wrap-around world. Every one of
          them carries a 708-weight neural network that its parents passed on, mutated. Nothing is
          trained and nothing is scripted — the only thing selecting the brains is whether their
          owner lived long enough to reproduce.
        </MaskedTextReveal>

        <Reveal className="mt-10 flex flex-wrap items-center gap-3" delay={0.35}>
          <a
            href="#lab"
            className="inline-flex min-h-10 items-center gap-2 bg-primary px-4 font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary-foreground transition-opacity hover:opacity-90"
          >
            Watch it run
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </a>
          <a
            href="#rules"
            className="inline-flex min-h-10 items-center border border-border-strong px-4 font-mono text-[12.5px] uppercase tracking-[0.08em] text-foreground transition-colors hover:border-white/30 hover:bg-accent"
          >
            Read the rules
          </a>
        </Reveal>

        <RevealGroup
          as="dl"
          className="mt-14 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4"
          stagger={0.07}
          delay={0.45}
        >
          {FACTS.map((f) => (
            <RevealItem key={f.label} className="bg-background px-4 py-4">
              <dt className="sr-only">{f.label}</dt>
              <dd>
                <span className="block font-mono text-[22px] font-semibold tabular-nums tracking-tight text-foreground">
                  {f.n}
                </span>
                <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                  {f.label}
                </span>
              </dd>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
