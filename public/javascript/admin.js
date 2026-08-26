document.addEventListener("click", async function (e) {

    const link = e.target.closest(".admin-page-link");

    if (!link) return;

    e.preventDefault();

    const url = link.getAttribute("href");

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to load page: ${response.status}`);
        }

        const html = await response.text();

        document.querySelector("#admin-content").innerHTML = html;

    }catch (error) {

    console.error(error);

    document.querySelector("#admin-content").innerHTML = `
        <p>Something went wrong while loading the page.</p>
        <p>${error.message}</p>
    `;
}
});document.addEventListener("click", function (e) {

    const button = e.target.closest(".status-toggle button");

    if (!button) return;

    console.log("BUTTON CLICK:", button.dataset.status);

    const group = button.closest(".status-toggle");

    // Remove active colors from both
    group.querySelector('[data-status="present"]')
        .classList.remove("btn-success");

    group.querySelector('[data-status="absent"]')
        .classList.remove("btn-danger");

    // Add active color
    if (button.dataset.status === "present") {
        button.classList.add("btn-success");
    } else {
        button.classList.add("btn-danger");
    }

});