const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  latex: true,
  defaultShowCopyCode: true
})

module.exports = withNextra(
  {
    async redirects() {
      return [
        {
          source: '/',
          destination: '/home/explore',
          permanent: true,
        },
      ];
    },
  }
)

// If you have other Next.js configurations, you can pass them as the parameter:
// module.exports = withNextra({ /* other next.js config */ })
// Learn more: https://nextra.site/docs/guide

