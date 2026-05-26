/**
 * Configuration STATIQUE du salon Aboodhairsalon.
 *
 * C'est la source de vérité de l'identité de marque pour cette installation.
 * Toutes les valeurs ici sont HARDCODÉES — pas de runtime fetch, pas de
 * dépendance à la DB. Lors d'un fork pour un nouveau salon partenaire, c'est
 * le fichier #1 à éditer.
 *
 * Pour les valeurs qui DOIVENT être éditables par le gérant (taxes, horaires,
 * adresse de l'expéditeur email, etc.), voir la table `salon_settings`
 * (1 ligne unique) et le helper `getSalonSettings()` dans `@/lib/salon-settings`.
 */

export const SALON = {
  /** Nom commercial — affiché partout (header, emails, OG, etc.). */
  name: 'Aboodhairsalon',

  /** Slug ASCII — utilisé pour les keys storage, identifiants techniques.
   *  Stable forever, ne JAMAIS le changer après le premier déploiement. */
  slug: 'aboodhairsalon',

  /** Description courte (tagline). Utilisée en meta-description fallback. */
  tagline: 'Salon de coiffure homme — Alexandrie',

  /** URL canonique de la vitrine. Doit matcher NEXT_PUBLIC_SITE_URL. */
  url: 'https://aboodhairsalon.com',

  /** Adresse postale (affichée sur la vitrine + emails). */
  address: {
    street: '',
    city: 'Alexandrie',
    country: 'Égypte',
    countryCode: 'EG',
  },

  /** Coordonnées de contact publiques. */
  contact: {
    phone: '+20 XXX XXX XXXX', // à remplir avec le vrai numéro
    email: 'contact@aboodhairsalon.com',
    instagram: 'aboodhairsalon',
    instagramUrl: 'https://instagram.com/aboodhairsalon',
    googleMapsUrl: '', // à remplir avec le lien Maps réel
  },

  /** Fuseau horaire — utilisé pour les conversions UTC↔local côté serveur. */
  timezone: 'Africa/Cairo',

  /** Devise — 3 lettres ISO 4217. Égypte = EGP (livre égyptienne). */
  currency: 'EGP',

  /** Locale par défaut pour le formatage monétaire (Intl.NumberFormat). */
  currencyLocale: 'en-EG',

  /** Couleurs de marque — DOIVENT matcher --color-brand-* dans globals.css.
   *  Dupliquées ici pour les helpers JS qui ont besoin des hex (ex. génération
   *  d'OG image, email templates, charts). */
  brand: {
    primary: '#d08c4f',
    glow: '#e8a867',
    deep: '#9b5f26',
  },

  /** Espaces — URLs canoniques. Utilisées pour les redirects after-login,
   *  les liens partagés depuis les emails, etc. */
  spaces: {
    /** Vitrine + booking public. */
    site: 'https://aboodhairsalon.com',
    /** Espace caisse — accès équipe. */
    cashier: 'https://cashier.aboodhairsalon.com',
    /** Espace direction — accès gérant. */
    manager: 'https://manager.aboodhairsalon.com',
  },
} as const;

export type SalonConfig = typeof SALON;
