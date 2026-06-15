import { ref } from "vue";

export type ToastVariant = "success" | "error" | "info";

export interface ToastShowOptions {
  duration?: number;
  variant?: ToastVariant;
  title?: string;
  description?: string;
}

const message = ref("");
const title = ref("");
const description = ref("");
const variant = ref<ToastVariant>("success");
const visible = ref(false);
let timer = 0;

function inferVariant(msg: string): ToastVariant {
  if (/\bfail(ed|ure)?\b|\berror\b|\bblock(ed)?\b/i.test(msg)) return "error";
  return "success";
}

export function useToast() {
  function dismiss() {
    visible.value = false;
    clearTimeout(timer);
  }

  function toast(msg: string, options?: number | ToastShowOptions) {
    const opts: ToastShowOptions = typeof options === "number" ? { duration: options } : (options ?? {});
    const duration = opts.duration ?? 2000;

    message.value = msg;
    title.value = opts.title ?? msg;
    description.value = opts.description ?? "";
    variant.value = opts.variant ?? inferVariant(msg);
    visible.value = true;

    clearTimeout(timer);
    timer = window.setTimeout(dismiss, duration);
  }

  return { message, title, description, variant, visible, toast, dismiss };
}
