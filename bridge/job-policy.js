// Publishing is not idempotent. Lost results must be reviewed, never replayed.
export const canRetryJob = job => job.payload?.noRetry !== true && !(job.agent === 'tiktok' && job.kind === 'tiktok-post')
/**
 * extension ยังติดงานนี้อยู่ แม้แท็บเงียบ — ส่งซ้ำ/ตัดสินว่าหลุดไม่ได้
 * background รับงานใหม่ของเว็บเดียวกันไม่ได้จนกว่างานเดิมจบ จึงไม่มาถามหางานของเว็บนั้นเลยระหว่างทำ
 * ยังมาถามหางานของเว็บอื่นอยู่ (extension ยังเปิด) แต่ไม่ถามหางานเว็บนี้ตั้งแต่ส่งงานนี้ไป = ยังทำงานนี้อยู่
 * เจอจริง 23 พ.ย. 2026: แท็บ Flow ที่ไม่ได้อยู่บนจอส่งสัญญาณห่าง 6-20 นาที → bridge ตัดสินว่าหลุดทั้งที่ยังวาดอยู่
 * pipeline เลยสั่งรอบใหม่ด้วยช็อตชุดเดิม → Flow วาดชุดเดิมซ้ำ ภาพรอบแรกมาถึงทีหลัง เสียเวลาเป็นชั่วโมง
 */
export function stillBusyWith(job, lastPoll, now = Date.now(), aliveMs = 90_000) {
  if (job.dispatchedAt == null) return false
  if ((lastPoll[job.agent] ?? 0) > job.dispatchedAt) return false // กลับมาถามหางานแล้ว = ว่าง/ถูกปลุกใหม่ งานนี้หลุดจริง
  return Object.entries(lastPoll).some(([agent, at]) => agent !== job.agent && now - at < aliveMs)
}

export const canDispatchJob = (job, jobs) => job.status === 'queued' && !job.cancelled && (job.agent !== 'tiktok' || ![...jobs].some(other => other.id !== job.id && other.agent === 'tiktok' && other.status === 'running'))
