// components/AlloraLogo.jsx
// Navbar brand lockup. Two static variants live in /public/logo/:
//   /logo/allora-lockup-dark.svg  — cream mark, shown on dark backgrounds
//   /logo/allora-lockup-light.svg — dark mark, shown on light backgrounds
// Both render; styles/navigation.css displays exactly one based on the
// <html> theme class, which next-themes sets before first paint — so a
// returning light-mode visitor never flashes the dark asset, and the
// component needs no runtime theme dependency at all.

// Native asset aspect ratio is 148:48 (content-trimmed viewBox); explicit
// dimensions avoid layout shift.
const WIDTH = 83
const HEIGHT = 27

export default function AlloraLogo() {
  return (
    <span className="allora-logo" style={{ display: 'block', width: WIDTH, height: HEIGHT }}>
      <img
        className="allora-logo-dark"
        src="/logo/allora-lockup-dark.svg"
        alt="Allora"
        width={WIDTH}
        height={HEIGHT}
      />
      <img
        className="allora-logo-light"
        src="/logo/allora-lockup-light.svg"
        alt="Allora"
        width={WIDTH}
        height={HEIGHT}
      />
    </span>
  )
}
