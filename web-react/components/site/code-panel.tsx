'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { CodeBlock } from '@/components/ui/code-block'
import { cn } from '@/lib/utils'

/**
 * Thin chrome around the code-block primitive: a mono caption bar and
 * a copy button, in the console idiom the rest of the page uses.
 */
export function CodePanel({
  label,
  code,
  lang,
  className,
}: {
  label: string
  code: string
  lang: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — the code is selectable anyway */
    }
  }

  return (
    <figure className={cn('border border-border bg-void', className)}>
      <figcaption className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-1.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-plant" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      {/* animated code block */}
      <CodeBlock
        code={code}
        lang={lang}
        theme="dark"
        themes={{ light: 'github-light', dark: 'vesper' }}
        className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] [&_pre]:!bg-transparent [&_code]:!bg-transparent"
      />
    </figure>
  )
}
