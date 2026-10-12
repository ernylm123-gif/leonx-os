// vercel.json'daki rewrites + headers kurallarını bir build klasörü üzerinde uygulayan
// küçük statik sunucu (yalnızca test için). Kullanım: startStaticServer(dir, port)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
}

export function startStaticServer(dir, port, vercelJsonPath) {
  const root = path.resolve(dir)
  const cfg = JSON.parse(readFileSync(vercelJsonPath, 'utf8'))
  const re = (src) => new RegExp('^' + src + '$')
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    for (const h of cfg.headers) if (re(h.source).test(url)) for (const { key, value } of h.headers) res.setHeader(key, value)
    let file = path.join(root, url === '/' ? 'index.html' : url)
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      const rw = cfg.rewrites.find((r) => re(r.source).test(url))
      if (!rw) {
        res.writeHead(404)
        return res.end('404')
      }
      file = path.join(root, rw.destination)
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}
