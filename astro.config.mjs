import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  site: 'https://kem0-kem.github.io',
  base: '/pf-8f3a2c',
  integrations: [mdx(), tailwind()]
});