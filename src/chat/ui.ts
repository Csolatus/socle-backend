import { Hono } from 'hono'
import { chatPage } from './ui-page.ts'

let clientBundle: Promise<string> | undefined

async function bundleClient(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL('./client.ts', import.meta.url).pathname],
    target: 'browser',
    minify: true,
  })
  if (!result.success || !result.outputs[0]) {
    throw new Error('Unable to build the chat UI client', {
      cause: result.logs,
    })
  }
  return result.outputs[0].text()
}

export function chatUiRoutes() {
  const routes = new Hono()
  routes.get('/', (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    c.header('X-Content-Type-Options', 'nosniff')
    return c.html(chatPage)
  })
  routes.get('/chat-ui.js', async (c) => {
    clientBundle ??= bundleClient().catch((error: unknown) => {
      clientBundle = undefined
      throw error
    })
    c.header('Content-Type', 'text/javascript; charset=utf-8')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'no-cache')
    return c.body(await clientBundle)
  })
  routes.get('/chat-ui.css', async (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(await Bun.file(new URL('./ui.css', import.meta.url)).text())
  })
  return routes
}
