// theme.config.tsx 
import React from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { DocsThemeConfig, useConfig } from 'nextra-theme-docs'
import AiButton from './components/AiButton.js'

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
  logo: () => {
    return (
      <>
        <svg width="140" height="52" viewBox="0 0 1000 367">
          <path d="M333.119 211.64C335.611 203.274 336.969 194.408 336.969 185.227C336.969 18M636.634 248.469C629.346 248.469 622.822 247.293 617.062 244.942C611.419 76 776.518 220.962C776.518 223.195 777.165 225.076 778.458 226.604C779.751 228.132 781.279 229.367 783.042 230.307C784.923 231.13 786.922 231.718 789.037 232.07C791.271 232.423 793.269 232.599 795.032 232.599C797.266 232.599 799.676 232.305 802.262 231.718C804.848 231.13 807.258 230.131 809.491 228.72C811.842 227.31 813.782 225.546 815.31 223.43C816.838 221.197 817.602 218.493 817.602 215.32V200.332Z" fill="currentColor" />
        </svg>
      </>
    )
  },
  logoLink: "/",
  head: function useHead() {
    const { title } = useConfig()
    const socialCard = '/allora-link-preview'
    return (
      <>
        <meta name="msapplication-TileColor" content="#fff" />
        <meta name="theme-color" content="#fff" />
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
  primaryHue: { dark: 144.71, light: 145.41 },
  primarySaturation: { dark: 75.56, light: 55.78 },
  project: {
    link: 'https://github.com/allora-network'
  },
  chat: {
    link: 'https://discord.com/invite/allora'
  },
  // fixed-position container.
  footer: {
    component: () => (
      <div
        style={{
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: 1000,
        }}
      >
        <AiButton />
      </div>
    ),
  },
  sidebar: {
    autoCollapse: true,
  },
 
}

export default config;
