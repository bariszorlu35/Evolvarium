'use client'

import { motion, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   Scroll choreography.

   One shared easing and one shared distance, so every section enters the
   viewport the same way and the page reads as a single instrument booting up
   rather than a pile of independently animated widgets.

   Deliberately NOT `whileInView`. That drives off IntersectionObserver, which
   only reports what it sampled: jump the page in one go — the End key, a
   dragged scrollbar, or any of the nav's own #anchor links — and every section
   skipped over in that jump is never sampled as intersecting. Combined with
   `once`, those elements keep their opacity-0 initial state permanently. The
   nav links alone made most of the page vanish.

   So the trigger is geometric instead: an element is revealed once its top has
   crossed the reveal line, which is also true for anything already scrolled
   past. Any scroll re-checks, so the state is self-healing and content cannot
   get stranded invisible. Each element listens only until it reveals, then
   detaches.
   ═══════════════════════════════════════════════════════════════════════════ */

const EASE = [0.16, 1, 0.3, 1] as const

/* how far up the viewport an element must come before it plays */
const LINE = 0.88

/* Resolved once, at module scope. Building the motion component inside a render
   body (motion.create(as)) mints a new component type each pass, which changes
   the child's identity and remounts the subtree — and a remounted element
   restarts at `hidden`, so reveals never finish. A static table also keeps the
   set of usable tags honest at the type level. */
const TAGS = {
  div: motion.div,
  section: motion.section,
  p: motion.p,
  span: motion.span,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
  dl: motion.dl,
  h2: motion.h2,
  h3: motion.h3,
  figure: motion.figure,
} as const

export type RevealTag = keyof typeof TAGS

function useReached<T extends HTMLElement>(skip = false) {
  const ref = useRef<T>(null)
  const [reached, setReached] = useState(false)

  useEffect(() => {
    // reduced motion never attaches the ref, so the listener could never
    // resolve — don't register one at all
    if (reached || skip) return
    let raf = 0

    const check = () => {
      const el = ref.current
      if (!el) return
      // top < line covers both "entering from below" and "already scrolled past"
      if (el.getBoundingClientRect().top < window.innerHeight * LINE) setReached(true)
    }

    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(check)
    }

    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [reached, skip])

  return [ref, reached] as const
}

type Dir = 'up' | 'down' | 'left' | 'right' | 'none'

const OFFSET: Record<Dir, { x?: number; y?: number }> = {
  up: { y: 22 },
  down: { y: -22 },
  left: { x: 22 },
  right: { x: -22 },
  none: {},
}

export function Reveal({
  children,
  as = 'div',
  className,
  delay = 0,
  duration = 0.7,
  from = 'up',
  blur = true,
}: {
  children: ReactNode
  as?: RevealTag
  className?: string
  delay?: number
  duration?: number
  from?: Dir
  blur?: boolean
}) {
  const still = useReducedMotion()
  const [ref, reached] = useReached<HTMLDivElement>(!!still)
  // the tag union makes prop/ref types intersect across every element kind;
  // the runtime component is whatever TAGS holds, so narrow the type to one
  // representative motion element
  const Tag = TAGS[as] as typeof motion.div

  if (still) return <Tag className={className}>{children}</Tag>

  const off = OFFSET[from]
  return (
    <Tag
      ref={ref}
      className={className}
      initial={{ opacity: 0, ...off, filter: blur ? 'blur(6px)' : 'blur(0px)' }}
      animate={reached ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' } : undefined}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </Tag>
  )
}

/* A parent that hands its children a stagger. Pair with <RevealItem>. */
export function RevealGroup({
  children,
  as = 'div',
  className,
  stagger = 0.08,
  delay = 0,
}: {
  children: ReactNode
  as?: RevealTag
  className?: string
  stagger?: number
  delay?: number
}) {
  const still = useReducedMotion()
  const [ref, reached] = useReached<HTMLDivElement>(!!still)
  // the tag union makes prop/ref types intersect across every element kind;
  // the runtime component is whatever TAGS holds, so narrow the type to one
  // representative motion element
  const Tag = TAGS[as] as typeof motion.div

  if (still) return <Tag className={className}>{children}</Tag>

  return (
    <Tag
      ref={ref}
      className={className}
      initial="hidden"
      animate={reached ? 'shown' : 'hidden'}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
    >
      {children}
    </Tag>
  )
}

export const revealItem: Variants = {
  hidden: { opacity: 0, y: 20, filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
}

export function RevealItem({
  children,
  as = 'div',
  className,
}: {
  children: ReactNode
  as?: RevealTag
  className?: string
}) {
  const still = useReducedMotion()
  // the tag union makes prop/ref types intersect across every element kind;
  // the runtime component is whatever TAGS holds, so narrow the type to one
  // representative motion element
  const Tag = TAGS[as] as typeof motion.div

  if (still) return <Tag className={className}>{children}</Tag>
  return (
    <Tag className={className} variants={revealItem}>
      {children}
    </Tag>
  )
}
