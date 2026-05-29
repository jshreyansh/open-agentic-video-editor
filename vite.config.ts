import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GoogleAuth } from 'google-auth-library'

// Load .env.local (and .env) into process.env for server-side plugin use.
// Vite only injects VITE_-prefixed vars into client code; server-side proxy code
// reads process.env directly so we populate it here before plugins initialise.
for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(new URL(`./${envFile}`, import.meta.url), 'utf8')
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* file doesn't exist — skip */
  }
}

const oxlintConfig = JSON.parse(readFileSync(new URL('./.oxlintrc.json', import.meta.url), 'utf8'))
const oxfmtConfig = JSON.parse(readFileSync(new URL('./.oxfmtrc.json', import.meta.url), 'utf8'))
const toolIgnorePatterns = [
  'dist/**',
  'coverage/**',
  'public/**',
  'tmp/**',
  'output/**',
  'scripts/**',
]

type ServerMiddlewareHandler = (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
) => void

// Vite plugin: proxy /api/gemini to Vertex AI Gemini using ADC (local dev only).
// Accepts ?model=<name> query param to target different Gemini models (e.g. TTS).
// Default model: gemini-2.5-flash
function geminiApiProxy() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

  return {
    name: 'gemini-api-proxy',
    configureServer(server: {
      middlewares: { use: (path: string, h: ServerMiddlewareHandler) => void }
    }) {
      server.middlewares.use('/api/gemini', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          // Parse model from query string: /api/gemini?model=gemini-2.5-flash-preview-tts
          const url = new URL(req.url ?? '', 'http://localhost')
          const model = url.searchParams.get('model') ?? 'gemini-2.5-flash'

          void (async () => {
            try {
              const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? (await auth.getProjectId())
              const location = process.env['GOOGLE_CLOUD_LOCATION'] ?? 'us-central1'
              const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`

              const client = await auth.getClient()
              const tokenResponse = await client.getAccessToken()
              const token = tokenResponse.token

              if (!token) {
                res.statusCode = 401
                res.setHeader('Content-Type', 'application/json')
                res.end(
                  JSON.stringify({
                    error: {
                      message: 'ADC not configured. Run: gcloud auth application-default login',
                    },
                  }),
                )
                return
              }

              const r = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body,
              })
              const data = await r.text()
              res.statusCode = r.status
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: { message: String(err) } }))
            }
          })()
        })
      })
    },
  }
}

// Vite plugin: proxy /api/cartesia to Cartesia TTS API (local dev only).
// Reads API key from X-Cartesia-Api-Key request header (supplied by client settings UI)
// or falls back to CARTESIA_API_KEY env var.
function cartesiaApiProxy() {
  return {
    name: 'cartesia-api-proxy',
    configureServer(server: {
      middlewares: { use: (path: string, h: ServerMiddlewareHandler) => void }
    }) {
      server.middlewares.use('/api/cartesia', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          const apiKey =
            (req.headers['x-cartesia-api-key'] as string | undefined) ??
            process.env['CARTESIA_API_KEY'] ??
            ''

          if (!apiKey) {
            res.statusCode = 401
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Cartesia API key not configured' }))
            return
          }

          void (async () => {
            try {
              const r = await fetch('https://api.cartesia.ai/tts/bytes', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cartesia-Version': '2024-06-10',
                  'X-API-Key': apiKey,
                },
                body,
              })
              const data = await r.arrayBuffer()
              res.statusCode = r.status
              res.setHeader('Content-Type', r.headers.get('content-type') ?? 'audio/wav')
              res.end(Buffer.from(data))
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: String(err) }))
            }
          })()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  lint: {
    ...oxlintConfig,
    ignorePatterns: toolIgnorePatterns,
    options: {
      ...(oxlintConfig.options ?? {}),
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ...oxfmtConfig,
    ignorePatterns: toolIgnorePatterns,
  },
  staged: {
    '*.{js,ts,tsx,json}': 'vp check --fix',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), geminiApiProxy(), cartesiaApiProxy()]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // @mediabunny/ac3 is an intentionally large lazy decoder bundle (~1.1 MB minified).
    // Keep warnings focused on unexpected growth rather than this known outlier.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Logger must be in its own chunk to avoid circular chunk TDZ errors.
          // Without this, Rollup places it in composition-runtime which has a
          // circular import with media-library, causing "Cannot access before
          // initialization" in production builds.
          if (id.endsWith('src/shared/logging/logger.ts')) {
            return 'core-logger'
          }

          // Timeline bridge modules that re-export UI must live with the UI
          // chunk; otherwise core ends up importing UI, which creates a
          // feature-editing-core <-> feature-editing-ui TDZ cycle at startup.
          if (
            id.includes('/src/features/timeline/contracts/editor.ts') ||
            id.includes('/src/features/timeline/index.ts')
          ) {
            return 'feature-editing-ui'
          }

          // Application feature chunks
          if (
            id.includes('/src/features/timeline/') ||
            id.includes('/src/features/media-library/')
          ) {
            if (id.includes('/components/')) {
              return 'feature-editing-ui'
            }
            return 'feature-editing-core'
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects'
          }
          // Composition-runtime shares deeply coupled deps with editing-core
          // (timeline stores, keyframes, export utils). Merging them into one
          // chunk eliminates the circular chunk dependency that causes TDZ
          // errors ("Cannot access before initialization") in production builds.
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-editing-core'
          }

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor'
          }
          // Router framework
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor'
          }
          // State management
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor'
          }
          // Media processing - loaded on demand
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder'
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder'
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core'
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing'
          }
          // Audio/video processing helpers
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing'
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui'
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (id.includes('lucide-react')) {
            return 'vendor-icons'
          }
          return undefined
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: [
      'mediabunny',
      '@mediabunny/ac3',
      '@mediabunny/mp3-encoder',
      '@huggingface/transformers',
    ],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
})
