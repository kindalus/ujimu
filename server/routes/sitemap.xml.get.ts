import { defineEventHandler, setHeader } from 'h3'
import { getPublicSpecialists } from '../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const specialists = await getPublicSpecialists()
  const specialistUrls = specialists
    .map((specialist) => `  <url>\n    <loc>https://ujimu.com/especialidades/${escapeXml(specialist.id)}</loc>\n  </url>`)
    .join('\n')
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ujimu.com/</loc>
  </url>${specialistUrls ? `\n${specialistUrls}` : ''}
</urlset>
`

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return sitemap
})

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
