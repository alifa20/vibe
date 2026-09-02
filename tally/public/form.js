/* Client-side validation. The server re-validates everything; this only makes
   mistakes visible before a round trip. */
(function () {
  'use strict';

  var form = document.querySelector('form[data-validate]');
  if (!form) return;

  var maxBytes = parseInt(form.dataset.maxBytes || '0', 10);
  var EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  function fieldEl(input) {
    return input.closest('.field');
  }

  function setError(input, message) {
    var wrap = fieldEl(input);
    if (!wrap) return;
    var slot = wrap.querySelector('.error');
    if (!slot) {
      slot = document.createElement('span');
      slot.className = 'error';
      wrap.appendChild(slot);
    }
    if (message) {
      wrap.classList.add('has-error');
      slot.textContent = message;
      input.setAttribute('aria-invalid', 'true');
    } else {
      wrap.classList.remove('has-error');
      slot.textContent = '';
      input.removeAttribute('aria-invalid');
    }
  }

  function validate(input) {
    var required = input.hasAttribute('required');
    var type = input.dataset.type;

    if (type === 'checkbox') {
      return setError(input, required && !input.checked ? 'This box must be checked.' : '');
    }

    if (type === 'file') {
      var file = input.files && input.files[0];
      if (required && !file) return setError(input, 'A file is required.');
      if (file && maxBytes && file.size > maxBytes) {
        return setError(
          input,
          'That file is ' + (file.size / 1048576).toFixed(1) + ' MB — the limit is ' +
            (maxBytes / 1048576) + ' MB.'
        );
      }
      return setError(input, '');
    }

    var value = (input.value || '').trim();
    if (required && !value) {
      return setError(input, type === 'select' ? 'Please choose an option.' : 'This field is required.');
    }
    if (type === 'email' && value && !EMAIL.test(value)) {
      return setError(input, 'Please enter a valid email address.');
    }
    if (input.maxLength > 0 && value.length > input.maxLength) {
      return setError(input, 'Please keep this under ' + input.maxLength + ' characters.');
    }
    return setError(input, '');
  }

  var inputs = Array.prototype.slice.call(form.querySelectorAll('[data-type]'));

  inputs.forEach(function (input) {
    var event = input.dataset.type === 'select' || input.dataset.type === 'checkbox' ||
      input.dataset.type === 'file' ? 'change' : 'blur';
    input.addEventListener(event, function () { validate(input); });
    input.addEventListener('input', function () {
      if (fieldEl(input) && fieldEl(input).classList.contains('has-error')) validate(input);
    });
  });

  form.addEventListener('submit', function (event) {
    var firstBad = null;
    inputs.forEach(function (input) {
      validate(input);
      var wrap = fieldEl(input);
      if (!firstBad && wrap && wrap.classList.contains('has-error')) firstBad = input;
    });

    if (firstBad) {
      event.preventDefault();
      firstBad.focus();
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    var button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.dataset.label = button.textContent;
      button.textContent = 'Sending…';
      // Re-enable if the navigation is cancelled (e.g. the user hits back).
      setTimeout(function () {
        button.disabled = false;
        button.textContent = button.dataset.label;
      }, 15000);
    }
  });

  // Native constraint bubbles would duplicate our messages.
  form.setAttribute('novalidate', 'novalidate');
})();
