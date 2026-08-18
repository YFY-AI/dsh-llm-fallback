// 构建:把 host 源码(src/*.js)与 client bundle 复制到 lib/(JS 直发,不编译)
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

for (const f of readdirSync('src')) {
  if (f.endsWith('.js')) {
    copyFileSync(`src/${f}`, `lib/${f}`)
    console.log(`copied src/${f} -> lib/${f}`)
  }
}
if (existsSync('client/client.js')) {
  copyFileSync('client/client.js', 'lib/client.js')
  console.log('copied client/client.js -> lib/client.js')
}
