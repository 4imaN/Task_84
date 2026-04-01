import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        canvas: '#f4efe3',
        ink: '#211f1a',
        brass: '#8d5b2d',
        pine: '#1d3a33',
        fog: '#d7ded6',
      },
      fontFamily: {
        display: ['"Palatino Linotype"', '"Book Antiqua"', 'Palatino', 'serif'],
        body: ['Georgia', '"Times New Roman"', 'serif'],
        ui: ['"Avenir Next"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
