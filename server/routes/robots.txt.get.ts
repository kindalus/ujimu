import { defineEventHandler, setHeader } from 'h3'

const robots = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /account/
Disallow: /companies/
Disallow: /subscription
Disallow: /api/

Sitemap: https://ujimu.com/sitemap.xml
`

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return robots
})
