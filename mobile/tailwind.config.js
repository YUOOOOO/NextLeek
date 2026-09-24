/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../frontend/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0d0f14",
        panel: "#1a1e29",
        line: "#283042",
        accent: "#6799fe",
      },
    },
  },
  plugins: [],
};
