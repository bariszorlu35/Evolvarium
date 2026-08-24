'use client'

import { motion, useReducedMotion, type Variants } from 'motion/react'
import { B2Mark } from '@/components/site/b2-mark'
import {
  GitHubIcon,
  SocialCloud,
  type SocialLink,
} from '@/components/ui/footer-section-1-utils/social-cloud'

/* The sign-off: mark, links, socials, a ruled divider, copyright — drawn on
   Evolvarium's own chassis (hairlines, mono caps, near-black). */

const LINKS = [
  { href: '#lab', label: 'Lab' },
  { href: '#rules', label: 'Rules' },
  { href: '#brain', label: 'Brain' },
  { href: '#run', label: 'Run it' },
  { href: '#top', label: 'Top' },
]

/* Only destinations that actually exist — a social row of dead "#" links is
   worse than a short one. Add handles here as they come. */
const SOCIALS: SocialLink[] = [
  { label: 'Source on GitHub', href: 'https://github.com/bariszorlu35/Evolvarium', icon: GitHubIcon },
]

const container: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 20, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
}

export function Footer() {
  const still = useReducedMotion()
  const anim = still
    ? {}
    : { initial: 'hidden' as const, whileInView: 'visible' as const, viewport: { once: true, margin: '0px 0px -80px 0px' } }

  return (
    <footer className="w-full overflow-hidden border-t border-border bg-background pt-16 text-foreground">
      <motion.div
        {...anim}
        variants={container}
        className="mx-auto flex w-[min(1320px,100%-2rem)] flex-col items-center gap-9"
      >
        {/* the mark, above everything it signs */}
        <motion.div variants={still ? undefined : item} className="flex justify-center">
          <a href="#top" aria-label="Back to top" className="group block">
            <B2Mark className="h-11 w-auto text-foreground transition-colors duration-300 group-hover:text-herb" />
          </a>
        </motion.div>

        <motion.nav
          variants={still ? undefined : item}
          className="relative z-10 flex flex-wrap justify-center gap-x-1 gap-y-2"
        >
          {LINKS.map((l) => (
            <motion.a
              key={l.href}
              href={l.href}
              className="relative px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground transition-colors duration-300 hover:text-foreground"
              whileHover={still ? undefined : { y: -2 }}
              whileTap={still ? undefined : { scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {l.label}
            </motion.a>
          ))}
        </motion.nav>

        <motion.div variants={still ? undefined : item}>
          <SocialCloud links={SOCIALS} />
        </motion.div>
      </motion.div>

      {/* ruled divider — the same hatch the graph-paper chassis is drawn from */}
      <motion.div
        className="mt-14 h-12 w-full border-y border-foreground/10 text-foreground opacity-10 bg-[repeating-linear-gradient(315deg,currentColor_0,currentColor_1px,transparent_0,transparent_50%)]"
        style={{ backgroundSize: '10px 10px' }}
        initial={still ? undefined : { backgroundPositionX: '0%' }}
        whileInView={still ? undefined : { backgroundPositionX: '100%' }}
        viewport={{ once: true }}
        transition={{ ease: 'linear', duration: 20 }}
      />

      <div className="mx-auto flex w-[min(1320px,100%-2rem)] flex-col gap-3 py-9 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-dim">
          © {new Date().getFullYear()} Evolvarium · open-ended artificial life
        </p>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          A project by{' '}
          <a
            href="https://bariszorlu.com"
            rel="noreferrer"
            className="text-herb hover:underline"
          >
            Barış Zorlu
          </a>
        </p>
      </div>
    </footer>
  )
}
