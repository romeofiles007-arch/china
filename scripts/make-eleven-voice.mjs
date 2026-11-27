/**
 * สร้างเสียง VoxCPM2 "สไตล์ ElevenLabs" จากคลิปที่เคยพากย์ด้วย ElevenLabs แล้ว
 *
 * VoxCPM2 เลียนน้ำเสียง + จังหวะ + อารมณ์ของคลิปต้นแบบได้ใกล้มากเมื่อมีข้อความที่พูดตรงทุกคำ (โหมด continuation)
 * → ตัดเสียง ElevenLabs ของคลิปเก่า 15–20 วิ (ประโยคต่อเนื่องที่เป็นภาษาไทยล้วน) พร้อมบทของประโยคเหล่านั้น
 * ทดสอบ 26–27 พ.ย. 2026: บทเดียวกัน อ่านผิด ~2% (ElevenLabs เอง 3.6%) ความยาวใกล้กัน (58 / 60.8 วิ)
 *
 *   node scripts/make-eleven-voice.mjs <slug ของคลิปที่พากย์ด้วย ElevenLabs> [id] [ชื่อที่แสดง]
 *
 * ได้ tts/voices/<id>/voice.json + voxcpm/calm.wav + calm.txt — เลือกได้ในแผงข้าง (กลุ่ม VoxCPM2)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from '../pipeline/lib/config.mjs'
import { run } from '../pipeline/lib/ffmpeg.mjs'
import { voiceDir, writeVoice } from '../pipeline/lib/voices.mjs'

const MIN_SECONDS = 15
const MAX_SECONDS = 20

/** ประโยคที่มีอักษรจีน/อังกฤษ/ตัวเลข → ข้อความไม่ตรงกับที่ ElevenLabs อ่านออกเสียง (เช่น "齐" อ่านว่า "ฉี") ใช้เป็นต้นแบบไม่ได้ */
export const thaiOnly = (text) => !/[A-Za-z0-9㐀-鿿]/.test(text)

/**
 * เลือกช่วงประโยคต่อเนื่องที่ยาว 15–20 วิ จากเวลาจริงของเสียงพากย์
 * @param segments  02_audio/segments.json
 * @param durations 02_audio/durations.json (ความยาวแต่ละประโยค หลังตัดเงียบ)
 * @param gaps      02_audio/gaps.json { segmentGapMs, paragraphGapMs }
 * @returns {{ from: number, to: number, start: number, end: number, text: string } | null}
 */
export function pickReference(segments, durations, gaps) {
  const starts = []
  let t = 0
  for (const [i, s] of segments.entries()) {
    starts.push(t)
    t += durations[i] + (s.isParagraphEnd ? gaps.paragraphGapMs : gaps.segmentGapMs) / 1000
  }
  for (let from = 0; from < segments.length; from++) {
    for (let to = from; to < segments.length && thaiOnly(segments[to].text); to++) {
      const end = starts[to] + durations[to]
      const length = end - starts[from]
      if (length > MAX_SECONDS) break
      if (length >= MIN_SECONDS) {
        const text = segments.slice(from, to + 1).map((s) => s.text.trim()).join(' ')
        return { from, to, start: starts[from], end, text }
      }
    }
  }
  return null
}

async function main() {
  const [slug, id = 'khathawuth_eleven', label = 'Khathawuth สไตล์ ElevenLabs'] = process.argv.slice(2)
  if (!slug) {
    console.error('ใช้: node scripts/make-eleven-voice.mjs <slug> [id] [ชื่อที่แสดง]')
    process.exit(1)
  }
  const audio = join(ROOT, 'projects', slug, '02_audio')
  const job = JSON.parse(readFileSync(join(audio, 'tts_job.json'), 'utf8'))
  if (job.engine !== 'elevenlabs') throw new Error(`คลิปนี้พากย์ด้วย ${job.engine} ไม่ใช่ ElevenLabs`)
  const read = (f) => JSON.parse(readFileSync(join(audio, f), 'utf8'))
  for (const f of ['segments.json', 'durations.json', 'gaps.json', 'voiceover.wav']) {
    if (!existsSync(join(audio, f))) throw new Error(`ไม่พบ ${f} ใน ${audio}`)
  }
  const pick = pickReference(read('segments.json'), read('durations.json'), read('gaps.json'))
  if (!pick) throw new Error('ไม่มีช่วงประโยคภาษาไทยล้วนที่ยาว 15–20 วิ — ลองคลิปอื่น')

  const dir = join(voiceDir(id), 'voxcpm')
  mkdirSync(dir, { recursive: true })
  const length = pick.end - pick.start + 0.15
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', pick.start.toFixed(3), '-t', length.toFixed(3), '-i', join(audio, 'voiceover.wav'),
    '-af', `afade=t=out:st=${(length - 0.15).toFixed(3)}:d=0.15`, '-ar', '24000', '-ac', '1', join(dir, 'calm.wav')])
  writeFileSync(join(dir, 'calm.txt'), pick.text + '\n', 'utf8')
  writeVoice(id, {
    label,
    status: 'draft',
    voxcpm: true,
    voxcpmSettings: { speed: 1, eq: 'off', cfg: 2, steps: 25 },
    voxcpmSource: `ElevenLabs · ${slug} · ประโยค ${pick.from + 1}–${pick.to + 1} (${(pick.end - pick.start).toFixed(1)} วิ)`,
    createdAt: new Date().toISOString(),
    error: null,
  })
  console.log(`สร้างเสียง ${id} แล้ว · ${(pick.end - pick.start).toFixed(1)} วิ · ประโยค ${pick.from + 1}–${pick.to + 1}`)
  console.log(pick.text)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
