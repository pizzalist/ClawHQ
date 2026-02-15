/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1a1b2e',
        panel: '#232440',
        accent: '#6366f1',
      },
    },
  },
  plugins: [],
};
