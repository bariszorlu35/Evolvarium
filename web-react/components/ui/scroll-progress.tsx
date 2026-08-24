'use client'

import { motion, useScroll, useSpring } from 'motion/react'

/**
 * A hairline under the sticky header that tracks read position. It sits on the
 * header's own bottom border, so it reads as that border filling in rather than
 * as an extra chrome element.
 */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll()
  const width = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 })

  return (
    <motion.div
      aria-hidden="true"
      className={className}
      style={{ scaleX: width, transformOrigin: '0% 50%' }}
    />
  )
}
