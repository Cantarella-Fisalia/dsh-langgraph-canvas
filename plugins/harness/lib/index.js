import { environmentValue } from '../../../scripts/runtime/brand.mjs'
/**
 * langcontour —— 宿主半侧（完整编辑闭环）
 *
 * 职责（按 docs/COOPERATION_AGREEMENT.md 2.2）：把甲方交付的独立前后端接进 Harness。
 *
 *   1. 静态：把 apps/frontend/dist 挂在 /langcontour/app 下（同源，iframe 可加载）
 *   2. API ：把 apps/backend 的 createApplication 挂在 /langcontour/api/v1
 *   3. 生命周期：插件卸载时调用 application.close()，关掉 watcher / SSE / Python worker
 *
 * 行为模型服务只返回代码 JSON；受限临时副本与确认事务见 P3_BEHAVIOR_TASKS_API.md。
 */

import { createReadStream, existsSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHarnessBehaviorAdapter } from './behavior-adapter.js'
import { createHarnessAnalysisAdapter } from './analysis-adapter.js'

export const name = 'langcontour'

/** 需要注入的服务：webServer 提供 HTTP 路由能力（见 dsh-host-webserver）。 */
// Conversation services are optional: static graph viewing needs only webServer.
export const inject = ['webServer']

const VERSION = '0.7.0'

/**
 * 仓库根：插件可能被 pnpm link / 目录联结加载，import.meta.url 会停在
 * <profile>/node_modules/langcontour/lib/index.js，必须先解链，
 * 否则静态目录和后端入口都会指到 profile 里去。
 *
 * 注意：pnpm 生成的联结用 realpathSync 解不开，必须用 realpathSync.native。
 */
function resolveRepoRoot() {
  const fromEnv = environmentValue('REPO_ROOT')
  if (fromEnv && existsSync(join(fromEnv, 'apps', 'backend', 'src', 'application.ts'))) return resolve(fromEnv)

  const self = fileURLToPath(import.meta.url)
  let real
  try {
    real = realpathSync.native(self)
  } catch {
    real = realpathSync(self)
  }
  return resolve(dirname(real), '../../..')
}

const REPO_ROOT = resolveRepoRoot()
const FRONTEND_DIST = join(REPO_ROOT, 'apps', 'frontend', 'dist')
const BACKEND_ENTRY = join(REPO_ROOT, 'apps', 'backend', 'src', 'application.ts')

/** 后端 API 前缀，必须与前端 apiBase 一致。 */
const API_PREFIX = '/langcontour/api/v1'
const APP_PREFIX = '/langcontour/app'
const ROUTE_PREFIX = '/langcontour'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function apply(ctx) {
  console.log('[langcontour] host plugin loaded (v' + VERSION + ') root=' + REPO_ROOT)

  /** 后端应用惰性创建：首次请求时才 import（类型剥离 + 启动 Python 客户端）。 */
  let applicationPromise
  const behaviorTaskAdapter = createHarnessBehaviorAdapter(ctx, { repoRoot: REPO_ROOT })
  function getApplication() {
    if (!applicationPromise) {
      applicationPromise = Promise.all([
        import(pathToFileURL(BACKEND_ENTRY).href),
        import(pathToFileURL(join(REPO_ROOT, 'scripts/runtime/python.mjs')).href),
      ]).then(([mod, runtime]) => {
          const pythonCommand = runtime.resolvePythonCommand()
          const application = mod.createApplication({
            repoRoot: REPO_ROOT,
            pythonCommand,
            apiPrefix: API_PREFIX,
            allowedOrigins: ['dsh-app://app'],
            behaviorTaskAdapter,
            analysisAdapter: createHarnessAnalysisAdapter(ctx),
          })
          console.log('[langcontour] backend mounted at ' + API_PREFIX + ' python=' + pythonCommand)
          return application
        })
        .catch((error) => {
          applicationPromise = undefined
          console.error('[langcontour] backend import failed:', error)
          throw error
        })
    }
    return applicationPromise
  }

  async function serveStatic(req, res, pathname) {
    const relative = pathname.slice(APP_PREFIX.length).replace(/^\/+/, '')
    const root = resolve(FRONTEND_DIST)
    const target = resolve(root, relative === '' ? 'index.html' : relative)
    if (target !== root && !target.startsWith(root + sep)) {
      sendJson(res, 403, { error: { code: 'FORBIDDEN', message: '路径越界。' } })
      return
    }
    let info
    try {
      info = await stat(target)
    } catch {
      // 目录缺省页：/langcontour/app 与 /langcontour/app/ 都返回 index.html
      if (relative === '' || extname(relative) === '') {
        return serveStatic(req, res, APP_PREFIX + '/index.html')
      }
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '静态资源不存在。' } })
      return
    }
    if (!info.isFile()) {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '静态资源不存在。' } })
      return
    }
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
    const versionedAsset = /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(relative)
    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': versionedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(target).pipe(res)
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          let pathname

          try {
            try { pathname = decodeURIComponent(url.pathname) }
            catch { sendJson(res, 400, { error: { code: 'INVALID_PATH', message: '路径编码无效。' } }); return }
            // 兼容 P0 健康检查，便于确认宿主侧是否加载
            if (req.method === 'GET' && pathname === '/langcontour/api/health') {
              let backend = 'pending'
              try {
                await getApplication()
                backend = 'ready'
              } catch (error) {
                backend = 'error: ' + (error instanceof Error ? error.message : String(error))
              }
              sendJson(res, 200, {
                ok: backend === 'ready',
                name,
                version: VERSION,
                stage: 'behavior-integration',
                behavior: await behaviorTaskAdapter.support(),
                backend,
                paths: { frontend: FRONTEND_DIST, backend: BACKEND_ENTRY, api: API_PREFIX },
                runtime: { node: process.version, platform: process.platform, pid: process.pid },
                at: new Date().toISOString(),
              })
              return
            }

            // 后端 API：交给甲方 application.handler，未匹配返回 false
            if (pathname === API_PREFIX || pathname.startsWith(API_PREFIX + '/')) {
              const application = await getApplication()
              const handled = await application.handler(req, res)
              if (!handled) sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } })
              return
            }

            // 前端静态产物
            if (pathname === APP_PREFIX || pathname.startsWith(APP_PREFIX + '/')) {
              await serveStatic(req, res, pathname)
              return
            }

            sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '路径不存在。', path: pathname } })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[langcontour] request failed:', pathname, message)
            if (!res.headersSent) sendJson(res, 500, { error: { code: 'INTEGRATION_ERROR', message } })
            else res.end()
          }
        },
      }),
    'langcontour: /langcontour routes (app + api)',
  )

  // 卸载清理：关 watcher、SSE 监听与 Python worker
  ctx.effect(() => async () => {
    await behaviorTaskAdapter.close()
    if (!applicationPromise) return
    await applicationPromise.then((application) => application.close())
      .catch((error) => console.error('[langcontour] close failed:', error))
  }, 'langcontour: application lifecycle')
}
