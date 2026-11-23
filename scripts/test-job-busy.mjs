// แท็บเงียบแต่ extension ยังติดงานอยู่ → bridge ต้องไม่ส่งซ้ำ/ตัดสินว่าหลุด (เจอจริง 23 พ.ย. 2026: Flow วาดช็อตชุดเดิมซ้ำ)
// node scripts/test-job-busy.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stillBusyWith } from '../bridge/job-policy.js'

let pass = 0
const t = (name, fn) => {
  fn()
  pass++
  console.log('ok -', name)
}
const now = 1_000_000_000
const job = { agent: 'flow', dispatchedAt: now - 20 * 60_000 }

t('extension ยังถามหางานเว็บอื่น แต่ไม่ถามหางาน flow ตั้งแต่ส่งงาน = ยังติดงานนี้', () => {
  assert.equal(stillBusyWith(job, { flow: job.dispatchedAt - 5, chatgpt: now - 10_000 }, now), true)
})
t('ถามหางาน flow ใหม่หลังส่งงานแล้ว = ว่าง/ถูกปลุกใหม่ งานหลุดจริง', () => {
  assert.equal(stillBusyWith(job, { flow: now - 30_000, chatgpt: now - 10_000 }, now), false)
})
t('extension เงียบทั้งตัว (Chrome ปิด) = ไม่ถือว่ายังติดงาน', () => {
  assert.equal(stillBusyWith(job, { flow: job.dispatchedAt - 5, chatgpt: now - 5 * 60_000 }, now), false)
})
t('งานที่ยังไม่เคยส่งให้ extension = ไม่ถือว่ายังติดงาน', () => {
  assert.equal(stillBusyWith({ agent: 'flow' }, { chatgpt: now }, now), false)
})
t('ส่งงานพร้อมกับตอนถามหางาน (เวลาเท่ากัน) = ยังไม่นับว่ากลับมาถาม', () => {
  assert.equal(stillBusyWith({ agent: 'flow', dispatchedAt: now - 60_000 }, { flow: now - 60_000, gemini: now }, now), true)
})

const server = readFileSync(new URL('../bridge/server.js', import.meta.url), 'utf8')
t('bridge เช็ก stillBusyWith ก่อนนับครั้งส่งซ้ำ', () => {
  const loop = server.slice(server.indexOf('setInterval(() => {'), server.indexOf('}, 20_000).unref()'))
  assert.ok(loop.indexOf('stillBusyWith(job, lastPoll)') > 0)
  assert.ok(loop.indexOf('stillBusyWith(job, lastPoll)') < loop.indexOf('job.attempts = '))
})
t('ทั้งสองทางที่ส่งงานให้ extension ตั้ง dispatchedAt', () => {
  assert.equal(server.split(/\.dispatchedAt = Date\.now\(\)/).length - 1, 2)
})
console.log(`\n${pass} ผ่าน`)
