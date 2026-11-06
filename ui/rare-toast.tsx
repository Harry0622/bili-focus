import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastCard } from '../vendor/rare-ui/toast';

// Keep upstream intact: the adapter supplies the local actions and popup sizing.
export function mountRareToast() {
  const host = document.createElement('div'); host.id = 'rare-toast-host'; host.className = 'rare-toast-stack'; host.setAttribute('role', 'status'); host.hidden = true; document.body.append(host);
  const root = createRoot(host);
  const controller = {
    show(text: string, options: { duration: number; type?: 'success' | 'error'; action?: { label: string; onClick: () => void } }) {
      host.hidden = false;
      root.render(<ToastCard toastId="focus-feedback" type={options.type || 'success'} title={text} action={options.action} dismissible={false} />);
    },
    dismiss() { host.hidden = true; root.render(null); },
    destroy() { controller.dismiss(); root.unmount(); host.remove(); },
  };
  return new Promise<typeof controller>(resolve => {
    function App() {
      useLayoutEffect(() => { resolve(controller); }, []);
      return null;
    }
    root.render(<App />);
  });
}
