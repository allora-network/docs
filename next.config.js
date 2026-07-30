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
        {
          source: '/devs/consumers/consumer-contracts',
          destination: '/devs/consumers/allora-api-endpoint',
          permanent: true,
        },
        {
          source: '/devs/consumers/consumer-contracts/dev-consumers',
          destination: '/devs/consumers/allora-api-endpoint',
          permanent: true,
        },
        {
          source: '/devs/consumers/consumer-contracts/deploy-consumer',
          destination: '/devs/consumers/allora-api-endpoint',
          permanent: true,
        },
        {
          source: '/devs/consumers/existing-consumers',
          destination: '/devs/consumers/allora-api-endpoint',
          permanent: true,
        },
        {
          source: '/devs/consumers/walkthrough-use-topic-inference',
          destination: '/devs/consumers/allora-api-endpoint',
          permanent: true,
        },
        {
          source: '/devs/workers/deploy-worker/allora-mdk',
          destination: '/devs/workers/migrate-from-offchain-node',
          permanent: true,
        },
        {
          source: '/devs/workers/walkthroughs/walkthrough-price-prediction-worker/modelpy',
          destination: '/devs/workers/walkthroughs/walkthrough-price-prediction-worker',
          permanent: true,
        },
        {
          source: '/devs/workers/walkthroughs/walkthrough-hugging-face-worker',
          destination: '/devs/workers/walkthroughs/walkthrough-price-prediction-worker',
          permanent: true,
        },
        {
          source: '/devs/workers/deploy-worker/build-and-deploy-worker-with-alibaba-cloud',
          destination: '/devs/workers/deploy-worker/using-docker',
          permanent: true,
        },
        {
          source: '/devs/workers/deploy-worker/build-and-deploy-worker-with-node-runners',
          destination: '/devs/workers/deploy-worker/using-docker',
          permanent: true,
        },
        {
          source: '/devs/reputers/coin-prediction-reputer',
          destination: '/devs/reputers/build-a-reputer',
          permanent: true,
        },
      ];
    },
  }
)

// If you have other Next.js configurations, you can pass them as the parameter:
// module.exports = withNextra({ /* other next.js config */ })
// Learn more: https://nextra.site/docs/guide

