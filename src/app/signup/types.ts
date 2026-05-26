/**
 * Types partagés entre la page client `/signup` et la Server Action `actions.ts`.
 * Séparés pour éviter les pièges TDZ liés au bundling des fichiers 'use server'.
 */

/** Codes d'erreur retournés par `signUp` — le client résout chaque code
 *  contre la clé `signup.errors.<key>` du catalogue de la locale active.
 *  Permet de garder zéro chaîne FR codée en dur côté serveur. */
export type SignupErrorKey =
  | 'salonNameTooShort'
  | 'salonNameTooLong'
  | 'emailInvalid'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'slugInvalid'
  | 'slugReserved'
  | 'slugTaken'
  | 'emailTaken'
  | 'tenantCreation'
  | 'branding'
  | 'settings'
  | 'userCreation'
  | 'invalidData'
  | 'rateLimited';

export type SignupResult =
  | {
      ok: true;
      tenant: { id: string; slug: string; name: string };
    }
  | {
      ok: false;
      errorKey: SignupErrorKey;
      /** Valeurs interpolées dans le message (ex. `{slug}`, `{email}`,
       *  `{message}` pour les erreurs Supabase brutes). */
      errorValues?: Record<string, string>;
      field?: 'salonName' | 'slug' | 'email' | 'password';
    };
