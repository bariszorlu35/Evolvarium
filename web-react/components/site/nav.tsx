'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLive } from '@/components/site/live-context'
import { ScrollProgress } from '@/components/ui/scroll-progress'

const LINKS = [
  { href: '#lab', label: 'Lab' },
  { href: '#rules', label: 'Rules', optional: false },
  { href: '#brain', label: 'Brain', optional: true },
  { href: '#run', label: 'Run it', optional: true },
]

export function Nav() {
  const { live } = useLive()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-60 border-b border-transparent backdrop-blur-xl backdrop-saturate-150 transition-colors duration-300',
        scrolled && 'border-border bg-background/82',
      )}
    >
      <div className="mx-auto flex h-14 w-[min(1320px,100%-2rem)] items-center gap-4">
        <a
          href="#top"
          className="flex items-center gap-2.5 font-mono text-[13px] font-semibold uppercase tracking-[0.1em] text-foreground"
        >
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
            <rect x="7" y="8" width="7" height="7" rx="2" fill="var(--herb)" />
            <rect x="18" y="17" width="7" height="7" rx="2" fill="var(--carn)" />
            <rect x="19" y="9" width="3" height="3" fill="var(--plant)" />
          </svg>
          Evolvarium
        </a>

        <span
          aria-hidden="true"
          className={cn(
            'size-[7px] shrink-0 transition-all duration-300',
            live ? 'bg-plant shadow-[0_0_0_3px_rgba(57,209,122,0.15)]' : 'bg-dim',
          )}
        />

        <nav className="ml-auto hidden items-center gap-0.5 sm:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={cn(
                'px-2.5 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                l.optional && 'hidden md:inline-flex',
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href="https://github.com/bariszorlu35/Evolvarium"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex min-h-8 items-center gap-1.5 border border-border-strong px-2.5 font-mono text-[12px] tracking-[0.06em] text-foreground transition-colors hover:border-white/30 hover:bg-accent sm:ml-0"
        >
          Source
        </a>
      </div>

      {/* read position, drawn on the header's own bottom hairline */}
      <ScrollProgress className="absolute inset-x-0 bottom-0 h-px bg-herb/70" />
    </header>
  )
}
