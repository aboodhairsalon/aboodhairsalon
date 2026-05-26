/**
 * PostCSS config — Tailwind v4 (beta).
 *
 * Tailwind v4 a remplacé tailwind.config.js par une directive CSS
 * `@theme` dans globals.css. Plus de config JS, juste ce postcss.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
