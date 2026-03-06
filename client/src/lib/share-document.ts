/**
 * Cross-platform document sharing via the Web Share API with PDF blob support.
 * Falls back to opening the URL in a new tab when share isn't available.
 */
export async function shareDocument(
  url: string,
  title: string,
  text?: string,
): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        const blob = await response.blob();
        const ext = blob.type.includes("pdf") ? ".pdf" : "";
        const filename = `${title.replace(/[^a-zA-Z0-9_\- ]/g, "")}${ext}`;
        const file = new File([blob], filename, { type: blob.type });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title, text: text ?? title, files: [file] });
          return true;
        }
      }
      await navigator.share({ title, text: text ?? title, url });
      return true;
    } catch {
      return false;
    }
  }
  window.open(url, "_blank", "noopener");
  return false;
}
