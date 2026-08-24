import './styles/globals.css'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'

/* Geist for running text — a grotesque drawn for interfaces, with the tight
   apertures and true tabular figures the readouts need. Space Grotesk carries
   the headings: same skeleton, but the clipped terminals give the display sizes
   the slightly technical voice the subject deserves. Geist Mono replaces
   JetBrains Mono so the instrument labels sit on the same metrics as the body. */
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bariszorlu.com'),
  title: 'Evolvarium — evolving artificial life',
  description:
    'An open-ended artificial-life simulation. Synthetic creatures forage, hunt and breed while their neural-network brains evolve in real time — live in your browser, with no server.',
  openGraph: {
    title: 'Evolvarium — evolving artificial life',
    description:
      'Creatures forage, hunt and breed while their neural-network brains evolve in real time. Runs entirely in your browser.',
    type: 'website',
    images: [`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/preview.png`],
  },
  twitter: { card: 'summary_large_image' },
  icons: {
    icon:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%2305070a'/%3E%3Crect x='7' y='8' width='7' height='7' rx='2' fill='%2339c6ff'/%3E%3Crect x='18' y='17' width='7' height='7' rx='2' fill='%23ff6a4d'/%3E%3Crect x='19' y='9' width='3' height='3' fill='%2339d17a'/%3E%3C/svg%3E",
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#05070a',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
