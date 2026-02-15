import { useEffect, useState, useCallback } from 'react';
import { create } from 'zustand';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  exiting?: boolean;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (message: string, type: ToastItem['type']) => void;
  remove: (id: number) => void;
  markExiting: (id: number) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (message, type) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 300);
    }, 3500);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  markExiting: (id) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    })),
}));

export function toast(message: string, type: ToastItem['type'] = 'info') {
  useToastStore.getState().add(message, type);
}

const ICONS: Record<string, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
};

const BG: Record<string, string> = {
  success: 'bg-green-500/15 border-green-500/30 text-green-300',
  error: 'bg-red-500/15 border-red-500/30 text-red-300',
  info: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-lg border backdrop-blur-sm shadow-lg text-sm flex items-center gap-2 transition-all duration-300 ${BG[t.type]} ${
            t.exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
          }`}
        >
          <span>{ICONS[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
