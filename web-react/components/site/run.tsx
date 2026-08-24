'use client'

import { MaskedTextReveal } from '@/components/ui/text-reveal'
import { CodePanel } from '@/components/site/code-panel'
import { Reveal, RevealGroup, RevealItem } from '@/components/ui/reveal'

const STATIC_CMD = `# serve the folder — any static host works
cd public && python3 -m http.server 8000
# or drop public/ on Netlify, Vercel, Pages, S3…`

const PYTHON_CMD = `pip install numpy
python web/server.py        # http://localhost:8765
python web/evolve.py        # headless pre-evolution`

const NEXT_CMD = `cd web-react && npm install
npm run dev                 # http://localhost:3000`

const EMBED = `<iframe src="https://your-host.example/evolvarium/"
  style="width:100%;max-width:1100px;height:900px;border:0"
  loading="lazy" title="Evolvarium"></iframe>`

const API = [
  ['/', 'the viewer'],
  ['/stream', 'Server-Sent Events — a snapshot pushed on every tick'],
  ['/state', 'the same snapshot as a one-off JSON request, gzipped'],
  ['/control', 'play · pause · toggle · step · reset · fps · mutation · food · brain'],
  ['/brains', 'the current champion genomes, as JSON'],
  ['/healthz', 'liveness probe'],
]

function Option({
  ix,
  title,
  children,
  body,
}: {
  ix: string
  title: string
  children: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-4 flex items-center gap-3 text-[18px] font-semibold tracking-[-0.01em]">
        <span className="inline-flex size-6 shrink-0 items-center justify-center border border-border-strong font-mono text-[11px] text-dim">
          {ix}
        </span>
        {title}
      </h3>
      {children}
      <p className="mt-4 text-[14.5px] leading-[1.7] text-muted-foreground">{body}</p>
    </div>
  )
}

export function Run() {
  return (
    <section id="run" className="mx-auto w-[min(1320px,100%-2rem)] scroll-mt-20 py-20 sm:py-28">
      <Reveal as="p" className="eyebrow mb-5 max-w-[520px]" from="none">
        Run it · embed it · host it
      </Reveal>
      <MaskedTextReveal
        as="h2"
        splitBy="words"
        className="max-w-[22ch] text-[clamp(25px,4.2vw,42px)] font-semibold leading-[1.15] tracking-[-0.02em]"
      >
        Three ways to put this somewhere
      </MaskedTextReveal>
      <Reveal
        as="p"
        delay={0.08}
        className="mt-5 max-w-[68ch] text-[17px] leading-[1.75] text-muted-foreground"
      >
        The page you are on is the React build: the whole simulation is JavaScript running in your
        tab, so every visitor gets their own world. The plain static folder still works with no
        build step at all, and the original Python server is there when you want one shared,
        persistent world instead.
      </Reveal>

      <RevealGroup className="mt-12 grid gap-10 lg:grid-cols-3" stagger={0.1}>
        <RevealItem>
        <Option
          ix="A"
          title="Next.js — this build"
          body={
            <>
              The app in <b className="text-foreground">web-react/</b> imports the same{' '}
              <b className="text-foreground">sim.js</b> engine the static page runs, so the world
              you see above is the real thing, not a recording.
            </>
          }
        >
          <CodePanel label="Bash" lang="bash" code={NEXT_CMD} />
        </Option>

        </RevealItem>

        <RevealItem>
        <Option
          ix="B"
          title="Static — one world per visitor"
          body={
            <>
              Needs a server only because the page loads ES modules; there is no backend and no
              build step. Champion genomes ship in{' '}
              <b className="text-foreground">seed_brains.json</b>, so the world opens already
              competent instead of starting from noise.
            </>
          }
        >
          <CodePanel label="Bash" lang="bash" code={STATIC_CMD} />
        </Option>

        </RevealItem>

        <RevealItem>
        <Option
          ix="C"
          title="Python — one shared world"
          body={
            <>
              Everyone watches the same simulation and the best genomes it has ever produced are
              saved back to disk, so a restart picks up where it left off. Set{' '}
              <b className="text-foreground">EVO_READONLY=1</b> for a public embed where visitors
              watch but cannot reset the world for everyone else.
            </>
          }
        >
          <CodePanel label="Bash" lang="bash" code={PYTHON_CMD} />
        </Option>
        </RevealItem>
      </RevealGroup>

      <RevealGroup className="mt-16 grid gap-10 lg:grid-cols-2" stagger={0.12}>
        <RevealItem>
          <h3 className="mb-4 text-[18px] font-semibold tracking-[-0.01em]">Embed it in a page</h3>
          <CodePanel label="HTML" lang="html" code={EMBED} />
        </RevealItem>

        <RevealItem>
          <h3 className="mb-4 text-[18px] font-semibold tracking-[-0.01em]">
            The Python server&rsquo;s HTTP API
          </h3>
          <div className="overflow-x-auto border border-border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Routes served by web/server.py</caption>
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-dim">
                    Route
                  </th>
                  <th className="px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-dim">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {API.map(([route, what]) => (
                  <tr key={route} className="border-b border-border/60 last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-[12.5px] text-herb">
                      {route}
                    </td>
                    <td className="px-3 py-2 text-[13.5px] leading-relaxed text-muted-foreground">
                      {what}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RevealItem>
      </RevealGroup>
    </section>
  )
}
