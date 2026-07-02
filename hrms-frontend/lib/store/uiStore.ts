"use client";
import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  toggleSidebarCollapsed: () => void;
  toggleMobileDrawer: () => void;
  setMobileDrawerOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileDrawerOpen: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleMobileDrawer: () => set((s) => ({ mobileDrawerOpen: !s.mobileDrawerOpen })),
  setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),
}));
