import type { ComponentType, ReactNode } from "react";

export type ToastVariant = "default" | "success" | "critical";
export type ToastPosition = "top" | "bottom";

export interface ToastData {
    text: string;
    variant?: ToastVariant;
    position?: ToastPosition;
    duration?: number;

    icon?: ComponentType;
    iconColor?: any;
    secondaryIconColor?: any;
    surface?: string;

    /**
     * Renders custom content instead of `text`/`icon`.
     * Discord's own escape hatch, called during the toast render.
     */
    __dangerouslyRenderContent?: () => ReactNode;
}

export type showToast = (data: ToastData) => void;
