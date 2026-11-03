/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nibo: {
          navy: '#14233c',
          navyDark: '#0e1a2e',
          blue: '#0070e0',
          blueHover: '#005bb5',
          blueLight: '#e6effc',
          blueBorder: '#b9d5fc',
          bg: '#f4f6f9',
          border: '#e2e8f0',
          textDark: '#1e293b',
          textMuted: '#64748b',
          red: '#d32f2f',
          green: '#16a34a',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
