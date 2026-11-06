import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeSelector, type ThemeOption } from '../vendor/rare-ui/theme-selector';
import { appearancePalette, DEFAULT_ACCENT } from '../shared/appearance.js';

function previewPalette(color: string, dark: boolean) {
  const palette = appearancePalette(color, dark);
  return { sidebar: palette['--bg'], panel: palette['--surface'], border: palette['--line'], strong: palette['--primary'], muted: palette['--line'], tile: palette['--raised'] };
}

// The official component is imported without modifying its implementation.
// This app adapter supplies Chinese labels, palettes and persisted settings.
export function mountThemeSelector(container: HTMLElement, value: string, darkSystem: boolean, onChange: (value: string) => void, color = DEFAULT_ACCENT) {
  const root = createRoot(container);
  let selected = value, systemDark = darkSystem, accent = color, firstCommit = true;
  let resolveMounted: (controller: ReturnType<typeof controllerValue>) => void;
  const mounted = new Promise<ReturnType<typeof controllerValue>>(resolve => { resolveMounted = resolve; });
  function controllerValue() {
    return {
      update(next: string, dark: boolean, color = accent) { if (next === selected && dark === systemDark && color === accent) return; selected = next; systemDark = dark; accent = color; render(); },
      destroy() { root.unmount(); },
    };
  }
  const controller = controllerValue();
  function App() {
    useLayoutEffect(() => {
      if (firstCommit) { firstCommit = false; resolveMounted(controller); }
    });
    const themes: ThemeOption[] = [
      { value: 'light', label: '浅色', colors: previewPalette(accent, false) },
      { value: 'dark', label: '深色', colors: previewPalette(accent, true) },
      { value: 'system', label: '随系统', colors: previewPalette(accent, systemDark) },
    ];
    return <ThemeSelector themes={themes} value={selected} onChange={onChange} aria-label="外观主题" className="rare-theme-control" itemClassName="rare-theme-item" />;
  }
  function render() { root.render(<App />); }
  render();
  return mounted;
}
