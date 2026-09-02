// Progressive enhancement only: without this file the form still posts
// normally and the server answers with a thank-you page.
(function () {
  var form = document.getElementById("contact-form");
  if (!form) return;

  var thanks = document.getElementById("contact-thanks");
  var btn = form.querySelector("button[type=submit]");
  var err = form.querySelector(".form__error");
  var label = btn ? btn.textContent : "";

  form.setAttribute("novalidate", "");

  form.addEventListener("submit", function (e) {
    if (!form.checkValidity()) return; // let the browser show its own hints
    e.preventDefault();

    err.textContent = "";
    btn.disabled = true;
    btn.textContent = "Sending…";

    fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json" },
      // URLSearchParams keeps the request form-encoded, so the same
      // endpoint handles JS and no-JS submissions with one parser.
      body: new URLSearchParams(new FormData(form))
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: r.ok };
        });
      })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Something went wrong.");
        form.hidden = true;
        thanks.hidden = false;
        thanks.focus();
      })
      .catch(function (e) {
        err.textContent =
          e.message + " You can also email me directly.";
        btn.disabled = false;
        btn.textContent = label;
      });
  });
})();
