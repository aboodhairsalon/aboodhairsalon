'use client';

/**
 * PushBellToggle — bouton « cloche » compact pour (dé)activer les notifications
 * push depuis le header. Pensé pour l'espace Caisse : le poste en salle doit
 * pouvoir s'abonner en un tap aux alertes de nouvelle réservation / annulation.
 *
 * Même logique que `manager/PushNotificationsCard.tsx` (la grosse carte des
 * Paramètres gérant) mais au format icône, et réutilisant EXACTEMENT les mêmes
 * Server Actions (`getPushPublicKey` / `subscribePush` / `unsubscribePush`),
 * qui sont déjà role-agnostiques (`requireAnyTenantRole`).
 *
 * États :
 *  - `loading` / `hidden` → rien (push non supporté ou VAPID non configuré).
 *  - `idle`       → cloche barrée + pastille d'accent (invite à activer).
 *  - `subscribed` → cloche pleine couleur marque.
 *
 * Prérequis : le service worker (`/sw.js`) doit être enregistré — c'est fait
 * globalement par `ServiceWorkerRegister` monté dans le root layout. Sans SW,
 * `navigator.serviceWorker.ready` ne résout pas et le bouton reste masqué.
 *
 * Feedback : le changement d'icône (barrée → pleine) EST le retour visuel
 * principal. Les toasts sont un bonus (no-op silencieux hors ToastProvider).
 */
import { Bell, BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useToast } from './Toast';
import { getPushPublicKey, subscribePush, unsubscribePush } from '../manager/push-actions';

/** Convertit une base64url en Uint8Array (format attendu par PushManager). */
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

type State = 'loading' | 'hidden' | 'idle' | 'subscribed';

export function PushBellToggle() {
  const t = useTranslations('manager.push');
  const toast = useToast();
  const [state, setState] = useState<State>('loading');
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('hidden');
      return;
    }
    const keyRes = await getPushPublicKey();
    if (!keyRes.ok) {
      setState('hidden'); // VAPID non configuré côté serveur
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setState(existing ? 'subscribed' : 'idle');
    } catch {
      setState('idle');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = () => {
    startTransition(async () => {
      const keyRes = await getPushPublicKey();
      if (!keyRes.ok) {
        toast.error(t('errorNotConfigured'));
        setState('hidden');
        return;
      }
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = 'denied';
      }
      if (permission !== 'granted') {
        toast.error(t('errorPermissionDenied'));
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) as unknown as BufferSource,
        });
        const json = sub.toJSON();
        const res = await subscribePush({
          endpoint: json.endpoint ?? sub.endpoint,
          keys: {
            p256dh: json['keys']?.['p256dh'] ?? '',
            auth: json['keys']?.['auth'] ?? '',
          },
          userAgent: navigator.userAgent.slice(0, 500),
        });
        if (!res.ok) {
          toast.error(t('errorEnableFailed'));
          await sub.unsubscribe().catch(() => {});
          return;
        }
        toast.success(t('toastEnabled'));
        setState('subscribed');
      } catch {
        toast.error(t('errorEnableFailed'));
      }
    });
  };

  const disable = () => {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await unsubscribePush(existing.endpoint);
          await existing.unsubscribe();
        }
        toast.success(t('toastDisabled'));
        setState('idle');
      } catch {
        toast.error(t('errorDisableFailed'));
      }
    });
  };

  if (state === 'loading' || state === 'hidden') return null;

  const subscribed = state === 'subscribed';
  return (
    <button
      type="button"
      onClick={subscribed ? disable : enable}
      disabled={pending}
      aria-label={subscribed ? t('disableBtn') : t('enableBtn')}
      title={subscribed ? t('subscribed') : t('enableBtn')}
      className={`btn-press relative rounded-sm p-2 transition-colors disabled:opacity-50 ${
        subscribed
          ? 'text-brand-primary hover:bg-surface'
          : 'text-ink-mute hover:text-ink hover:bg-surface'
      }`}
    >
      {subscribed ? (
        <Bell className="h-4 w-4" strokeWidth={2} />
      ) : (
        <BellOff className="h-4 w-4" strokeWidth={2} />
      )}
      {/* Pastille d'accent quand pas encore abonné — attire l'œil du caissier. */}
      {!subscribed && (
        <span
          className="bg-brand-primary absolute end-1 top-1 h-1.5 w-1.5 rounded-full"
          aria-hidden
        />
      )}
    </button>
  );
}
