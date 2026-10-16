import type { SupabaseClient } from '@supabase/supabase-js'
import type { Review } from './review'
import type { ReviewInputs } from './reviewSetup'

/** An image review as kept in the list: on this device (no `path`) or in the account (image in the "reviews" bucket). */
export interface SavedReview { id: string; at: string; name: string; targetId?: string; thumb: string; result: Review; inputs?: ReviewInputs; path?: string }

const BUCKET = 'reviews'
/** Files up to this size are stored as they are; larger ones as a scaled JPEG (the bucket allows 25 MB). */
export const MAX_UPLOAD = 24 * 1024 * 1024
const UPLOADABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff']

/** The table or bucket isn't there yet: the migration hasn't been applied to this project. */
export class NotSetUp extends Error {}
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /bucket not found/i.test(e.message ?? ''))

const LOCAL_KEY = 'astroplanner.review.history'
export const loadLocal = (): SavedReview[] => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') } catch { return [] } }
export const saveLocal = (h: SavedReview[]) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(h)) } catch { /* storage full or unavailable */ } }

export async function listReviews(db: SupabaseClient): Promise<SavedReview[]> {
  const { data, error } = await db.from('image_reviews').select('id, created, name, target_id, thumb, result, path').order('created', { ascending: false }).limit(100)
  if (missing(error)) throw new NotSetUp()
  if (error) throw error
  // the inputs (setup, site, integration) ride along in the result JSON
  return (data ?? []).map((r) => { const { inputs, ...result } = r.result as Review & { inputs?: ReviewInputs }; return { id: r.id, at: r.created, name: r.name, targetId: r.target_id ?? undefined, thumb: r.thumb ?? '', result: result as Review, inputs, path: r.path } })
}

/** The file to store: the original when the bucket takes it, else the scaled copy that was reviewed. */
export function uploadBlob(file: File, scaled: () => Promise<Blob>): Promise<{ blob: Blob; ext: string }> {
  if (file.size <= MAX_UPLOAD && UPLOADABLE.includes(file.type)) return Promise.resolve({ blob: file, ext: file.type.split('/')[1].replace('jpeg', 'jpg') })
  return scaled().then((blob) => ({ blob, ext: 'jpg' }))
}

/** Upload the image under the user's folder, then the row; the image goes again if the row can't be written. */
export async function saveReview(db: SupabaseClient, userId: string, rec: Omit<SavedReview, 'path'>, blob: Blob, ext: string): Promise<SavedReview> {
  const path = `${userId}/${rec.id}.${ext}`
  const up = await db.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
  if (missing(up.error as { message?: string } | null)) throw new NotSetUp()
  if (up.error) throw up.error
  const { error } = await db.from('image_reviews').insert({ id: rec.id, created: rec.at, name: rec.name, target_id: rec.targetId ?? null, thumb: rec.thumb, result: { ...rec.result, inputs: rec.inputs }, path })
  if (error) {
    await db.storage.from(BUCKET).remove([path])
    if (missing(error)) throw new NotSetUp()
    throw error
  }
  return { ...rec, path }
}

/** Save changed setup details (and target) for a stored review. */
export async function updateReview(db: SupabaseClient, rec: SavedReview) {
  const { error } = await db.from('image_reviews').update({ target_id: rec.targetId ?? null, result: { ...rec.result, inputs: rec.inputs } }).eq('id', rec.id)
  if (error) throw error
}

export async function deleteReview(db: SupabaseClient, rec: SavedReview) {
  const { error } = await db.from('image_reviews').delete().eq('id', rec.id)
  if (error) throw error
  if (rec.path) await db.storage.from(BUCKET).remove([rec.path])
}

/** A link to the stored image that works for an hour (the bucket is private). */
export async function imageUrl(db: SupabaseClient, path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}
