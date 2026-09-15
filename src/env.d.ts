/// <reference types="astro/client" />

/**
 * Scoped declarations for Starlight's injected virtual component modules.
 * Starlight resolves these modules through its Vite plugin at build time but
 * does not ship ambient type declarations for them.
 */
declare module 'virtual:starlight/components/Search' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
  const Search: AstroComponentFactory;
  export default Search;
}

declare module 'virtual:starlight/components/ThemeSelect' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
  const ThemeSelect: AstroComponentFactory;
  export default ThemeSelect;
}

declare module 'virtual:starlight/components/MobileMenuToggle' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
  const MobileMenuToggle: AstroComponentFactory;
  export default MobileMenuToggle;
}
