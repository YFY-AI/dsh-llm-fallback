// 构建辅助:把 client bundle 复制到 lib/(DSH client 加载路径)
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })
copyFileSync('client/client.js', 'lib/client.js')
console.log('copied client/client.js -> lib/client.js')
