import React from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import type { AppNotification } from '../types/mediquick';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onOpenOrder: (orderId: string) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  notifications,
  onOpenOrder,
}) => {
  if (!isOpen) return null;

  const markAsRead = async (notif: AppNotification) => {
    if (!notif.read) {
      try {
        await updateDoc(doc(db, 'notifications', notif.id), { read: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notifications/${notif.id}`);
      }
    }
    if (notif.orderId) {
      onClose();
      onOpenOrder(notif.orderId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-sm bg-white h-full border-l border-slate-200 shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal-600" />
            <h2 className="text-base font-bold text-slate-900">Notifications</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No notifications yet. Order updates, pharmacy responses, and delivery alerts appear here.
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void markAsRead(n)}
                className={`w-full text-left p-4 hover:bg-slate-50 transition-colors space-y-1 ${
                  !n.read ? 'bg-teal-50/40' : 'bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-bold ${
                      n.type === 'ORDER_REJECTED' || n.type === 'EMERGENCY'
                        ? 'text-red-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {n.title}
                  </span>
                  {n.read && <CheckCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
};
