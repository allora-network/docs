// components/AlloraLogo.jsx
// Navbar brand lockup. Two static variants live in /public/logo/:
//   /logo/allora-lockup-dark.svg  — cream mark, shown on dark backgrounds
//   /logo/allora-lockup-light.svg — dark mark, shown on light backgrounds
// The site is dark-first, so the dark variant is also the pre-hydration
// fallback (next-themes only knows the resolved theme after mount).
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

const LOCKUPS = {
  dark: '/logo/allora-lockup-dark.svg',
  light: '/logo/allora-lockup-light.svg',
}

// Native asset aspect ratio is 148:48 (content-trimmed viewBox); explicit
// dimensions avoid layout shift.
const WIDTH = 83
const HEIGHT = 27

export default function AlloraLogo() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const variant = mounted && resolvedTheme === 'light' ? 'light' : 'dark'

  return (
    <img
      src={LOCKUPS[variant]}
      alt="Allora"
      width={WIDTH}
      height={HEIGHT}
      style={{ display: 'block' }}
    />
  )
}
