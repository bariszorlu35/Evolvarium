'use client'

import { createContext, useContext, useState } from 'react'

/**
 * Whether the world is currently stepping. The Lab owns the simulation, but the
 * header's pulse has to tell the truth about it, so the flag lives one level up.
 */
const LiveContext = createContext<{
  live: boolean
  setLive: (v: boolean) => void
}>({ live: false, setLive: () => {} })

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState(false)
  return <LiveContext.Provider value={{ live, setLive }}>{children}</LiveContext.Provider>
}

export const useLive = () => useContext(LiveContext)
