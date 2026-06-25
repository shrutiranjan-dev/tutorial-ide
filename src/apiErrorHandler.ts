import { ToastType } from "./ToastContext";

type ToastHandler = (message: string, type?: ToastType) => void;

/**
 * Wraps an API call to provide standardized error handling and notifications.
 * @param call The async API function to execute.
 * @param toastHandler The showToast function from ToastContext.
 * @param errorMessage Custom error message to show in the toast.
 * @returns The result of the API call or null if it failed.
 */
export async function withApiError<T>(
  call: Promise<T> | (() => Promise<T>),
  toastHandler: ToastHandler,
  errorMessage: string = "An unexpected error occurred"
): Promise<T | null> {
  try {
    return await (typeof call === "function" ? call() : call);
  } catch (error) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : errorMessage;
    toastHandler(message, "danger");
    return null;
  }
}
