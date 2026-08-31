/** @type {import('tailwindcss').Config} */

// CHAI palette, from the CHAI Identity Guide.
// Brand values are exact. The few interpolated tints are marked and exist only
// for interface states (hover, active, borders) that the guide does not cover.
const BRAND = {
  darkBlue: '#003E78', // primary - logo, headings, first choice for non-black
  turquoise: '#117996', // primary accent
  gold: '#F3B71B', // alternate accent
  lightBlue: '#D5E7EF', // light background
  lightGrey: '#F2F2F2', // light background
  lightGold: '#F8D476', // light background
  lightTurquoise: '#46C6EA',
  mediumBlue: '#158CFF',
  darkGold: '#C08E0A',
  teal: '#6EDBCD',
  darkTeal: '#218477',
  green: '#1ED37F',
  darkGreen: '#169E5F',
  darkRed: '#7C1220',
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Named brand tokens - use these when you mean a specific brand color.
        chaiBlue: BRAND.darkBlue,
        chaiTurquoise: BRAND.turquoise,
        chaiGold: BRAND.gold,
        chaiLightBlue: BRAND.lightBlue,
        chaiLightGrey: BRAND.lightGrey,
        chaiLightGold: BRAND.lightGold,
        chaiGreen: BRAND.green,
        chaiDarkGreen: BRAND.darkGreen,
        chaiDarkRed: BRAND.darkRed,
        chaiTeal: BRAND.teal,
        chaiDarkTeal: BRAND.darkTeal,
        chaiDarkGold: BRAND.darkGold,
        chaiLightTurquoise: BRAND.lightTurquoise,
        chaiMediumBlue: BRAND.mediumBlue,

        // Numeric ramp, so ordinary Tailwind utilities work. Anchored on the
        // brand wherever the guide defines a value.
        chai: {
          50: BRAND.lightGrey, //  brand - Light Grey
          100: BRAND.lightBlue, // brand - Light Blue
          200: '#B8D5E4', //       tint  - borders, dividers
          300: '#8FBBD2', //       tint  - disabled text on light
          400: BRAND.lightTurquoise, // brand - Light Turquoise
          500: BRAND.turquoise, // brand - Turquoise, focus rings
          600: BRAND.darkBlue, //  brand - Dark Blue, primary actions
          700: '#00305D', //       tint  - hover on primary
          800: '#002343', //       tint  - active on primary
          900: '#001A33', //       tint  - deepest
        },
      },
      // Any bare `ring` utility should land on Turquoise, not Tailwind's default
      // blue-500, which is not a CHAI color.
      ringColor: { DEFAULT: BRAND.turquoise },
      ringOffsetColor: { DEFAULT: '#FFFFFF' },
      fontFamily: {
        // Trebuchet MS is the CHAI standard precisely because it ships with
        // every Windows and Mac install - no webfont, no fallback rendering,
        // identical on every colleague's machine. Fira Sans is the approved
        // alternative for externally designed material.
        sans: [
          'Trebuchet MS',
          'Fira Sans',
          'Lucida Grande',
          'Lucida Sans Unicode',
          'Tahoma',
          'sans-serif',
        ],
        // Khmer script is not covered by the CHAI Identity Guide, and Trebuchet
        // MS has no Khmer glyphs. Noto Sans Khmer is used for Khmer text only.
        // Worth confirming with CHAI Global Communications before anything
        // high-visibility ships.
        kh: ['Noto Sans Khmer', 'Khmer OS', 'sans-serif'],
      },
      keyframes: {
        'slide-in': {
          from: { transform: 'translateX(110%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}
