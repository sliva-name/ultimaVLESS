import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@/shared/ipc';

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let disposed = false;

    void window.electronAPI
      .getUpdateStatus()
      .then((initial) => {
        if (!disposed) setStatus(initial);
      })
      .catch(() => undefined);

    const remove = window.electronAPI.onUpdateStatus((next) => {
      setStatus(next);
      if (next.stage === 'available' || next.stage === 'downloaded') {
        setDismissed(false);
      }
    });

    return () => {
      disposed = true;
      remove();
    };
  }, []);

  return {
    status,
    dismissed,
    dismiss: () => setDismissed(true),
    installUpdate: () => window.electronAPI.installUpdate(),
  };
}
