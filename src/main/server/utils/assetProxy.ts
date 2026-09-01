import type { Request, Response } from 'express'

const PROXY_PATH = '/api/assets/proxy'
const MAX_ASSET_BYTES = 10 * 1024 * 1024

const isLocalHost = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())

export const proxyAssetUrl = (url: string | null | undefined): string => {
  if (!url || !/^https?:\/\//i.test(url)) return url || ''
  try {
    if (isLocalHost(new URL(url).hostname)) return url
  } catch {
    return url
  }
  return `${PROXY_PATH}?url=${encodeURIComponent(url)}`
}

export const proxyAsset = async (req: Request, res: Response): Promise<void> => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : ''
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    res.status(400).json({ error: 'A valid asset URL is required' })
    return
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    res.status(400).json({ error: 'Only HTTP and HTTPS assets are supported' })
    return
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      res.status(response.status).end()
      return
    }

    const contentType = response.headers.get('content-type') || ''
    const contentLength = Number(response.headers.get('content-length'))
    if (!contentType.toLowerCase().startsWith('image/') || contentLength > MAX_ASSET_BYTES) {
      res.status(415).end()
      return
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > MAX_ASSET_BYTES) {
      res.status(413).end()
      return
    }

    res.setHeader('Cache-Control', 'public, max-age=300')
    res.setHeader('Content-Type', contentType)
    res.send(body)
  } catch {
    res.status(502).end()
  }
}
