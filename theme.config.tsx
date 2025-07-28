import React from 'react'
import { useRouter } from 'next/router'
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
  logo: () => null,
  docsRepositoryBase: 'https://github.com/allora-network/docs',
  logoLink: "/",
  navbar: {
    extraContent: (
      <div className="nav-extras">
        <AiButton />
      </div>
    )
  },
  navigation: {
    prev: true,
    next: true
  },
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
        <style>{`
          /* Navigation Styling */
          .nextra-nav-container a[data-active],
          .nextra-nav-container .nx-items a {
            display: flex !important;
            align-items: center;
            padding: 0.5rem 0;
            color: #4b5563;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
          }

          .nextra-nav-container a[data-active]:hover,
          .nextra-nav-container .nx-items a:hover {
            color: #059669;
          }

          .nextra-nav-container a[data-active="true"] {
            color: #059669;
            font-weight: 600;
          }

          /* AI Button Styling */
          .nav-extras button {
            margin-bottom: 0 !important;
            background: linear-gradient(135deg, #f8fafc, #f1f5f9) !important;
            color: #475569 !important;
            height: 2.25rem;
            padding: 0 14px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 6px !important;
            transition: all 0.2s ease !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
          }

          .nav-extras button:hover {
            background: linear-gradient(135deg, #e2e8f0, #cbd5e1) !important;
            border-color: #cbd5e1 !important;
            color: #1e293b !important;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
            transform: translateY(-1px) !important;
          }

          .nav-extras button:active {
            transform: translateY(0) !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
          }

          /* Sidebar Enhancement */
          .nx-sidebar-container {
            border-right: 1px solid #f1f5f9;
          }

          .nx-sidebar-container .nx-sidebar {
            padding: 1rem 0;
          }

          /* Content Area */
          .nx-content {
            padding-top: 2rem;
          }

          /* Responsive Design */
          @media (max-width: 480px) {
            .nav-extras {
              display: none;
            }
          }

          /* Dark Mode Support */
          .dark .nav-extras button {
            background: linear-gradient(135deg, #374151, #4b5563) !important;
            color: #d1d5db !important;
            border-color: #4b5563 !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
          }

          .dark .nav-extras button:hover {
            background: linear-gradient(135deg, #4b5563, #6b7280) !important;
            border-color: #6b7280 !important;
            color: #f3f4f6 !important;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4) !important;
          }

          .dark .nx-sidebar-container {
            border-right-color: #374151;
          }

          /* Custom Focus States */
          .nav-extras button:focus-visible {
            outline: 2px solid #10b981 !important;
            outline-offset: 2px !important;
          }

          /* Page Title Enhancement */
          .nx-content h1:first-child {
            background: linear-gradient(135deg, #111827, #374151);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 1.5rem;
          }

          .dark .nx-content h1:first-child {
            background: linear-gradient(135deg, #f9fafb, #e5e7eb);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          /* Sidebar Section Headings */
          .sidebar-separator-container {
            margin: 12px 0 4px 0 !important;
            padding: 0 !important;
          }

          .sidebar-separator-container:first-child {
            margin-top: 8px !important;
          }

          .sidebar-separator-container:not(:first-child) {
            margin-top: 8px !important;
          }

          .sidebar-separator-line {
            height: 1px !important;
            background-color: #e5e7eb !important;
            margin: 4px 0 0 0 !important;
            width: 100% !important;
          }

          .sidebar-separator-line-top {
            height: 1px !important;
            background-color: #e5e7eb !important;
            margin: 0 0 4px 0 !important;
            width: 100% !important;
          }

          .sidebar-separator {
            display: block !important;
            color: #6b7280 !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.05em !important;
            padding: 4px 16px 4px 16px !important;
          }

          .dark .sidebar-separator-line {
            background-color: #374151 !important;
          }

          .dark .sidebar-separator-line-top {
            background-color: #374151 !important;
          }

          .dark .sidebar-separator {
            color: #9ca3af !important;
          }
        `}</style>
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
  footer: {
    component: null
  },
  sidebar: {
    autoCollapse: true,
    defaultMenuCollapseLevel: 1,
    titleComponent: ({ title, type }) => {
      if (type === 'separator') {
        const isFirst = title === 'DOCUMENTATION'
        return (
          <div className="sidebar-separator-container">
            {!isFirst && <div className="sidebar-separator-line-top"></div>}
            <span className="sidebar-separator">{title}</span>
            {isFirst && <div className="sidebar-separator-line"></div>}
          </div>
        )
      }
      return <>{title}</>
    }
  },
  toc: {
    backToTop: true
  },
  editLink: {
    text: 'Edit this page on GitHub →'
  },
  feedback: {
    content: 'Question? Give us feedback →',
    labels: 'feedback'
  },
  gitTimestamp: ({ timestamp }) => (
    <div className="text-xs text-gray-500 mt-6">
      Last updated on {timestamp.toLocaleDateString()}
    </div>
  )
}

export default config