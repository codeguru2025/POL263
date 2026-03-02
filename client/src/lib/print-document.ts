/**
 * Opens a PDF URL in a new window and triggers the browser's native print
 * dialog. The native dialog surfaces every printer connected to the computer
 * (physical, network, and virtual such as "Save as PDF").
 */
export function printDocument(pdfUrl: string) {
  const win = window.open(pdfUrl, "_blank", "noopener");
  if (!win) {
    window.open(pdfUrl, "_blank");
    return;
  }
  win.addEventListener("load", () => {
    setTimeout(() => win.print(), 400);
  });
}
