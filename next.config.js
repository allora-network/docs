const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  latex: true,
  defaultShowCopyCode: true,
  mdxOptions: {
    // Inject snippets/* files into ```lang file=<path> fences at build time so
    // documented code cannot drift from the runnable snippet files.
    remarkPlugins: [require('./scripts/remarkIncludeCode')]
  }
})

// Every path that existed before the six-section IA restructure 301s to its
// new home. Exact rules come first; tree-level catch-alls at the end are
// backstops so no URL under the old top-level trees can 404. Next.js applies
// the first matching rule.
const permanent = true;

const exactRedirects = {
  '/': '/get-started',

  // ── Get Started landing moved from /get-started/overview to /get-started ──
  '/get-started/overview': '/get-started',

  // ── pre-restructure redirects, retargeted to avoid chains ──
  '/devs/consumers/consumer-contracts': '/consume/api',
  '/devs/consumers/consumer-contracts/dev-consumers': '/consume/api',
  '/devs/consumers/consumer-contracts/deploy-consumer': '/consume/api',
  '/devs/consumers/existing-consumers': '/consume/api',
  '/devs/consumers/walkthrough-use-topic-inference': '/consume/api',
  '/devs/workers/deploy-worker/allora-mdk': '/build/migrate-from-offchain-node',
  '/devs/workers/walkthroughs/walkthrough-price-prediction-worker/modelpy': '/build/worker/sdk-py',
  '/devs/workers/walkthroughs/walkthrough-hugging-face-worker': '/build/worker/sdk-py',
  '/devs/workers/deploy-worker/build-and-deploy-worker-with-alibaba-cloud': '/build/worker/containerize',
  '/devs/workers/deploy-worker/build-and-deploy-worker-with-node-runners': '/build/worker/containerize',
  '/devs/reputers/coin-prediction-reputer': '/build/reputer/build-a-reputer',

  // ── /devs/consumers + /devs/sdk → Consume Inference ──
  '/devs/consumers': '/consume/overview',
  '/devs/consumers/allora-api-endpoint': '/consume/api',
  '/devs/consumers/rpc-data-access': '/consume/rpc-grpc',
  '/devs/sdk/overview': '/consume/sdk-overview',
  '/devs/sdk/allora-sdk-ts': '/consume/sdk-ts',
  '/devs/sdk/allora-sdk-py': '/consume/sdk-py',

  // ── /devs/get-started → Get Started / Build / Operate ──
  '/devs/get-started/overview': '/get-started',
  '/devs/get-started/setup-wallet': '/get-started/setup-wallet',
  '/devs/get-started/cli': '/get-started/cli',
  '/devs/get-started/basic-usage': '/get-started/basic-usage',
  '/devs/get-started/managing-gas': '/operate/gas-and-fees',
  '/devs/get-started/existing-topics': '/build/forge/topics',
  '/devs/get-started/query-network-data': '/operate/topics/query-network-data',
  '/devs/get-started/model-forge': '/build/forge/competitions',

  // ── /devs/workers → Build on Allora ──
  '/devs/workers': '/build/overview',
  '/devs/workers/requirements': '/build/worker/requirements',
  '/devs/workers/deploy-worker/using-docker': '/build/worker/containerize',
  '/devs/workers/walkthroughs/walkthrough-price-prediction-worker': '/build/worker/sdk-py',
  '/devs/workers/migrate-from-offchain-node': '/build/migrate-from-offchain-node',
  '/devs/workers/deploy-forecaster': '/build/forecaster',
  '/devs/workers/query-worker-data': '/build/worker/query-worker-data',
  '/devs/workers/query-ema-score': '/build/worker/query-ema-score',

  // ── /devs/reputers → Build on Allora ──
  '/devs/reputers': '/build/reputer',
  '/devs/reputers/reputers': '/build/reputer/deploy-docker',
  '/devs/reputers/build-a-reputer': '/build/reputer/build-a-reputer',
  '/devs/reputers/set-and-adjust-stake': '/build/reputer/set-and-adjust-stake',
  '/devs/reputers/query-reputer-data': '/build/reputer/query-reputer-data',
  '/devs/reputers/query-ema-score': '/build/reputer/query-ema-score',

  // ── /devs/topic-creators → Operate the Network ──
  '/devs/topic-creators/topic-life-cycle': '/operate/topics/lifecycle',
  '/devs/topic-creators/how-to-create-topic': '/operate/topics/create',
  '/devs/topic-creators/query-topic-data': '/operate/topics/query',

  // ── /home exceptions (slugs that changed or left Learn) ──
  '/home': '/learn/what-is-allora',
  '/home/delegating-stake': '/learn/staking',
  '/home/release-notes': '/reference/release-notes',
  // The whitepaper page was an orphaned glossary stub; the nav already points
  // at the PDF, so the URL does too.
  '/home/whitepaper': 'https://research.assets.allora.network/allora.0x10001.pdf',
  '/learn/whitepaper': 'https://research.assets.allora.network/allora.0x10001.pdf',

  // ── Learn consolidation: explore + overview → what-is-allora; the layers
  // tree → inference-synthesis (consumption, forecast, synthesis) and
  // consensus-and-rewards (consensus, worker/reputer/topic/total rewards).
  // Exact /home/... rules are listed too so those URLs jump straight to the
  // final destination instead of chaining through the /home/:path* rule.
  '/learn/explore': '/learn/what-is-allora',
  '/home/explore': '/learn/what-is-allora',
  '/learn/overview': '/learn/what-is-allora',
  '/home/overview': '/learn/what-is-allora',
  '/learn/layers': '/learn/inference-synthesis',
  '/home/layers': '/learn/inference-synthesis',
  '/learn/layers/inference-consumption': '/learn/inference-synthesis#inference-consumption',
  '/home/layers/inference-consumption': '/learn/inference-synthesis#inference-consumption',
  '/learn/layers/forecast-synthesis': '/learn/inference-synthesis#forecast-and-synthesis',
  '/home/layers/forecast-synthesis': '/learn/inference-synthesis#forecast-and-synthesis',
  '/learn/layers/forecast-synthesis/forecast': '/learn/inference-synthesis#forecast',
  '/home/layers/forecast-synthesis/forecast': '/learn/inference-synthesis#forecast',
  '/learn/layers/forecast-synthesis/synthesis': '/learn/inference-synthesis#synthesis',
  '/home/layers/forecast-synthesis/synthesis': '/learn/inference-synthesis#synthesis',
  '/learn/layers/consensus': '/learn/consensus-and-rewards',
  '/home/layers/consensus': '/learn/consensus-and-rewards',
  '/learn/layers/consensus/workers': '/learn/consensus-and-rewards#worker-rewards',
  '/home/layers/consensus/workers': '/learn/consensus-and-rewards#worker-rewards',
  '/learn/layers/consensus/reputers': '/learn/consensus-and-rewards#reputer-rewards',
  '/home/layers/consensus/reputers': '/learn/consensus-and-rewards#reputer-rewards',
  '/learn/layers/consensus/topic-rewards': '/learn/consensus-and-rewards#topic-rewards',
  '/home/layers/consensus/topic-rewards': '/learn/consensus-and-rewards#topic-rewards',
  '/learn/layers/consensus/total-rewards': '/learn/consensus-and-rewards#total-rewards',
  '/home/layers/consensus/total-rewards': '/learn/consensus-and-rewards#total-rewards',

  // ── /marketplace → Consume Inference ──
  '/marketplace': '/consume/integrations',
  '/marketplace/explore': '/consume/integrations',

  // ── /community → repo CONTRIBUTING ──
  '/community': 'https://github.com/allora-network/docs/blob/main/CONTRIBUTING.md',
  '/community/contribute': 'https://github.com/allora-network/docs/blob/main/CONTRIBUTING.md',
  '/community/resources': 'https://github.com/allora-network/docs/blob/main/CONTRIBUTING.md',
};

const treeRedirects = [
  // Eliza-OS integration removed (upstream no longer ships the plugin); these
  // must precede the slug-preserving /marketplace/integrations rule so old
  // Eliza URLs reach their final destination in a single hop.
  { source: '/consume/integrations/eliza-os/:path*', destination: '/consume/integrations', permanent },
  { source: '/marketplace/integrations/eliza-os/:path*', destination: '/consume/integrations', permanent },
  // Slug-preserving subtree moves.
  { source: '/devs/reference/:path*', destination: '/reference/:path*', permanent },
  { source: '/devs/validators/:path*', destination: '/operate/validators/:path*', permanent },
  { source: '/marketplace/integrations/:path*', destination: '/consume/integrations/:path*', permanent },
  { source: '/home/:path*', destination: '/learn/:path*', permanent },
  // Backstops: anything else under the removed trees lands somewhere useful.
  { source: '/devs/:path*', destination: '/get-started', permanent },
  { source: '/marketplace/:path*', destination: '/consume/integrations', permanent },
  { source: '/community/:path*', destination: 'https://github.com/allora-network/docs/blob/main/CONTRIBUTING.md', permanent },
];

module.exports = withNextra(
  {
    async redirects() {
      return [
        ...Object.entries(exactRedirects).map(([source, destination]) => ({
          source,
          destination,
          permanent,
        })),
        ...treeRedirects,
      ];
    },
  }
)

// If you have other Next.js configurations, you can pass them as the parameter:
// module.exports = withNextra({ /* other next.js config */ })
// Learn more: https://nextra.site/docs/guide
