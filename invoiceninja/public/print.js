// The print button. A file rather than an inline handler, so the CSP stays strict.
document.getElementById('print-button')?.addEventListener('click', () => window.print());
