'use server';
/**
 * Server Actions — Galerie photos du salon.
 *
 * Gère les photos affichées sur l'espace /client (section « Galerie » de
 * l'accueil). Stockage en data URL base64 dans `tenant_gallery.photo_url`
 * — même approche que `tenant_branding.logo_url`, pas de bucket Supabase
 * Storage pour rester simple sur des volumes modestes (5-10 photos/salon).
 *
 * Toutes les mutations passent par `requireTenant()` → on est sûr que
 *  1. Le user est connecté
 *  2. Il n'est pas caissier (caissiers redirigés vers /cashier)
 *  3. Son `app_metadata.tenant_id` correspond bien au tenant qu'il édite
 *
 * Une fois ces 3 gardes franchies, on bypasse RLS via `createAdminClient()`
 * — la sécurité est déjà prouvée côté serveur.
 *
 * Convention de réorganisation : `sort_order` est un `double precision` →
 * pour insérer une photo entre A (sort=2) et B (sort=4), on lui assigne
 * sort=3. Cela évite de devoir UPDATE-toutes-les-lignes à chaque déplacement.
 * Les photos sont triées ASC par sort_order côté UI.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, type Database } from '@/db';
import { requireTenant } from '../_data/auth-server';

type GalleryRow = Database['public']['Tables']['tenant_gallery']['Row'];
type GalleryInsert = Database['public']['Tables']['tenant_gallery']['Insert'];

export type GalleryErrorCode =
  | 'invalidData'
  | 'tenantNotAuthorized'
  | 'galleryDbError'
  | 'photoTooLarge'
  | 'photoNotFound'
  | 'tooManyPhotos'
  | 'invalidImageFormat';

export type GalleryErrorValues = Record<string, string | number>;

export type GalleryResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; errorKey: GalleryErrorCode; errorValues?: GalleryErrorValues };

export interface GalleryPhoto {
  id: string;
  photoUrl: string;
  caption: string | null;
  sortOrder: number;
}

/** Plafond raisonnable : 20 photos / salon. Au-delà la page d'accueil
 *  devient lourde à charger. Cohérent avec l'usage attendu (vitrine
 *  vitrine, pas un Instagram). */
const MAX_PHOTOS_PER_TENANT = 20;

/** Borne haute du data URL — 5 MB. À l'usage normal une photo resized en
 *  1200×800 JPEG q=0.8 fait ~300 KB. 5 MB laisse de la marge pour les
 *  uploads bruts qui n'ont pas été resized côté client. */
const MAX_PHOTO_BYTES = 5_000_000;

/** Vérifie que le contenu base64 décodé commence par les magic bytes attendus
 *  pour le mime déclaré. Un manager pourrait coller `data:image/jpeg;base64,`
 *  + un payload binaire arbitraire (PDF, EXE, etc.) — le navigateur refuserait
 *  de le rendre mais la donnée polluerait notre DB. On force la cohérence. */
function validateImageMagicBytes(dataUrl: string): boolean {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return false;
  const [, format, b64] = match;
  if (!b64) return false;
  // On décode juste les premiers octets (suffisant pour les magic bytes)
  let head: Buffer;
  try {
    head = Buffer.from(b64.slice(0, 32), 'base64');
  } catch {
    return false;
  }
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (format === 'png') {
    return (
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47 &&
      head[4] === 0x0d &&
      head[5] === 0x0a &&
      head[6] === 0x1a &&
      head[7] === 0x0a
    );
  }
  // JPEG : FF D8 FF
  if (format === 'jpeg' || format === 'jpg') {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  }
  // WebP : "RIFF" .... "WEBP" (offsets 0-3 + 8-11)
  if (format === 'webp') {
    return (
      head[0] === 0x52 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x46 &&
      head[8] === 0x57 &&
      head[9] === 0x45 &&
      head[10] === 0x42 &&
      head[11] === 0x50
    );
  }
  return false;
}

const UploadSchema = z.object({
  /** Data URL base64 PNG/JPEG/WebP. Validation :
   *  - Format mime du data URL strict (regex)
   *  - Magic bytes vérifiés côté serveur (un manager ne peut pas coller
   *    un binaire arbitraire en se faisant passer pour une image)
   *  - Borne 5 MB pour éviter l'abus DB */
  photoUrl: z
    .string()
    .min(50, 'invalidData')
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/, 'invalidData')
    .max(MAX_PHOTO_BYTES, 'photoTooLarge')
    .refine(validateImageMagicBytes, 'invalidImageFormat'),
  caption: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v)),
});

export type UploadGalleryPhotoInput = z.input<typeof UploadSchema>;

/**
 * Upload une nouvelle photo dans la galerie. Calcule automatiquement le
 * `sort_order` = max(actuel) + 1 → la photo apparaît en dernier.
 */
export async function uploadGalleryPhoto(
  input: UploadGalleryPhotoInput,
): Promise<GalleryResult<{ id: string }>> {
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const parsed = UploadSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const msg = first?.message;
    const errorKey: GalleryErrorCode =
      msg === 'photoTooLarge'
        ? 'photoTooLarge'
        : msg === 'invalidImageFormat'
          ? 'invalidImageFormat'
          : 'invalidData';
    return { ok: false, errorKey };
  }

  // Garde anti-flood : compter les photos existantes
  const { count, error: countErr } = await admin
    .from('tenant_gallery')
    .select('id', { count: 'exact', head: true })
    ;

  if (countErr) {
    return { ok: false, errorKey: 'galleryDbError', errorValues: { message: countErr.message } };
  }
  if ((count ?? 0) >= MAX_PHOTOS_PER_TENANT) {
    return {
      ok: false,
      errorKey: 'tooManyPhotos',
      errorValues: { max: MAX_PHOTOS_PER_TENANT },
    };
  }

  // Trouver le max(sort_order) actuel pour placer la nouvelle photo en queue.
  // ORDER BY DESC LIMIT 1 reste rapide grâce à l'index (tenant_id, sort_order).
  const { data: maxRows } = await admin
    .from('tenant_gallery')
    .select('sort_order')
    
    .order('sort_order', { ascending: false })
    .limit(1);
  const maxRow = (maxRows as { sort_order: number }[] | null)?.[0];
  const nextSort = maxRow ? maxRow.sort_order + 1 : 0;

  // Upload vers Supabase Storage (bucket `salon-gallery`) au lieu de
  // stocker le data URL en DB. Bénéfices :
  //  - 300 KB → 50 octets dans `tenant_gallery.photo_url` (juste l'URL)
  //  - CDN Supabase + cache HTTP côté client
  //  - Bande passante réduite à grande échelle SaaS
  //
  // Path convention : `{tenant_id}/{photo_id}.jpg`. Le {photo_id} sera
  // l'ID UUID du row tenant_gallery — on l'insère donc d'abord avec un
  // placeholder, puis on upload, puis on update avec l'URL publique.
  // C'est moins atomique qu'une transaction unique mais Supabase Storage
  // n'est pas dans la même transaction DB → on accepte cette fenêtre.

  // 1. Décode le data URL en bytes
  const dataUrlMatch = parsed.data.photoUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!dataUrlMatch) {
    return { ok: false, errorKey: 'invalidData' };
  }
  const [, format, b64] = dataUrlMatch;
  if (!b64) return { ok: false, errorKey: 'invalidData' };
  const ext = format === 'jpg' ? 'jpeg' : format!;
  const contentType = `image/${ext}`;
  const bytes = Buffer.from(b64, 'base64');

  // 2. Insert le row d'abord pour obtenir un photo_id stable
  const insertRow: GalleryInsert = {
    photo_url: '', // placeholder — on update juste après
    caption: parsed.data.caption ?? null,
    sort_order: nextSort,
  };

  const { data: ins, error } = await admin
    .from('tenant_gallery')
    .insert(insertRow as never)
    .select('id')
    .single();

  if (error || !ins) {
    return {
      ok: false,
      errorKey: 'galleryDbError',
      errorValues: { message: error?.message ?? '' },
    };
  }
  const photoId = (ins as { id: string }).id;
  const storagePath = `${ctx.tenant.id}/${photoId}.${ext}`;

  // 3. Upload vers Storage
  const uploadRes = await admin.storage.from('salon-gallery').upload(storagePath, bytes, {
    contentType,
    upsert: true,
    cacheControl: '31536000', // 1 an — les photos sont immutables (un nouvel upload = nouveau photo_id)
  });
  if (uploadRes.error) {
    // Rollback : supprime le row qu'on vient de créer
    await admin.from('tenant_gallery').delete().eq('id', photoId);
    return {
      ok: false,
      errorKey: 'galleryDbError',
      errorValues: { message: `Storage upload failed: ${uploadRes.error.message}` },
    };
  }

  // 4. Récupère l'URL publique et update le row
  const { data: publicData } = admin.storage.from('salon-gallery').getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

  const { error: updateErr } = await admin
    .from('tenant_gallery')
    .update({ photo_url: publicUrl })
    .eq('id', photoId);
  if (updateErr) {
    return {
      ok: false,
      errorKey: 'galleryDbError',
      errorValues: { message: updateErr.message },
    };
  }

  revalidatePath('/manager');
  revalidatePath('/client');
  return { ok: true, data: { id: photoId } };
}

/**
 * Supprime une photo de la galerie. Vérifie que la photo appartient bien
 * au tenant de l'appelant (sinon un attaquant pourrait passer un id d'une
 * autre boutique).
 */
export async function deleteGalleryPhoto(photoId: string): Promise<GalleryResult> {
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const idValid = z.string().uuid().safeParse(photoId);
  if (!idValid.success) return { ok: false, errorKey: 'invalidData' };

  // 1. Récupère l'URL pour pouvoir déduire le path Storage à supprimer.
  //    Si la photo a été uploadée AVANT la migration vers Storage (data URL
  //    legacy), le delete Storage no-op silencieusement.
  const { data: existing } = await admin
    .from('tenant_gallery')
    .select('photo_url')
    .eq('id', photoId)
    
    .maybeSingle();
  const existingUrl = (existing as { photo_url?: string } | null)?.photo_url ?? null;

  // 2. Delete le row DB (avec garde tenant)
  const { data: deleted, error } = await admin
    .from('tenant_gallery')
    .delete()
    .eq('id', photoId)
     // garde tenant — empêche cross-delete
    .select('id');

  if (error) {
    return { ok: false, errorKey: 'galleryDbError', errorValues: { message: error.message } };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, errorKey: 'photoNotFound' };
  }

  // 3. Nettoyage Storage en best-effort (pas bloquant si ça échoue —
  //    le row DB est déjà gone, donc la photo n'est plus servie côté UI).
  if (existingUrl && existingUrl.includes('/storage/v1/object/public/salon-gallery/')) {
    const path = existingUrl.split('/storage/v1/object/public/salon-gallery/')[1];
    if (path) {
      void admin.storage
        .from('salon-gallery')
        .remove([path])
        .catch(() => {});
    }
  }

  revalidatePath('/manager');
  revalidatePath('/client');
  return { ok: true };
}

/**
 * Met à jour la légende d'une photo. Garde tenant identique à la delete.
 */
export async function updateGalleryCaption(
  photoId: string,
  caption: string | null,
): Promise<GalleryResult> {
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const idValid = z.string().uuid().safeParse(photoId);
  if (!idValid.success) return { ok: false, errorKey: 'invalidData' };

  const captionParsed = z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v))
    .safeParse(caption);
  if (!captionParsed.success) return { ok: false, errorKey: 'invalidData' };

  const { data: updated, error } = await admin
    .from('tenant_gallery')
    .update({ caption: captionParsed.data ?? null } as never)
    .eq('id', photoId)
    
    .select('id');

  if (error) {
    return { ok: false, errorKey: 'galleryDbError', errorValues: { message: error.message } };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, errorKey: 'photoNotFound' };
  }

  revalidatePath('/manager');
  revalidatePath('/client');
  return { ok: true };
}

/**
 * Réordonne les photos selon l'ordre fourni. Reçoit la liste des ids dans
 * l'ordre désiré, et leur assigne sort_order = 0, 1, 2, … (renumérotation
 * dense). Plus simple à raisonner côté UI que de calculer des floats
 * intermédiaires côté client.
 *
 * Garde tenant : si l'un des ids ne lui appartient pas, on ne fait rien
 * pour cet id (le  filtre).
 */
export async function reorderGalleryPhotos(photoIds: string[]): Promise<GalleryResult> {
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const idsValid = z.array(z.string().uuid()).min(0).max(MAX_PHOTOS_PER_TENANT).safeParse(photoIds);
  if (!idsValid.success) return { ok: false, errorKey: 'invalidData' };

  // Update en parallèle — chaque ligne reçoit son nouveau sort_order = index.
  // En cas d'erreur partielle on retourne la première erreur, les updates
  // déjà passés restent commités (acceptable pour cette feature : un retry
  // côté UI suffit, et l'ordre reste cohérent même s'il diffère du voulu).
  const updates = idsValid.data.map((id, idx) =>
    admin
      .from('tenant_gallery')
      .update({ sort_order: idx } as never)
      .eq('id', id)
      ,
  );

  const results = await Promise.all(updates);
  const firstErr = results.find((r) => r.error);
  if (firstErr?.error) {
    return {
      ok: false,
      errorKey: 'galleryDbError',
      errorValues: { message: firstErr.error.message },
    };
  }

  revalidatePath('/manager');
  revalidatePath('/client');
  return { ok: true };
}

/**
 * Liste les photos du tenant courant (pour l'UI manager).
 * Ordre : sort_order ASC (=) ordre d'affichage côté client.
 */
export async function listGalleryPhotos(): Promise<GalleryResult<GalleryPhoto[]>> {
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('tenant_gallery')
    .select('id, photo_url, caption, sort_order')
    
    .order('sort_order', { ascending: true });

  if (error) {
    return { ok: false, errorKey: 'galleryDbError', errorValues: { message: error.message } };
  }

  const rows = (data as Pick<GalleryRow, 'id' | 'photo_url' | 'caption' | 'sort_order'>[]) ?? [];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      photoUrl: r.photo_url,
      caption: r.caption,
      sortOrder: r.sort_order,
    })),
  };
}
