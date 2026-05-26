'use client';

/**
 * GalleryEditor — gestion des photos de la galerie côté Direction.
 *
 * Affiché dans /manager?tab=settings entre Horaires et Notifications.
 * Permet :
 *  - Upload de nouvelles photos (drag & drop OU clic, multi-fichiers)
 *  - Réordonnancement par flèches haut/bas (drag&drop natif HTML5 disponible
 *    mais on garde flèches pour fiabilité tactile mobile)
 *  - Édition de la légende inline (max 120 chars)
 *  - Suppression avec confirmation
 *
 * Resize côté client en canvas avant upload :
 *  - max 1600 px sur le plus grand côté
 *  - JPEG q=0.82 → ~250-400 KB / photo
 * Cela borne le data URL stocké en DB et le temps de chargement côté /client.
 *
 * L'état initial est passé en prop pour éviter un round-trip après le mount —
 * `ManagerSettings` lit la galerie via `useTenantOrNull()` (servie par le
 * TenantProvider qui la fournit avec la session).
 */
import { ChevronDown, ChevronUp, ImageIcon, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Btn } from '@/components';

import { useToast } from '../_components/Toast';
import {
  deleteGalleryPhoto,
  listGalleryPhotos,
  reorderGalleryPhotos,
  updateGalleryCaption,
  uploadGalleryPhoto,
  type GalleryPhoto,
} from './gallery-actions';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const MAX_RAW_FILE_BYTES = 12_000_000; // 12 MB photo brute avant resize

/** Resize l'image en canvas → JPEG base64. Évite d'envoyer une photo iPhone
 *  brute de 4 MB pour finir compressée à 300 KB en DB. */
async function resizeToDataUrl(file: File): Promise<string> {
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = imgUrl;
    });

    const { width: w0, height: h0 } = img;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-context');
    ctx.drawImage(img, 0, 0, w, h);

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

export function GalleryEditor() {
  const t = useTranslations('manager.gallery');
  const tErrors = useTranslations('manager.errors');
  const toast = useToast();
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Charge la liste au mount (et après chaque mutation).
  const refresh = () => {
    void listGalleryPhotos().then((res) => {
      if (res.ok) setPhotos(res.data ?? []);
      else toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
    });
  };
  // Chargement initial au mount uniquement. `refresh` est stable au sein
  // d'un mount (refermeture sur les setters React qui sont stables) — pas
  // besoin de le mettre en deps. Wrap inline pour éviter l'esLint disable.
  useEffect(() => {
    void listGalleryPhotos().then((res) => {
      if (res.ok) setPhotos(res.data ?? []);
      else toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
    });
  }, [toast, tErrors]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;

    setUploadingCount((c) => c + arr.length);
    for (const file of arr) {
      try {
        if (file.size > MAX_RAW_FILE_BYTES) {
          toast.error(t('errorFileTooLarge', { name: file.name }));
          continue;
        }
        const dataUrl = await resizeToDataUrl(file);
        const res = await uploadGalleryPhoto({ photoUrl: dataUrl, caption: null });
        if (!res.ok) {
          toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
        }
      } catch {
        toast.error(t('errorUploadFailed'));
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
    refresh();
  };

  const handleDelete = (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    startTransition(async () => {
      const res = await deleteGalleryPhoto(id);
      if (res.ok) {
        setPhotos((p) => p?.filter((x) => x.id !== id) ?? null);
        toast.success(t('toastDeleted'));
      } else {
        toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
      }
    });
  };

  const handleMove = (id: string, direction: 'up' | 'down') => {
    if (!photos) return;
    const idx = photos.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(idx, 1);
    if (!moved) return;
    next.splice(newIdx, 0, moved);
    setPhotos(next); // optimistic
    startTransition(async () => {
      const res = await reorderGalleryPhotos(next.map((p) => p.id));
      if (!res.ok) {
        toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
        refresh(); // rollback via DB
      }
    });
  };

  const handleCaption = (id: string, caption: string) => {
    setPhotos((p) => p?.map((x) => (x.id === id ? { ...x, caption: caption || null } : x)) ?? null);
  };

  const commitCaption = (id: string, caption: string | null) => {
    startTransition(async () => {
      const res = await updateGalleryCaption(id, caption);
      if (!res.ok) {
        toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
        refresh();
      }
    });
  };

  return (
    <section>
      <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
        {t('section')}
      </div>
      <p className="text-ink-soft mb-4 text-xs">{t('hint')}</p>

      {/* Zone d'upload : drag&drop + clic */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        className={`border-line bg-surface-elev mb-4 flex flex-col items-center justify-center rounded-sm border-2 border-dashed px-6 py-8 transition ${
          dragOver ? 'border-brand-primary bg-brand-primary/5' : ''
        }`}
      >
        <Upload className="text-ink-soft mb-2 h-6 w-6" strokeWidth={1.4} />
        <div className="text-ink-mute text-center text-xs">{t('dropZone')}</div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = ''; // permet de re-uploader le même fichier
          }}
        />
        <div className="mt-3">
          <Btn
            variant="secondary"
            size="sm"
            icon={Upload}
            onClick={() => fileRef.current?.click()}
            disabled={uploadingCount > 0}
          >
            {uploadingCount > 0
              ? t('uploadingCount', { count: uploadingCount })
              : t('selectFilesBtn')}
          </Btn>
        </div>
      </div>

      {/* Grille des photos existantes */}
      {photos === null ? (
        <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
          {t('loading')}
        </div>
      ) : photos.length === 0 ? (
        <div className="border-line bg-surface-elev flex flex-col items-center justify-center rounded-sm border px-6 py-10">
          <ImageIcon className="text-ink-soft mb-2 h-8 w-8" strokeWidth={1.2} />
          <div className="text-ink-mute text-xs">{t('emptyState')}</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, idx) => (
            <div
              key={p.id}
              className="border-line bg-surface-elev relative overflow-hidden rounded-sm border"
            >
              {/* Photo */}
              <div className="relative aspect-[4/5] w-full">
                <img
                  src={p.photoUrl}
                  alt={p.caption ?? t('photoAlt', { index: idx + 1 })}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {/* Overlay actions */}
                <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/40 via-transparent to-black/60 p-1.5 opacity-0 transition hover:opacity-100 group-hover:opacity-100">
                  <div className="flex items-start justify-between">
                    <div className="mono rounded-sm bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      #{idx + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      title={t('deleteBtn')}
                      className="btn-press rounded-sm bg-black/60 p-1 text-white hover:bg-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMove(p.id, 'up')}
                      disabled={idx === 0}
                      title={t('moveUpBtn')}
                      className="btn-press rounded-sm bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(p.id, 'down')}
                      disabled={idx === photos.length - 1}
                      title={t('moveDownBtn')}
                      className="btn-press rounded-sm bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                </div>
              </div>
              {/* Légende éditable */}
              <input
                type="text"
                value={p.caption ?? ''}
                onChange={(e) => handleCaption(p.id, e.target.value)}
                onBlur={(e) => commitCaption(p.id, e.target.value || null)}
                placeholder={t('captionPlaceholder')}
                maxLength={120}
                className="border-line text-ink placeholder:text-ink-soft w-full border-t bg-transparent px-2 py-1.5 text-[11px] focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
