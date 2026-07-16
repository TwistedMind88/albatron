// Snimanje fajla: u browseru anchor download, u Tauri webview-u
// (koji ne podrzava anchor download) save dijalog + fs plugin (faza 14)
export async function sacuvajFajl(ime: string, blob: Blob) {
  if ("__TAURI_INTERNALS__" in window) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const ext = ime.split(".").pop() ?? "";
    const path = await save({ defaultPath: ime, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ime;
  a.click();
  URL.revokeObjectURL(url);
}
