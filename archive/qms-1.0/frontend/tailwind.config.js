/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        'sm': '640px',   // 手机
        'md': '768px',   // 平板
        'lg': '1024px',  // 桌面
        'xl': '1280px',
        '2xl': '1536px',
      },
    },
  },
  plugins: [],
}
