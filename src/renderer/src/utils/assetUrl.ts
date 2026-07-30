export function resolveAssetUrl(url: string | null | undefined, baseUrl: string): string {
  if (!url) return ''
  if (/^(?:https?:|data:|blob:)/i.test(url)) return url
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
}
