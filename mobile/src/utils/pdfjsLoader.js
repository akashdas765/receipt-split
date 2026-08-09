// pdfjs-dist + its ~1MB worker are only needed by (uncommon) PDF upload
// paths — load them on first use instead of bundling into the initial page
// load. Shared by ScanPage (receipt PDFs) and the statement PDF parser
// (bank/CC statement PDFs) so both reuse the same singleton load and worker
// configuration instead of loading the library twice.
let pdfjsLibPromise = null;

export function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrlModule]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}
