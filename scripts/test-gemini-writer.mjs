// โหมด Gemini เขียนบท — เลือกรุ่นเอง สลับรุ่นเมื่อโควตาหมด จำแชตไว้สั่งปรับต่อ
//   node --test scripts/test-gemini-writer.mjs
// ผู้ใช้ (21 พ.ย. 2026): "เราลองเพิ่มเติมโหมด Gemini เขียนให้ดีไหม" → ทำต่อหลังแก้คำสั่งเขียนบท
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rankModels, geminiChat, writerOf, WRITERS } from '../pipeline/lib/gemini_text.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('เรียงรุ่น: pro ใหม่สุดก่อน · เสถียรก่อน preview · ตัดรุ่นเฉพาะทาง', () => {
  const ranked = rankModels([
    'models/gemini-2.5-flash', 'models/gemini-2.5-pro', 'models/gemini-3-pro-preview', 'models/gemini-3-pro',
    'models/gemini-2.5-flash-preview-tts', 'models/gemini-2.5-flash-lite', 'models/gemini-2.0-flash-exp-image-generation',
    'models/text-embedding-004', 'models/gemini-3-flash',
  ])
  assert.deepEqual(ranked, ['gemini-3-pro', 'gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-3-flash', 'gemini-2.5-flash'])
})

test('ผู้เขียนบท: ค่าเริ่มต้น ChatGPT · เลือก Gemini ได้', () => {
  assert.equal(writerOf({ script: {} }), 'chatgpt')
  assert.equal(writerOf({ script: { writer: 'gemini' } }), 'gemini')
  assert.equal(writerOf({ script: { writer: 'อื่นๆ' } }), 'chatgpt')
  assert.deepEqual(Object.keys(WRITERS), ['chatgpt', 'gemini'])
})

/** fetch ปลอม — ตอบตามรุ่นที่ถูกเรียก บันทึกทุกคำขอไว้ตรวจ */
function fakeFetch(handlers) {
  const calls = []
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push({ url: String(url), body })
    if (String(url).includes('/models?')) {
      return new Response(JSON.stringify({ models: ['gemini-3-pro', 'gemini-2.5-flash'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }))
    }
    const model = String(url).match(/models\/([^:]+):generateContent/)[1]
    return handlers[model](body)
  }
  return { fn, calls }
}
const reply = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'คิดก่อน', thought: true }, { text }] } }] }))

test('โควตารุ่น pro หมด → ใช้ flash · สั่งปรับในแชตเดิมใช้รุ่นเดิมพร้อมประวัติแชต', async () => {
  process.env.GEMINI_API_KEY = 'test-key-for-unit-tests-only'
  const { fn, calls } = fakeFetch({
    'gemini-3-pro': () => new Response(JSON.stringify({ error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } }), { status: 429 }),
    'gemini-2.5-flash': (body) => reply(body.contents.length === 1 ? 'บทแรก' : 'บทที่ปรับแล้ว'),
  })
  const real = globalThis.fetch
  globalThis.fetch = fn
  try {
    const chat = geminiChat({ log: () => {} })
    assert.equal(await chat.ask('เขียนบท'), 'บทแรก', 'ไม่เอาส่วน thought มาเป็นบท')
    assert.equal(chat.model, 'gemini-2.5-flash')
    assert.equal(await chat.ask('ปรับความยาว', { newChat: false }), 'บทที่ปรับแล้ว')
    const last = calls.at(-1)
    assert.match(last.url, /gemini-2\.5-flash:generateContent/)
    assert.deepEqual(last.body.contents.map((c) => c.role), ['user', 'model', 'user'])
    assert.equal(calls.filter((c) => c.url.includes('gemini-3-pro:')).length, 1, 'รุ่นที่โควตาหมดไม่ถูกเรียกซ้ำในแชตเดิม')
  } finally {
    globalThis.fetch = real
  }
})

test('key ผิด → error ทันที ไม่ลองรุ่นอื่น', async () => {
  process.env.GEMINI_API_KEY = 'test-key-for-unit-tests-only'
  const { fn } = fakeFetch({ 'gemini-3-pro': () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }) })
  const real = globalThis.fetch
  globalThis.fetch = fn
  try {
    await assert.rejects(geminiChat({ log: () => {} }).ask('เขียนบท'), /Gemini ปฏิเสธ: API key not valid/)
  } finally {
    globalThis.fetch = real
  }
})

test('autopilot: ผู้เขียนเป็น Gemini ใช้ทั้งคิดหัวข้อและเขียนบท · ล้มแล้วใช้ ChatGPT แทน', () => {
  const src = read('pipeline/autopilot.mjs')
  assert.match(src, /writer\.ask\(/, 'เขียนบทผ่านผู้เขียนที่เลือก')
  assert.match(src, /topicGemini\.ask\(prompt\)/, 'คิดหัวข้อผ่าน Gemini')
  assert.match(src, /เปลี่ยนไปใช้ ChatGPT สำหรับคลิปนี้/)
  assert.match(src, /restart\(\)/, 'เปลี่ยนผู้เขียนกลางการปรับความยาว → ส่ง prompt เต็มให้ ChatGPT')
})

test('แผงข้าง: ปุ่มผู้เขียนบท + ช่องใส่ key · bridge บันทึก script.writer', () => {
  const html = read('extension/sidepanel.html')
  const js = read('extension/sidepanel.js')
  const ui = read('bridge/ui.js')
  assert.match(html, /id="clipWriter"/)
  assert.match(html, /id="writerGeminiKey"/)
  assert.match(js, /saveClipSettings\(\{ writer: b\.dataset\.value \}\)/)
  assert.match(ui, /if \(WRITERS\[body\.writer\]\) c\.script\.writer = body\.writer/)
  assert.match(ui, /writer: Object\.entries\(WRITERS\)/)
})
