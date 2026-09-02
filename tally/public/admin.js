(function () {
  'use strict';

  // Show the options box only for field types that use it.
  document.querySelectorAll('[data-type-select]').forEach(function (select) {
    var scope = select.closest('form') || document;
    var optionsRow = scope.querySelector('[data-options-row]');
    var placeholderRow = scope.querySelector('[data-placeholder-row]');
    var withOptions = (select.dataset.typeSelect || '').split(',');

    function sync() {
      var usesOptions = withOptions.indexOf(select.value) !== -1;
      if (optionsRow) optionsRow.hidden = !usesOptions;
      if (placeholderRow) placeholderRow.hidden = select.value === 'checkbox' || select.value === 'file';
    }
    select.addEventListener('change', sync);
    sync();
  });

  // Copy the public link.
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var value = button.dataset.copy;
      var done = function () {
        var original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = original; }, 1400);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(done, done);
      } else {
        var input = document.querySelector('[data-copy-source]');
        if (input) { input.select(); document.execCommand('copy'); done(); }
      }
    });
  });

  // Confirm destructive actions.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });
})();
