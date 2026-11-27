#!/usr/bin/env node
/**
 * ให้เครื่องพากย์ (scripts/tts-worker.mjs) เปิดเองทุกครั้งที่ login — ไม่มีหน้าต่างค้าง
 * วางไฟล์ .vbs ในโฟลเดอร์ Startup ของผู้ใช้ (ไม่ต้องใช้สิทธิ์ admin) แล้วเปิด worker ทันที
 *
 *   node scripts/install-tts-worker.mjs [--host 24hrs] [--root C:/Git/china]   ติดตั้ง + เปิดเลย
 *   node scripts/install-tts-worker.mjs --uninstall                             เอาออก (worker ตัวที่เปิดอยู่ต้องปิดเอง)
 *
 * log: projects/_tts_worker/worker.log
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../pipeline/lib/config.mjs'

const startup = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const file = join(startup, 'China TTS worker.vbs')

if (process.argv.includes('--uninstall')) {
  rmSync(file, { force: true })
  console.log(`เอาออกจาก Startup แล้ว: ${file}`)
  process.exit(0)
}
if (!existsSync(startup)) {
  console.error(`ไม่พบโฟลเดอร์ Startup: ${startup}`)
  process.exit(1)
}

const pass = []
for (const name of ['host', 'root', 'node']) {
  const i = process.argv.indexOf(`--${name}`)
  if (i > 0 && process.argv[i + 1]) pass.push(`--${name}`, process.argv[i + 1])
}
const worker = join(ROOT, 'scripts', 'tts-worker.mjs')
const q = (s) => `""${s}""` // quote ภายในสตริงของ VBScript
const cmd = [q(process.execPath), q(worker), ...pass.map(q)].join(' ')
writeFileSync(
  file,
  [
    "' เครื่องพากย์ VoxCPM2 ของ China — ดึงงานพากย์จากเครื่องผลิตผ่าน SSH (สร้างโดย scripts/install-tts-worker.mjs)",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${ROOT}"`,
    `sh.Run "${cmd}", 0, False`,
    '',
  ].join('\r\n'),
)
console.log(`ติดตั้งแล้ว: ${file}`)

spawn('wscript.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
console.log(`เปิดเครื่องพากย์แล้ว — ดู log ที่ ${join(ROOT, 'projects', '_tts_worker', 'worker.log')}`)
