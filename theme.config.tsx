// theme.config.tsx
import React from 'react'
import { useRouter } from 'next/router'
import { DocsThemeConfig, useConfig } from 'nextra-theme-docs'
import AiButton from './components/AiButton.js'
import AlloraLogo from './components/AlloraLogo.jsx'

const config: DocsThemeConfig = {
  useNextSeoProps() {
    const { asPath } = useRouter()
    if (asPath !== '/') {
      return {
        titleTemplate: '%s – Allora'
      }
    }
  },
  docsRepositoryBase: 'https://github.com/allora-network/docs',
  logo: AlloraLogo,
  logoLink: "/",
  head: function useHead() {
    const { title } = useConfig()
    const socialCard = 'https://docs.allora.network/allora-link-preview.png'
    return (
      <>
        <meta name="msapplication-TileColor" content="#101010" />
        <meta name="theme-color" content="#101010" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Language" content="en" />
        <meta
          name="description"
          content="A self-improving decentralized AI network."
        />
        <meta
          name="og:description"
          content="A self-improving decentralized AI network."
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={socialCard} />
        <meta name="twitter:site:domain" content="allora.network" />
        <meta name="twitter:url" content="https://allora.network" />
        <meta
          name="og:title"
          content={title ? title + ' – Allora' : 'Allora'}
        />
        <meta name="og:image" content={socialCard} />
        <meta name="apple-mobile-web-app-title" content="Allora" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.png" type="image/png" />
      </>
    )
  },
  // Brand accent: --allora-accent-1 #ff6200 == hsl(23.06deg 100% 50%).
  // Same orange in both modes, so scalar values cover dark and light.
  primaryHue: 23.06,
  primarySaturation: 100,
  // Dark-first: next-themes defaults to dark on first visit; the toggle
  // still switches to light and persists via localStorage.
  nextThemes: {
    defaultTheme: 'dark',
  },
  project: {
    link: 'https://github.com/allora-network'
  },
  chat: {
    link: 'https://discord.com/invite/allora'
  },
  // Visible footer links plus the fixed-position AI button container.
  footer: {
    component: () => (
      <>
        <footer
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "var(--allora-space-lg)",
            padding: "var(--allora-space-lg) var(--allora-space-base)",
            fontSize: "var(--allora-text-xs)",
            color: "var(--allora-text-muted)",
          }}
        >
          <a href="https://github.com/allora-network/docs/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">
            Contribute
          </a>
          <a href="https://discord.gg/allora" target="_blank" rel="noreferrer">
            Discord
          </a>
          <a href="https://twitter.com/AlloraNetwork" target="_blank" rel="noreferrer">
            Twitter
          </a>
          <a href="https://research.allora.network" target="_blank" rel="noreferrer">
            Research Forum
          </a>
          <a href="https://research.assets.allora.network/allora.0x10001.pdf" target="_blank" rel="noreferrer">
            Whitepaper
          </a>
        </footer>
        <div
          style={{
            position: "fixed",
            right: "var(--allora-space-md)",
            bottom: "var(--allora-space-md)",
            zIndex: 1000,
          }}
        >
          <AiButton />
        </div>
      </>
    ),
  },
  sidebar: {
    autoCollapse: true,
  },

}

export default config;
