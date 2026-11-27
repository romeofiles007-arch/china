// เทสต์: เสียง VoxCPM2 "สไตล์ ElevenLabs" — เลือกช่วงต้นแบบจากคลิป ElevenLabs + ค่าเฉพาะเสียงใน voice.json
//   node scripts/test-eleven-voice.mjs
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { pickReference, thaiOnly } from './make-eleven-voice.mjs'
import { voxcpmSettings } from '../pipeline/lib/voxcpm.mjs'
import { voiceDir, writeVoice } from '../pipeline/lib/voices.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// เวลาจริงจากคลิปโจโฉ (ElevenLabs) — เสียงพากย์ยาวตรงกับผลรวมนี้ (64.18 วิ)
const GAPS = { segmentGapMs: 500, paragraphGapMs: 900 }
const seg = (text, isParagraphEnd = false) => ({ text, isParagraphEnd })

test('ต่อประโยคตั้งแต่ต้นจนได้ 15–20 วิ และคำนวณเวลาเริ่ม/จบรวมช่วงเว้น', () => {
  const segments = [seg('คืนนั้น... โจโฉกำลังอ่านถ้อยคำโจมตีตัวเอง', true), seg('ในวรรณกรรมสามก๊กเล่าว่า'), seg('เฉินหลินเขียนคำประกาศให้ฝ่ายอ้วนเสี้ยว'), seg('ถ้อยคำในนั้นกล่าวหาโจโฉอย่างรุนแรง', true), seg('เมื่ออ่านจบ... โจโฉทั้งโกรธทั้งทึ่ง'), seg('เพราะแม้คำจะบาดใจ')]
  const p = pickReference(segments, [4.08, 2.2, 2.6, 3.05, 3.31, 1.8], GAPS)
  assert.equal(p.from, 0)
  assert.equal(p.to, 4)
  assert.equal(p.start, 0)
  assert.ok(Math.abs(p.end - 18.03) < 0.02, `end ${p.end}`)
  assert.equal(p.text, segments.slice(0, 5).map((s) => s.text).join(' '))
})

test('ข้ามประโยคที่มีอักษรจีน (ElevenLabs อ่าน "齐" ว่า "ฉี" ข้อความไม่ตรงกับเสียง)', () => {
  const segments = [seg('สนามแข่งม้าแห่งแคว้น齐กำลังเริ่มขึ้น'), ...Array.from({ length: 8 }, (_, i) => seg(`ประโยคที่ ${'หนึ่งสองสามสี่ห้าหกเจ็ดแปด'[i]}`))]
  const p = pickReference(segments, Array(9).fill(3), GAPS)
  assert.equal(p.from, 1)
  assert.ok(!p.text.includes('齐'))
})

test('ไม่มีช่วงที่ยาวพอ → null', () => {
  assert.equal(pickReference([seg('สั้น'), seg('สั้นอีก')], [2, 2], GAPS), null)
})

test('thaiOnly: ไทยและเครื่องหมายผ่าน · จีน/อังกฤษ/ตัวเลขไม่ผ่าน', () => {
  assert.ok(thaiOnly('“อย่าเพิ่งส่งม้าชั้นดีลงแข่ง”... และแพ้'))
  for (const t of ['แคว้น齐', 'ใช้ AI', 'ปี 2026']) assert.ok(!thaiOnly(t), t)
})

test('voice.json → voxcpmSettings ชนะค่ารวม (ไม่ชะลอซ้ำ ไม่ใส่ EQ) · เสียงอื่นใช้ค่ารวมเดิม', () => {
  const id = '_test_eleven_voice'
  try {
    writeVoice(id, { voxcpm: true, voxcpmSettings: { speed: 1, eq: 'off', cfg: 2, steps: 25 } })
    assert.deepEqual(voxcpmSettings(id, { voice: id, speed: 0.85, eq: 'bright', cfg: 2, steps: 10, emotion: 'calm' }), { voice: id, speed: 1, eq: 'off', cfg: 2, steps: 25, emotion: 'calm' })
    writeVoice(id, { voxcpmSettings: null })
    assert.deepEqual(voxcpmSettings(id, { voice: id, speed: 0.85, eq: 'bright' }), { voice: id, speed: 0.85, eq: 'bright' })
  } finally {
    rmSync(voiceDir(id), { recursive: true, force: true })
  }
})

console.log(`\nผ่าน ${passed} ข้อ`)
