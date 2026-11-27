#!/usr/bin/env node
/**
 * เครื่องพากย์ (การ์ดจอแรง เช่น 4070) — ดึงงานพากย์ VoxCPM2 จากคิวของเครื่องผลิต (24hrs) ผ่าน SSH แล้วส่งเสียงกลับ
 *
 *   node scripts/tts-worker.mjs [--host 24hrs] [--root C:/Git/china] [--node "C:/Program Files/nodejs/node.exe"] [--python <venv>/Scripts/python.exe] [--once]
 *   --root ใส่ซ้ำได้ (หรือคั่นด้วย ,) — รับงานจากหลายโปรแกรมบนเครื่องผลิตเดียวกัน เช่น china + buddha-Content + phi1baht
 *          ทุกโปรแกรมต้องมี scripts/tts-queue.mjs · เครื่องพากย์ใช้โค้ดพากย์ของโปรแกรมนี้ (china) กับทุกงาน
 *   --asr-python = Python ที่มี faster-whisper ไว้ตรวจคำเกินท้ายประโยค (เช่น <โปรเจกต์>/tts/.venv/Scripts/python.exe)
 *   --python = ใช้ VoxCPM2 ที่ลงไว้ในโปรเจกต์อื่นของเครื่องนี้ (ไม่ใส่ = tts/.venv-voxcpm ของโปรเจกต์นี้)
 *
 * เปิดเองตอน login: node scripts/install-tts-worker.mjs  (ถอน: --uninstall)
 * ต้องมี: tts/.venv-voxcpm (scripts/setup-voxcpm.ps1) + `ssh <host>` เข้าได้โดยไม่ถามรหัส (ใช้ key)
 * เครื่องผลิตปิด/เน็ตหลุด → รอแล้วลองใหม่เอง · งานที่ค้างตอนเครื่องนี้ดับ → เปิดใหม่แล้วรับต่อเอง
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, appendFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, basename } from 'node:path'
import { ROOT } from '../pipeline/lib/config.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const HOST = arg('host', '24hrs')
const REMOTE_ROOTS = (() => {
  const roots = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--root' ? a.split(',') : [])).map((r) => r.trim().replace(/\\/g, '/')).filter(Boolean)
  return roots.length ? [...new Set(roots)] : ['C:/Git/china']
})()
const tagOf = (root) => basename(root)
const REMOTE_NODE = arg('node', 'C:/Program Files/nodejs/node.exe').replace(/\\/g, '/')
const ONCE = process.argv.includes('--once')
if (arg('python')) process.env.VOXCPM_PYTHON = arg('python')
// Python ที่มี faster-whisper — ตรวจแล้วตัดคำเกินท้ายประโยค (พูดคำสุดท้ายซ้ำ/คำมั่ว) · ไม่ใส่ = ใช้ tts/.venv ถ้ามี
if (arg('asr-python')) process.env.VOXCPM_ASR_PYTHON = arg('asr-python')
// import หลังตั้ง VOXCPM_PYTHON — โมดูลอ่านค่าตอนโหลด
const { synthVoxcpm, voxcpmInstalled, VOXCPM_PYTHON } = await import('../pipeline/lib/voxcpm.mjs')
const NAME = hostname().replace(/[^\w-]/g, '') || 'tts-worker'
const POLL_MS = 20_000
const OFFLINE_RETRY_MS = 30_000

const WORK_DIR = join(ROOT, 'projects', '_tts_worker')
mkdirSync(WORK_DIR, { recursive: true })
const LOG = join(WORK_DIR, 'worker.log')
const log = (msg) => {
  const line = `[${new Date().toLocaleString('th-TH', { hour12: false })}] ${msg}`
  console.log(line)
  try {
    appendFileSync(LOG, line + '\n')
  } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// เปิดซ้ำ (login ใหม่ / กดเอง) → ตัวเดียวพอ ไม่แย่งการ์ดจอกัน
const LOCK = join(WORK_DIR, 'worker.lock')
function takeLock() {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'))
    if (pid && pid !== process.pid) {
      process.kill(pid, 0)
      return false
    }
  } catch {}
  writeFileSync(LOCK, String(process.pid))
  return true
}

function gpuName() {
  try {
    return execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].replace(/[^\w .-]/g, '').trim()
  } catch {
    return ''
  }
}

/** เรียก scripts/tts-queue.mjs บนเครื่องผลิตผ่าน SSH → JSON */
function remote(root, args, input = null) {
  const safe = args.map((a) => String(a).replace(/[^\w .:-]/g, ''))
  const cmd = [`"${REMOTE_NODE}"`, `"${root}/scripts/tts-queue.mjs"`, ...safe.map((a) => `"${a}"`)].join(' ')
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', HOST, cmd], { windowsHide: true })
    const chunks = []
    let err = ''
    proc.stdout.on('data', (d) => chunks.push(d))
    proc.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) => {
      const text = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/).pop() ?? ''
      let data = null
      try {
        data = JSON.parse(text)
      } catch {}
      if (data?.error) return reject(new Error(data.error))
      if (code !== 0 || !data) return reject(new Error(err.split(/\r?\n/).filter((l) => l && !l.startsWith('**')).pop() || `ssh จบด้วย exit ${code}`))
      resolve(data)
    })
    if (input !== null) proc.stdin.end(input)
    else proc.stdin.end()
  })
}

async function runJob(root, { job, refWav }) {
  const tag = tagOf(root)
  const dir = join(WORK_DIR, job.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'out'), { recursive: true })
  const ref = { wav: join(dir, 'ref.wav'), text: job.refText }
  writeFileSync(ref.wav, Buffer.from(refWav, 'base64'))
  const segments = job.segments.map((s) => ({ index: s.index, text: s.text, out: join(dir, 'out', `${String(s.index).padStart(4, '0')}.wav`) }))
  log(`[${tag}] รับงาน ${job.id}${job.label ? ` (${job.label})` : ''} · ${segments.length} ประโยค`)
  const started = Date.now()
  // แจ้งเครื่องผลิตเป็นระยะ — ไม่งั้นแผงข้างจะเห็นว่าเครื่องพากย์ปิด ระหว่างที่โหลดโมเดล/พากย์ประโยคยาว
  // ทุกโปรแกรม — คิวของโปรแกรมอื่นจะเห็นว่า "กำลังพากย์งานอื่นอยู่" ไม่ใช่ "ปิดอยู่"
  const busy = `${tag}-${job.id}`
  const beat = setInterval(() => REMOTE_ROOTS.forEach((r) => remote(r, ['heartbeat', NAME, busy]).catch(() => {})), POLL_MS)
  let reports = Promise.resolve()
  const report = (done) => (reports = reports.then(() => remote(root, ['progress', job.id, done, segments.length]).catch(() => {})))
  try {
    report(0)
    await synthVoxcpm(segments, { ref, emotion: 'calm', ...job.settings }, (msg) => {
      if (msg.event === 'segment') report(msg.index + 1)
      if (msg.event === 'error') log(`  ประโยคพัง: ${msg.message}`)
      if (msg.event === 'fixed') log(`  ตัดคำเกินท้าย ประโยค ${msg.index + 1} (${msg.seconds} วิ): "${msg.full}" → "${msg.head}"`)
      if (msg.event === 'fix-skipped') log(`  ${msg.message}`)
    })
    await reports
    const files = Object.fromEntries(readdirSync(join(dir, 'out')).filter((f) => /^\d{4}\.wav$/.test(f)).map((f) => [f, readFileSync(join(dir, 'out', f)).toString('base64')]))
    if (Object.keys(files).length < segments.length) throw new Error(`ได้เสียง ${Object.keys(files).length}/${segments.length} ประโยค`)
    const seconds = Math.round((Date.now() - started) / 1000)
    // ส่งกลับไม่สำเร็จ (เครื่องผลิตรีสตาร์ท/เน็ตหลุด) → ลองซ้ำ ไม่ต้องพากย์ใหม่
    for (let attempt = 1; ; attempt++) {
      try {
        await remote(root, ['finish', job.id, NAME], JSON.stringify({ files, seconds }))
        break
      } catch (err) {
        if (/ไม่มีงาน/.test(err.message) || attempt >= 20) throw err
        log(`  ส่งเสียงกลับไม่สำเร็จ (${err.message}) — ลองใหม่ใน 30 วิ`)
        await sleep(OFFLINE_RETRY_MS)
      }
    }
    log(`[${tag}] ส่งเสียงกลับแล้ว ${job.id} · ${segments.length} ประโยคใน ${seconds} วิ`)
  } catch (err) {
    log(`[${tag}] งาน ${job.id} ไม่สำเร็จ: ${err.message}`)
    await remote(root, ['fail', job.id, NAME], err.message).catch(() => {})
  } finally {
    clearInterval(beat)
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  if (!voxcpmInstalled()) {
    log(`ไม่พบ VoxCPM2 (${VOXCPM_PYTHON}) — รัน scripts/setup-voxcpm.ps1 หรือใส่ --python ของที่ลงไว้แล้ว`)
    process.exit(2)
  }
  if (!takeLock()) {
    console.log('เครื่องพากย์ทำงานอยู่แล้ว (มีอีกตัวเปิดอยู่)')
    process.exit(0)
  }
  const gpu = gpuName()
  log(`เครื่องพากย์ ${NAME}${gpu ? ` (${gpu})` : ''} เริ่มทำงาน · เช็กคิวที่ ${HOST}: ${REMOTE_ROOTS.join(', ')} ทุก ${POLL_MS / 1000} วิ`)
  // แต่ละโปรแกรมเชื่อมได้/ไม่ได้แยกกัน — โปรแกรมหนึ่งยังไม่อัปเดต (ไม่มี tts-queue.mjs) ไม่ทำให้โปรแกรมอื่นหยุด
  const offline = new Map()
  for (;;) {
    let worked = false
    for (const root of REMOTE_ROOTS) {
      let got
      try {
        got = await remote(root, ['poll', NAME, gpu])
        if (offline.get(root)) log(`[${tagOf(root)}] เชื่อมได้แล้ว`)
        offline.set(root, false)
      } catch (err) {
        if (!offline.get(root)) log(`[${tagOf(root)}] เชื่อม ${HOST}:${root} ไม่ได้ (${err.message}) — รอแล้วลองใหม่`)
        offline.set(root, true)
        continue
      }
      if (got.job) {
        await runJob(root, got)
        worked = true
      }
    }
    if (ONCE) process.exit(REMOTE_ROOTS.every((r) => offline.get(r)) ? 1 : 0)
    // เพิ่งทำงานเสร็จ → เช็กคิวต่อทันที (อาจมีงานรออยู่อีก) · ทุกโปรแกรมเชื่อมไม่ได้ → รอนานขึ้น
    if (!worked) await sleep(REMOTE_ROOTS.every((r) => offline.get(r)) ? OFFLINE_RETRY_MS : POLL_MS)
  }
}

process.on('exit', () => {
  try {
    if (existsSync(LOCK) && Number(readFileSync(LOCK, 'utf8')) === process.pid) rmSync(LOCK)
  } catch {}
})
process.on('SIGINT', () => process.exit(0))
main().catch((err) => {
  log(`เครื่องพากย์หยุด: ${err.stack ?? err.message}`)
  process.exit(1)
})
