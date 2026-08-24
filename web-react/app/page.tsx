import { Nav } from '@/components/site/nav'
import { Hero } from '@/components/site/hero'
import { Lab } from '@/components/site/lab'
import { Rules } from '@/components/site/rules'
import { Brain } from '@/components/site/brain'
import { Run } from '@/components/site/run'
import { Footer } from '@/components/site/footer'
import { LiveProvider } from '@/components/site/live-context'

export default function Home() {
  return (
    <LiveProvider>
      <a
        href="#lab"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-120 focus:bg-primary focus:px-3.5 focus:py-2 focus:font-mono focus:text-[13px] focus:font-semibold focus:text-primary-foreground"
      >
        Skip to the simulation
      </a>
      <Nav />
      <main>
        <Hero />
        <Lab />
        <Rules />
        <Brain />
        <Run />
      </main>
      <Footer />
    </LiveProvider>
  )
}
