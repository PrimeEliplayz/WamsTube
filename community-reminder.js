"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const publish = document.getElementById("publishButton");
    if (!publish) return;
    publish.addEventListener("click", event => {
        const confirmed = window.confirm("Community guidelines reminder: publish only school-appropriate videos, respect privacy and copyright, and make sure you have permission before featuring other students.");
        if (!confirmed) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
});
