import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, X } from 'lucide-react';
import styles from './DialogContext.module.css';

type DialogVariant = 'info' | 'error' | 'success' | 'warning';
interface DialogOptions { title?: string; variant?: DialogVariant; confirmLabel?: string; cancelLabel?: string; }
interface ActiveDialog extends DialogOptions { message: string; isConfirmation: boolean; resolve: (value: boolean) => void; }
interface DialogContextValue { showAlert: (message: string, options?: DialogOptions) => Promise<void>; showConfirm: (message: string, options?: DialogOptions) => Promise<boolean>; }
const DialogContext = createContext<DialogContextValue | null>(null);
const dialogDefaults: Record<DialogVariant, { title: string; Icon: typeof AlertCircle }> = {
  info: { title: 'แจ้งให้ทราบ', Icon: AlertCircle }, error: { title: 'เกิดข้อผิดพลาด', Icon: AlertCircle },
  success: { title: 'ดำเนินการสำเร็จ', Icon: CheckCircle2 }, warning: { title: 'โปรดยืนยันรายการ', Icon: HelpCircle },
};

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback((result: boolean) => setDialog((current) => { current?.resolve(result); return null; }), []);
  const showAlert = useCallback((message: string, options: DialogOptions = {}) => new Promise<void>((resolve) => setDialog({ message, isConfirmation: false, resolve: () => resolve(), ...options })), []);
  const showConfirm = useCallback((message: string, options: DialogOptions = {}) => new Promise<boolean>((resolve) => setDialog({ message, isConfirmation: true, resolve, ...options })), []);
  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDialog(false); };
    window.addEventListener('keydown', onKeyDown); confirmButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, dialog]);
  const variant = dialog?.variant ?? (dialog?.isConfirmation ? 'warning' : 'info');
  const { title: defaultTitle, Icon } = dialogDefaults[variant];
  return <DialogContext.Provider value={{ showAlert, showConfirm }}>
    {children}
    {dialog && <div className={styles.backdrop} role="presentation" onMouseDown={() => closeDialog(false)}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" onMouseDown={(event) => event.stopPropagation()}>
        <div className={`${styles.icon} ${styles[variant]}`}><Icon size={25} aria-hidden="true" /></div>
        <button className={styles.close} type="button" onClick={() => closeDialog(false)} aria-label="ปิดหน้าต่าง"><X size={20} /></button>
        <div className={styles.content}><h2 id="app-dialog-title">{dialog.title ?? defaultTitle}</h2><p id="app-dialog-message">{dialog.message}</p></div>
        <div className={styles.actions}>
          {dialog.isConfirmation && <button className={styles.cancel} type="button" onClick={() => closeDialog(false)}>{dialog.cancelLabel ?? 'ยกเลิก'}</button>}
          <button ref={confirmButtonRef} className={styles.confirm} type="button" onClick={() => closeDialog(true)}>{dialog.confirmLabel ?? 'ตกลง'}</button>
        </div>
      </section>
    </div>}
  </DialogContext.Provider>;
}
export function useDialog() { const context = useContext(DialogContext); if (!context) throw new Error('useDialog must be used within DialogProvider'); return context; }
