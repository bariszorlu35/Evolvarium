'use client'

import * as React from 'react'
import { useInView, type UseInViewOptions } from 'motion/react'

export type UseIsInViewOptions = {
  inView?: boolean
  inViewOnce?: boolean
  inViewMargin?: UseInViewOptions['margin']
}

/**
 * Wraps motion's `useInView` and merges a forwarded ref with a local one, so a
 * primitive can both expose its node and watch its own visibility.
 * When `inView` is false the element is treated as always visible.
 */
export function useIsInView<T extends HTMLElement = HTMLElement>(
  ref: React.Ref<T> | undefined,
  { inView = false, inViewOnce = true, inViewMargin = '0px' }: UseIsInViewOptions = {},
) {
  const localRef = React.useRef<T>(null)
  React.useImperativeHandle(ref, () => localRef.current as T)

  const inViewResult = useInView(localRef, {
    once: inViewOnce,
    margin: inViewMargin,
  })

  return { ref: localRef, isInView: !inView || inViewResult }
}
